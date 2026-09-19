//! Menu bar icon and the panel it opens.
//!
//! The icon is a fixed commit-graph mark. While git work runs, a badge for that work
//! blinks in its bottom-right corner; conflicts and failures show a steady red badge.
//! The blink thread parks when nothing runs, so the idle app uses no CPU.
//!
//! The panel is an NSPanel (non-activating, joins full-screen spaces) so it opens over
//! full-screen apps without taking focus from the user's editor. Every NSPanel call runs
//! on the main thread; calling it elsewhere deadlocks.

// tauri_panel!'s event handler syntax requires `-> ()`
#![allow(clippy::unused_unit)]

use std::{
    sync::{
        Arc, Condvar, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};

use serde::Serialize;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, Rect,
    image::Image,
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
};
use tauri_nspanel::{CollectionBehavior, ManagerExt, PanelLevel, StyleMask, WebviewWindowExt, tauri_panel};

use crate::project::UiState;

pub const PANEL: &str = "panel";
pub const DETAIL: &str = "detail";
const TRAY_ID: &str = "main";
const BLINK: Duration = Duration::from_millis(500);
const BLUR_GRACE: Duration = Duration::from_millis(80);
/// After opening another of our windows, blur-hide waits this long for it to take focus
const WINDOW_OPEN_GRACE: Duration = Duration::from_millis(600);
const MARGIN: f64 = 6.0;

tauri_panel! {
    panel!(GitmenuPanel {
        config: {
            can_become_key_window: true,
            is_floating_panel: true
        }
    })

    panel_event!(GitmenuPanelEvents {
        window_did_resign_key(notification: &NSNotification) -> ()
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Activity {
    Push,
    Pull,
    Fetch,
    Commit,
}

struct Frames {
    idle: Image<'static>,
    push: Image<'static>,
    pull: Image<'static>,
    fetch: Image<'static>,
    commit: Image<'static>,
    conflict_light: Image<'static>,
    conflict_dark: Image<'static>,
    failure_light: Image<'static>,
    failure_dark: Image<'static>,
}

macro_rules! frame {
    ($name:literal) => {
        Image::from_bytes(include_bytes!(concat!("../icons/tray/", $name, "@2x.png"))).expect("tray icon png")
    };
}

impl Frames {
    fn load() -> Self {
        Self {
            idle: frame!("idle"),
            push: frame!("push"),
            pull: frame!("pull"),
            fetch: frame!("fetch"),
            commit: frame!("commit"),
            conflict_light: frame!("conflict-light"),
            conflict_dark: frame!("conflict-dark"),
            failure_light: frame!("failure-light"),
            failure_dark: frame!("failure-dark"),
        }
    }

    fn activity(&self, activity: Activity) -> &Image<'static> {
        match activity {
            Activity::Push => &self.push,
            Activity::Pull => &self.pull,
            Activity::Fetch => &self.fetch,
            Activity::Commit => &self.commit,
        }
    }
}

#[derive(Default)]
struct IconState {
    activity: Option<Activity>,
    conflict: bool,
    failure: bool,
    /// Bumped on every change so the blink thread redraws at once
    generation: u64,
}

pub struct Tray {
    state: Mutex<IconState>,
    wake: Condvar,
    pinned: AtomicBool,
    /// The panel is a free-floating window (movable, titled) instead of hanging off the icon
    detached: AtomicBool,
    /// Last detached position and size, saved to UI state when the panel hides or attaches
    detached_frame: Mutex<Option<[f64; 4]>>,
    /// A native file picker is open: it isn't one of our windows, but the panel must stay
    pub picker_open: AtomicBool,
    /// Blur-hide is suppressed until this instant (while a window we opened takes focus)
    suppress_hide_until: Mutex<Option<Instant>>,
    last_rect: Mutex<Option<Rect>>,
    /// Size the panel was given on show; only a size the user changed is remembered
    applied_size: Mutex<Option<(f64, f64)>>,
    conflicted: Mutex<std::collections::HashSet<std::path::PathBuf>>,
}

impl Tray {
    fn update(&self, f: impl FnOnce(&mut IconState)) {
        let mut state = self.state.lock().unwrap();
        f(&mut state);
        state.generation += 1;
        self.wake.notify_all();
    }
}

pub fn setup(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let tray_state = Arc::new(Tray {
        state: Mutex::new(IconState::default()),
        wake: Condvar::new(),
        pinned: AtomicBool::new(false),
        detached: AtomicBool::new(false),
        detached_frame: Mutex::new(None),
        picker_open: AtomicBool::new(false),
        suppress_hide_until: Mutex::new(None),
        last_rect: Mutex::new(None),
        applied_size: Mutex::new(None),
        conflicted: Mutex::new(Default::default()),
    });
    app.manage(Arc::clone(&tray_state));
    let frames = Arc::new(Frames::load());

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(frames.idle.clone())
        .icon_as_template(true)
        .tooltip("gitmenu")
        .show_menu_on_left_click(false)
        // Mouse down, not up: it arrives before the panel resigns key, so the toggle sees the
        // panel's real state instead of racing the blur-hide
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left, button_state: MouseButtonState::Down, rect, ..
            } = event
            {
                let app = tray.app_handle();
                *app.state::<Arc<Tray>>().last_rect.lock().unwrap() = Some(rect);
                // The status item takes key focus for the rest of the click; that must not
                // count as the user clicking away from the panel we're about to show
                keep_open_briefly(app);
                toggle_panel(app);
            }
        })
        .build(app)?;

    setup_panel(app)?;
    spawn_blinker(app.clone(), tray_state, frames);
    if app.state::<Arc<UiState>>().get("panel.detached").and_then(|v| v.as_bool()) == Some(true) {
        set_detached(app, true);
    }
    Ok(())
}

