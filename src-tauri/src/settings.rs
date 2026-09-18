//! `settings.json` and `keybindings.json` in `~/Library/Application Support/gitside/`.
//!
//! Both files are JSONC like VS Code's. Edits go through a concrete syntax tree so the
//! user's comments, ordering and unknown keys survive. The files are watched; any change
//! (from the app or an editor) reloads and emits `settings://changed` / `keybindings://changed`.

use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Arc, RwLock},
    time::Duration,
};

use jsonc_parser::{ParseOptions, cst::CstInputValue, cst::CstRootNode};
use notify::RecursiveMode;
use notify_debouncer_full::{DebounceEventResult, Debouncer, RecommendedCache, new_debouncer};
use serde_json::{Map, Value};
use tauri::{AppHandle, Emitter};

use crate::error::{Error, Result};

const DEFAULTS: &str = include_str!("../../src/commands/configuration.json");

pub struct Settings {
    dir: PathBuf,
    values: RwLock<Map<String, Value>>,
    defaults: Map<String, Value>,
    _watcher: std::sync::Mutex<Option<Debouncer<notify::RecommendedWatcher, RecommendedCache>>>,
}

impl Settings {
    pub fn load(dir: PathBuf) -> Result<Arc<Self>> {
        fs::create_dir_all(&dir)?;
        let defaults = serde_json::from_str::<Map<String, Value>>(DEFAULTS)
            .expect("configuration.json is valid")
            .into_iter()
            .map(|(key, schema)| (key, schema.get("default").cloned().unwrap_or(Value::Null)))
            .collect();
        let settings = Arc::new(Self {
            values: RwLock::new(read_object(&dir.join("settings.json"))),
            dir,
            defaults,
            _watcher: std::sync::Mutex::new(None),
        });
        Ok(settings)
    }

    pub fn settings_path(&self) -> PathBuf {
        self.dir.join("settings.json")
    }

    pub fn keybindings_path(&self) -> PathBuf {
        self.dir.join("keybindings.json")
    }

    /// The user's value, else the schema default, else null.
    pub fn get(&self, key: &str) -> Value {
        self.values.read().unwrap().get(key).cloned().or_else(|| self.defaults.get(key).cloned()).unwrap_or(Value::Null)
    }

    pub fn get_str(&self, key: &str) -> Option<String> {
        self.get(key).as_str().map(str::to_owned)
    }

    pub fn user_values(&self) -> Map<String, Value> {
        self.values.read().unwrap().clone()
    }

    /// Sets one top-level key (`null` removes it) and writes the file, keeping comments.
    pub fn set(&self, key: &str, value: Value) -> Result<()> {
        let path = self.settings_path();
        let text = fs::read_to_string(&path).unwrap_or_default();
        let text = if text.trim().is_empty() { "{}\n".to_owned() } else { text };
        let root = CstRootNode::parse(&text, &ParseOptions::default())
            .map_err(|e| Error::Settings(format!("{}: {e}", path.display())))?;
        let object = root.object_value_or_set();
        match (object.get(key), value.is_null()) {
            (Some(prop), true) => prop.remove(),
            (Some(prop), false) => prop.set_value(to_cst(&value)),
            (None, true) => {}
            (None, false) => {
                object.append(key, to_cst(&value));
            }
        }
        write_atomic(&path, &root.to_string())?;
        let mut values = self.values.write().unwrap();
        if value.is_null() {
            values.remove(key);
        } else {
            values.insert(key.to_owned(), value);
        }
        Ok(())
    }

    pub fn keybindings(&self) -> Value {
        let path = self.keybindings_path();
        let text = fs::read_to_string(&path).unwrap_or_default();
        if text.trim().is_empty() {
            return Value::Array(Vec::new());
        }
        jsonc_parser::parse_to_serde_value::<Value>(&text, &ParseOptions::default())
            .ok()
            .filter(Value::is_array)
            .unwrap_or(Value::Array(Vec::new()))
    }

