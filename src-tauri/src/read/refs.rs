//! Branches, remote branches, tags and stashes (for pickers and the GitLens views).

use gix::bstr::ByteSlice;
use serde::Serialize;

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