pub fn is_detached(app: &AppHandle) -> bool {
    app.state::<Arc<Tray>>().detached.load(Ordering::Relaxed)
}

/// Detached: the same floating panel, but at its remembered frame, movable by its header,
/// and left open until closed. Attached: under the icon, hidden on blur. The style mask
/// never changes: giving the panel a title bar makes AppKit rebuild its frame view, and
/// WebKit's observer on the swizzled panel class then crashes the app.
pub fn set_detached(app: &AppHandle, detached: bool) {
    let app2 = app.clone();
    let _ = app.run_on_main_thread(move || {
        let app = app2;
        let Ok(panel) = app.get_webview_panel(PANEL) else { return };
        let Some(window) = app.get_webview_window(PANEL) else { return };
        let tray = app.state::<Arc<Tray>>();
        let ui = app.state::<Arc<UiState>>();
        tray.detached.store(detached, Ordering::Relaxed);
        ui.set("panel.detached", serde_json::Value::Bool(detached));
        if detached {
            let frame = ui.get("panel.detachedFrame").and_then(|v| serde_json::from_value::<[f64; 4]>(v).ok());
            if let Some([x, y, w, h]) = frame {
                let _ = window.set_size(tauri::LogicalSize::new(w, h));
                let _ = window.set_position(tauri::LogicalPosition::new(x, y));
            }
        } else {
            save_detached_frame(&app);
            if panel.is_visible() {
                place_panel(&app, &window);
            }
        }
        let _ = app.emit("panel://detached", detached);
    });
}

/// Records the detached window's frame (called on move and resize; written out later).
pub fn note_detached_frame(app: &AppHandle) {
    let tray = app.state::<Arc<Tray>>();
    if !tray.detached.load(Ordering::Relaxed) {
        return;
    }
    let Some(window) = app.get_webview_window(PANEL) else { return };
    if let (Ok(pos), Ok(size), Ok(scale)) = (window.outer_position(), window.inner_size(), window.scale_factor()) {
        let p = pos.to_logical::<f64>(scale);
        let s = size.to_logical::<f64>(scale);
        *tray.detached_frame.lock().unwrap() = Some([p.x, p.y, s.width, s.height]);
    }
}

