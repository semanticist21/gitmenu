//! Read-only repository access through gix. Handles are opened once per repository and
//! kept; each request takes a thread-local copy. A handle is reopened when the repository's
//! config file changes (remotes, upstreams and settings are read from it at open time).

pub mod refs;
pub mod status;

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Mutex,
    time::SystemTime,
};

use crate::error::{Error, Result};

/// Object cache per repository handle. Small on purpose: several repositories stay open and
/// the app's memory is dominated by what the windows hold, not by gix.
const OBJECT_CACHE_BYTES: usize = 8 * 1024 * 1024;

#[derive(Default)]
pub struct Repos {
    open: Mutex<HashMap<PathBuf, (gix::ThreadSafeRepository, Option<SystemTime>)>>,
}

fn config_mtime(repo: &gix::ThreadSafeRepository) -> Option<SystemTime> {
    let common = repo
        .common_dir
        .clone()
        .unwrap_or_else(|| repo.git_dir().to_path_buf());
    std::fs::metadata(common.join("config"))
        .and_then(|m| m.modified())
        .ok()
}

impl Repos {
    pub fn get(&self, root: &Path) -> Result<gix::Repository> {
        if let Some((repo, mtime)) = self.open.lock().unwrap().get(root)
            && config_mtime(repo) == *mtime
        {
            return Ok(Self::local(repo));
        }
        let repo = gix::ThreadSafeRepository::open(root)
            .map_err(|e| Error::Repo(format!("{}: {e}", root.display())))?;
        let local = Self::local(&repo);
        let mtime = config_mtime(&repo);
        self.open
            .lock()
            .unwrap()
            .insert(root.to_path_buf(), (repo, mtime));
        Ok(local)
    }

    /// Drops a cached handle (after `git init` or a repository moving).
    pub fn forget(&self, root: &Path) {
        self.open.lock().unwrap().remove(root);
    }

    fn local(repo: &gix::ThreadSafeRepository) -> gix::Repository {
        let mut local = repo.to_thread_local();
        local.object_cache_size_if_unset(OBJECT_CACHE_BYTES);
        local
    }
}
