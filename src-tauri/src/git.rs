//! IPC commands for repository reads (gix) and writes (git CLI through the queue).

use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

use serde_json::Value;
use tauri::State;

use crate::{
    error::{Error, Result},
    project::Projects,
    queue::{OpKind, Output, Queue},
    read::{
        Repos,
        refs::{self, RefInfo, StashInfo},
        status::{self, RepoStatus},
    },
    write::{self, CommitOptions, DiscardResult, Repo},
};

/// Runs a gix read off the async runtime's worker threads.
async fn read<T: Send + 'static>(
    repos: &Arc<Repos>,
    root: PathBuf,
    f: impl FnOnce(&gix::Repository) -> Result<T> + Send + 'static,
) -> Result<T> {
    let repos = Arc::clone(repos);
    tauri::async_runtime::spawn_blocking(move || f(&repos.get(&root)?))
        .await
        .map_err(|e| Error::Other(e.to_string()))?
}

fn common_dir(projects: &Projects, repos: &Repos, root: &Path) -> Result<PathBuf> {
    if let Some(info) = projects.repo_for(root)
        && info.root == root
    {
        return Ok(info.common_dir);
    }
    Ok(repos.get(root)?.common_dir().to_path_buf())
}

#[tauri::command]
pub async fn repo_status(
    app: tauri::AppHandle,
    repos: State<'_, Arc<Repos>>,
    root: PathBuf,
) -> Result<RepoStatus> {
    let status = read(&repos, root.clone(), status::status).await?;
    crate::tray::set_repo_conflict(&app, &root, !status.merge.is_empty());
    Ok(status)
}

#[tauri::command]
pub async fn repo_head_message(
    repos: State<'_, Arc<Repos>>,
    root: PathBuf,
) -> Result<Option<String>> {
    read(&repos, root, |repo| Ok(status::head_message(repo))).await
}

#[tauri::command]
pub async fn repo_refs(repos: State<'_, Arc<Repos>>, root: PathBuf) -> Result<Vec<RefInfo>> {
    read(&repos, root, refs::refs).await
}

#[tauri::command]
pub async fn repo_stashes(repos: State<'_, Arc<Repos>>, root: PathBuf) -> Result<Vec<StashInfo>> {
    read(&repos, root, refs::stashes).await
}

/// A `git config` value as git resolves it (for `commit.template`, `pull.rebase`, …).
#[tauri::command]
pub async fn repo_config(
    repos: State<'_, Arc<Repos>>,
    root: PathBuf,
    key: String,
) -> Result<Option<String>> {
    read(&repos, root, move |repo| {
        Ok(repo
            .config_snapshot()
            .string(key.as_str())
            .map(|v| v.to_string()))
    })
    .await
}

macro_rules! target {
    ($projects:expr, $repos:expr, $root:expr) => {{
        let common = common_dir(&$projects, &$repos, &$root)?;
        (common, $root)
    }};
}

#[tauri::command]
pub async fn git_stage(
    queue: State<'_, Arc<Queue>>,
    projects: State<'_, Arc<Projects>>,
    repos: State<'_, Arc<Repos>>,
    root: PathBuf,
    paths: Vec<String>,
    label: String,
) -> Result<Output> {
    let (common, root) = target!(projects, repos, root);
    write::stage(
        &queue,
        Repo {
            root: &root,
            common_dir: &common,
        },
        &paths,
        &label,
    )
    .await
}

#[tauri::command]
pub async fn git_unstage(
    queue: State<'_, Arc<Queue>>,
    projects: State<'_, Arc<Projects>>,
    repos: State<'_, Arc<Repos>>,
    root: PathBuf,
    paths: Vec<String>,
    label: String,
) -> Result<Output> {
    let (common, root) = target!(projects, repos, root);
    let unborn = repos.get(&root)?.head_id().is_err();
    write::unstage(
        &queue,
        Repo {
            root: &root,
            common_dir: &common,
        },
        &paths,
        unborn,
        &label,
    )
    .await
}

#[tauri::command]
pub async fn git_discard(
    queue: State<'_, Arc<Queue>>,
    projects: State<'_, Arc<Projects>>,
    repos: State<'_, Arc<Repos>>,
    root: PathBuf,
    tracked: Vec<String>,
    untracked: Vec<String>,
    label: String,
) -> Result<DiscardResult> {
    let (common, root) = target!(projects, repos, root);
    write::discard(
        &queue,
        Repo {
            root: &root,
            common_dir: &common,
        },
        &tracked,
        &untracked,
        &label,
    )
    .await
}

