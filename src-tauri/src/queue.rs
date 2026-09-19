//! Runs git CLI operations.
//!
//! - Writes run one at a time per worktree: that is the unit that owns an index, a HEAD
//!   and an `index.lock`. Submodules and linked worktrees get their own queues.
//! - Network operations run beside writes, but never two of the same kind on one
//!   repository (a fetch while a fetch is running is refused). Pull also takes the
//!   worktree's write slot because it changes the index.
//! - `index.lock` conflicts are retried briefly; if the lock stays, the holding process is
//!   reported. The lock file is never deleted.
//! - Every operation can be cancelled; the menu bar icon shows what is running.

use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::{io::AsyncReadExt, sync::oneshot};

use crate::{
    env::GitEnv,
    error::{Error, Result},
    output::{GitLog, LogEntry, now_ms},
    tray::{self, Activity},
};

const LOCK_RETRIES: [u64; 5] = [50, 100, 200, 400, 800];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OpKind {
    Commit,
    Push,
    Pull,
    Fetch,
    Sync,
    Checkout,
    Stage,
    Other,
}

impl OpKind {
    fn is_network(self) -> bool {
        matches!(self, OpKind::Push | OpKind::Pull | OpKind::Fetch | OpKind::Sync)
    }

    fn takes_write_slot(self) -> bool {
        !matches!(self, OpKind::Push | OpKind::Fetch)
    }

