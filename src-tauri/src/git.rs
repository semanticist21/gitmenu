//! IPC commands for repository reads (gix) and writes (git CLI through the queue).

use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

use serde_json::Value;
use tauri::State;

use crate::{
    error::{Error, Result},
    project::{HugeRepos, Projects},
    queue::{OpKind, Output, Queue},
    read::{
        Repos,
        blame::{self, Blame},
        content::{self, DiffResult, Side},
        log::{self, CommitDetails, Comparison, LogPage, LogQuery},
        refs::{self, RefInfo, RemoteInfo, StashInfo},
        status::{self, RepoStatus},
    },
    settings::Settings,
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
    settings: State<'_, Arc<Settings>>,
    huge: State<'_, Arc<HugeRepos>>,
    root: PathBuf,
) -> Result<RepoStatus> {
    let limit = settings.get("git.statusLimit").as_u64().unwrap_or(10_000) as usize;
    let status = read(&repos, root.clone(), move |repo| status::status(repo, limit)).await?;
    // A repository this big stops being refreshed from the watcher, as in VS Code
    huge.set(&root, status.hit_limit);
    crate::tray::set_repo_conflict(&app, &root, !status.merge.is_empty());
    Ok(status)
}

/// Contents of both sides and their line hunks, for the diff tab.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn repo_diff(
    repos: State<'_, Arc<Repos>>,
    root: PathBuf,
    path: String,
    original_path: Option<String>,
    left: Side,
    right: Side,
    max_bytes: u64,
    ignore_trim_whitespace: bool,
) -> Result<DiffResult> {
    read(&repos, root.clone(), move |repo| {
        let left_path = original_path.as_deref().unwrap_or(&path);
        let mut left_bytes = content::load(repo, &root, left_path, &left)?;
        // A file added to the index since HEAD compares against HEAD's (missing) version
        if left_bytes.is_none() && matches!(left, Side::Index) {
            left_bytes = content::load(repo, &root, left_path, &Side::Head)?;
        }
        let right_bytes = content::load(repo, &root, &path, &right)?;
        Ok(content::diff(
            left_path,
            &path,
            left_bytes,
            right_bytes,
            &content::DiffOptions { max_bytes, ignore_trim_whitespace },
        ))
    })
    .await
}

/// One file's text at a side (for "Open File (HEAD)" and "Open File at Revision").
#[tauri::command]
pub async fn repo_file(
    repos: State<'_, Arc<Repos>>,
    root: PathBuf,
    path: String,
    side: Side,
    max_bytes: u64,
) -> Result<DiffResult> {
    read(&repos, root.clone(), move |repo| {
        let bytes = content::load(repo, &root, &path, &side)?;
        let mut result = content::diff(
            &path,
            &path,
            None,
            bytes,
            &content::DiffOptions { max_bytes, ignore_trim_whitespace: false },
        );
        result.hunks.clear();
        Ok(result)
    })
    .await
}

#[tauri::command]
pub async fn repo_blame(
    repos: State<'_, Arc<Repos>>,
    root: PathBuf,
    path: String,
    rev: String,
    worktree: bool,
) -> Result<Blame> {
    read(&repos, root.clone(), move |repo| {
        let text = if worktree { std::fs::read_to_string(root.join(&path)).ok() } else { None };
        blame::blame(repo, &path, &rev, text.as_deref())
    })
    .await
}

