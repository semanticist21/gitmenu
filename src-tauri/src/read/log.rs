//! Commit history through gix: pages of commits for the Commits and Search & Compare views,
//! file history that follows renames (GitLens's File History), commit details with changed
//! files, and branch comparisons.

use gix::bstr::{BStr, ByteSlice};
use gix::object::tree::diff::ChangeDetached;
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

fn err(e: &dyn std::fmt::Display) -> Error {
    Error::Repo(e.to_string())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Person {
    pub name: String,
    pub email: String,
    /// Seconds since epoch
    pub time: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitInfo {
    pub id: String,
    pub parents: Vec<String>,
    pub author: Person,
    pub committer: Person,
    /// First line of the message, as written (leading whitespace kept)
    pub subject: String,
    /// File history only: the file's path in this commit (it changes across renames)
    pub path: Option<String>,
    /// File history only: how this commit changed the file
    pub status: Option<FileStatus>,
    /// File history only: the path before this commit renamed the file
    pub original_path: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FileStatus {
    Added,
    Modified,
    Deleted,
    Renamed,
    Copied,
    TypeChanged,
}

/// GitLens search operators; every non-empty list must match (values within a list are ORed).
#[derive(Debug, Default, Clone, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Search {
    pub message: Vec<String>,
    pub author: Vec<String>,
    pub commit: Vec<String>,
    /// Path substrings or globs (`*`, `**`, `?`)
    pub file: Vec<String>,
    /// Added or removed text (`git log -G`); needs the git CLI
    pub changes: Vec<String>,
    pub match_case: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogQuery {
    /// Starting points; defaults to HEAD
    #[serde(default)]
    pub revs: Vec<String>,
    /// Commits reachable from these are left out (`a..b`)
    #[serde(default)]
    pub hide: Vec<String>,
    /// File history of this path (follows renames)
    pub path: Option<String>,
    pub search: Option<Search>,
    #[serde(default)]
    pub skip: usize,
    pub limit: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogPage {
    pub commits: Vec<CommitInfo>,
    /// More commits follow this page
    pub more: bool,
}

fn person(sig: gix::actor::SignatureRef<'_>) -> Person {
    Person {
        name: sig.name.to_str_lossy().into_owned(),
        email: sig.email.to_str_lossy().into_owned(),
        time: sig.time().map(|t| t.seconds).unwrap_or_default(),
    }
}

fn subject(message: &BStr) -> String {
    message.lines().next().unwrap_or_default().to_str_lossy().into_owned()
}

fn info(commit: &gix::Commit<'_>) -> Result<CommitInfo> {
    let decoded = commit.decode().map_err(|e| err(&e))?;
    Ok(CommitInfo {
        id: commit.id.to_string(),
        parents: decoded.parents().map(|p| p.to_string()).collect(),
        author: person(decoded.author().map_err(|e| err(&e))?),
        committer: person(decoded.committer().map_err(|e| err(&e))?),
        subject: subject(decoded.message),
        path: None,
        status: None,
        original_path: None,
    })
}

fn resolve(repo: &gix::Repository, rev: &str) -> Result<gix::ObjectId> {
    let id = repo.rev_parse_single(rev).map_err(|e| err(&e))?;
    Ok(id.object().map_err(|e| err(&e))?.peel_to_commit().map_err(|e| err(&e))?.id)
}

/// `*`, `**` and `?` globs; anything else matches as a substring.
fn path_matches(pattern: &str, path: &str, match_case: bool) -> bool {
    let (pattern, path) =
        if match_case { (pattern.to_owned(), path.to_owned()) } else { (pattern.to_lowercase(), path.to_lowercase()) };
    if !pattern.contains(['*', '?']) {
        return path.contains(&pattern);
    }
    gix::glob::wildmatch(pattern.as_bytes().as_bstr(), path.as_bytes().as_bstr(), gix::glob::wildmatch::Mode::empty())
        || gix::glob::wildmatch(
            format!("**/{pattern}").as_bytes().as_bstr(),
            path.as_bytes().as_bstr(),
            gix::glob::wildmatch::Mode::empty(),
        )
}

fn contains(haystack: &str, needle: &str, match_case: bool) -> bool {
    if match_case { haystack.contains(needle) } else { haystack.to_lowercase().contains(&needle.to_lowercase()) }
}

fn tree_of(repo: &gix::Repository, id: gix::ObjectId) -> Result<gix::Tree<'_>> {
    repo.find_commit(id).map_err(|e| err(&e))?.tree().map_err(|e| err(&e))
}

fn entry_at(tree: &gix::Tree<'_>, path: &str) -> Option<(gix::ObjectId, gix::object::tree::EntryMode)> {
    tree.lookup_entry_by_path(path).ok().flatten().map(|e| (e.object_id(), e.mode()))
}

fn diff_options(rewrites: bool) -> gix::diff::Options {
    let mut options = gix::diff::Options::default();
    options.track_path();
    options.track_rewrites(rewrites.then(Default::default));
    options
}

/// Changes from `old` to `new` (files only; directory entries are dropped).
fn tree_changes(
    repo: &gix::Repository,
    old: Option<&gix::Tree<'_>>,
    new: &gix::Tree<'_>,
) -> Result<Vec<ChangeDetached>> {
    let changes = repo.diff_tree_to_tree(old, Some(new), Some(diff_options(true))).map_err(|e| err(&e))?;
    Ok(changes.into_iter().filter(|c| !c.entry_mode().is_tree()).collect())
}

fn search_matches(
    repo: &gix::Repository,
    commit: &gix::Commit<'_>,
    info: &CommitInfo,
    search: &Search,
) -> Result<bool> {
    let case = search.match_case;
    if !search.commit.is_empty() && !search.commit.iter().any(|s| info.id.starts_with(&s.to_lowercase())) {
        return Ok(false);
    }
    if !search.author.is_empty()
        && !search.author.iter().any(|a| contains(&info.author.name, a, case) || contains(&info.author.email, a, case))
    {
        return Ok(false);
    }
    if !search.message.is_empty() {
        let message = commit.message_raw().map_err(|e| err(&e))?.to_str_lossy().into_owned();
        if !search.message.iter().all(|m| contains(&message, m, case)) {
            return Ok(false);
        }
    }
    if !search.file.is_empty() {
        let tree = commit.tree().map_err(|e| err(&e))?;
        let parent = commit.parent_ids().next().map(|p| tree_of(repo, p.detach())).transpose()?;
        let changes =
            repo.diff_tree_to_tree(parent.as_ref(), Some(&tree), Some(diff_options(false))).map_err(|e| err(&e))?;
        let any = changes
            .iter()
            .filter(|c| !c.entry_mode().is_tree())
            .any(|c| search.file.iter().any(|f| path_matches(f, &c.location().to_str_lossy(), case)));
        if !any {
            return Ok(false);
        }
    }
    Ok(true)
}

/// One page of history, newest first (commit time, like `git log`).
pub fn log(repo: &gix::Repository, query: &LogQuery) -> Result<LogPage> {
    let revs = if query.revs.is_empty() { vec!["HEAD".to_owned()] } else { query.revs.clone() };
    let mut tips = Vec::new();
    for rev in &revs {
        match resolve(repo, rev) {
            Ok(id) => tips.push(id),
            // An unborn HEAD has no history yet
            Err(_) if rev == "HEAD" => {}
            Err(e) => return Err(e),
        }
    }
    if tips.is_empty() {
        return Ok(LogPage { commits: Vec::new(), more: false });
    }
    let hidden = query.hide.iter().map(|r| resolve(repo, r)).collect::<Result<Vec<_>>>()?;
    let walk = repo
        .rev_walk(tips)
        .with_hidden(hidden)
        .sorting(gix::revision::walk::Sorting::ByCommitTime(Default::default()))
        .all()
        .map_err(|e| err(&e))?;

    let mut path = query.path.clone();
    let mut skipped = 0;
    let mut commits = Vec::new();
    for item in walk {
        let item = item.map_err(|e| err(&e))?;
        let commit = item.object().map_err(|e| err(&e))?;
        let mut entry = info(&commit)?;

        if let Some(current) = path.clone() {
            let tree = commit.tree().map_err(|e| err(&e))?;
            let own = entry_at(&tree, &current);
            let parent_trees = commit.parent_ids().map(|p| tree_of(repo, p.detach())).collect::<Result<Vec<_>>>()?;
            // Unchanged against a parent: the change (if any) came through that parent
            if parent_trees.iter().any(|t| entry_at(t, &current) == own) || (parent_trees.is_empty() && own.is_none()) {
                continue;
            }
            let status = match (&own, parent_trees.first().and_then(|t| entry_at(t, &current))) {
                (None, _) => FileStatus::Deleted,
                (Some(_), Some((_, mode))) if Some(mode) != own.map(|o| o.1) => FileStatus::TypeChanged,
                (Some(_), Some(_)) => FileStatus::Modified,
                (Some(_), None) => {
                    // Added here: follow a rename to the older name (`git log --follow`)
                    let renamed = match parent_trees.first() {
                        Some(parent) => tree_changes(repo, Some(parent), &tree)?.into_iter().find_map(|c| match c {
                            ChangeDetached::Rewrite { source_location, location, copy: false, .. }
                                if location == current.as_bytes() =>
                            {
                                Some(source_location.to_str_lossy().into_owned())
                            }
                            _ => None,
                        }),
                        None => None,
                    };
                    match renamed {
                        Some(old) => {
                            entry.original_path = Some(old.clone());
                            path = Some(old);
                            FileStatus::Renamed
                        }
                        None => FileStatus::Added,
                    }
                }
            };
            entry.path = Some(current);
            entry.status = Some(status);
        }

        if let Some(search) = &query.search
            && !search_matches(repo, &commit, &entry, search)?
        {
            continue;
        }
        if skipped < query.skip {
            skipped += 1;
            continue;
        }
        if commits.len() == query.limit {
            return Ok(LogPage { commits, more: true });
        }
        commits.push(entry);
    }
    Ok(LogPage { commits, more: false })
}

/// `--format` for `git log` output that [`parse_cli`] reads (for `-L` and `-G`, which gix lacks).
pub const CLI_FORMAT: &str = "--format=%H%x00%P%x00%an%x00%ae%x00%at%x00%cn%x00%ce%x00%ct%x00%s%x1e";

pub fn parse_cli(out: &str) -> Vec<CommitInfo> {
    out.split('\x1e')
        .filter_map(|record| {
            let f: Vec<&str> = record.trim_start_matches('\n').split('\0').collect();
            if f.len() < 9 {
                return None;
            }
            let time = |s: &str| s.parse().unwrap_or_default();
            Some(CommitInfo {
                id: f[0].to_owned(),
                parents: f[1].split_whitespace().map(Into::into).collect(),
                author: Person { name: f[2].into(), email: f[3].into(), time: time(f[4]) },
                committer: Person { name: f[5].into(), email: f[6].into(), time: time(f[7]) },
                subject: f[8].into(),
                path: None,
                status: None,
                original_path: None,
            })
        })
        .collect()
}

/// `git log` arguments for a search that needs the CLI (`changes`, GitLens's `~:`).
pub fn cli_search_args(query: &LogQuery) -> Vec<String> {
    let mut args = vec!["log".to_owned(), CLI_FORMAT.to_owned(), "--date-order".to_owned()];
    args.push(format!("--skip={}", query.skip));
    args.push(format!("--max-count={}", query.limit + 1));
    let search = query.search.clone().unwrap_or_default();
    if !search.match_case {
        args.push("--regexp-ignore-case".into());
    }
    for c in &search.changes {
        args.push(format!("-G{c}"));
    }
    for m in &search.message {
        args.push(format!("--grep={m}"));
    }
    if search.message.len() > 1 {
        args.push("--all-match".into());
    }
    for a in &search.author {
        args.push(format!("--author={a}"));
    }
    let revs = if query.revs.is_empty() { vec!["HEAD".to_owned()] } else { query.revs.clone() };
    args.extend(revs);
    args.extend(query.hide.iter().map(|h| format!("^{h}")));
    args.push("--".into());
    args.extend(search.file.iter().map(|f| if f.contains(['*', '?']) { format!(":(glob)**/{f}") } else { f.clone() }));
    args
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitFile {
    pub path: String,
    pub original_path: Option<String>,
    pub status: FileStatus,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitDetails {
    #[serde(flatten)]
    pub info: CommitInfo,
    pub message: String,
    /// Changes against the first parent (the empty tree for a root commit)
    pub files: Vec<CommitFile>,
}

fn files(changes: Vec<ChangeDetached>) -> Vec<CommitFile> {
    let mut out: Vec<CommitFile> = changes
        .into_iter()
        .map(|change| match change {
            ChangeDetached::Addition { location, .. } => CommitFile {
                path: location.to_str_lossy().into_owned(),
                original_path: None,
                status: FileStatus::Added,
            },
            ChangeDetached::Deletion { location, .. } => CommitFile {
                path: location.to_str_lossy().into_owned(),
                original_path: None,
                status: FileStatus::Deleted,
            },
            ChangeDetached::Modification { location, previous_entry_mode, entry_mode, .. } => CommitFile {
                path: location.to_str_lossy().into_owned(),
                original_path: None,
                status: if previous_entry_mode.kind() == entry_mode.kind() {
                    FileStatus::Modified
                } else {
                    FileStatus::TypeChanged
                },
            },
            ChangeDetached::Rewrite { source_location, location, copy, .. } => CommitFile {
                path: location.to_str_lossy().into_owned(),
                original_path: Some(source_location.to_str_lossy().into_owned()),
                status: if copy { FileStatus::Copied } else { FileStatus::Renamed },
            },
        })
        .collect();
    out.sort_by(|a, b| a.path.cmp(&b.path));
    out
}

pub fn commit_details(repo: &gix::Repository, rev: &str) -> Result<CommitDetails> {
    let commit = repo.find_commit(resolve(repo, rev)?).map_err(|e| err(&e))?;
    let info = info(&commit)?;
    let message = commit.message_raw().map_err(|e| err(&e))?.to_str_lossy().trim_end().to_owned();
    let tree = commit.tree().map_err(|e| err(&e))?;
    let parent = commit.parent_ids().next().map(|p| tree_of(repo, p.detach())).transpose()?;
    Ok(CommitDetails { info, message, files: files(tree_changes(repo, parent.as_ref(), &tree)?) })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Comparison {
    pub base: String,
    pub head: String,
    pub merge_base: Option<String>,
    /// Commits in `head` but not `base`
    pub ahead: usize,
    /// Commits in `base` but not `head`
    pub behind: usize,
    /// Files changed from the merge base to `head` (`git diff base...head`)
    pub files: Vec<CommitFile>,
}

pub fn compare(repo: &gix::Repository, base: &str, head: &str) -> Result<Comparison> {
    let base_id = resolve(repo, base)?;
    let head_id = resolve(repo, head)?;
    let count = |tip, other| -> Result<usize> {
        Ok(repo.rev_walk([tip]).with_hidden([other]).all().map_err(|e| err(&e))?.filter(|i| i.is_ok()).count())
    };
    let merge_base = repo.merge_base(base_id, head_id).ok().map(|id| id.detach());
    let from = merge_base.unwrap_or(base_id);
    let files = files(tree_changes(repo, Some(&tree_of(repo, from)?), &tree_of(repo, head_id)?)?);
    Ok(Comparison {
        base: base_id.to_string(),
        head: head_id.to_string(),
        merge_base: merge_base.map(|id| id.to_string()),
        ahead: count(head_id, base_id)?,
        behind: count(base_id, head_id)?,
        files,
    })
}

#[cfg(test)]
mod tests {
    use std::{path::Path, process::Command};

    use super::*;

    fn git(dir: &Path, args: &[&str]) {
        let status = Command::new("git")
            .args(args)
            .current_dir(dir)
            .env("GIT_AUTHOR_DATE", "2024-01-01T00:00:00Z")
            .env("GIT_COMMITTER_DATE", "2024-01-01T00:00:00Z")
            .status()
            .unwrap();
        assert!(status.success(), "git {args:?}");
    }

    fn commit(dir: &Path, n: u32, message: &str) {
        let date = format!("2024-01-01T00:00:{n:02}Z");
        let status = Command::new("git")
            .args(["commit", "-qam", message])
            .current_dir(dir)
            .env("GIT_AUTHOR_DATE", &date)
            .env("GIT_COMMITTER_DATE", &date)
            .status()
            .unwrap();
        assert!(status.success());
    }

    fn fixture() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path();
        git(d, &["init", "-q", "-b", "main"]);
        git(d, &["config", "user.name", "Ann"]);
        git(d, &["config", "user.email", "ann@example.com"]);
        std::fs::write(d.join("a.txt"), "one\ntwo\nthree\nfour\nfive\n").unwrap();
        std::fs::write(d.join("b.txt"), "b\n").unwrap();
        git(d, &["add", "."]);
        commit(d, 1, "add files");
        std::fs::write(d.join("b.txt"), "b2\n").unwrap();
        commit(d, 2, "change b");
        git(d, &["mv", "a.txt", "c.txt"]);
        commit(d, 3, "rename a to c");
        std::fs::write(d.join("c.txt"), "one\ntwo\nthree\nfour\nfive\nsix\n").unwrap();
        commit(d, 4, "  grow c");
        dir
    }

    fn query(path: Option<&str>) -> LogQuery {
        LogQuery { revs: vec![], hide: vec![], path: path.map(Into::into), search: None, skip: 0, limit: 10 }
    }

    #[test]
    fn pages_and_subjects() {
        let dir = fixture();
        let repo = gix::open(dir.path()).unwrap();
        let page = log(&repo, &query(None)).unwrap();
        let subjects: Vec<_> = page.commits.iter().map(|c| c.subject.as_str()).collect();
        assert_eq!(subjects, ["  grow c", "rename a to c", "change b", "add files"]);
        assert!(!page.more);
        let page = log(&repo, &LogQuery { skip: 1, limit: 2, ..query(None) }).unwrap();
        assert_eq!(page.commits.len(), 2);
        assert_eq!(page.commits[0].subject, "rename a to c");
        assert!(page.more);
    }

    #[test]
    fn file_history_follows_renames() {
        let dir = fixture();
        let repo = gix::open(dir.path()).unwrap();
        let page = log(&repo, &query(Some("c.txt"))).unwrap();
        let got: Vec<_> =
            page.commits.iter().map(|c| (c.subject.trim(), c.path.clone().unwrap(), c.status.unwrap())).collect();
        assert_eq!(
            got,
            [
                ("grow c", "c.txt".to_owned(), FileStatus::Modified),
                ("rename a to c", "c.txt".to_owned(), FileStatus::Renamed),
                ("add files", "a.txt".to_owned(), FileStatus::Added),
            ]
        );
    }

    #[test]
    fn search_and_details() {
        let dir = fixture();
        let repo = gix::open(dir.path()).unwrap();
        let search = Search { file: vec!["b.txt".into()], ..Default::default() };
        let page = log(&repo, &LogQuery { search: Some(search), ..query(None) }).unwrap();
        assert_eq!(page.commits.len(), 2);
        let search = Search { message: vec!["RENAME".into()], ..Default::default() };
        let page = log(&repo, &LogQuery { search: Some(search), ..query(None) }).unwrap();
        assert_eq!(page.commits.len(), 1);

        let details = commit_details(&repo, "HEAD~1").unwrap();
        assert_eq!(details.files.len(), 1);
        assert_eq!(details.files[0].status, FileStatus::Renamed);
        assert_eq!(details.files[0].original_path.as_deref(), Some("a.txt"));

        let cmp = compare(&repo, "HEAD~2", "HEAD").unwrap();
        assert_eq!((cmp.ahead, cmp.behind), (2, 0));
        assert_eq!(cmp.files.len(), 1);
    }
}
