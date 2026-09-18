//! Open at login through SMAppService (macOS 13+), and app updates. The updater is active
//! only in builds that carry its public key and endpoint (release CI adds them); local and
//! dev builds have none and report updates as unavailable.

use objc2_service_management::{SMAppService, SMAppServiceStatus};
use serde::Serialize;

use crate::error::{Error, Result};

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LoginItem {
    Enabled,
    Disabled,
    /// Registered, but the user must allow it in System Settings > Login Items
    RequiresApproval,
    /// Only a signed app in /Applications can register; dev builds land here
    Unavailable,
}

pub fn login_item_status() -> LoginItem {
    let service = unsafe { SMAppService::mainAppService() };
    let status = unsafe { service.status() };
    if status == SMAppServiceStatus::Enabled {
        LoginItem::Enabled
    } else if status == SMAppServiceStatus::RequiresApproval {
        LoginItem::RequiresApproval
    } else if status == SMAppServiceStatus::NotFound {
        LoginItem::Unavailable
    } else {
        LoginItem::Disabled
    }
}

pub fn set_login_item(enabled: bool) -> Result<LoginItem> {
    let service = unsafe { SMAppService::mainAppService() };
    let result = if enabled {
        unsafe { service.registerAndReturnError() }
    } else {
        unsafe { service.unregisterAndReturnError() }
    };
    result.map_err(|e| Error::Other(e.localizedDescription().to_string()))?;
    Ok(login_item_status())
}

/// Whether this build can update itself.
pub fn updater_configured(app: &tauri::AppHandle) -> bool {
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|u| u.get("pubkey"))
        .and_then(|k| k.as_str())
        .is_some_and(|k| !k.is_empty())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Update {
    pub version: String,
    pub notes: Option<String>,
}

/// Checks the release feed; `None` when up to date or when this build can't update.
pub async fn check(app: &tauri::AppHandle) -> Result<Option<Update>> {
    use tauri_plugin_updater::UpdaterExt;
    if !updater_configured(app) {
        return Ok(None);
    }
    let updater = app.updater().map_err(|e| Error::Other(e.to_string()))?;
    let update = updater.check().await.map_err(|e| Error::Other(e.to_string()))?;
    Ok(update.map(|u| Update { version: u.version, notes: u.body }))
}

/// Downloads and installs the available update, then restarts into it.
pub async fn install(app: &tauri::AppHandle) -> Result<()> {
    use tauri_plugin_updater::UpdaterExt;
    let updater = app.updater().map_err(|e| Error::Other(e.to_string()))?;
    let Some(update) = updater.check().await.map_err(|e| Error::Other(e.to_string()))? else { return Ok(()) };
    update.download_and_install(|_, _| {}, || {}).await.map_err(|e| Error::Other(e.to_string()))?;
    app.restart();
}
