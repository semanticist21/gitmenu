//! IPC commands for the panel and the detail window. Field names are camelCase on the wire.

use std::{path::PathBuf, sync::Arc};

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
    if key == "gitside.panel.globalShortcut" {
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

#[tauri::command]
pub fn ui_state_set(ui: State<Arc<UiState>>, key: String, value: Value) {
    ui.set(&key, value);
}

#[tauri::command]
pub fn projects_list(projects: State<Arc<Projects>>) -> (Vec<ProjectInfo>, Option<PathBuf>) {
    (projects.list(), projects.active())
}

#[tauri::command]
pub fn projects_recent(projects: State<Arc<Projects>>) -> Vec<PathBuf> {
    projects.recent()
}

#[tauri::command]
pub fn project_open(projects: State<Arc<Projects>>, path: PathBuf) -> Result<ProjectInfo> {
    projects.inner().open(path)
}

#[tauri::command]
pub fn project_close(projects: State<Arc<Projects>>, id: PathBuf) {
    projects.close(&id);
}

#[tauri::command]
pub fn project_activate(projects: State<Arc<Projects>>, id: PathBuf) -> Result<()> {
    projects.activate(&id)
}

#[tauri::command]
pub fn project_reorder(projects: State<Arc<Projects>>, order: Vec<PathBuf>) {
    projects.reorder(order);
}

#[tauri::command]
pub fn project_relocate(projects: State<Arc<Projects>>, id: PathBuf, path: PathBuf) -> Result<ProjectInfo> {
    projects.inner().relocate(&id, path)
}

#[tauri::command]
pub fn project_answer_parent(projects: State<Arc<Projects>>, id: PathBuf, accept: bool) -> Result<ProjectInfo> {
    projects.inner().answer_parent(&id, accept)
}

#[tauri::command]
pub async fn project_init_repo(
    projects: State<'_, Arc<Projects>>,
    queue: State<'_, Arc<Queue>>,
    id: PathBuf,
) -> Result<ProjectInfo> {
    queue.run(Target { worktree: &id, common_dir: &id.join(".git") }, OpKind::Other, "git init", &["init"]).await?;
    projects.inner().rescan(&id)
}

/// Shows the folder picker in front of other apps. The app is a non-activating accessory,
/// so it activates itself first or the picker would open behind the frontmost app.
#[tauri::command]
pub async fn pick_folder(app: AppHandle, title: Option<String>) -> Result<Option<PathBuf>> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    let app2 = app.clone();
    app.run_on_main_thread(move || {
        activate_app();
        let mut dialog = app2.dialog().file();
        if let Some(title) = title {
            dialog = dialog.set_title(title);
        }
        dialog.pick_folder(move |folder| {
            let _ = tx.send(folder.and_then(|f| f.into_path().ok()));
        });
    })?;
    Ok(rx.await.unwrap_or(None))
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

/// Opens (or focuses) the single detail window; `route` picks the tab to show.
#[tauri::command]
pub fn detail_open(app: AppHandle, route: String) -> Result<()> {
    if let Some(window) = app.get_webview_window(DETAIL) {
        let _ = tauri::Emitter::emit_to(&app, DETAIL, "detail://navigate", &route);
        window.show()?;
        window.set_focus()?;
        return Ok(());
    }
    let url = format!("index.html#{route}");
    WebviewWindowBuilder::new(&app, DETAIL, WebviewUrl::App(url.into()))
        .title("gitside")
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

#[tauri::command]
pub fn op_cancel(queue: State<Arc<Queue>>, id: u64) {
    queue.cancel(id);
}

#[tauri::command]
pub async fn open_in_terminal(settings: State<'_, Arc<Settings>>, path: PathBuf) -> Result<()> {
    let app_name = settings.get_str("gitside.terminal.app").unwrap_or_else(|| "Terminal".into());
    run_open(&["-a", &app_name], &path).await
}

#[tauri::command]
pub async fn reveal_in_finder(path: PathBuf) -> Result<()> {
    run_open(&["-R"], &path).await
}

/// Opens a file or folder with its default app (macOS `open`).
#[tauri::command]
pub async fn open_path(path: PathBuf) -> Result<()> {
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
