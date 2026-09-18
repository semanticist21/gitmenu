//! Login shell environment, git discovery, and the askpass/editor bridge.
//!
//! GUI apps start without the user's shell PATH, so the login shell's environment is read
//! once in the background (`$SHELL -ilc 'env -0'`). Writes wait for it; gix reads do not.
//! git's prompts (credentials, SSH passphrase, host fingerprint, commit message editor) are
//! answered by this same executable started in helper mode (see [`run_helper`]), which asks
//! the running app over a Unix socket; the app shows the question in the panel.

use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Write},
    os::unix::net::UnixStream,
    path::{Path, PathBuf},
    process::{Command as StdCommand, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader as TokioBufReader},
    net::UnixListener,
    sync::{oneshot, watch},
};

use crate::{
    error::{Error, Result},
    settings::Settings,
};

const IPC_ENV: &str = "GITSIDE_IPC";
const SHELL_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug)]
pub struct Resolved {
    pub vars: HashMap<String, String>,
    pub git: Option<PathBuf>,
    pub git_version: Option<String>,
}

/// Shared handle to the resolved environment and the prompt bridge.
pub struct GitEnv {
    state: watch::Sender<Option<Arc<Resolved>>>,
    socket: PathBuf,
    exe: PathBuf,
    pending: Mutex<HashMap<u64, oneshot::Sender<Option<String>>>>,
    next_id: AtomicU64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvStatus {
    pub ready: bool,
    pub git: Option<String>,
    pub git_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum PromptRequest {
    /// GIT_ASKPASS / SSH_ASKPASS; `prompt` is git's or ssh's question text
    Askpass { prompt: String },
    /// GIT_EDITOR; the file holds the message to edit in place
    Editor { path: String },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PromptEvent {
    id: u64,
    #[serde(flatten)]
    request: PromptRequest,
    /// Askpass prompts that look like yes/no, secret, or plain text questions
    input: &'static str,
}

impl GitEnv {
    pub fn new() -> Arc<Self> {
        let socket = std::env::temp_dir().join(format!("gitside-{}.sock", std::process::id()));
        let exe = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("gitside"));
        Arc::new(Self {
            state: watch::channel(None).0,
            socket,
            exe,
            pending: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
        })
    }

    /// Reads the login shell environment and finds git, off the main thread.
    pub fn start(self: &Arc<Self>, app: AppHandle, settings: Arc<Settings>) {
        let this = Arc::clone(self);
        std::thread::spawn(move || {
            let vars = match login_shell_env() {
                Ok(vars) => vars,
                Err(message) => {
                    log::warn!("login shell environment unavailable: {message}");
                    let _ = app.emit("env://failed", message);
                    fallback_env()
                }
            };
            let (git, git_version) = find_git(&vars, settings.get_str("git.path").as_deref());
            if git.is_none() {
                let _ = app.emit("git://missing", ());
            }
            this.state.send_replace(Some(Arc::new(Resolved {
                vars,
                git,
                git_version,
            })));
            let _ = app.emit("env://ready", this.status());
        });
    }

    /// Re-resolves git after the `git.path` setting changes.
    pub fn refresh_git(&self, app: &AppHandle, settings: &Settings) {
        let Some(current) = self.state.borrow().clone() else {
            return;
        };
        let (git, git_version) = find_git(&current.vars, settings.get_str("git.path").as_deref());
        if git.is_none() {
            let _ = app.emit("git://missing", ());
        }
        self.state.send_replace(Some(Arc::new(Resolved {
            vars: current.vars.clone(),
            git,
            git_version,
        })));
        let _ = app.emit("env://ready", self.status());
    }

    pub fn status(&self) -> EnvStatus {
        match self.state.borrow().as_ref() {
            Some(r) => EnvStatus {
                ready: true,
                git: r.git.as_ref().map(|p| p.display().to_string()),
                git_version: r.git_version.clone(),
            },
            None => EnvStatus {
                ready: false,
                git: None,
                git_version: None,
            },
        }
    }

    /// Waits for the environment; errors if git is missing.
    pub async fn ready(&self) -> Result<Arc<Resolved>> {
        let mut rx = self.state.subscribe();
        let resolved = rx
            .wait_for(Option::is_some)
            .await
            .map_err(|_| Error::Other("environment resolver stopped".into()))?
            .clone()
            .expect("checked is_some");
        if resolved.git.is_none() {
            return Err(Error::GitMissing);
        }
        Ok(resolved)
    }

    /// A git command in `cwd` with the user's environment and our prompt helpers.
    pub async fn git(&self, cwd: &Path, args: &[&str]) -> Result<tokio::process::Command> {
        let resolved = self.ready().await?;
        let git = resolved.git.as_ref().ok_or(Error::GitMissing)?;
        let mut cmd = tokio::process::Command::new(git);
        cmd.current_dir(cwd)
            .env_clear()
            .envs(&resolved.vars)
            // Stable, parseable output regardless of the user's locale and color config
            .env("LANG", "en_US.UTF-8")
            .env("LC_ALL", "en_US.UTF-8")
            .env("GIT_PAGER", "cat")
            .env("PAGER", "cat")
            .env("GIT_TERMINAL_PROMPT", "0")
            .env(IPC_ENV, &self.socket)
            .env("GIT_ASKPASS", &self.exe)
            .env("SSH_ASKPASS", &self.exe)
            .env("SSH_ASKPASS_REQUIRE", "force")
            .env("GIT_EDITOR", format!("'{}' --editor", self.exe.display()))
            .args(["-c", "core.quotepath=false", "-c", "color.ui=false"])
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        Ok(cmd)
    }

    /// Serves helper connections: one JSON line in, one JSON line out.
    pub async fn serve_prompts(self: Arc<Self>, app: AppHandle) -> Result<()> {
        let _ = std::fs::remove_file(&self.socket);
        let listener = UnixListener::bind(&self.socket)?;
        loop {
            let (stream, _) = listener.accept().await?;
            let this = Arc::clone(&self);
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let (read, mut write) = stream.into_split();
                let mut line = String::new();
                if TokioBufReader::new(read)
                    .read_line(&mut line)
                    .await
                    .is_err()
                {
                    return;
                }
                let Ok(request) = serde_json::from_str::<PromptRequest>(&line) else {
                    return;
                };
                let answer = this.ask(&app, request).await;
                let reply = serde_json::json!({ "value": answer }).to_string() + "\n";
                let _ = write.write_all(reply.as_bytes()).await;
            });
        }
    }

