//! The commit graph for the Graph tab: commits in `git log --graph --date-order` order with
//! lanes computed here, so the window only draws the rows on screen. The whole graph is laid
//! out once per set of tips and kept; pages are cut from it.

use std::{
    collections::{BinaryHeap, HashMap},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use gix::{ObjectId, bstr::ByteSlice};
use serde::{Deserialize, Serialize};

use super::log::{CommitInfo, Person};
use crate::error::{Error, Result};

fn err(e: &dyn std::fmt::Display) -> Error {
    Error::Repo(e.to_string())
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum Scope {
    /// Every branch, remote branch and tag
    All,
    /// HEAD and its upstream
    Current,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct GraphQuery {
    pub scope: Scope,
    pub remotes: bool,
    pub tags: bool,
    pub stashes: bool,
    pub skip: usize,
    pub limit: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphRef {
    /// `main`, `origin/main`, `v1.0`, `stash@{0}`
    pub name: String,
    /// `head` (checked out), `branch`, `remote`, `tag`, `stash`
    pub kind: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphRow {
    #[serde(flatten)]
    pub commit: CommitInfo,
    /// Lane of this commit's dot
    pub lane: u16,
    /// Lanes entering the dot from above (other than a straight line in `lane`)
    pub into: Vec<u16>,
    /// Lanes leaving the dot downward, to this commit's parents
    pub out: Vec<u16>,
    /// Lanes passing straight through this row
    pub pass: Vec<u16>,
    /// Whether a line comes into the dot from above in its own lane
    pub continues: bool,
    pub refs: Vec<GraphRef>,
    pub stash: bool,
    /// Reachable from HEAD (on the current branch)
    pub current: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphPage {
    pub rows: Vec<GraphRow>,
    pub more: bool,
    pub total: usize,
    /// Widest row in the whole graph, so column width doesn't jump between pages
    pub lanes: u16,
}

struct Node {
    id: ObjectId,
    parents: Vec<ObjectId>,
    time: i64,
}

struct Layout {
    lane: u16,
    into: Vec<u16>,
    out: Vec<u16>,
    pass: Vec<u16>,
    continues: bool,
}

struct Graph {
    nodes: Vec<Node>,
    layout: Vec<Layout>,
    lanes: u16,
    on_head: std::collections::HashSet<ObjectId>,
}

/// Commits reachable from `head` within the graph.
fn reachable(nodes: &[Node], head: Option<ObjectId>) -> std::collections::HashSet<ObjectId> {
    let parents: HashMap<ObjectId, &[ObjectId]> = nodes.iter().map(|n| (n.id, n.parents.as_slice())).collect();
    let mut seen = std::collections::HashSet::new();
    let mut stack: Vec<ObjectId> = head.into_iter().collect();
    while let Some(id) = stack.pop() {
        if seen.insert(id)
            && let Some(ps) = parents.get(&id)
        {
            stack.extend(ps.iter().copied());
        }
    }
    seen
}

/// Graphs laid out so far, by repository; replaced when the tips or options change.
#[derive(Default)]
pub struct GraphCache {
    graphs: Mutex<HashMap<PathBuf, (u64, Arc<Graph>)>>,
}

/// Starting commits, ref labels by commit, and stash commits.
type Tips = (Vec<ObjectId>, HashMap<ObjectId, Vec<GraphRef>>, std::collections::HashSet<ObjectId>);

fn tips_and_refs(repo: &gix::Repository, query: &GraphQuery) -> Result<Tips> {
    let head = super::status::head(repo);
    let head_id = repo.head_id().ok().map(|id| id.detach());
    let upstream =
        head.branch.as_deref().and_then(|b| head_id.and_then(|id| super::status::branch_upstream(repo, b, id)));
    let mut tips = Vec::new();
    let mut refs: HashMap<ObjectId, Vec<GraphRef>> = HashMap::new();
    let mut add = |id: ObjectId, name: String, kind: &'static str, tip: bool, tips: &mut Vec<ObjectId>| {
        if tip {
            tips.push(id);
        }
        refs.entry(id).or_default().push(GraphRef { name, kind });
    };
    if let Some(id) = head_id
        && head.detached
    {
        add(id, "HEAD".into(), "head", true, &mut tips);
    }
    for reference in super::refs::refs(repo)? {
        let Some(id) = reference.commit.as_deref().and_then(|c| ObjectId::from_hex(c.as_bytes()).ok()) else {
            continue;
        };
        let current =
            head.branch.as_deref() == Some(reference.short.as_str()) && reference.kind == super::refs::RefKind::Branch;
        let is_upstream = upstream.as_ref().is_some_and(|u| u.name == reference.short)
            && reference.kind == super::refs::RefKind::Remote;
        let (kind, wanted) = match reference.kind {
            super::refs::RefKind::Branch => {
                (if current { "head" } else { "branch" }, query.scope == Scope::All || current)
            }
            super::refs::RefKind::Remote => ("remote", query.remotes && (query.scope == Scope::All || is_upstream)),
            super::refs::RefKind::Tag => ("tag", query.tags && query.scope == Scope::All),
        };
        // Labels show on commits in the graph even when their ref isn't a starting point
        add(id, reference.short, kind, wanted, &mut tips);
    }
    let mut stashes = std::collections::HashSet::new();
    if query.stashes && query.scope == Scope::All {
        for stash in super::refs::stashes(repo)? {
            if let Ok(id) = ObjectId::from_hex(stash.commit.as_bytes()) {
                stashes.insert(id);
                add(id, format!("stash@{{{}}}", stash.index), "stash", true, &mut tips);
            }
        }
    }
    tips.sort();
    tips.dedup();
    Ok((tips, refs, stashes))
}

/// Commits reachable from `tips`, children before parents, newer first among the ready ones
/// (`--date-order`). Stash commits keep only their first parent, hiding the index commit.
fn order(
    repo: &gix::Repository,
    tips: &[ObjectId],
    stashes: &std::collections::HashSet<ObjectId>,
) -> Result<Vec<Node>> {
    let mut nodes: HashMap<ObjectId, Node> = HashMap::new();
    let mut stack: Vec<ObjectId> = tips.to_vec();
    while let Some(id) = stack.pop() {
        if nodes.contains_key(&id) {
            continue;
        }
        let commit = repo.find_commit(id).map_err(|e| err(&e))?;
        let decoded = commit.decode().map_err(|e| err(&e))?;
        let mut parents: Vec<ObjectId> = decoded.parents().collect();
        if stashes.contains(&id) {
            parents.truncate(1);
        }
        let time = decoded.committer().map(|c| c.time().map(|t| t.seconds).unwrap_or_default()).unwrap_or_default();
        stack.extend(parents.iter().copied());
        nodes.insert(id, Node { id, parents, time });
    }
    let mut children: HashMap<ObjectId, usize> = HashMap::new();
    for node in nodes.values() {
        for p in &node.parents {
            *children.entry(*p).or_default() += 1;
        }
    }
    let mut ready: BinaryHeap<(i64, ObjectId)> =
        nodes.values().filter(|n| !children.contains_key(&n.id)).map(|n| (n.time, n.id)).collect();
    let mut out = Vec::with_capacity(nodes.len());
    while let Some((_, id)) = ready.pop() {
        let Some(node) = nodes.remove(&id) else { continue };
        for p in &node.parents {
            if let Some(count) = children.get_mut(p) {
                *count -= 1;
                if *count == 0
                    && let Some(parent) = nodes.get(p)
                {
                    ready.push((parent.time, *p));
                }
            }
        }
        out.push(node);
    }
    Ok(out)
}

/// Assigns lanes: each lane waits for one commit; a commit takes the leftmost lane waiting
/// for it, its first parent continues in that lane and other parents get their own.
fn layout(nodes: &[Node]) -> (Vec<Layout>, u16) {
    let mut lanes: Vec<Option<ObjectId>> = Vec::new();
    let mut out = Vec::with_capacity(nodes.len());
    let mut widest = 0u16;
    let free = |lanes: &mut Vec<Option<ObjectId>>| match lanes.iter().position(Option::is_none) {
        Some(i) => i,
        None => {
            lanes.push(None);
            lanes.len() - 1
        }
    };
    for node in nodes {
        let waiting: Vec<usize> =
            lanes.iter().enumerate().filter(|(_, l)| **l == Some(node.id)).map(|(i, _)| i).collect();
        let continues = !waiting.is_empty();
        let lane = match waiting.first() {
            Some(&i) => i,
            None => free(&mut lanes),
        };
        let into: Vec<u16> = waiting.iter().skip(1).map(|&i| i as u16).collect();
        for &i in &waiting {
            lanes[i] = None;
        }
        let pass: Vec<u16> =
            lanes.iter().enumerate().filter(|(i, l)| l.is_some() && *i != lane).map(|(i, _)| i as u16).collect();

        let mut outs = Vec::new();
        for (n, parent) in node.parents.iter().enumerate() {
            if let Some(existing) = lanes.iter().position(|l| *l == Some(*parent)) {
                outs.push(existing as u16);
            } else if n == 0 {
                lanes[lane] = Some(*parent);
                outs.push(lane as u16);
            } else {
                let i = free(&mut lanes);
                lanes[i] = Some(*parent);
                outs.push(i as u16);
            }
        }
        widest = widest.max(lanes.len() as u16).max(lane as u16 + 1);
        // Trailing empty lanes can go
        while lanes.last().is_some_and(Option::is_none) {
            lanes.pop();
        }
        out.push(Layout { lane: lane as u16, into, out: outs, pass, continues });
    }
    (out, widest)
}

fn signature(tips: &[ObjectId], head: Option<ObjectId>, query: &GraphQuery) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    tips.hash(&mut hasher);
    head.hash(&mut hasher);
    (query.scope, query.remotes, query.tags, query.stashes).hash(&mut hasher);
    hasher.finish()
}

impl GraphCache {
    pub fn page(&self, repo: &gix::Repository, root: &Path, query: &GraphQuery) -> Result<GraphPage> {
        let (tips, refs, stashes) = tips_and_refs(repo, query)?;
        let head = repo.head_id().ok().map(|id| id.detach());
        let key = signature(&tips, head, query);
        let cached = self.graphs.lock().unwrap().get(root).filter(|(k, _)| *k == key).map(|(_, g)| Arc::clone(g));
        let graph = match cached {
            Some(graph) => graph,
            None => {
                let nodes = order(repo, &tips, &stashes)?;
                let (layout, lanes) = layout(&nodes);
                let on_head = reachable(&nodes, head);
                let graph = Arc::new(Graph { nodes, layout, lanes, on_head });
                self.graphs.lock().unwrap().insert(root.to_path_buf(), (key, Arc::clone(&graph)));
                graph
            }
        };
        let end = (query.skip + query.limit).min(graph.nodes.len());
        let mut rows = Vec::with_capacity(end.saturating_sub(query.skip));
        for i in query.skip..end {
            let node = &graph.nodes[i];
            let layout = &graph.layout[i];
            let commit = repo.find_commit(node.id).map_err(|e| err(&e))?;
            let decoded = commit.decode().map_err(|e| err(&e))?;
            let person = |sig: gix::actor::SignatureRef<'_>| Person {
                name: sig.name.to_str_lossy().into_owned(),
                email: sig.email.to_str_lossy().into_owned(),
                time: sig.time().map(|t| t.seconds).unwrap_or_default(),
            };
            let author = decoded.author().map_err(|e| err(&e))?;
            let committer = decoded.committer().map_err(|e| err(&e))?;
            rows.push(GraphRow {
                commit: CommitInfo {
                    id: node.id.to_string(),
                    parents: node.parents.iter().map(ToString::to_string).collect(),
                    author: person(author),
                    committer: person(committer),
                    subject: decoded.message.lines().next().unwrap_or_default().to_str_lossy().into_owned(),
                    path: None,
                    status: None,
                    original_path: None,
                },
                lane: layout.lane,
                into: layout.into.clone(),
                out: layout.out.clone(),
                pass: layout.pass.clone(),
                continues: layout.continues,
                // Labels come from this read: they can move without the tips changing
                refs: refs.get(&node.id).cloned().unwrap_or_default(),
                stash: stashes.contains(&node.id),
                current: graph.on_head.contains(&node.id),
            });
        }
        Ok(GraphPage { more: end < graph.nodes.len(), total: graph.nodes.len(), lanes: graph.lanes, rows })
    }
}

#[cfg(test)]
mod tests {
    use std::process::Command;

    use super::*;

    fn git(dir: &Path, args: &[&str], n: u32) {
        let date = format!("2024-01-01T00:00:{n:02}Z");
        let status = Command::new("git")
            .args(args)
            .current_dir(dir)
            .env("GIT_AUTHOR_DATE", &date)
            .env("GIT_COMMITTER_DATE", &date)
            .status()
            .unwrap();
        assert!(status.success(), "git {args:?}");
    }

    #[test]
    fn merge_lanes() {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path();
        git(d, &["init", "-q", "-b", "main"], 0);
        git(d, &["config", "user.name", "Ann"], 0);
        git(d, &["config", "user.email", "ann@example.com"], 0);
        git(d, &["commit", "-q", "--allow-empty", "-m", "root"], 1);
        git(d, &["switch", "-q", "-c", "topic"], 1);
        git(d, &["commit", "-q", "--allow-empty", "-m", "topic work"], 2);
        git(d, &["switch", "-q", "main"], 2);
        git(d, &["commit", "-q", "--allow-empty", "-m", "main work"], 3);
        git(d, &["merge", "-q", "--no-ff", "-m", "merge topic", "topic"], 4);

        let repo = gix::open(d).unwrap();
        let query = GraphQuery { scope: Scope::All, remotes: true, tags: true, stashes: true, skip: 0, limit: 10 };
        let page = GraphCache::default().page(&repo, d, &query).unwrap();
        let got: Vec<_> = page.rows.iter().map(|r| (r.commit.subject.as_str(), r.lane, r.out.clone())).collect();
        assert_eq!(
            got,
            [
                ("merge topic", 0, vec![0, 1]),
                ("main work", 0, vec![0]),
                ("topic work", 1, vec![0]),
                ("root", 0, vec![])
            ]
        );
        assert_eq!(page.lanes, 2);
        assert_eq!(page.rows[0].refs[0].kind, "head");
        // The topic line passes beside "main work", and joins root from lane 1
        assert_eq!(page.rows[1].pass, vec![1]);
        assert!(page.rows[2].pass.contains(&0));
    }
}