/// While a native file or folder picker is open. The picker is a normal-level window, so the
/// floating panel drops to normal level until it closes, or it would cover the picker.
pub fn set_picker_open(app: &AppHandle, open: bool) {
    app.state::<Arc<Tray>>().picker_open.store(open, Ordering::Relaxed);
    let level = if open { PanelLevel::Normal } else { PanelLevel::Floating };
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Ok(panel) = handle.get_webview_panel(PANEL) {
            panel.set_level(level.value());
        }
    });
}

pub fn save_detached_frame(app: &AppHandle) {
    let tray = app.state::<Arc<Tray>>();
    if let Some(frame) = *tray.detached_frame.lock().unwrap() {
        app.state::<Arc<UiState>>().set("panel.detachedFrame", serde_json::json!(frame));
    }
}

fn setup_panel(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let window = app.get_webview_window(PANEL).expect("panel window in tauri.conf.json");
    let panel = window.to_panel::<GitmenuPanel>().map_err(|e| e.to_string())?;
    panel.set_level(PanelLevel::Floating.value());
    panel.set_style_mask(StyleMask::empty().nonactivating_panel().resizable().into());
    panel.set_collection_behavior(CollectionBehavior::new().full_screen_auxiliary().can_join_all_spaces().into());
    panel.set_has_shadow(true);
    panel.set_corner_radius(10.0);

    let handler = GitmenuPanelEvents::new();
    let handle = app.clone();
    handler.window_did_resign_key(move |_| {
        let app = handle.clone();
        std::thread::spawn(move || {
            std::thread::sleep(BLUR_GRACE);
            let app2 = app.clone();
            let _ = app.run_on_main_thread(move || hide_if_unfocused(&app2));
        });
    });
    panel.set_event_handler(Some(handler.as_ref()));
    // The handler must outlive the panel's weak delegate reference
    std::mem::forget(handler);
    Ok(())
}

/// Hides the panel after it lost key status, unless pinned, a picker is open, or another of
/// our windows took (or is about to take) focus.
fn hide_if_unfocused(app: &AppHandle) {
    let tray = app.state::<Arc<Tray>>();
    if tray.pinned.load(Ordering::Relaxed)
        || tray.detached.load(Ordering::Relaxed)
        || tray.picker_open.load(Ordering::Relaxed)
    {
        return;
    }
    if tray.suppress_hide_until.lock().unwrap().is_some_and(|t| Instant::now() < t) {
        // Take key focus back so the next click away still resigns it
        if let Ok(panel) = app.get_webview_panel(PANEL)
            && panel.is_visible()
        {
            panel.make_key_window();
        }
        return;
    }
    let ours_focused = app.webview_windows().values().any(|w| w.is_focused().unwrap_or(false));
    if !ours_focused {
        hide_panel(app);
    }
}

/// Call before opening another window of ours, so the panel doesn't hide while focus moves.
pub fn keep_open_briefly(app: &AppHandle) {
    *app.state::<Arc<Tray>>().suppress_hide_until.lock().unwrap() = Some(Instant::now() + WINDOW_OPEN_GRACE);
}

pub fn toggle_panel(app: &AppHandle) {
    let focused = app.get_webview_window(PANEL).and_then(|w| w.is_focused().ok()).unwrap_or(false);
    match app.get_webview_panel(PANEL) {
        // A detached window may be open behind other apps: the icon brings it forward first
        Ok(panel) if panel.is_visible() && (focused || !is_detached(app)) => hide_panel(app),
        Ok(_) => show_panel(app),
        Err(e) => log::error!("panel handle lost: {e:?}"),
    }
}

