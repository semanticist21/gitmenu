//! IPC commands for the panel and the detail window. Field names are camelCase on the wire.

use std::{os::unix::fs::PermissionsExt, path::PathBuf, sync::Arc};

use serde_json::{Map, Value};
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};

use crate::{
    env::{EnvStatus, GitEnv},
    error::{Error, Result},
    project::{ProjectInfo, Projects, UiState},
    queue::{OpKind, Queue, Target},
    settings::Settings,
    tray::{self, DETAIL},
    update::{self, LoginItem},
};

type Env<'a> = State<'a, Arc<GitEnv>>;

#[tauri::command]
pub fn env_status(env: Env) -> EnvStatus {
    env.status()
}

/// Reads the login shell and finds git again ("Try Again" in the panel).
#[tauri::command]
pub fn env_refresh(app: AppHandle, env: Env, settings: State<Arc<Settings>>) {
    env.start(app, settings.inner().clone());
}

#[tauri::command]
pub fn settings_get(settings: State<Arc<Settings>>) -> Map<String, Value> {
    settings.user_values()
}

#[tauri::command]
pub fn settings_set(app: AppHandle, settings: State<Arc<Settings>>, env: Env, key: String, value: Value) -> Result<()> {
    settings.set(&key, value)?;
    if key == "git.path" {
        env.refresh_git(&app, &settings);
    }
    if key == "gitmenu.panel.globalShortcut" {
        crate::register_global_shortcut(&app, &settings);
    }
    Ok(())
}

#[tauri::command]
pub fn settings_file_paths(settings: State<Arc<Settings>>) -> (PathBuf, PathBuf) {
    (settings.settings_path(), settings.keybindings_path())
}

#[tauri::command]
pub fn keybindings_get(settings: State<Arc<Settings>>) -> Value {
    settings.keybindings()
}

#[tauri::command]
pub fn keybindings_set(settings: State<Arc<Settings>>, bindings: Value) -> Result<()> {
    settings.set_keybindings(bindings)
}

#[tauri::command]
pub fn ui_state_get(ui: State<Arc<UiState>>, key: String) -> Option<Value> {
    ui.get(&key)
}

/// The `project_*` commands are `async` on purpose: a non-async `#[tauri::command]` runs inside
/// wry's URL-scheme handler, on the macOS main thread, where a folder like `~/code` froze every
/// window. Anything that touches the filesystem goes through `spawn_blocking` from there, since
/// an `async fn` that blocks only moves the stall onto a tokio worker.
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| Error::Other(e.to_string()))?
}

#[tauri::command]
pub async fn ui_state_set(ui: State<'_, Arc<UiState>>, key: String, value: Value) -> Result<()> {
    ui.inner().set(&key, value);
    Ok(())
}

#[tauri::command]
pub async fn projects_list(projects: State<'_, Arc<Projects>>) -> Result<(Vec<ProjectInfo>, Option<PathBuf>)> {
    Ok((projects.list(), projects.active()))
}

#[tauri::command]
pub async fn projects_recent(projects: State<'_, Arc<Projects>>) -> Result<Vec<PathBuf>> {
    Ok(projects.recent())
}

#[tauri::command]
pub async fn project_open(projects: State<'_, Arc<Projects>>, path: PathBuf) -> Result<ProjectInfo> {
    let projects = Arc::clone(projects.inner());
    let _lane = projects.lane().await;
    blocking(move || projects.open(path)).await
}

