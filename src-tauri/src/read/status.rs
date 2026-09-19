//! `git status` through gix: HEAD, upstream ahead/behind, the operation in progress, and
//! changes grouped like VS Code (merge, index, working tree, untracked). The index is never
//! written (`Outcome::write_changes` is not called), so reading never races git writes.

use std::collections::HashSet;

use gix::{bstr::ByteSlice, remote::Direction, status::UntrackedFiles};
use serde::Serialize;

use crate::error::{Error, Result};

/// VS Code's `Status` for a resource (extensions/git/src/api/git.d.ts).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StatusCode {
    IndexModified,
    IndexAdded,
    IndexDeleted,
    IndexRenamed,
    IndexCopied,
    Modified,
    Deleted,
    Untracked,
    IntentToAdd,
    TypeChanged,
    AddedByUs,
    AddedByThem,
    DeletedByUs,
    DeletedByThem,
    BothAdded,
    BothDeleted,
    BothModified,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    /// Repository-relative path, `/`-separated
    pub path: String,
    /// The path before a rename or copy
    pub original_path: Option<String>,
    pub status: StatusCode,
    pub submodule: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Head {
    /// Short branch name; `None` when detached
    pub branch: Option<String>,
    /// Full commit id; `None` in a repository without commits
    pub commit: Option<String>,
    pub detached: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Upstream {
    /// `origin/main`
    pub name: String,
    pub remote: String,
    pub ahead: usize,
    pub behind: usize,
    /// The tracking branch doesn't exist (never fetched, or deleted on the remote)
    pub gone: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoStatus {
    pub head: Head,
    pub upstream: Option<Upstream>,
    /// `merge`, `rebase`, `cherryPick`, `revert`, `bisect`, `applyMailbox`
    pub operation: Option<&'static str>,
    pub merge: Vec<FileChange>,
    pub index: Vec<FileChange>,
    pub working_tree: Vec<FileChange>,
    pub untracked: Vec<FileChange>,
    pub remotes: Vec<String>,
}

fn path(bytes: &gix::bstr::BStr) -> String {
    bytes.to_str_lossy().into_owned()
}

pub fn status(repo: &gix::Repository) -> Result<RepoStatus> {
    let err = |e: &dyn std::fmt::Display| Error::Repo(e.to_string());
    let mut merge = Vec::new();
    let mut index = Vec::new();
    let mut working_tree = Vec::new();
    let mut untracked = Vec::new();

    let iter = repo
        .status(gix::progress::Discard)
        .map_err(|e| err(&e))?
        .untracked_files(UntrackedFiles::Files)
        .into_iter(None)
        .map_err(|e| err(&e))?;

    for item in iter {
        let item = item.map_err(|e| err(&e))?;
        match item {
            gix::status::Item::IndexWorktree(item) => {
                worktree_change(&item, &mut merge, &mut working_tree, &mut untracked)
            }
            gix::status::Item::TreeIndex(change) => {
                use gix::diff::index::ChangeRef;
                let entry = match change {
                    ChangeRef::Addition { location, .. } => FileChange {
                        path: path(location.as_ref()),
                        original_path: None,
                        status: StatusCode::IndexAdded,
                        submodule: false,
                    },
                    ChangeRef::Deletion { location, .. } => FileChange {
                        path: path(location.as_ref()),
                        original_path: None,
                        status: StatusCode::IndexDeleted,
                        submodule: false,
                    },
                    ChangeRef::Modification { location, previous_entry_mode, entry_mode, .. } => FileChange {
                        path: path(location.as_ref()),
                        original_path: None,
                        status: if previous_entry_mode.to_tree_entry_mode().map(|m| m.kind())
                            != entry_mode.to_tree_entry_mode().map(|m| m.kind())
                        {
                            StatusCode::TypeChanged
                        } else {
                            StatusCode::IndexModified
                        },
                        submodule: entry_mode.is_submodule(),
                    },
                    ChangeRef::Rewrite { source_location, location, copy, .. } => FileChange {
                        path: path(location.as_ref()),
                        original_path: Some(path(source_location.as_ref())),
                        status: if copy { StatusCode::IndexCopied } else { StatusCode::IndexRenamed },
                        submodule: false,
                    },
                };
                index.push(entry);
            }
        }
    }

    // Conflicted paths only belong to the merge group
    let conflicted: HashSet<String> = merge.iter().map(|c: &FileChange| c.path.clone()).collect();
    index.retain(|c| !conflicted.contains(&c.path));
    working_tree.retain(|c| !conflicted.contains(&c.path));
    for group in [&mut merge, &mut index, &mut working_tree, &mut untracked] {
        group.sort_by(|a, b| a.path.cmp(&b.path));
        group.dedup_by(|a, b| a.path == b.path);
    }

    let head = head(repo);
    let upstream = upstream(repo, &head);
    Ok(RepoStatus {
        operation: repo.state().map(|s| {
            use gix::state::InProgress::*;
            match s {
                Merge => "merge",
                Rebase | RebaseInteractive => "rebase",
                CherryPick | CherryPickSequence => "cherryPick",
                Revert | RevertSequence => "revert",
                Bisect => "bisect",
                ApplyMailbox | ApplyMailboxRebase => "applyMailbox",
            }
        }),
        remotes: repo.remote_names().iter().map(|n| n.to_str_lossy().into_owned()).collect(),
        head,
        upstream,
        merge,
        index,
        working_tree,
        untracked,
    })
}

fn worktree_change(
    item: &gix::status::index_worktree::Item,
    merge: &mut Vec<FileChange>,
    working_tree: &mut Vec<FileChange>,
    untracked: &mut Vec<FileChange>,
) {
    use gix::status::index_worktree::Item;
    use gix_status_types::*;
    match item {
        Item::Modification { rela_path, status, .. } => {
            let path = path(rela_path.as_ref());
            match status {
                EntryStatus::Conflict { summary, .. } => merge.push(FileChange {
                    path,
                    original_path: None,
                    status: match summary {
                        Conflict::BothDeleted => StatusCode::BothDeleted,
                        Conflict::AddedByUs => StatusCode::AddedByUs,
                        Conflict::DeletedByThem => StatusCode::DeletedByThem,
                        Conflict::AddedByThem => StatusCode::AddedByThem,
                        Conflict::DeletedByUs => StatusCode::DeletedByUs,
                        Conflict::BothAdded => StatusCode::BothAdded,
                        Conflict::BothModified => StatusCode::BothModified,
                    },
                    submodule: false,
                }),
                EntryStatus::Change(change) => {
                    let (status, submodule) = match change {
                        Change::Removed => (StatusCode::Deleted, false),
                        Change::Type { .. } => (StatusCode::TypeChanged, false),
                        Change::Modification { .. } => (StatusCode::Modified, false),
                        Change::SubmoduleModification(_) => (StatusCode::Modified, true),
                    };
                    working_tree.push(FileChange { path, original_path: None, status, submodule });
                }
                EntryStatus::IntentToAdd => working_tree.push(FileChange {
                    path,
                    original_path: None,
                    status: StatusCode::IntentToAdd,
                    submodule: false,
                }),
                EntryStatus::NeedsUpdate(_) => {}
            }
        }
        Item::DirectoryContents { entry, .. } => {
            if matches!(entry.status, gix::dir::entry::Status::Untracked) {
                untracked.push(FileChange {
                    path: path(entry.rela_path.as_ref()),
                    original_path: None,
                    status: StatusCode::Untracked,
                    submodule: false,
                });
            }
        }
        Item::Rewrite { source, dirwalk_entry, copy, .. } => {
            // An untracked file matched a deleted one; git (without -M on the worktree) shows
            // these as a deletion plus an untracked file, and so does VS Code
            let _ = copy;
            working_tree.push(FileChange {
                path: path(source.rela_path()),
                original_path: None,
                status: StatusCode::Deleted,
                submodule: false,
            });
            untracked.push(FileChange {
                path: path(dirwalk_entry.rela_path.as_ref()),
                original_path: None,
                status: StatusCode::Untracked,
                submodule: false,
            });
        }
    }
}

mod gix_status_types {
    pub use gix::status::plumbing::index_as_worktree::{Change, Conflict, EntryStatus};
}

pub fn head(repo: &gix::Repository) -> Head {
    let Ok(head) = repo.head() else {
        return Head { branch: None, commit: None, detached: false };
    };
    let branch = head.referent_name().map(|n| n.shorten().to_str_lossy().into_owned());
    let commit = head.id().map(|id| id.to_string());
    Head { detached: head.is_detached(), branch, commit }
}

fn upstream(repo: &gix::Repository, head: &Head) -> Option<Upstream> {
    branch_upstream(repo, head.branch.as_ref()?, repo.head_id().ok()?.detach())
}

/// The upstream of local branch `branch` (short name) whose tip is `local_id`.
pub fn branch_upstream(repo: &gix::Repository, branch: &str, local_id: gix::ObjectId) -> Option<Upstream> {
    let full: gix::refs::FullName = format!("refs/heads/{branch}").try_into().ok()?;
    let tracking = repo.branch_remote_tracking_ref_name(full.as_ref(), Direction::Fetch)?.ok()?;
    let remote = repo
        .branch_remote_name(branch, Direction::Fetch)
        .map(|n| n.as_bstr().to_str_lossy().into_owned())
        .unwrap_or_default();
    let name = tracking.shorten().to_str_lossy().into_owned();
    let (ahead, behind, gone) = match repo.find_reference(tracking.as_ref()) {
        Ok(mut reference) => {
            let upstream_id = reference.peel_to_id().ok()?.detach();
            (count_only_in(repo, local_id, upstream_id), count_only_in(repo, upstream_id, local_id), false)
        }
        // Configured but never fetched, or deleted on the remote: nothing to compare with
        Err(_) => (0, 0, true),
    };
    Some(Upstream { name, remote, ahead, behind, gone })
}

/// Commits reachable from `tip` but not from `other` (`git rev-list --count other..tip`).
fn count_only_in(repo: &gix::Repository, tip: gix::ObjectId, other: gix::ObjectId) -> usize {
    if tip == other {
        return 0;
    }
    repo.rev_walk([tip]).with_hidden([other]).all().map(|walk| walk.filter(|info| info.is_ok()).count()).unwrap_or(0)
}

/// The HEAD commit's full message, for amending.
pub fn head_message(repo: &gix::Repository) -> Option<String> {
    let commit = repo.head_commit().ok()?;
    let message = commit.message_raw().ok()?;
    Some(message.to_str_lossy().trim_end().to_owned())
}

#[cfg(test)]
mod tests {
    use std::{path::Path, process::Command};

    use super::*;

    fn git(dir: &Path, args: &[&str]) {
        let status = Command::new("git")
            .current_dir(dir)
            .args(["-c", "user.name=t", "-c", "user.email=t@t", "-c", "init.defaultBranch=main"])
            .args(args)
            .status()
            .unwrap();
        assert!(status.success(), "git {args:?}");
    }

    fn fixture(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("gitmenu-status-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        git(&dir, &["init", "-q"]);
        dir
    }

    #[test]
    fn groups_changes_like_git() {
        let dir = fixture("groups");
        std::fs::write(dir.join("a.txt"), "a\n").unwrap();
        std::fs::write(dir.join("b.txt"), "b\n").unwrap();
        std::fs::write(dir.join("gone.txt"), "x\n").unwrap();
        git(&dir, &["add", "."]);
        git(&dir, &["commit", "-qm", "init"]);
        std::fs::write(dir.join("a.txt"), "a2\n").unwrap(); // modified, unstaged
        std::fs::write(dir.join("b.txt"), "b2\n").unwrap();
        git(&dir, &["add", "b.txt"]); // modified, staged
        std::fs::remove_file(dir.join("gone.txt")).unwrap(); // deleted
        std::fs::write(dir.join("new.txt"), "n\n").unwrap(); // untracked
        std::fs::write(dir.join("added.txt"), "n\n").unwrap();
        git(&dir, &["add", "added.txt"]); // added

        let repo = gix::open(&dir).unwrap();
        let s = status(&repo).unwrap();
        let find = |g: &[FileChange], p: &str| g.iter().find(|c| c.path == p).map(|c| c.status);
        assert_eq!(find(&s.working_tree, "a.txt"), Some(StatusCode::Modified));
        assert_eq!(find(&s.index, "b.txt"), Some(StatusCode::IndexModified));
        assert_eq!(find(&s.working_tree, "gone.txt"), Some(StatusCode::Deleted));
        assert_eq!(find(&s.untracked, "new.txt"), Some(StatusCode::Untracked));
        assert_eq!(find(&s.index, "added.txt"), Some(StatusCode::IndexAdded));
        assert_eq!(s.head.branch.as_deref(), Some("main"));
        assert!(s.operation.is_none());
        assert_eq!(head_message(&repo).as_deref(), Some("init"));
    }

    #[test]
    fn reports_conflicts_and_merge_state() {
        let dir = fixture("conflict");
        std::fs::write(dir.join("f.txt"), "base\n").unwrap();
        git(&dir, &["add", "."]);
        git(&dir, &["commit", "-qm", "base"]);
        git(&dir, &["checkout", "-qb", "other"]);
        std::fs::write(dir.join("f.txt"), "other\n").unwrap();
        git(&dir, &["commit", "-qam", "other"]);
        git(&dir, &["checkout", "-q", "main"]);
        std::fs::write(dir.join("f.txt"), "main\n").unwrap();
        git(&dir, &["commit", "-qam", "main"]);
        let _ = Command::new("git").current_dir(&dir).args(["merge", "other"]).output();

        let repo = gix::open(&dir).unwrap();
        let s = status(&repo).unwrap();
        assert_eq!(s.operation, Some("merge"));
        assert_eq!(s.merge.len(), 1);
        assert_eq!(s.merge[0].status, StatusCode::BothModified);
        assert!(s.index.is_empty() && s.working_tree.is_empty());
    }

    #[test]
    fn counts_ahead_and_behind() {
        let remote = fixture("remote");
        std::fs::write(remote.join("f.txt"), "1\n").unwrap();
        git(&remote, &["add", "."]);
        git(&remote, &["commit", "-qm", "1"]);
        let clone = std::env::temp_dir().join(format!("gitmenu-status-clone-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&clone);
        git(&remote, &["clone", "-q", remote.to_str().unwrap(), clone.to_str().unwrap()]);
        std::fs::write(remote.join("f.txt"), "2\n").unwrap();
        git(&remote, &["commit", "-qam", "2"]);
        git(&clone, &["fetch", "-q"]);
        std::fs::write(clone.join("g.txt"), "g\n").unwrap();
        git(&clone, &["add", "."]);
        git(&clone, &["commit", "-qm", "local"]);

        let repo = gix::open(&clone).unwrap();
        let s = status(&repo).unwrap();
        let up = s.upstream.expect("upstream");
        assert_eq!(up.name, "origin/main");
        assert_eq!((up.ahead, up.behind), (1, 1));
        assert_eq!(s.remotes, vec!["origin".to_owned()]);
    }
}