/// Shows the panel under the menu bar icon. Safe to call from any thread.
pub fn show_panel(app: &AppHandle) {
    let app2 = app.clone();
    let _ = app.run_on_main_thread(move || {
        let app = app2;
        let Ok(panel) = app.get_webview_panel(PANEL) else {
            return;
        };
        if panel.is_visible() {
            panel.show_and_make_key();
            return;
        }
        // Never `panel.to_window()` here: in this nspanel revision it converts the panel back
        // into a plain window and drops the delegate
        if !is_detached(&app)
            && let Some(window) = app.get_webview_window(PANEL)
        {
            place_panel(&app, &window);
        }
        panel.show_and_make_key();
        let _ = app.emit("panel://shown", ());
        let tray = app.state::<Arc<Tray>>();
        // Opening the panel acknowledges a failure; the panel shows what went wrong
        tray.update(|s| s.failure = false);
    });
}

pub fn hide_panel(app: &AppHandle) {
    let app2 = app.clone();
    let _ = app.run_on_main_thread(move || {
        let app = app2;
        let Ok(panel) = app.get_webview_panel(PANEL) else {
            return;
        };
        if !panel.is_visible() {
            return;
        }
        if is_detached(&app) {
            save_detached_frame(&app);
        } else if let Some(window) = app.get_webview_window(PANEL)
            && let (Ok(size), Ok(scale)) = (window.inner_size(), window.scale_factor())
        {
            let logical = size.to_logical::<f64>(scale);
            let applied = *app.state::<Arc<Tray>>().applied_size.lock().unwrap();
            // Remember a size only when the user dragged the edge, not our own clamping
            if applied.is_some_and(|(w, h)| (w - logical.width).abs() > 1.0 || (h - logical.height).abs() > 1.0) {
                app.state::<Arc<UiState>>().set("panel.size", serde_json::json!([logical.width, logical.height]));
            }
        }
        panel.hide();
        let _ = app.emit("panel://hidden", ());
    });
}

pub fn set_pinned(app: &AppHandle, pinned: bool) {
    app.state::<Arc<Tray>>().pinned.store(pinned, Ordering::Relaxed);
}

/// Restores the remembered size and centers the panel under the icon, inside the screen.
fn place_panel(app: &AppHandle, window: &tauri::WebviewWindow) {
    let tray = app.state::<Arc<Tray>>();
    // The icon's rect right after launch is wrong, so it's read at click time when possible
    let rect = tray
        .last_rect
        .lock()
        .unwrap()
        .or_else(|| app.tray_by_id(TRAY_ID).and_then(|t: TrayIcon| t.rect().ok().flatten()));
    let Some(rect) = rect else { return };
    let scale = window.scale_factor().unwrap_or(2.0);
    let icon_pos = rect.position.to_physical::<f64>(scale);
    let icon_size = rect.size.to_physical::<f64>(scale);
    let monitor = window
        .available_monitors()
        .ok()
        .and_then(|monitors| {
            monitors.into_iter().find(|m| {
                let (p, s) = (m.position(), m.size());
                icon_pos.x >= p.x as f64 && icon_pos.x < (p.x + s.width as i32) as f64
            })
        })
        .or_else(|| window.current_monitor().ok().flatten());

    let (mut width, mut height) = app
        .state::<Arc<UiState>>()
        .get("panel.size")
        .and_then(|v| Some((v.get(0)?.as_f64()?, v.get(1)?.as_f64()?)))
        // A saved height at the minimum came from clamping against a wrong startup rect
        .filter(|(_, h)| *h > 320.0)
        .unwrap_or((360.0, 640.0));
    let top = icon_pos.y + icon_size.height;
    if let Some(m) = &monitor {
        let area = m.work_area();
        let max_h = (area.size.height as f64 / scale) - (top - area.position.y as f64) / scale - MARGIN;
        height = height.min(max_h).max(320.0);
        width = width.max(300.0);
    }
    let _ = window.set_size(tauri::LogicalSize::new(width, height));
    *tray.applied_size.lock().unwrap() = Some((width, height));
    let phys_w = width * scale;
    let mut x = icon_pos.x + icon_size.width / 2.0 - phys_w / 2.0;
    if let Some(m) = &monitor {
        let area = m.work_area();
        let left = area.position.x as f64 + MARGIN * scale;
        let right = (area.position.x + area.size.width as i32) as f64 - MARGIN * scale - phys_w;
        x = x.clamp(left, right.max(left));
    }
    let _ = window.set_position(PhysicalPosition::new(x.round() as i32, (top + 4.0 * scale).round() as i32));
}

