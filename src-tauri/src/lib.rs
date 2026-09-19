mod ai;
mod autofetch;
mod avatar;
mod commands;
mod crash;
mod env;
mod error;
mod git;
mod output;
mod project;
mod queue;
mod read;
mod settings;
mod terminal;
mod tray;
mod update;
mod write;

use std::sync::Arc;

use tauri::{ActivationPolicy, AppHandle, Emitter, Listener, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

pub use env::run_helper;

use crate::{env::GitEnv, project::Projects, queue::Queue, settings::Settings, terminal::Terminals};

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_nspanel_init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                // The panel is sized and placed under the menu bar icon by tray.rs
                .with_denylist(&[tray::PANEL])
                .build(),
        )
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        tray::toggle_panel(app);
                    }
                })
                .build(),
        )
        .setup(|app| {
            app.set_activation_policy(ActivationPolicy::Accessory);
            let handle = app.handle().clone();
            if update::updater_configured(&handle) {
                handle.plugin(tauri_plugin_updater::Builder::new().build())?;
            }
            let dir = project::app_support_dir(&handle);
            let settings = Settings::load(dir.clone())?;
            crash::init(&settings);
            settings.watch(handle.clone())?;
            let ui = project::UiState::load(&dir);
            app.manage(Arc::clone(&settings));
            app.manage(Arc::clone(&ui));

            let env = GitEnv::new();
            env.start(handle.clone(), Arc::clone(&settings));
            tauri::async_runtime::spawn({
                let (env, handle) = (Arc::clone(&env), handle.clone());
                async move {
                    if let Err(e) = env.serve_prompts(handle).await {
                        log::error!("prompt socket stopped: {e}");
                    }
                }
            });
            app.manage(Arc::clone(&env));

            app.manage(Arc::new(read::Repos::default()));
            app.manage(Arc::new(read::graph::GraphCache::default()));
            let cache = app.path().app_cache_dir().unwrap_or_else(|_| std::env::temp_dir().join("gitmenu"));
            app.manage(Arc::new(avatar::Avatars::new(&cache)));
            app.manage(Terminals::new(cache.join("shell-integration"), handle.package_info().version.to_string(), {
                let handle = handle.clone();
                move |event| {
                    let _ = match event {
                        terminal::Event::Exit(exit) => handle.emit(terminal::EXIT_EVENT, exit),
                        terminal::Event::Title(title) => handle.emit(terminal::TITLE_EVENT, title),
                    };
                }
            }));
            let queue = Queue::new(Arc::clone(&env), handle.clone());
            app.manage(Arc::clone(&queue));
            let projects = Projects::new(handle.clone(), Arc::clone(&settings), Arc::clone(&ui), queue);
            projects.restore();
            app.manage(Arc::clone(&projects));

            tray::setup(&handle)?;
            autofetch::start(handle.clone());
            register_global_shortcut(&handle, &settings);
            // Edits to settings.json from outside the app: act only on the keys that matter
            handle.listen("settings://changed", {
                let handle = handle.clone();
                let seen = std::sync::Mutex::new((
                    settings.get_str("git.path"),
                    settings.get_str("gitmenu.panel.globalShortcut"),
                ));
                move |_| {
                    let settings = handle.state::<Arc<Settings>>();
                    let now = (settings.get_str("git.path"), settings.get_str("gitmenu.panel.globalShortcut"));
                    let mut seen = seen.lock().unwrap();
                    if now.1 != seen.1 {
                        register_global_shortcut(&handle, &settings);
                    }
                    if now.0 != seen.0 {
                        handle.state::<Arc<GitEnv>>().refresh_git(&handle, &settings);
                    }
                    *seen = now;
                }
            });

            // First launch: nothing to show from the menu bar yet, so open the panel
            if projects.list().is_empty() && ui.get("launched").is_none() {
                ui.set("launched", serde_json::Value::Bool(true));
                tray::show_panel(&handle);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::env_status,
            commands::env_refresh,
            commands::settings_get,
            commands::settings_set,
            commands::settings_file_paths,
            commands::keybindings_get,
            commands::keybindings_set,
            commands::ui_state_get,
            commands::ui_state_set,
            commands::projects_list,
            commands::projects_recent,
            commands::project_open,
            commands::project_close,
            commands::project_activate,
            commands::project_reorder,
            commands::project_relocate,
            commands::project_answer_parent,
            commands::project_init_repo,
            commands::pick_folder,
            commands::pick_file,
            commands::clipboard_write,
            commands::clipboard_read,
            commands::panel_hide,
            commands::panel_set_pinned,
            commands::panel_set_detached,
            commands::detail_open,
            commands::detail_set_always_on_top,
            commands::prompt_open,
            commands::prompt_respond,
            commands::prompt_read_file,
            commands::prompt_write_file,
            commands::op_cancel,
            commands::git_log_entries,
            commands::git_log_clear,
            commands::git_log_failure,
            commands::open_in_terminal,
            commands::reveal_in_finder,
            commands::open_path,
            commands::terminal_apps,
            commands::app_quit,
            commands::login_item_status,
            commands::login_item_set,
            commands::update_check,
            commands::update_install,
            commands::crash_report,
            git::repo_status,
            git::repo_head_message,
            git::repo_diff,
            git::repo_file,
            git::repo_blame,
            git::repo_log,
            git::repo_line_history,
            git::repo_commit,
            git::repo_compare,
            git::repo_remotes,
            git::repo_branches,
            git::repo_worktrees,
            git::repo_contributors,
            git::repo_graph,
            git::avatars_resolve,
            git::repo_refs,
            git::repo_stashes,
            git::repo_config,
            git::git_stage,
            git::git_unstage,
            git::git_discard,
            git::git_recovery_point,
            git::git_commit,
            git::git_apply,
            git::git_exec,
            git::ai_availability,
            git::ai_commit_message,
            git::git_ignore,
            git::git_clone,
            git::trash_paths,
            git::read_text_file,
            terminal::terminal_open,
            terminal::terminal_write,
            terminal::terminal_write_binary,
            terminal::terminal_resize,
            terminal::terminal_has_child_processes,
            terminal::terminal_kill,
        ])
        .build(tauri::generate_context!())
        .expect("error while building gitmenu")
        .run(|app, event| match event {
            tauri::RunEvent::Exit => {
                tray::save_detached_frame(app);
                app.state::<Arc<GitEnv>>().cleanup();
                app.state::<Arc<Terminals>>().kill_all();
            }
            // Terminal tabs live in the detail window; their shells end with it
            tauri::RunEvent::WindowEvent { label, event: tauri::WindowEvent::Destroyed, .. }
                if label == tray::DETAIL =>
            {
                app.state::<Arc<Terminals>>().kill_all();
            }
            tauri::RunEvent::WindowEvent { label, event, .. } if label == tray::PANEL => match event {
                // The detached window's close button re-attaches it instead of destroying it
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    tray::hide_panel(app);
                    tray::set_detached(app, false);
                }
                tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => tray::note_detached_frame(app),
                _ => {}
            },
            _ => {}
        });
}

fn tauri_plugin_nspanel_init() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_nspanel::init()
}

/// Binds the one global shortcut (panel open/close) from `gitmenu.panel.globalShortcut`.
pub(crate) fn register_global_shortcut(app: &AppHandle, settings: &Settings) {
    let shortcuts = app.global_shortcut();
    let _ = shortcuts.unregister_all();
    if let Some(accelerator) = settings.get_str("gitmenu.panel.globalShortcut").filter(|s| !s.is_empty())
        && let Err(e) = shortcuts.register(accelerator.as_str())
    {
        log::warn!("global shortcut {accelerator} not registered: {e}");
    }
}