    fn activity(self) -> Option<Activity> {
        match self {
            OpKind::Push => Some(Activity::Push),
            OpKind::Pull | OpKind::Sync => Some(Activity::Pull),
            OpKind::Fetch => Some(Activity::Fetch),
            OpKind::Commit => Some(Activity::Commit),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Output {
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpEvent<'a> {
    id: u64,
    repo: &'a Path,
    kind: OpKind,
    label: &'a str,
    /// Started by the app (autofetch), not the user: no bar entry, no error toast
    background: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpDone<'a> {
    id: u64,
    repo: &'a Path,
    kind: OpKind,
    error: Option<&'a Error>,
    background: bool,
    /// For a failure git explained on stderr: the key of its kept output (Show Command Output)
    output: Option<String>,
}

pub struct Queue {
    env: Arc<GitEnv>,
    app: AppHandle,
    slots: Mutex<HashMap<PathBuf, Arc<tokio::sync::Mutex<()>>>>,
    network: Mutex<HashSet<(PathBuf, OpKind)>>,
    cancels: Mutex<HashMap<u64, oneshot::Sender<()>>>,
    active: Mutex<HashMap<u64, OpKind>>,
    writing: Mutex<HashMap<PathBuf, usize>>,
    next_id: AtomicU64,
    log: GitLog,
}

/// What an operation runs against.
pub struct Target<'a> {
    /// Worktree root: the command's working directory and its write slot
    pub worktree: &'a Path,
    /// Shared `.git` directory, so linked worktrees don't fetch the same remote twice
    pub common_dir: &'a Path,
}

impl Queue {
    pub fn new(env: Arc<GitEnv>, app: AppHandle) -> Arc<Self> {
        Arc::new(Self {
            env,
            app,
            slots: Mutex::new(HashMap::new()),
            network: Mutex::new(HashSet::new()),
            cancels: Mutex::new(HashMap::new()),
            active: Mutex::new(HashMap::new()),
            writing: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            log: GitLog::default(),
        })
    }

    /// The Git output log
    pub fn log(&self) -> &GitLog {
        &self.log
    }

    /// True while a write is running in this worktree; the watcher holds its events until then.
    pub fn is_writing(&self, worktree: &Path) -> bool {
        self.writing.lock().unwrap().get(worktree).is_some_and(|n| *n > 0)
    }

    /// Runs `git <args>` for `target`. `label` is shown in the panel while it runs.
    pub async fn run(&self, target: Target<'_>, kind: OpKind, label: &str, args: &[&str]) -> Result<Output> {
        self.run_inner(target, kind, label, args, None, false).await
    }

    /// A run the user didn't ask for: it still queues and blinks the badge, but stays out of
    /// the ops bar and never toasts.
    pub async fn run_background(&self, target: Target<'_>, kind: OpKind, label: &str, args: &[&str]) -> Result<Output> {
        self.run_inner(target, kind, label, args, None, true).await
    }

    pub async fn run_with_stdin(
        &self,
        target: Target<'_>,
        kind: OpKind,
        label: &str,
        args: &[&str],
        stdin: Option<Vec<u8>>,
    ) -> Result<Output> {
        self.run_inner(target, kind, label, args, stdin, false).await
    }

    async fn run_inner(
        &self,
        target: Target<'_>,
        kind: OpKind,
        label: &str,
        args: &[&str],
        stdin: Option<Vec<u8>>,
        background: bool,
    ) -> Result<Output> {
        let network_key = (target.common_dir.to_path_buf(), kind);
        if kind.is_network() && !self.network.lock().unwrap().insert(network_key.clone()) {
            return Err(Error::AlreadyRunning(format!("{kind:?}").to_lowercase()));
        }
        let _network_guard = scopeguard(kind.is_network(), || {
            self.network.lock().unwrap().remove(&network_key);
        });

        let slot = kind
            .takes_write_slot()
            .then(|| Arc::clone(self.slots.lock().unwrap().entry(target.worktree.to_path_buf()).or_default()));
        let _slot_guard = match &slot {
            Some(slot) => Some(slot.lock().await),
            None => None,
        };
        let _slot_cleanup = scopeguard(slot.is_some(), || {
            // Only this call and the map hold the slot: nothing is queued behind it
            let mut slots = self.slots.lock().unwrap();
            if slots.get(target.worktree).is_some_and(|s| Arc::strong_count(s) <= 2) {
                slots.remove(target.worktree);
            }
        });
        let worktree = target.worktree.to_path_buf();
        if kind.takes_write_slot() {
            *self.writing.lock().unwrap().entry(worktree.clone()).or_default() += 1;
        }
        let _writing_guard = scopeguard(kind.takes_write_slot(), || {
            if let Some(n) = self.writing.lock().unwrap().get_mut(&worktree) {
                *n -= 1;
            }
        });

        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        self.begin(id, kind);
        let _ = self.app.emit("op://started", OpEvent { id, repo: target.worktree, kind, label, background });
        let result = self.run_retrying(id, target.worktree, args, stdin).await;
        self.end(id, result.as_ref().err());
        let output = match &result {
            Err(Error::Cancelled | Error::AlreadyRunning(_)) | Ok(_) => None,
            Err(_) => self.log.keep_failure(id),
        };
        let _ = self.app.emit(
            "op://finished",
            OpDone { id, repo: target.worktree, kind, error: result.as_ref().err(), background, output },
        );
        result
    }

    /// Cancels a running operation by the id from `op://started`.
    pub fn cancel(&self, id: u64) {
        if let Some(tx) = self.cancels.lock().unwrap().remove(&id) {
            let _ = tx.send(());
        }
    }

    async fn run_retrying(&self, id: u64, cwd: &Path, args: &[&str], stdin: Option<Vec<u8>>) -> Result<Output> {
        let mut attempt = 0;
        loop {
            match self.spawn(id, cwd, args, stdin.clone()).await {
                Err(Error::Git { stderr, .. }) if is_index_locked(&stderr) && attempt < LOCK_RETRIES.len() => {
                    tokio::time::sleep(Duration::from_millis(LOCK_RETRIES[attempt])).await;
                    attempt += 1;
                }
                Err(Error::Git { stderr, .. }) if is_index_locked(&stderr) => {
                    let path = locked_path(&stderr).unwrap_or_else(|| cwd.join(".git/index.lock"));
                    return Err(Error::IndexLocked {
                        holder: lock_holder(&path).await,
                        path: path.display().to_string(),
                    });
                }
                other => return other,
            }
        }
    }

    /// Runs git once and records it in the output log
    async fn spawn(&self, id: u64, cwd: &Path, args: &[&str], stdin: Option<Vec<u8>>) -> Result<Output> {
        let time = now_ms();
        let started = Instant::now();
        let result = self.spawn_git(id, cwd, args, stdin).await;
        let (code, stderr) = match &result {
            Ok(output) => (Some(0), output.stderr.clone()),
            Err(Error::Git { stderr, code, .. }) => (*code, stderr.clone()),
            Err(Error::Cancelled) => (None, String::new()),
            Err(error) => (None, error.to_string()),
        };
        let entry = LogEntry {
            op: id,
            time,
            repo: cwd.to_path_buf(),
            args: args.iter().map(|a| (*a).to_owned()).collect(),
            duration_ms: started.elapsed().as_millis() as u64,
            code,
            cancelled: matches!(result, Err(Error::Cancelled)),
            stderr,
        };
        self.log.push(&self.app, entry);
        result
    }

    async fn spawn_git(&self, id: u64, cwd: &Path, args: &[&str], stdin: Option<Vec<u8>>) -> Result<Output> {
        let mut cmd = self.env.git(cwd, args).await?;
        if stdin.is_some() {
            cmd.stdin(Stdio::piped());
        }
        let mut child = cmd.spawn()?;
        if let Some(bytes) = stdin {
            let mut pipe = child.stdin.take().expect("piped");
            tokio::io::AsyncWriteExt::write_all(&mut pipe, &bytes).await?;
        }
        let mut out = child.stdout.take().expect("piped");
        let mut err = child.stderr.take().expect("piped");
        let stdout = tokio::spawn(async move {
            let mut buf = Vec::new();
            let _ = out.read_to_end(&mut buf).await;
            buf
        });
        let stderr = tokio::spawn(async move {
            let mut buf = Vec::new();
            let _ = err.read_to_end(&mut buf).await;
            buf
        });
        let (cancel_tx, cancel_rx) = oneshot::channel();
        self.cancels.lock().unwrap().insert(id, cancel_tx);
        let status = tokio::select! {
            status = child.wait() => status?,
            _ = cancel_rx => {
                let _ = child.kill().await;
                return Err(Error::Cancelled);
            }
        };
        self.cancels.lock().unwrap().remove(&id);
        let stdout = String::from_utf8_lossy(&stdout.await.unwrap_or_default()).into_owned();
        let stderr = String::from_utf8_lossy(&stderr.await.unwrap_or_default()).into_owned();
        if status.success() {
            Ok(Output { stdout, stderr })
        } else {
            Err(Error::Git { message: git_message(&stderr, args), stderr, code: status.code() })
        }
    }

    fn begin(&self, id: u64, kind: OpKind) {
        self.active.lock().unwrap().insert(id, kind);
        self.update_tray(None);
    }

    fn end(&self, id: u64, error: Option<&Error>) {
        self.active.lock().unwrap().remove(&id);
        let failed = error.is_some_and(|e| !matches!(e, Error::Cancelled | Error::AlreadyRunning(_)));
        self.update_tray(Some(failed));
    }

    fn update_tray(&self, finished_with_failure: Option<bool>) {
        if finished_with_failure == Some(true) {
            tray::set_failure(&self.app, true);
        }
        // Most visible activity wins: push > pull > fetch > commit
        let active = self.active.lock().unwrap();
        let activity = [Activity::Push, Activity::Pull, Activity::Fetch, Activity::Commit]
            .into_iter()
            .find(|a| active.values().any(|k| k.activity() == Some(*a)));
        tray::set_activity(&self.app, activity);
    }
}

fn is_index_locked(stderr: &str) -> bool {
    stderr.contains(".lock': File exists") || stderr.contains("index.lock")
}

fn locked_path(stderr: &str) -> Option<PathBuf> {
    let start = stderr.find("Unable to create '")? + "Unable to create '".len();
    let end = stderr[start..].find('\'')? + start;
    Some(PathBuf::from(&stderr[start..end]))
}

/// Names the process that holds `path` open, or says the lock looks stale.
async fn lock_holder(path: &Path) -> String {
    let output = tokio::process::Command::new("/usr/sbin/lsof").args(["-Fpc", "--"]).arg(path).output().await;
    if let Ok(output) = output {
        let text = String::from_utf8_lossy(&output.stdout);
        let pid = text.lines().find_map(|l| l.strip_prefix('p'));
        let name = text.lines().find_map(|l| l.strip_prefix('c'));
        if let (Some(pid), Some(name)) = (pid, name) {
            return format!("{name} (pid {pid})");
        }
    }
    "no running process has it open; it may be left over from a crashed git command".into()
}

/// The line users need from git's stderr: the first `fatal:`/`error:` line, else the last line.
fn git_message(stderr: &str, args: &[&str]) -> String {
    let lines: Vec<&str> = stderr.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    lines
        .iter()
        .find(|l| l.starts_with("fatal:") || l.starts_with("error:"))
        .or(lines.last())
        .map(|l| l.trim_start_matches("fatal: ").trim_start_matches("error: ").to_owned())
        .unwrap_or_else(|| format!("git {} failed", args.first().unwrap_or(&"")))
}

struct Guard<F: FnMut()>(bool, F);

impl<F: FnMut()> Drop for Guard<F> {
    fn drop(&mut self) {
        if self.0 {
            (self.1)();
        }
    }
}

fn scopeguard<F: FnMut()>(armed: bool, f: F) -> Guard<F> {
    Guard(armed, f)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_locked_path() {
        let stderr = "fatal: Unable to create '/tmp/repo/.git/index.lock': File exists.\n\nAnother git process seems to be running";
        assert!(is_index_locked(stderr));
        assert_eq!(locked_path(stderr), Some(PathBuf::from("/tmp/repo/.git/index.lock")));
        assert_eq!(git_message(stderr, &["commit"]), "Unable to create '/tmp/repo/.git/index.lock': File exists.");
    }
}
