//! Writes through the system git CLI, run by the per-worktree queue.
//!
//! Destructive operations make a recovery point first: tracked changes are captured with
//! `git stash create` (a commit object nothing references; `git stash apply <id>` brings the
//! changes back), and untracked files go to the Trash instead of being deleted.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::{
    error::{Error, Result},
    queue::{OpKind, Output, Queue, Target},
};

pub struct Repo<'a> {
    pub root: &'a Path,
    pub common_dir: &'a Path,
}

impl<'a> Repo<'a> {
    fn target(&self) -> Target<'a> {
        Target {
            worktree: self.root,
            common_dir: self.common_dir,
        }
    }
}

fn pathspec_stdin(paths: &[String]) -> Vec<u8> {
    // NUL-separated with --pathspec-file-nul so any file name survives
    let mut bytes = Vec::new();
    for path in paths {
        bytes.extend_from_slice(path.as_bytes());
        bytes.push(0);
    }
    bytes
}

pub async fn stage(queue: &Queue, repo: Repo<'_>, paths: &[String], label: &str) -> Result<Output> {
    queue
        .run_with_stdin(
            repo.target(),
            OpKind::Stage,
            label,
            &["add", "-A", "--pathspec-from-file=-", "--pathspec-file-nul"],
            Some(pathspec_stdin(paths)),
        )
        .await
}

pub async fn unstage(
    queue: &Queue,
    repo: Repo<'_>,
    paths: &[String],
    unborn: bool,
    label: &str,
) -> Result<Output> {
    // Before the first commit there is no HEAD to restore from; drop the entries instead
    let args: &[&str] = if unborn {
        &[
            "rm",
            "--cached",
            "-r",
            "-q",
            "--pathspec-from-file=-",
            "--pathspec-file-nul",
        ]
    } else {
        &[
            "restore",
            "--staged",
            "--pathspec-from-file=-",
            "--pathspec-file-nul",
        ]
    };
    queue
        .run_with_stdin(
            repo.target(),
            OpKind::Stage,
            label,
            args,
            Some(pathspec_stdin(paths)),
        )
        .await
}

/// Captures tracked changes (index and worktree) as a dangling stash commit.
/// Returns `None` when there is nothing to capture.
pub async fn recovery_point(queue: &Queue, repo: &Repo<'_>) -> Result<Option<String>> {
    let out = queue
        .run(
            repo.target(),
            OpKind::Other,
            "git stash create",
            &["stash", "create"],
        )
        .await?;
    let id = out.stdout.trim();
    Ok((!id.is_empty()).then(|| id.to_owned()))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscardResult {
    /// Apply with `git stash apply` to undo
    pub recovery: Option<String>,
    /// Untracked files moved to the Trash
    pub trashed: Vec<PathBuf>,
}

/// Discards worktree changes to `tracked` paths (restored from the index, as VS Code does)
/// and moves `untracked` paths to the Trash.
pub async fn discard(
    queue: &Queue,
    repo: Repo<'_>,
    tracked: &[String],
    untracked: &[String],
    label: &str,
) -> Result<DiscardResult> {
    let recovery = if tracked.is_empty() {
        None
    } else {
        recovery_point(queue, &repo).await?
    };
    if !tracked.is_empty() {
        queue
            .run_with_stdin(
                repo.target(),
                OpKind::Other,
                label,
                &[
                    "checkout",
                    "-q",
                    "--pathspec-from-file=-",
                    "--pathspec-file-nul",
                    "--",
                ],
                Some(pathspec_stdin(tracked)),
            )
            .await?;
    }
    let mut trashed = Vec::new();
    for rel in untracked {
        let path = repo.root.join(rel);
        trash(&path)?;
        trashed.push(path);
    }
    Ok(DiscardResult { recovery, trashed })
}

/// Moves a file or folder to the user's Trash (recoverable from Finder).
pub fn trash(path: &Path) -> Result<()> {
    use objc2_foundation::{NSFileManager, NSString, NSURL};
    let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
    let manager = NSFileManager::defaultManager();
    manager
        .trashItemAtURL_resultingItemURL_error(&url, None)
        .map_err(|e| Error::Other(format!("{}: {}", path.display(), e.localizedDescription())))
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CommitOptions {
    /// Stage all tracked changes first (`--all`); untracked files are added by the caller
    pub all: bool,
    pub amend: bool,
    pub signoff: bool,
    pub no_verify: bool,
    pub allow_empty: bool,
    /// Let git open its editor for the message (our GIT_EDITOR prompt); `message` is ignored
    pub edit: bool,
    /// Amend keeping the current message
    pub no_edit: bool,
}

pub async fn commit(
    queue: &Queue,
    repo: Repo<'_>,
    message: &str,
    options: &CommitOptions,
    label: &str,
) -> Result<Output> {
    let mut args = vec!["commit", "--quiet"];
    let stdin = if options.edit {
        None
    } else if options.no_edit {
        args.push("--no-edit");
        None
    } else {
        args.extend(["--allow-empty-message", "-F", "-"]);
        Some(message.as_bytes().to_vec())
    };
    if options.all {
        args.push("--all");
    }
    if options.amend {
        args.push("--amend");
    }
    if options.signoff {
        args.push("--signoff");
    }
    if options.no_verify {
        args.push("--no-verify");
    }
    if options.allow_empty {
        args.push("--allow-empty");
    }
    queue
        .run_with_stdin(repo.target(), OpKind::Commit, label, &args, stdin)
        .await
}

/// Appends repository-relative paths to the root `.gitignore` (VS Code's "Add to .gitignore").
pub fn append_gitignore(root: &Path, paths: &[String]) -> Result<()> {
    use std::io::Write;
    let file = root.join(".gitignore");
    let existing = std::fs::read_to_string(&file).unwrap_or_default();
    let mut out = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&file)?;
    if !existing.is_empty() && !existing.ends_with('\n') {
        writeln!(out)?;
    }
    for path in paths {
        writeln!(out, "/{}", path.trim_start_matches('/'))?;
    }
    Ok(())
}

/// Applies a patch to the index (`cached`) or the worktree; `reverse` undoes it.
pub async fn apply_patch(
    queue: &Queue,
    repo: Repo<'_>,
    patch: &str,
    cached: bool,
    reverse: bool,
    label: &str,
) -> Result<Output> {
    let mut args = vec!["apply", "--whitespace=nowarn", "--recount"];
    if cached {
        args.push("--cached");
    }
    if reverse {
        args.push("-R");
    }
    args.push("-");
    queue
        .run_with_stdin(
            repo.target(),
            OpKind::Stage,
            label,
            &args,
            Some(patch.as_bytes().to_vec()),
        )
        .await
}

/// Any other git command, classified for the queue and the menu bar badge.
pub async fn exec(
    queue: &Queue,
    repo: Repo<'_>,
    kind: OpKind,
    label: &str,
    args: &[String],
) -> Result<Output> {
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    queue.run(repo.target(), kind, label, &args).await
}
