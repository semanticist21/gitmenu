//! The Git output log, like VS Code's Git output channel: every git command the queue runs, how
//! long it took, its exit code and what it wrote to stderr. Kept in memory, the last 500.
//!
//! The commands of a failed operation are also kept apart, under a key unique across launches,
//! for its Show Command Output: clearing the log or a restart can't show another command there.

use std::{
    collections::VecDeque,
    path::PathBuf,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

const KEEP: usize = 500;
/// Failed operations whose output stays available
const KEEP_FAILURES: usize = 50;
/// Stderr kept per command, from the end: that's where git says what failed
const MAX_STDERR: usize = 32 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    /// The operation (`op://started` id) that ran it
    pub op: u64,
    /// Start, in Unix milliseconds
    pub time: u64,
    pub repo: PathBuf,
    pub args: Vec<String>,
    pub duration_ms: u64,
    /// None when git was cancelled, killed, or couldn't start
    pub code: Option<i32>,
    pub cancelled: bool,
    /// What git wrote to stderr, or why it couldn't run
    pub stderr: String,
}

pub struct GitLog {
    entries: Mutex<VecDeque<LogEntry>>,
    failures: Mutex<VecDeque<(String, Vec<LogEntry>)>>,
    /// This launch, so failure keys never repeat across restarts
    session: u64,
}

impl Default for GitLog {
    fn default() -> Self {
        Self { entries: Mutex::default(), failures: Mutex::default(), session: now_ms() }
    }
}

impl GitLog {
    pub fn push(&self, app: &AppHandle, mut entry: LogEntry) {
        entry.stderr = tail(&progress_free(&entry.stderr), MAX_STDERR);
        {
            let mut entries = self.entries.lock().unwrap();
            if entries.len() == KEEP {
                entries.pop_front();
            }
            entries.push_back(entry.clone());
        }
        let _ = app.emit("git-log://entry", entry);
    }

    pub fn entries(&self) -> Vec<LogEntry> {
        self.entries.lock().unwrap().iter().cloned().collect()
    }

    pub fn clear(&self) {
        self.entries.lock().unwrap().clear();
    }

    /// Keeps a failed operation's commands; returns their key when git said something
    pub fn keep_failure(&self, op: u64) -> Option<String> {
        let commands: Vec<LogEntry> = self.entries.lock().unwrap().iter().filter(|e| e.op == op).cloned().collect();
        if commands.iter().all(|e| e.stderr.trim().is_empty()) {
            return None;
        }
        let key = format!("{}-{op}", self.session);
        let mut failures = self.failures.lock().unwrap();
        if failures.len() == KEEP_FAILURES {
            failures.pop_front();
        }
        failures.push_back((key.clone(), commands));
        Some(key)
    }

    pub fn failure(&self, key: &str) -> Option<Vec<LogEntry>> {
        self.failures.lock().unwrap().iter().find(|(k, _)| k == key).map(|(_, commands)| commands.clone())
    }
}

pub fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or_default()
}

/// Git redraws progress lines with `\r`; keep only the last state of each line
fn progress_free(text: &str) -> String {
    text.lines()
        .map(|line| line.rsplit('\r').find(|part| !part.is_empty()).unwrap_or(""))
        .collect::<Vec<_>>()
        .join("\n")
}

/// The last `max` bytes of `text`, starting at a character boundary
fn tail(text: &str, max: usize) -> String {
    if text.len() <= max {
        return text.to_owned();
    }
    let mut start = text.len() - max;
    while !text.is_char_boundary(start) {
        start += 1;
    }
    format!("…\n{}", &text[start..])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_the_last_progress_state() {
        assert_eq!(
            progress_free("Counting objects:  50% (1/2)\rCounting objects: 100% (2/2), done.\nhint: x"),
            "Counting objects: 100% (2/2), done.\nhint: x"
        );
    }

    #[test]
    fn keeps_the_end_of_long_output() {
        let text = format!("{}fatal: the reason", "x".repeat(100));
        assert_eq!(tail(&text, 17), "…\nfatal: the reason");
        assert_eq!(tail("é".repeat(10).as_str(), 5), "…\néé");
    }
}
