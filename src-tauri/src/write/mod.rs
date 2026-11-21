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

pub mod recovery;

pub struct Repo<'a> {
    pub root: &'a Path,
    pub common_dir: &'a Path,
}

impl<'a> Repo<'a> {
    fn target(&self) -> Target<'a> {
        Target { worktree: self.root, common_dir: self.common_dir }
    }
}

fn pathspec_stdin(paths: &[String]) -> Vec<u8> {
    // NUL preserves every filename; literal magic prevents a selected path from matching other files.
    let mut bytes = Vec::new();
    for path in paths {
        bytes.extend_from_slice(b":(literal)");
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

pub async fn remove_conflict(queue: &Queue, repo: Repo<'_>, path: String, label: &str) -> Result<Output> {
    queue
        .run_conflict_removal(
            repo.target(),
            label,
            &["rm", "-q", "--pathspec-from-file=-", "--pathspec-file-nul"],
            pathspec_stdin(std::slice::from_ref(&path)),
            &path,
        )
        .await
}

fn unstage_args(unborn: bool) -> &'static [&'static str] {
    // Before the first commit, remove entries even if they differ from the untouched worktree.
    if unborn {
        &["rm", "--cached", "--force", "-r", "-q", "--pathspec-from-file=-", "--pathspec-file-nul"]
    } else {
        &["restore", "--staged", "--pathspec-from-file=-", "--pathspec-file-nul"]
    }
}

pub async fn unstage(queue: &Queue, repo: Repo<'_>, paths: &[String], unborn: bool, label: &str) -> Result<Output> {
    queue.run_with_stdin(repo.target(), OpKind::Stage, label, unstage_args(unborn), Some(pathspec_stdin(paths))).await
}

/// Captures tracked changes (index and worktree) as a dangling stash commit.
/// Returns `None` when there is nothing to capture.
pub async fn recovery_point(queue: &Queue, repo: &Repo<'_>, label: &str) -> Result<Option<String>> {
    let out = queue.run(repo.target(), OpKind::Other, label, &["stash", "create"]).await?;
    let id = out.stdout.trim();
    Ok((!id.is_empty()).then(|| id.to_owned()))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscardResult {
    /// Worktree and index snapshots for undoing the selected tracked paths.
    pub recovery: Option<String>,
    /// Untracked files moved to the Trash
    pub trashed: Vec<PathBuf>,
    pub trash_error: Option<String>,
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
        queue
            .run_with_recovery(
                repo.target(),
                label,
                &["checkout", "-q", "--pathspec-from-file=-", "--pathspec-file-nul", "--"],
                pathspec_stdin(tracked),
            )
            .await?
            .recovery
    };
    let mut trashed = Vec::new();
    for rel in untracked {
        let path = repo.root.join(rel);
        if let Err(error) = trash(&path) {
            return Ok(DiscardResult { recovery, trashed, trash_error: Some(error.to_string()) });
        }
        trashed.push(path);
    }
    Ok(DiscardResult { recovery, trashed, trash_error: None })
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
    queue.run_with_stdin(repo.target(), OpKind::Commit, label, &args, stdin).await
}

/// Appends repository-relative paths to the root `.gitignore` (VS Code's "Add to .gitignore").
pub fn append_gitignore(root: &Path, paths: &[String]) -> Result<()> {
    use std::io::Write;
    let file = root.join(".gitignore");
    let existing = std::fs::read_to_string(&file).unwrap_or_default();
    let mut out = std::fs::OpenOptions::new().create(true).append(true).open(&file)?;
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
    queue.run_with_stdin(repo.target(), OpKind::Stage, label, &args, Some(patch.as_bytes().to_vec())).await
}

/// Any other git command, classified for the queue and the menu bar badge.
pub async fn exec(queue: &Queue, repo: Repo<'_>, kind: OpKind, label: &str, args: &[String]) -> Result<Output> {
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    queue.run(repo.target(), kind, label, &args).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        io::Write,
        process::{Command, Stdio},
    };

    fn git(root: &Path, args: &[&str], stdin: &[u8]) -> String {
        let mut child = Command::new("git")
            .current_dir(root)
            .args(["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgSign=false"])
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        child.stdin.take().unwrap().write_all(stdin).unwrap();
        let output = child.wait_with_output().unwrap();
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        String::from_utf8(output.stdout).unwrap()
    }

    #[test]
    fn file_actions_only_touch_selected_literal_path() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let selected = pathspec_stdin(&["[id].txt".into()]);
        let add = ["add", "-A", "--pathspec-from-file=-", "--pathspec-file-nul"];
        git(root, &["init", "-q"], b"");
        for path in ["[id].txt", "i.txt"] {
            fs::write(root.join(path), "original\n").unwrap();
        }
        git(root, &add, &selected);
        assert_eq!(git(root, &["ls-files"], b""), "[id].txt\n");
        fs::write(root.join("[id].txt"), "newer edit\n").unwrap();
        git(root, unstage_args(true), &selected);
        assert_eq!(git(root, &["ls-files"], b""), "");
        assert_eq!(fs::read_to_string(root.join("[id].txt")).unwrap(), "newer edit\n");

        git(root, &["add", "-A"], b"");
        git(root, &["commit", "-qm", "initial"], b"");
        for path in ["[id].txt", "i.txt"] {
            fs::write(root.join(path), "modified\n").unwrap();
        }
        git(root, &["add", "-A"], b"");
        git(root, unstage_args(false), &selected);
        assert_eq!(git(root, &["diff", "--cached", "--name-only"], b""), "i.txt\n");
        fs::write(root.join("i.txt"), "untouched edit\n").unwrap();
        git(root, &["checkout", "-q", "--pathspec-from-file=-", "--pathspec-file-nul", "--"], &selected);
        assert_eq!(fs::read_to_string(root.join("[id].txt")).unwrap(), "newer edit\n");
        assert_eq!(fs::read_to_string(root.join("i.txt")).unwrap(), "untouched edit\n");
    }

    #[test]
    fn discard_undo_restores_only_selected_changes_and_refuses_new_edits() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let binary = "line\t[id].dat";
        let removed = "removed.txt";
        let link = "changed-kind.txt";
        let paths = vec![binary.to_owned(), removed.to_owned(), link.to_owned()];
        let checkout = ["checkout", "-q", "--pathspec-from-file=-", "--pathspec-file-nul", "--"];
        git(root, &["init", "-q"], b"");
        fs::write(root.join(binary), b"old\0data").unwrap();
        fs::write(root.join(removed), "first\n").unwrap();
        fs::write(root.join("neighbor.txt"), "first\n").unwrap();
        fs::write(root.join(link), "first\n").unwrap();
        git(root, &["add", "-A"], b"");
        git(root, &["commit", "-qm", "base"], b"");
        fs::write(root.join("neighbor.txt"), "staged\n").unwrap();
        git(root, &["add", "neighbor.txt"], b"");
        fs::write(root.join("neighbor.txt"), "untouched edit\n").unwrap();
        let contents = (0..=255).collect::<Vec<u8>>();
        fs::write(root.join(binary), &contents).unwrap();
        fs::remove_file(root.join(removed)).unwrap();
        fs::remove_file(root.join(link)).unwrap();
        std::os::unix::fs::symlink("neighbor.txt", root.join(link)).unwrap();
        let recovery = git(root, &["stash", "create"], b"");
        git(root, &checkout, &pathspec_stdin(&paths));
        let patch = recovery::patch(&gix::open(root).unwrap(), recovery.trim(), &paths).unwrap();
        git(root, &["apply", "--binary", "-"], &patch);
        assert_eq!(fs::read(root.join(binary)).unwrap(), contents);
        assert!(!root.join(removed).exists());
        assert_eq!(fs::read_link(root.join(link)).unwrap(), Path::new("neighbor.txt"));
        assert_eq!(fs::read_to_string(root.join("neighbor.txt")).unwrap(), "untouched edit\n");
        assert_eq!(git(root, &["show", ":neighbor.txt"], b""), "staged\n");

        git(root, &checkout, &pathspec_stdin(&paths));
        fs::write(root.join(binary), "newer edit\n").unwrap();
        let mut child = Command::new("git")
            .current_dir(root)
            .args(["apply", "--binary", "-"])
            .stdin(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        child.stdin.take().unwrap().write_all(&patch).unwrap();
        assert!(!child.wait_with_output().unwrap().status.success());
        assert_eq!(fs::read_to_string(root.join(binary)).unwrap(), "newer edit\n");
        assert!(root.join(removed).exists());
        assert_eq!(fs::read_to_string(root.join(link)).unwrap(), "first\n");
    }
}
