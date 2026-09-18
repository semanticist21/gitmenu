//! Branches, remote branches, tags and stashes (for pickers and the GitLens views).

use gix::bstr::ByteSlice;
use serde::Serialize;

use super::status::{Upstream, branch_upstream};
use crate::error::{Error, Result};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefInfo {
    /// Full name, `refs/heads/main`
    pub name: String,
    /// Display name, `main` / `origin/main` / `v1.0`
    pub short: String,
    pub kind: RefKind,
    /// Commit the ref points at (peeled for annotated tags)
    pub commit: Option<String>,
    /// Committer time of that commit, seconds since epoch
    pub time: Option<i64>,
    pub subject: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RefKind {
    Branch,
    Remote,
    Tag,
}

pub fn refs(repo: &gix::Repository) -> Result<Vec<RefInfo>> {
    let err = |e: &dyn std::fmt::Display| Error::Repo(e.to_string());
    let platform = repo.references().map_err(|e| err(&e))?;
    let mut out = Vec::new();
    for reference in platform.all().map_err(|e| err(&e))? {
        let Ok(mut reference) = reference else {
            continue;
        };
        let name = reference.name().as_bstr().to_str_lossy().into_owned();
        let (kind, short) = if let Some(s) = name.strip_prefix("refs/heads/") {
            (RefKind::Branch, s.to_owned())
        } else if let Some(s) = name.strip_prefix("refs/remotes/") {
            // `origin/HEAD` is a pointer, not a branch
            if s.ends_with("/HEAD") {
                continue;
            }
            (RefKind::Remote, s.to_owned())
        } else if let Some(s) = name.strip_prefix("refs/tags/") {
            (RefKind::Tag, s.to_owned())
        } else {
            continue;
        };
        let commit = reference.peel_to_commit().ok();
        out.push(RefInfo {
            name,
            short,
            kind,
            time: commit.as_ref().and_then(|c| c.time().ok()).map(|t| t.seconds),
            subject: commit
                .as_ref()
                .and_then(|c| c.message_raw().ok())
                .map(|m| m.lines().next().unwrap_or_default().to_str_lossy().into_owned()),
            commit: commit.map(|c| c.id.to_string()),
        });
    }
    Ok(out)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    #[serde(flatten)]
    pub info: RefInfo,
    /// Checked out in this worktree
    pub current: bool,
    pub upstream: Option<Upstream>,
}

/// Local branches with their upstream and how far they are ahead and behind it.
pub fn branches(repo: &gix::Repository) -> Result<Vec<BranchInfo>> {
    let current = super::status::head(repo).branch;
    Ok(refs(repo)?
        .into_iter()
        .filter(|r| r.kind == RefKind::Branch)
        .map(|info| {
            let upstream = info
                .commit
                .as_deref()
                .and_then(|c| gix::ObjectId::from_hex(c.as_bytes()).ok())
                .and_then(|id| branch_upstream(repo, &info.short, id));
            BranchInfo { current: current.as_deref() == Some(info.short.as_str()), upstream, info }
        })
        .collect())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeInfo {
    pub path: String,
    pub branch: Option<String>,
    pub commit: Option<String>,
    /// The repository's main worktree (not a linked one)
    pub main: bool,
    /// The worktree this repository handle belongs to
    pub current: bool,
    pub locked: bool,
    /// The folder is gone (`git worktree prune` removes it)
    pub missing: bool,
}

/// The main worktree and every linked one (`git worktree list`).
pub fn worktrees(repo: &gix::Repository) -> Result<Vec<WorktreeInfo>> {
    let err = |e: &dyn std::fmt::Display| Error::Repo(e.to_string());
    let here = repo.workdir().and_then(|p| std::fs::canonicalize(p).ok());
    let describe = |repo: &gix::Repository, path: std::path::PathBuf, main: bool, locked: bool| {
        let head = super::status::head(repo);
        let canonical = std::fs::canonicalize(&path).ok();
        WorktreeInfo {
            missing: canonical.is_none(),
            current: canonical.is_some() && canonical == here,
            path: path.to_string_lossy().into_owned(),
            branch: head.branch,
            commit: head.commit,
            main,
            locked,
        }
    };
    let mut out = Vec::new();
    let main = repo.main_repo().map_err(|e| err(&e))?;
    if let Some(workdir) = main.workdir() {
        out.push(describe(&main, workdir.to_path_buf(), true, false));
    }
    for proxy in main.worktrees().map_err(|e| err(&e))? {
        let locked = proxy.is_locked();
        let Ok(path) = proxy.base() else { continue };
        match proxy.into_repo_with_possibly_inaccessible_worktree() {
            Ok(linked) => out.push(describe(&linked, path, false, locked)),
            Err(_) => out.push(WorktreeInfo {
                path: path.to_string_lossy().into_owned(),
                branch: None,
                commit: None,
                main: false,
                current: false,
                locked,
                missing: true,
            }),
        }
    }
    Ok(out)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Contributor {
    pub name: String,
    pub email: String,
    pub commits: usize,
    /// Newest commit by this author, for the avatar lookup and sorting
    pub latest: String,
    pub latest_time: i64,
}

/// Authors of the commits reachable from HEAD with their commit counts (`git shortlog -sne`),
/// most commits first. Authors are told apart by email, like GitLens.
pub fn contributors(repo: &gix::Repository) -> Result<Vec<Contributor>> {
    let err = |e: &dyn std::fmt::Display| Error::Repo(e.to_string());
    let Ok(head) = repo.head_id() else { return Ok(Vec::new()) };
    let mut by_email: std::collections::HashMap<String, Contributor> = std::collections::HashMap::new();
    for info in repo.rev_walk([head.detach()]).all().map_err(|e| err(&e))? {
        let Ok(info) = info else { continue };
        let Ok(commit) = info.object() else { continue };
        let Ok(author) = commit.author() else { continue };
        let email = author.email.to_str_lossy().to_lowercase();
        let time = author.time().map(|t| t.seconds).unwrap_or_default();
        let entry = by_email.entry(email.clone()).or_insert_with(|| Contributor {
            name: author.name.to_str_lossy().into_owned(),
            email,
            commits: 0,
            latest: commit.id.to_string(),
            latest_time: time,
        });
        entry.commits += 1;
        if time > entry.latest_time {
            entry.latest_time = time;
            entry.latest = commit.id.to_string();
            entry.name = author.name.to_str_lossy().into_owned();
        }
    }
    let mut out: Vec<_> = by_email.into_values().collect();
    out.sort_by(|a, b| b.commits.cmp(&a.commits).then_with(|| a.name.cmp(&b.name)));
    Ok(out)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteInfo {
    pub name: String,
    pub fetch_url: Option<String>,
    pub push_url: Option<String>,
}

/// Configured remotes with their URLs (for remote links and the Remotes view).
pub fn remotes(repo: &gix::Repository) -> Result<Vec<RemoteInfo>> {
    let mut out = Vec::new();
    for name in repo.remote_names() {
        let Ok(remote) = repo.find_remote(name.as_bstr()) else { continue };
        let url = |direction| remote.url(direction).map(|u| u.to_bstring().to_str_lossy().into_owned());
        out.push(RemoteInfo {
            name: name.to_str_lossy().into_owned(),
            fetch_url: url(gix::remote::Direction::Fetch),
            push_url: url(gix::remote::Direction::Push),
        });
    }
    Ok(out)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StashInfo {
    /// 0 for `stash@{0}`
    pub index: usize,
    pub commit: String,
    pub message: String,
    pub time: i64,
}

/// The stash list, newest first (reflog of `refs/stash`).
pub fn stashes(repo: &gix::Repository) -> Result<Vec<StashInfo>> {
    let Ok(reference) = repo.find_reference("refs/stash") else {
        return Ok(Vec::new());
    };
    let mut log = reference.log_iter();
    let Ok(Some(entries)) = log.rev() else {
        return Ok(Vec::new());
    };
    Ok(entries
        .filter_map(|line| line.ok())
        .enumerate()
        .map(|(index, entry)| StashInfo {
            index,
            commit: entry.new_oid.to_string(),
            message: entry.message.to_str_lossy().into_owned(),
            time: entry.signature.time.seconds,
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use std::{path::Path, process::Command};

    use super::*;

    fn git(dir: &Path, args: &[&str]) {
        assert!(Command::new("git").args(args).current_dir(dir).status().unwrap().success(), "git {args:?}");
    }

    #[test]
    fn branches_worktrees_contributors() {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path().join("main");
        std::fs::create_dir(&d).unwrap();
        git(&d, &["init", "-q", "-b", "main"]);
        git(&d, &["config", "user.name", "Ann"]);
        git(&d, &["config", "user.email", "Ann@Example.com"]);
        std::fs::write(d.join("a"), "1").unwrap();
        git(&d, &["add", "."]);
        git(&d, &["commit", "-qm", "one"]);
        git(
            &d,
            &["-c", "user.name=Bo", "-c", "user.email=bo@example.com", "commit", "-q", "--allow-empty", "-m", "two"],
        );
        git(&d, &["commit", "-q", "--allow-empty", "-m", "three"]);
        git(&d, &["branch", "feature"]);
        git(&d, &["worktree", "add", "-q", "../wt", "feature"]);

        let repo = gix::open(&d).unwrap();
        let branches = branches(&repo).unwrap();
        assert_eq!(branches.len(), 2);
        assert!(branches.iter().any(|b| b.info.short == "main" && b.current));

        let trees = worktrees(&repo).unwrap();
        assert_eq!(trees.len(), 2);
        assert!(trees[0].main && trees[0].current);
        assert_eq!(trees[1].branch.as_deref(), Some("feature"));

        let people = contributors(&repo).unwrap();
        assert_eq!((people[0].email.as_str(), people[0].commits), ("ann@example.com", 2));
        assert_eq!(people[1].commits, 1);
    }
}