#[tauri::command]
pub async fn git_recovery_point(
    queue: State<'_, Arc<Queue>>,
    projects: State<'_, Arc<Projects>>,
    repos: State<'_, Arc<Repos>>,
    root: PathBuf,
) -> Result<Option<String>> {
    let (common, root) = target!(projects, repos, root);
    write::recovery_point(
        &queue,
        &Repo {
            root: &root,
            common_dir: &common,
        },
    )
    .await
}

#[tauri::command]
pub async fn git_commit(
    queue: State<'_, Arc<Queue>>,
    projects: State<'_, Arc<Projects>>,
    repos: State<'_, Arc<Repos>>,
    root: PathBuf,
    message: String,
    options: CommitOptions,
    label: String,
) -> Result<Output> {
    let (common, root) = target!(projects, repos, root);
    write::commit(
        &queue,
        Repo {
            root: &root,
            common_dir: &common,
        },
        &message,
        &options,
        &label,
    )
    .await
}

// The injected State handles count as arguments
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn git_apply(
    queue: State<'_, Arc<Queue>>,
    projects: State<'_, Arc<Projects>>,
    repos: State<'_, Arc<Repos>>,
    root: PathBuf,
    patch: String,
    cached: bool,
    reverse: bool,
    label: String,
) -> Result<Output> {
    let (common, root) = target!(projects, repos, root);
    write::apply_patch(
        &queue,
        Repo {
            root: &root,
            common_dir: &common,
        },
        &patch,
        cached,
        reverse,
        &label,
    )
    .await
}

#[tauri::command]
pub async fn git_exec(
    queue: State<'_, Arc<Queue>>,
    projects: State<'_, Arc<Projects>>,
    repos: State<'_, Arc<Repos>>,
    root: PathBuf,
    kind: OpKind,
    label: String,
    args: Vec<String>,
) -> Result<Output> {
    let (common, root) = target!(projects, repos, root);
    let result = write::exec(
        &queue,
        Repo {
            root: &root,
            common_dir: &common,
        },
        kind,
        &label,
        &args,
    )
    .await;
    // Remote, branch and config changes are cached in the open handle
    if args.first().is_some_and(|a| a == "remote" || a == "config") {
        repos.forget(&root);
    }
    result
}

#[tauri::command]
pub fn git_ignore(root: PathBuf, paths: Vec<String>) -> Result<()> {
    write::append_gitignore(&root, &paths)
}

/// `git clone <url>` into `parent`; returns the new repository's folder.
#[tauri::command]
pub async fn git_clone(
    queue: State<'_, Arc<Queue>>,
    parent: PathBuf,
    url: String,
    label: String,
) -> Result<PathBuf> {
    let name = url
        .trim_end_matches('/')
        .rsplit(['/', ':'])
        .next()
        .unwrap_or("repository")
        .trim_end_matches(".git")
        .to_owned();
    let dest = parent.join(&name);
    let target = crate::queue::Target {
        worktree: &parent,
        common_dir: &dest,
    };
    queue
        .run(
            target,
            OpKind::Fetch,
            &label,
            &["clone", "--progress", &url, &name],
        )
        .await?;
    Ok(dest)
}

#[tauri::command]
pub fn ai_availability() -> crate::ai::Availability {
    crate::ai::availability()
}

#[tauri::command]
pub async fn ai_commit_message(
    env: State<'_, Arc<crate::env::GitEnv>>,
    settings: State<'_, Arc<crate::settings::Settings>>,
    root: PathBuf,
) -> Result<String> {
    crate::ai::commit_message(&env, &settings, &root).await
}

#[tauri::command]
pub fn trash_paths(paths: Vec<PathBuf>) -> Result<()> {
    for path in paths {
        write::trash(&path)?;
    }
    Ok(())
}

/// Reads a file in the worktree as text, for AI context and small previews.
#[tauri::command]
pub fn read_text_file(path: PathBuf, max_bytes: Option<usize>) -> Result<Value> {
    let bytes = std::fs::read(&path)?;
    let cut = max_bytes.map_or(bytes.len(), |m| m.min(bytes.len()));
    Ok(Value::String(
        String::from_utf8_lossy(&bytes[..cut]).into_owned(),
    ))
}
