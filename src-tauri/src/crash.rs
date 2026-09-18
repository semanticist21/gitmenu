//! Opt-in crash reports (`gitside.crashReports.enabled`, off by default). Only release builds
//! that embed a DSN (`GITSIDE_SENTRY_DSN` at build time) can send. Anything that looks like a
//! path is removed from messages first, so repository paths and file names never leave the Mac;
//! commit contents are never attached.

use std::sync::{Arc, OnceLock};

use sentry::protocol::Event;

use crate::settings::Settings;

static GUARD: OnceLock<sentry::ClientInitGuard> = OnceLock::new();

/// Replaces every word containing a path separator (and `~`-paths) with `<path>`.
pub fn scrub(text: &str) -> String {
    text.split_inclusive(char::is_whitespace)
        .map(|word| {
            let trimmed = word.trim_end();
            if trimmed.contains('/') || trimmed.contains('\\') || trimmed.starts_with('~') {
                format!("<path>{}", &word[trimmed.len()..])
            } else {
                word.to_owned()
            }
        })
        .collect()
}

fn scrub_event(mut event: Event<'static>) -> Event<'static> {
    event.message = event.message.map(|m| scrub(&m));
    for exception in &mut event.exception.values {
        exception.value = exception.value.as_deref().map(scrub);
    }
    event.breadcrumbs.values.clear();
    event.extra.clear();
    event.user = None;
    event.server_name = None;
    event
}

/// Starts reporting when the user opted in and this build can report.
pub fn init(settings: &Settings) {
    let Some(dsn) = option_env!("GITSIDE_SENTRY_DSN") else { return };
    if settings.get("gitside.crashReports.enabled").as_bool() != Some(true) {
        return;
    }
    let guard = sentry::init((
        dsn,
        sentry::ClientOptions {
            release: sentry::release_name!(),
            send_default_pii: false,
            before_send: Some(Arc::new(|event| Some(scrub_event(event)))),
            ..Default::default()
        },
    ));
    let _ = GUARD.set(guard);
}

/// A window's uncaught error, reported like a panic.
pub fn report(message: &str) {
    if GUARD.get().is_some() {
        sentry::capture_message(&scrub(message), sentry::Level::Error);
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn scrubs_paths() {
        assert_eq!(super::scrub("failed to read /Users/ann/code/x.rs: denied"), "failed to read <path> denied");
        assert_eq!(super::scrub("at ~/a b\\c done"), "at <path> <path> done");
    }
}