#[tauri::command]
pub async fn project_close(projects: State<'_, Arc<Projects>>, id: PathBuf) -> Result<()> {
    let projects = Arc::clone(projects.inner());
    let _lane = projects.lane().await;
    // Dropping the folder's watcher joins its thread, so it does not belong on this thread
    blocking(move || {
        projects.close(&id);
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn project_activate(projects: State<'_, Arc<Projects>>, id: PathBuf) -> Result<()> {
    let _lane = projects.lane().await;
    projects.activate(&id)
}

#[tauri::command]
pub async fn project_reorder(projects: State<'_, Arc<Projects>>, order: Vec<PathBuf>) -> Result<()> {
    let _lane = projects.lane().await;
    projects.reorder(order);
    Ok(())
}

#[tauri::command]
pub async fn project_relocate(projects: State<'_, Arc<Projects>>, id: PathBuf, path: PathBuf) -> Result<ProjectInfo> {
    let projects = Arc::clone(projects.inner());
    let _lane = projects.lane().await;
    blocking(move || projects.relocate(&id, path)).await
}

#[tauri::command]
pub async fn project_answer_parent(
    projects: State<'_, Arc<Projects>>,
    id: PathBuf,
    accept: bool,
) -> Result<ProjectInfo> {
    let projects = Arc::clone(projects.inner());
    let _lane = projects.lane().await;
    blocking(move || projects.answer_parent(&id, accept)).await
}

#[tauri::command]
pub async fn project_init_repo(
    projects: State<'_, Arc<Projects>>,
    queue: State<'_, Arc<Queue>>,
    id: PathBuf,
    label: String,
    branch: Option<String>,
) -> Result<ProjectInfo> {
    // The tab is published before its scan finds anything, so the caller's repository list is
    // no answer: a folder that already is (or sits in) a repository must not be initialized.
    let covered = {
        let projects = Arc::clone(projects.inner());
        let id = id.clone();
        blocking(move || Ok(projects.has_repo(&id))).await?
    };
    if covered {
        return projects.info(&id);
    }
    let mut args = vec!["init"];
    if let Some(branch) = branch.as_deref().filter(|b| !b.is_empty()) {
        args.extend(["-b", branch]);
    }
    queue.run(Target { worktree: &id, common_dir: &id.join(".git") }, OpKind::Other, &label, &args).await?;
    let projects = Arc::clone(projects.inner());
    blocking(move || projects.rescan(&id)).await
}

/// Shows a file or folder picker in front of other apps. The app is a non-activating accessory,
/// so it activates itself first or the picker would open behind the frontmost app.
/// Runs a native picker as a standalone modal window (`runModal`). The dialog plugin's picker is
/// a sheet on the app's main window, and while the detail window is open that is where it hangs.
async fn run_picker(
    app: &AppHandle,
    pick: impl FnOnce() -> Option<PathBuf> + Send + 'static,
) -> Result<Option<PathBuf>> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    tray::set_picker_open(app, true);
    let shown = app.run_on_main_thread(move || {
        activate_app();
        let _ = tx.send(pick());
    });
    let picked = if shown.is_ok() { rx.await.unwrap_or(None) } else { None };
    tray::set_picker_open(app, false);
    shown?;
    Ok(picked)
}

#[tauri::command]
pub async fn pick_file(app: AppHandle, title: Option<String>, directory: PathBuf) -> Result<Option<PathBuf>> {
    run_picker(&app, move || {
        let dialog = rfd::FileDialog::new().set_directory(directory);
        match title {
            Some(title) => dialog.set_title(title),
            None => dialog,
        }
        .pick_file()
    })
    .await
}

#[tauri::command]
pub async fn pick_folder(app: AppHandle, title: Option<String>) -> Result<Option<PathBuf>> {
    run_picker(&app, move || {
        let dialog = rfd::FileDialog::new().set_can_create_directories(true);
        match title {
            Some(title) => dialog.set_title(title),
            None => dialog,
        }
        .pick_folder()
    })
    .await
}

fn activate_app() {
    use objc2_app_kit::NSApplication;
    let Some(mtm) = objc2::MainThreadMarker::new() else {
        return;
    };
    let app = NSApplication::sharedApplication(mtm);
    #[allow(deprecated)]
    app.activateIgnoringOtherApps(true);
}

#[tauri::command]
pub fn panel_hide(app: AppHandle) {
    tray::hide_panel(&app);
}

#[tauri::command]
pub fn panel_set_pinned(app: AppHandle, pinned: bool) {
    tray::set_pinned(&app, pinned);
}

#[tauri::command]
pub fn panel_set_detached(app: AppHandle, detached: bool) {
    tray::set_detached(&app, detached);
}

/// Opens (or focuses) the single detail window; `route` picks the tab to show.
#[tauri::command]
pub fn detail_open(app: AppHandle, route: String) -> Result<()> {
    tray::keep_open_briefly(&app);
    if let Some(window) = app.get_webview_window(DETAIL) {
        let _ = tauri::Emitter::emit_to(&app, DETAIL, "detail://navigate", &route);
        window.show()?;
        window.set_focus()?;
        return Ok(());
    }
    let url = format!("index.html#{route}");
    WebviewWindowBuilder::new(&app, DETAIL, WebviewUrl::App(url.into()))
        .title("gitmenu")
        .inner_size(1100.0, 760.0)
        .min_inner_size(640.0, 400.0)
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .visible(true)
        .focused(true)
        .build()?;
    Ok(())
}

#[tauri::command]
pub fn detail_set_always_on_top(app: AppHandle, value: bool) -> Result<()> {
    if let Some(window) = app.get_webview_window(DETAIL) {
        window.set_always_on_top(value)?;
    }
    Ok(())
}

/// Prompts git is still waiting on (the panel asks when it mounts; events aren't replayed).
#[tauri::command]
pub fn prompt_open(env: Env) -> Vec<crate::env::PromptEvent> {
    env.open_prompts()
}

#[tauri::command]
pub fn prompt_respond(env: Env, id: u64, value: Option<String>) {
    env.respond(id, value);
}

/// Reads the message file git handed to its editor.
#[tauri::command]
pub fn prompt_read_file(path: PathBuf) -> Result<String> {
    Ok(std::fs::read_to_string(path)?)
}

/// Saves the edited message and tells git the editor closed.
#[tauri::command]
pub fn prompt_write_file(env: Env, id: u64, path: PathBuf, content: Option<String>) -> Result<()> {
    match content {
        Some(content) => {
            std::fs::write(path, content)?;
            env.respond(id, Some(String::new()));
        }
        None => env.respond(id, None),
    }
    Ok(())
}

/// The Git output log, oldest first
#[tauri::command]
pub fn git_log_entries(queue: State<Arc<Queue>>) -> Vec<crate::output::LogEntry> {
    queue.log().entries()
}

#[tauri::command]
pub fn git_log_clear(queue: State<Arc<Queue>>) {
    queue.log().clear();
}

/// A failed operation's commands, by the key from `op://finished`
#[tauri::command]
pub fn git_log_failure(queue: State<Arc<Queue>>, key: String) -> Option<Vec<crate::output::LogEntry>> {
    queue.log().failure(&key)
}

#[tauri::command]
pub fn op_cancel(queue: State<Arc<Queue>>, id: u64) {
    queue.cancel(id);
}

#[tauri::command]
pub async fn open_in_terminal(settings: State<'_, Arc<Settings>>, path: PathBuf) -> Result<()> {
    let app_name = settings.get_str("gitmenu.terminal.app").unwrap_or_else(|| "Terminal".into());
    run_open(&["-a", &app_name], &path).await
}

#[tauri::command]
pub async fn clipboard_write(text: String) -> Result<()> {
    use tokio::io::AsyncWriteExt;
    let mut child = pasteboard("/usr/bin/pbcopy").stdin(std::process::Stdio::piped()).spawn()?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(text.as_bytes()).await?;
    }
    child.wait().await?;
    Ok(())
}

#[tauri::command]
pub async fn clipboard_read() -> Result<String> {
    let output = pasteboard("/usr/bin/pbpaste").stdin(std::process::Stdio::null()).output().await?;
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// pbcopy and pbpaste pick their text encoding from the locale, and an app started from Finder
/// may have none: without UTF-8 they drop or garble anything outside ASCII.
fn pasteboard(program: &str) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new(program);
    cmd.env("LC_ALL", "en_US.UTF-8");
    cmd
}

#[tauri::command]
pub async fn reveal_in_finder(path: PathBuf) -> Result<()> {
    run_open(&["-R"], &path).await
}

/// Opens a file or folder with its default app (macOS `open`).
#[tauri::command]
pub async fn open_path(path: PathBuf) -> Result<()> {
    // Files and web links only: `open` would also run apps and scripts, and remote URLs come
    // from repository config and settings
    let text = path.to_string_lossy();
    let web = text.starts_with("https://") || text.starts_with("http://");
    if !web && !path.is_absolute() {
        return Err(Error::Other(format!("not a file path or web link: {text}")));
    }
    if !web {
        let meta = std::fs::metadata(&path)?;
        if !meta.is_file() && !meta.is_dir() {
            return Err(Error::Other(format!("not a file or folder: {text}")));
        }
        if path.extension().is_some_and(|e| e == "app") || meta.permissions().mode() & 0o111 != 0 && meta.is_file() {
            return Err(Error::Other(format!("won't launch an executable: {text}")));
        }
    }
    run_open(&[], &path).await
}

async fn run_open(flags: &[&str], path: &PathBuf) -> Result<()> {
    let output = tokio::process::Command::new("/usr/bin/open").args(flags).arg(path).output().await?;
    if output.status.success() {
        Ok(())
    } else {
        Err(Error::Other(String::from_utf8_lossy(&output.stderr).trim().to_owned()))
    }
}

/// Terminal apps installed on this Mac, for the setting's picker.
#[tauri::command]
pub fn terminal_apps() -> Vec<String> {
    const KNOWN: [&str; 9] =
        ["Terminal", "iTerm", "Ghostty", "Warp", "WezTerm", "kitty", "Alacritty", "Hyper", "Tabby"];
    let dirs = [PathBuf::from("/Applications"), PathBuf::from("/System/Applications/Utilities")]
        .into_iter()
        .chain(std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Applications")));
    let dirs: Vec<PathBuf> = dirs.collect();
    KNOWN
        .iter()
        .filter(|name| dirs.iter().any(|d| d.join(format!("{name}.app")).exists()))
        .map(|s| (*s).to_owned())
        .collect()
}

#[tauri::command]
pub fn app_quit(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub fn login_item_status() -> LoginItem {
    update::login_item_status()
}

#[tauri::command]
pub fn login_item_set(enabled: bool) -> Result<LoginItem> {
    update::set_login_item(enabled)
}

#[tauri::command]
pub async fn update_check(app: AppHandle) -> Result<Option<update::Update>> {
    update::check(&app).await
}

#[tauri::command]
pub async fn update_install(app: AppHandle) -> Result<()> {
    update::install(&app).await
}

/// Reports a window's uncaught error when crash reports are on.
#[tauri::command]
pub fn crash_report(message: String) {
    crate::crash::report(&message);
}