    async fn ask(&self, app: &AppHandle, request: PromptRequest) -> Option<String> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(id, tx);
        let input = match &request {
            PromptRequest::Editor { .. } => "editor",
            PromptRequest::Askpass { prompt } => classify_prompt(prompt),
        };
        crate::tray::show_panel(app);
        let _ = app.emit("prompt://request", PromptEvent { id, request, input });
        rx.await.ok().flatten()
    }

    /// Answers a pending prompt; `None` cancels it (git sees a failed helper).
    pub fn respond(&self, id: u64, value: Option<String>) {
        if let Some(tx) = self.pending.lock().unwrap().remove(&id) {
            let _ = tx.send(value);
        }
    }

    pub fn cleanup(&self) {
        let _ = std::fs::remove_file(&self.socket);
    }
}

/// Decides how the panel should ask: `confirm` (yes/no), `secret`, or `text`.
fn classify_prompt(prompt: &str) -> &'static str {
    let lower = prompt.to_lowercase();
    if lower.contains("yes/no") || lower.contains("(yes/no") {
        "confirm"
    } else if lower.starts_with("username") {
        "text"
    } else {
        "secret"
    }
}

fn login_shell_env() -> std::result::Result<HashMap<String, String>, String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let mut child = StdCommand::new(&shell)
        .args(["-ilc", "env -0"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("{shell}: {e}"))?;
    let mut stdout = child.stdout.take().expect("piped");
    let reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = std::io::Read::read_to_end(&mut stdout, &mut buf);
        buf
    });
    let started = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if started.elapsed() > SHELL_TIMEOUT => {
                let _ = child.kill();
                return Err(format!(
                    "{shell} did not finish within {}s",
                    SHELL_TIMEOUT.as_secs()
                ));
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
            Err(e) => return Err(e.to_string()),
        }
    }
    let out = reader.join().unwrap_or_default();
    let vars: HashMap<String, String> = out
        .split(|b| *b == 0)
        .filter_map(|entry| {
            let entry = String::from_utf8_lossy(entry);
            let (k, v) = entry.split_once('=')?;
            // Shell startup files may print before `env -0` runs; keep only real names
            (!k.is_empty() && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '_'))
                .then(|| (k.to_owned(), v.to_owned()))
        })
        .collect();
    if !vars.contains_key("PATH") {
        return Err(format!("{shell} returned no PATH"));
    }
    Ok(vars)
}

