//! `git.autofetch`: fetches every open repository every `git.autofetchPeriod` seconds
//! (VS Code's defaults: off, 180s). `"all"` fetches every remote, `true` the default one.

use std::{sync::Arc, time::Duration};

use tauri::{AppHandle, Manager};

use crate::{project::Projects, queue::OpKind, queue::Queue, queue::Target, settings::Settings};

pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            let (enabled, all, period) = {
                let settings = app.state::<Arc<Settings>>();
                let mode = settings.get("git.autofetch");
                let period = settings.get("git.autofetchPeriod").as_u64().unwrap_or(180).max(30);
                (mode.as_bool() == Some(true) || mode.as_str() == Some("all"), mode.as_str() == Some("all"), period)
            };
            tokio::time::sleep(Duration::from_secs(period)).await;
            if !enabled {
                continue;
            }
            let projects = app.state::<Arc<Projects>>().list();
            let queue = app.state::<Arc<Queue>>();
            for project in projects.iter().filter(|p| !p.missing) {
                for repo in &project.repos {
                    let target = Target { worktree: &repo.root, common_dir: &repo.common_dir };
                    let args: &[&str] = if all { &["fetch", "--all"] } else { &["fetch"] };
                    // Already fetching, or no remote: nothing to report for a background task
                    let _ = queue.run_background(target, OpKind::Fetch, "git fetch", args).await;
                }
            }
        }
    });
}
