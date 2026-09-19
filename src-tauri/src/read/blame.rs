//! Line blame through gix. Blame runs on a commit; for the worktree the committed blame is
//! carried through the diff from HEAD to the file on disk, and changed lines are reported as
//! not committed yet (what VS Code and GitLens show).

use std::collections::HashMap;

use gix::bstr::{BStr, ByteSlice};
use serde::Serialize;

use super::content::line_hunks;
use crate::error::{Error, Result};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlameCommit {
    pub id: String,
    pub author: String,
    pub email: String,
    /// Author time, seconds since epoch
    pub time: i64,
    pub summary: String,
}

/// Consecutive lines attributed to one commit (`commit` is `None` for uncommitted lines).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BlameRange {
    /// 0-based first line
    pub start: u32,
    pub len: u32,
    pub commit: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Blame {
    pub ranges: Vec<BlameRange>,
    pub commits: HashMap<String, BlameCommit>,
}

/// Blames `path` at `rev`; when `worktree_text` is given, maps the result onto that text.
pub fn blame(repo: &gix::Repository, path: &str, rev: &str, worktree_text: Option<&str>) -> Result<Blame> {
    let err = |e: &dyn std::fmt::Display| Error::Repo(e.to_string());
    let commit_id = repo
        .rev_parse_single(rev)
        .map_err(|e| err(&e))?
        .object()
        .map_err(|e| err(&e))?
        .peel_to_commit()
        .map_err(|e| err(&e))?
        .id;
    let options = gix::repository::blame_file::Options {
        // Myers attributes ambiguous lines closest to git (measured in the spike)
        diff_algorithm: Some(gix::diff::blob::Algorithm::Myers),
        rewrites: Some(Default::default()),
        ..Default::default()
    };
    let outcome = repo.blame_file(BStr::new(path.as_bytes()), commit_id, options).map_err(|e| err(&e))?;

    let mut commits = HashMap::new();
    let mut per_line: Vec<Option<String>> = vec![None; outcome.blob.lines().count()];
    for entry in &outcome.entries {
        let id = entry.commit_id.to_string();
        if !commits.contains_key(&id)
            && let Ok(commit) = repo.find_commit(entry.commit_id)
        {
            let author = commit.author().map_err(|e| err(&e))?;
            commits.insert(
                id.clone(),
                BlameCommit {
                    id: id.clone(),
                    author: author.name.to_str_lossy().into_owned(),
                    email: author.email.to_str_lossy().into_owned(),
                    time: author.time().map(|t| t.seconds).unwrap_or_default(),
                    summary: commit
                        .message_raw()
                        .map(|m| m.lines().next().unwrap_or_default().to_str_lossy().trim().to_owned())
                        .unwrap_or_default(),
                },
            );
        }
        let start = entry.start_in_blamed_file as usize;
        for line in per_line.iter_mut().skip(start).take(entry.len.get() as usize) {
            *line = Some(id.clone());
        }
    }

    if let Some(text) = worktree_text {
        per_line = carry_through(&outcome.blob.to_str_lossy(), text, &per_line);
    }
    Ok(Blame { ranges: to_ranges(&per_line), commits })
}

/// Moves line attributions from `committed` to `current` along their diff; new or changed
/// lines get `None`.
fn carry_through(committed: &str, current: &str, attributions: &[Option<String>]) -> Vec<Option<String>> {
    let total = current.lines().count();
    let mut out = Vec::with_capacity(total);
    let mut left = 0usize;
    let mut right = 0usize;
    for hunk in line_hunks(committed, current, false) {
        while right < hunk.right_start as usize {
            out.push(attributions.get(left).cloned().flatten());
            left += 1;
            right += 1;
        }
        out.extend(std::iter::repeat_n(None, hunk.right_count as usize));
        left += hunk.left_count as usize;
        right += hunk.right_count as usize;
    }
    while right < total {
        out.push(attributions.get(left).cloned().flatten());
        left += 1;
        right += 1;
    }
    out
}

fn to_ranges(lines: &[Option<String>]) -> Vec<BlameRange> {
    let mut ranges: Vec<BlameRange> = Vec::new();
    for (i, commit) in lines.iter().enumerate() {
        match ranges.last_mut() {
            Some(last) if &last.commit == commit && last.start + last.len == i as u32 => last.len += 1,
            _ => ranges.push(BlameRange { start: i as u32, len: 1, commit: commit.clone() }),
        }
    }
    ranges
}

#[cfg(test)]
mod tests {
    use std::process::Command;

    use super::*;

    #[test]
    fn carries_blame_to_worktree_lines() {
        let a = Some("a".to_owned());
        let b = Some("b".to_owned());
        let out = carry_through("1\n2\n3\n", "1\nnew\n2\n3\n", &[a.clone(), b.clone(), a.clone()]);
        assert_eq!(out, vec![a.clone(), None, b, a]);
    }

    #[test]
    fn blames_like_git() {
        let dir = std::env::temp_dir().join(format!("gitmenu-blame-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let git = |args: &[&str]| {
            assert!(
                Command::new("git")
                    .current_dir(&dir)
                    .args(["-c", "user.name=Ada", "-c", "user.email=ada@x", "-c", "init.defaultBranch=main"])
                    .args(args)
                    .status()
                    .unwrap()
                    .success()
            )
        };
        git(&["init", "-q"]);
        std::fs::write(dir.join("f.txt"), "one\ntwo\n").unwrap();
        git(&["add", "."]);
        git(&["commit", "-qm", "first"]);
        std::fs::write(dir.join("f.txt"), "one\ntwo\nthree\n").unwrap();
        git(&["commit", "-qam", "second"]);
        std::fs::write(dir.join("f.txt"), "zero\none\ntwo\nthree\n").unwrap();

        let repo = gix::open(&dir).unwrap();
        let result = blame(&repo, "f.txt", "HEAD", Some("zero\none\ntwo\nthree\n")).unwrap();
        let summaries: Vec<Option<String>> = result
            .ranges
            .iter()
            .flat_map(|r| {
                std::iter::repeat_n(r.commit.as_ref().map(|c| result.commits[c].summary.clone()), r.len as usize)
            })
            .collect();
        assert_eq!(summaries, vec![None, Some("first".into()), Some("first".into()), Some("second".into())]);
        assert_eq!(result.commits.values().next().unwrap().author, "Ada");
    }
}
