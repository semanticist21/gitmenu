use tauri::{
    ActivationPolicy, Manager, WindowEvent,
    image::Image,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_positioner::{Position, WindowExt};

const PANEL: &str = "panel";

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_positioner::init())
        .setup(|app| {
            app.set_activation_policy(ActivationPolicy::Accessory);
            let icon = Image::from_bytes(include_bytes!("../icons/tray/idle@2x.png"))?;
            TrayIconBuilder::with_id("main")
                .icon(icon)
                .icon_as_template(true)
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    tauri_plugin_positioner::on_tray_event(tray.app_handle(), &event);
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let Some(panel) = tray.app_handle().get_webview_window(PANEL) else {
                            return;
                        };
                        if panel.is_visible().unwrap_or(false) {
                            let _ = panel.hide();
                        } else {
                            let _ = panel.move_window(Position::TrayBottomCenter);
                            let _ = panel.show();
                            let _ = panel.set_focus();
                        }
                    }
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == PANEL
                && let WindowEvent::Focused(false) = event
            {
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running gitside");
}
