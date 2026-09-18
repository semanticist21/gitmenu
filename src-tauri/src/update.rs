//! Open at login through SMAppService (macOS 13+). The updater lands here in M7.

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