pub fn set_activity(app: &AppHandle, activity: Option<Activity>) {
    if let Some(tray) = app.try_state::<Arc<Tray>>() {
        tray.update(|s| s.activity = activity);
    }
}

/// Records whether `root` has merge conflicts; the icon shows the conflict badge while any does.
pub fn set_repo_conflict(app: &AppHandle, root: &std::path::Path, conflict: bool) {
    let Some(tray) = app.try_state::<Arc<Tray>>() else {
        return;
    };
    let mut repos = tray.conflicted.lock().unwrap();
    let changed = if conflict { repos.insert(root.to_path_buf()) } else { repos.remove(root) };
    let any = !repos.is_empty();
    drop(repos);
    if changed {
        tray.update(|s| s.conflict = any);
    }
}

pub fn set_failure(app: &AppHandle, failure: bool) {
    if let Some(tray) = app.try_state::<Arc<Tray>>() {
        tray.update(|s| s.failure = failure);
    }
}

/// Redraws the icon on every state change and blinks the badge while work runs.
fn spawn_blinker(app: AppHandle, tray: Arc<Tray>, frames: Arc<Frames>) {
    std::thread::spawn(move || {
        let mut shown_generation = u64::MAX;
        let mut badge_on = true;
        loop {
            let (activity, conflict, failure) = {
                let mut state = tray.state.lock().unwrap();
                // Park until something changes; while work runs, wake every blink tick
                while state.generation == shown_generation && state.activity.is_none() {
                    state = tray.wake.wait(state).unwrap();
                }
                if state.generation != shown_generation {
                    badge_on = true;
                } else {
                    let (next, _) = tray.wake.wait_timeout(state, BLINK).unwrap();
                    state = next;
                    badge_on = !badge_on;
                }
                shown_generation = state.generation;
                (state.activity, state.conflict, state.failure)
            };
            let Some(icon) = app.tray_by_id(TRAY_ID) else {
                continue;
            };
            match (activity, conflict, failure) {
                (Some(activity), _, _) => {
                    let image = if badge_on { frames.activity(activity) } else { &frames.idle };
                    let _ = icon.set_icon_with_as_template(Some(image.clone()), true);
                }
                (None, true, _) | (None, false, true) => {
                    let dark = menu_bar_is_dark(&icon);
                    let image = match (conflict, dark) {
                        (true, true) => &frames.conflict_dark,
                        (true, false) => &frames.conflict_light,
                        (false, true) => &frames.failure_dark,
                        (false, false) => &frames.failure_light,
                    };
                    // Red can't be a template image; the body is drawn for the menu bar's appearance
                    let _ = icon.set_icon_with_as_template(Some(image.clone()), false);
                }
                (None, false, false) => {
                    let _ = icon.set_icon_with_as_template(Some(frames.idle.clone()), true);
                }
            }
        }
    });
}

/// The status item's own appearance (the menu bar can be dark while the app is light).
fn menu_bar_is_dark(icon: &TrayIcon) -> bool {
    use objc2_app_kit::{NSAppearanceCustomization, NSAppearanceNameAqua, NSAppearanceNameDarkAqua};
    use objc2_foundation::NSArray;
    icon.with_inner_tray_icon(|inner| {
        let Some(item) = inner.ns_status_item() else {
            return false;
        };
        let mtm = objc2::MainThreadMarker::new().expect("tray callbacks run on the main thread");
        let Some(button) = item.button(mtm) else {
            return false;
        };
        let appearance = button.effectiveAppearance();
        let names = unsafe { NSArray::from_slice(&[NSAppearanceNameAqua, NSAppearanceNameDarkAqua]) };
        let best = appearance.bestMatchFromAppearancesWithNames(&names);
        best.is_some_and(|name| unsafe { &*name == NSAppearanceNameDarkAqua })
    })
    .unwrap_or(false)
}