    /// Replaces the whole keybindings array. The Keyboard Shortcuts tab edits one entry at a
    /// time on the frontend and sends back the list; comments between entries are not kept.
    pub fn set_keybindings(&self, bindings: Value) -> Result<()> {
        if !bindings.is_array() {
            return Err(Error::Settings("keybindings must be an array".into()));
        }
        let text = serde_json::to_string_pretty(&bindings)? + "\n";
        write_atomic(&self.keybindings_path(), &text)
    }

    /// Watches the settings folder and emits change events for either file.
    pub fn watch(self: &Arc<Self>, app: AppHandle) -> Result<()> {
        let this = Arc::clone(self);
        let mut debouncer = new_debouncer(Duration::from_millis(150), None, move |result: DebounceEventResult| {
            let Ok(events) = result else { return };
            let touched =
                |name: &str| events.iter().any(|e| e.paths.iter().any(|p| p.file_name().is_some_and(|f| f == name)));
            if touched("settings.json") {
                let next = read_object(&this.settings_path());
                *this.values.write().unwrap() = next.clone();
                let _ = app.emit("settings://changed", next);
            }
            if touched("keybindings.json") {
                let _ = app.emit("keybindings://changed", this.keybindings());
            }
        })
        .map_err(|e| Error::Settings(e.to_string()))?;
        debouncer.watch(&self.dir, RecursiveMode::NonRecursive).map_err(|e| Error::Settings(e.to_string()))?;
        *self._watcher.lock().unwrap() = Some(debouncer);
        Ok(())
    }
}

fn read_object(path: &Path) -> Map<String, Value> {
    let text = fs::read_to_string(path).unwrap_or_default();
    if text.trim().is_empty() {
        return Map::new();
    }
    match jsonc_parser::parse_to_serde_value::<Value>(&text, &ParseOptions::default()) {
        Ok(Value::Object(map)) => map,
        Ok(_) => Map::new(),
        Err(e) => {
            // Keep the last good values on a half-typed file; the editor will save again
            log::warn!("ignoring unreadable {}: {e}", path.display());
            Map::new()
        }
    }
}

pub fn write_atomic(path: &Path, text: &str) -> Result<()> {
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, text)?;
    fs::rename(&tmp, path)?;
    Ok(())
}

fn to_cst(value: &Value) -> CstInputValue {
    match value {
        Value::Null => CstInputValue::Null,
        Value::Bool(b) => CstInputValue::Bool(*b),
        Value::Number(n) => CstInputValue::Number(n.to_string()),
        Value::String(s) => CstInputValue::String(s.clone()),
        Value::Array(items) => CstInputValue::Array(items.iter().map(to_cst).collect()),
        Value::Object(map) => CstInputValue::Object(map.iter().map(|(k, v)| (k.clone(), to_cst(v))).collect()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_keeps_comments_and_unknown_keys() {
        let dir = tempdir();
        fs::write(
            dir.join("settings.json"),
            "{\n  // mine\n  \"editor.fontSize\": 13,\n  \"git.path\": \"/usr/bin/git\",\n}\n",
        )
        .unwrap();
        let settings = Settings::load(dir.clone()).unwrap();
        assert_eq!(settings.get("git.detectSubmodulesLimit"), Value::from(10));
        settings.set("git.path", Value::from("/opt/homebrew/bin/git")).unwrap();
        settings.set("gitside.theme.mode", Value::from("dark")).unwrap();
        let text = fs::read_to_string(dir.join("settings.json")).unwrap();
        assert!(text.contains("// mine"));
        assert!(text.contains("\"editor.fontSize\": 13"));
        assert!(text.contains("/opt/homebrew/bin/git"));
        assert!(text.contains("\"gitside.theme.mode\": \"dark\""));
        settings.set("git.path", Value::Null).unwrap();
        assert!(!fs::read_to_string(dir.join("settings.json")).unwrap().contains("git.path"));
        assert_eq!(settings.get("git.path"), Value::Null);
    }

    fn tempdir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("gitside-settings-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }
}
