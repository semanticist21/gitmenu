//! The Git output log, like VS Code's Git output channel: every git command the queue runs, how
//! long it took, its exit code and what it wrote to stderr. Kept in memory, the last 500.

use std::{
    collections::VecDeque,
    path::PathBuf,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

const KEEP: usize = 500;
/// Stderr kept per command; progress output of a long fetch can be much longer
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
    /// None when it was cancelled or couldn't start
    pub code: Option<i32>,
    pub stderr: String,
}

#[derive(Default)]
pub struct GitLog(Mutex<VecDeque<LogEntry>>);

impl GitLog {
    pub fn push(&self, app: &AppHandle, mut entry: LogEntry) {
        entry.stderr = progress_free(&entry.stderr);
        if entry.stderr.len() > MAX_STDERR {
            let mut end = MAX_STDERR;
            while !entry.stderr.is_char_boundary(end) {
                end -= 1;
            }
            entry.stderr.truncate(end);
            entry.stderr.push_str("\n…");
        }
        {
            let mut entries = self.0.lock().unwrap();
            if entries.len() == KEEP {
                entries.pop_front();
            }
            entries.push_back(entry.clone());
        }
        let _ = app.emit("git-log://entry", entry);
    }

    pub fn entries(&self) -> Vec<LogEntry> {
        self.0.lock().unwrap().iter().cloned().collect()
    }

    pub fn clear(&self) {
        self.0.lock().unwrap().clear();
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
}