fn fallback_env() -> HashMap<String, String> {
    let mut vars: HashMap<String, String> = std::env::vars().collect();
    let path = vars.get("PATH").cloned().unwrap_or_default();
    vars.insert(
        "PATH".into(),
        format!("/opt/homebrew/bin:/usr/local/bin:{path}:/usr/bin:/bin"),
    );
    vars
}

fn find_git(
    vars: &HashMap<String, String>,
    configured: Option<&str>,
) -> (Option<PathBuf>, Option<String>) {
    let candidates: Vec<PathBuf> = match configured.filter(|s| !s.is_empty()) {
        Some(path) => vec![PathBuf::from(path)],
        None => vars
            .get("PATH")
            .map(|p| p.split(':').map(|d| Path::new(d).join("git")).collect())
            .unwrap_or_default(),
    };
    for candidate in candidates {
        if !candidate.is_file() {
            continue;
        }
        // /usr/bin/git is a stub that opens the Command Line Tools installer when they are missing
        if candidate == Path::new("/usr/bin/git") && !command_line_tools_installed() {
            continue;
        }
        let output = StdCommand::new(&candidate)
            .arg("--version")
            .stdin(Stdio::null())
            .output();
        if let Ok(output) = output
            && output.status.success()
        {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_owned();
            return (Some(candidate), Some(version));
        }
    }
    (None, None)
}

fn command_line_tools_installed() -> bool {
    StdCommand::new("/usr/bin/xcode-select")
        .arg("-p")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}

/// Helper mode: git or ssh started this executable to ask a question.
/// Returns the process exit code, or `None` when this is a normal app launch.
pub fn run_helper() -> Option<i32> {
    let socket = std::env::var_os(IPC_ENV)?;
    let args: Vec<String> = std::env::args().skip(1).collect();
    let request = match args.as_slice() {
        [flag, path] if flag == "--editor" => PromptRequest::Editor { path: path.clone() },
        [] => return Some(1),
        prompt => PromptRequest::Askpass {
            prompt: prompt.join(" "),
        },
    };
    let answer = (|| -> std::io::Result<Option<String>> {
        let mut stream = UnixStream::connect(socket)?;
        stream.write_all((serde_json::to_string(&request)? + "\n").as_bytes())?;
        let mut line = String::new();
        BufReader::new(stream).read_line(&mut line)?;
        let reply: serde_json::Value = serde_json::from_str(&line)?;
        Ok(reply
            .get("value")
            .and_then(|v| v.as_str())
            .map(str::to_owned))
    })();
    match (answer, request) {
        (Ok(Some(_)), PromptRequest::Editor { .. }) => Some(0),
        (Ok(Some(value)), PromptRequest::Askpass { .. }) => {
            println!("{value}");
            Some(0)
        }
        _ => Some(1),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_prompts() {
        assert_eq!(
            classify_prompt("Username for 'https://github.com': "),
            "text"
        );
        assert_eq!(
            classify_prompt("Password for 'https://me@github.com': "),
            "secret"
        );
        assert_eq!(
            classify_prompt("Enter passphrase for key '/Users/me/.ssh/id_ed25519': "),
            "secret"
        );
        assert_eq!(
            classify_prompt(
                "Are you sure you want to continue connecting (yes/no/[fingerprint])? "
            ),
            "confirm"
        );
    }

    #[test]
    fn reads_login_shell_path() {
        let vars = login_shell_env().expect("login shell env");
        assert!(vars["PATH"].contains("/usr/bin"));
    }
}