#[tauri::command]
pub async fn repo_head_message(repos: State<'_, Arc<Repos>>, root: PathBuf) -> Result<Option<String>> {
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

/// Runs a read-only git command that gix can't do (`log -L`, `log -G`) and returns stdout.
async fn cli_read(env: &crate::env::GitEnv, root: &Path, args: &[String]) -> Result<String> {
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    let output = env.git(root, &args).await?.output().await?;
    if !output.status.success() {
        return Err(Error::Git {
            message: format!("git {} failed", args.first().copied().unwrap_or_default()),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
            code: output.status.code(),
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn page(mut commits: Vec<log::CommitInfo>, limit: usize) -> LogPage {
    let more = commits.len() > limit;
    commits.truncate(limit);
    LogPage { commits, more }
}

/// A page of commits (Commits view, File History, search results, comparisons).
#[tauri::command]
pub async fn repo_log(
    env: State<'_, Arc<crate::env::GitEnv>>,
    repos: State<'_, Arc<Repos>>,
    root: PathBuf,
    query: LogQuery,
) -> Result<LogPage> {
    if query.search.as_ref().is_some_and(|s| !s.changes.is_empty()) {
        let out = cli_read(&env, &root, &log::cli_search_args(&query)).await?;
        return Ok(page(log::parse_cli(&out), query.limit));
    }
    read(&repos, root, move |repo| log::log(repo, &query)).await
}

/// Commits that changed lines `start..=end` (1-based) of `path` (`git log -L`).
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn repo_line_history(
    env: State<'_, Arc<crate::env::GitEnv>>,
    root: PathBuf,
    path: String,
    start: u32,
    end: u32,
    rev: Option<String>,
    skip: usize,
    limit: usize,
) -> Result<LogPage> {
    let args = vec![
        "log".to_owned(),
        log::CLI_FORMAT.to_owned(),
        "--no-patch".to_owned(),
        format!("-L{start},{end}:{path}"),
        format!("--skip={skip}"),
        format!("--max-count={}", limit + 1),
        rev.unwrap_or_else(|| "HEAD".into()),
    ];
    let out = cli_read(&env, &root, &args).await?;
    Ok(page(log::parse_cli(&out), limit))
}

#[tauri::command]
pub async fn repo_commit(repos: State<'_, Arc<Repos>>, root: PathBuf, rev: String) -> Result<CommitDetails> {
    read(&repos, root, move |repo| log::commit_details(repo, &rev)).await
}

#[tauri::command]
pub async fn repo_compare(
    repos: State<'_, Arc<Repos>>,
    root: PathBuf,
    base: String,
    head: String,
) -> Result<Comparison> {
    read(&repos, root, move |repo| log::compare(repo, &base, &head)).await
}

#[tauri::command]
pub async fn repo_branches(repos: State<'_, Arc<Repos>>, root: PathBuf) -> Result<Vec<refs::BranchInfo>> {
    read(&repos, root, refs::branches).await
}

#[tauri::command]
pub async fn repo_worktrees(repos: State<'_, Arc<Repos>>, root: PathBuf) -> Result<Vec<refs::WorktreeInfo>> {
    read(&repos, root, refs::worktrees).await
}

#[tauri::command]
pub async fn repo_contributors(repos: State<'_, Arc<Repos>>, root: PathBuf) -> Result<Vec<refs::Contributor>> {
    read(&repos, root, refs::contributors).await
}

#[tauri::command]
pub async fn repo_remotes(repos: State<'_, Arc<Repos>>, root: PathBuf) -> Result<Vec<RemoteInfo>> {
    read(&repos, root, refs::remotes).await
}

#[tauri::command]
pub async fn avatars_resolve(
    env: State<'_, Arc<crate::env::GitEnv>>,
    avatars: State<'_, Arc<crate::avatar::Avatars>>,
    repos: State<'_, Arc<Repos>>,
    root: PathBuf,
    requests: Vec<crate::avatar::AvatarRequest>,
) -> Result<std::collections::HashMap<String, String>> {
    let remotes = read(&repos, root.clone(), refs::remotes).await.unwrap_or_default();
    // `origin` first, then any other GitHub remote
    let github = remotes
        .iter()
        .filter(|r| r.name == "origin")
        .chain(remotes.iter())
        .find_map(|r| r.fetch_url.as_deref().and_then(crate::avatar::github_repo));
    Ok(avatars.resolve(&env, &root, github, requests).await)
}

/// A `git config` value as git resolves it (for `commit.template`, `pull.rebase`, …).
#[tauri::command]
pub async fn repo_config(repos: State<'_, Arc<Repos>>, root: PathBuf, key: String) -> Result<Option<String>> {
    read(&repos, root, move |repo| Ok(repo.config_snapshot().string(key.as_str()).map(|v| v.to_string()))).await
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
    write::stage(&queue, Repo { root: &root, common_dir: &common }, &paths, &label).await
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
    write::unstage(&queue, Repo { root: &root, common_dir: &common }, &paths, unborn, &label).await
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
    write::discard(&queue, Repo { root: &root, common_dir: &common }, &tracked, &untracked, &label).await
}

#[tauri::command]
pub async fn git_recovery_point(
    queue: State<'_, Arc<Queue>>,
    projects: State<'_, Arc<Projects>>,
    repos: State<'_, Arc<Repos>>,
    root: PathBuf,
    label: String,
) -> Result<Option<String>> {
    let (common, root) = target!(projects, repos, root);
    write::recovery_point(&queue, &Repo { root: &root, common_dir: &common }, &label).await
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
    write::commit(&queue, Repo { root: &root, common_dir: &common }, &message, &options, &label).await
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
    write::apply_patch(&queue, Repo { root: &root, common_dir: &common }, &patch, cached, reverse, &label).await
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
    check_exec_args(&args)?;
    let result = write::exec(&queue, Repo { root: &root, common_dir: &common }, kind, &label, &args).await;
    // Remote, branch and config changes are cached in the open handle
    if args.first().is_some_and(|a| a == "remote" || a == "config") {
        repos.forget(&root);
    }
    result
}

/// Subcommands the windows may run through `git_exec`; anything that could point git at
/// another program (`-c`, `--exec-path`, `--upload-pack`, …) is refused.
const EXEC_ALLOWED: &[&str] = &[
    "branch",
    "checkout",
    "cherry-pick",
    "commit",
    "config",
    "fetch",
    "ls-remote",
    "merge",
    "pull",
    "push",
    "rebase",
    "remote",
    "reset",
    "rev-list",
    "revert",
    "stash",
    "switch",
    "tag",
    "update-ref",
    "worktree",
];

fn check_exec_args(args: &[String]) -> Result<()> {
    let Some(first) = args.first() else { return Err(Error::Other("empty git command".into())) };
    if !EXEC_ALLOWED.contains(&first.as_str()) {
        return Err(Error::Other(format!("git {first} isn't allowed from the window")));
    }
    let blocked = ["-c", "--exec-path", "--upload-pack", "--receive-pack", "--git-dir", "--work-tree", "-C"];
    for arg in args {
        if blocked.iter().any(|b| arg == b || arg.starts_with(&format!("{b}="))) {
            return Err(Error::Other(format!("git option {arg} isn't allowed from the window")));
        }
    }
    if first == "config" && args.iter().any(|a| a.starts_with("core.sshCommand") || a.starts_with("core.gitProxy")) {
        return Err(Error::Other("that config key isn't allowed from the window".into()));
    }
    Ok(())
}

#[tauri::command]
pub fn git_ignore(root: PathBuf, paths: Vec<String>) -> Result<()> {
    write::append_gitignore(&root, &paths)
}

/// `git clone <url>` into `parent`; returns the new repository's folder.
#[tauri::command]
pub async fn git_clone(queue: State<'_, Arc<Queue>>, parent: PathBuf, url: String, label: String) -> Result<PathBuf> {
    let name =
        url.trim_end_matches('/').rsplit(['/', ':']).next().unwrap_or("repository").trim_end_matches(".git").to_owned();
    let dest = parent.join(&name);
    let target = crate::queue::Target { worktree: &parent, common_dir: &dest };
    queue.run(target, OpKind::Fetch, &label, &["clone", "--progress", &url, &name]).await?;
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

/// Reads a file inside `root` as text, for AI context and conflict checks.
#[tauri::command]
pub fn read_text_file(root: PathBuf, path: String, max_bytes: Option<usize>) -> Result<Value> {
    let root = std::fs::canonicalize(&root)?;
    let full = std::fs::canonicalize(root.join(&path))?;
    if !full.starts_with(&root) {
        return Err(Error::Other(format!("{path} is outside the repository")));
    }
    let bytes = std::fs::read(&full)?;
    let cut = max_bytes.map_or(bytes.len(), |m| m.min(bytes.len()));
    Ok(Value::String(String::from_utf8_lossy(&bytes[..cut]).into_owned()))
}

/// A page of the commit graph for the Graph tab.
#[tauri::command]
pub async fn repo_graph(
    repos: State<'_, Arc<Repos>>,
    graphs: State<'_, Arc<crate::read::graph::GraphCache>>,
    root: PathBuf,
    query: crate::read::graph::GraphQuery,
) -> Result<crate::read::graph::GraphPage> {
    let graphs = Arc::clone(&graphs);
    let at = root.clone();
    read(&repos, root, move |repo| graphs.page(repo, &at, &query)).await
}

#[cfg(test)]
mod tests {
    use super::check_exec_args;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn exec_allowlist() {
        assert!(check_exec_args(&args(&["push", "origin", "main"])).is_ok());
        assert!(check_exec_args(&args(&["stash", "pop", "--index", "stash@{0}"])).is_ok());
        assert!(check_exec_args(&args(&[])).is_err());
        assert!(check_exec_args(&args(&["clone", "x"])).is_err());
        assert!(check_exec_args(&args(&["push", "-c", "core.sshCommand=evil"])).is_err());
        assert!(check_exec_args(&args(&["fetch", "--upload-pack=evil"])).is_err());
        assert!(check_exec_args(&args(&["config", "core.sshCommand", "evil"])).is_err());
        assert!(check_exec_args(&args(&["config", "user.name", "Ann"])).is_ok());
    }
}
