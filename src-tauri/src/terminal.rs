//! Integrated terminal: the user's shell in a PTY for each terminal tab of the detail window.
//!
//! Sessions are kept here by the tab's key, so a remounted or reloaded tab re-attaches to its
//! shell; they all end with the detail window. Output goes to the tab's channel as raw bytes and
//! is never decoded here, since a read can end inside a UTF-8 sequence.
//!
//! The shell is the user's login shell with the login environment (env.rs), started as a login
//! shell like VS Code's terminal on macOS. zsh and bash also get git completion when the user's
//! config doesn't set it up, through startup files injected the way VS Code injects its shell
//! integration (the scripts in `terminal/`).
//!
//! The tab's title is VS Code's default `${process}`: the terminal's foreground process, looked at
//! when output arrives rather than on a timer.

use std::{
    collections::HashMap,
    fs::File,
    io::{ErrorKind, Read, Write},
    os::fd::{AsRawFd, BorrowedFd, RawFd},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc,
    },
    thread,
    time::{Duration, Instant},
};

use portable_pty::{CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde::Serialize;
use tauri::{
    Manager, State, Webview,
    ipc::{Channel, InvokeResponseBody},
};

use crate::{
    env::{GitEnv, IPC_ENV},
    error::{Error, Result},
    project::Projects,
    settings::write_atomic,
};

pub const EXIT_EVENT: &str = "terminal://exit";
pub const TITLE_EVENT: &str = "terminal://title";

/// Most output sent to the tab at once
const READ_SIZE: usize = 64 * 1024;
/// How long output is gathered before it goes to the tab (VS Code's `TerminalDataBufferer`)
const BATCH_WINDOW: Duration = Duration::from_millis(5);
/// How long after output stops the title gets a second look: a command usually starts after the
/// shell's last output (the new line that ends the command line). VS Code polls at this rate.
const TITLE_RECHECK: Duration = Duration::from_millis(200);
/// How long an exit waits for the shell's last output (VS Code's `DataFlushTimeout`)
const FLUSH_TIMEOUT: Duration = Duration::from_millis(250);
/// How long a closed terminal's shell gets to exit on SIGHUP before its process group is killed
const KILL_GRACE: Duration = Duration::from_secs(5);
/// Askpass and editor plumbing, gitmenu's own or inherited from the app that started it: meant
/// for one git command, never for an interactive shell
const PLUMBING_VARS: [&str; 8] = [
    IPC_ENV,
    "GIT_ASKPASS",
    "SSH_ASKPASS",
    "SSH_ASKPASS_REQUIRE",
    "GIT_EDITOR",
    "GIT_TERMINAL_PROMPT",
    "GIT_PAGER",
    "GH_PROMPT_DISABLED",
];
/// These describe the shell that read the login environment, not the new one
const RESOLVER_VARS: [&str; 4] = ["PWD", "OLDPWD", "SHLVL", "_"];
const ZSH_FILES: [(&str, &str); 4] = [
    (".zshenv", include_str!("terminal/zshenv.zsh")),
    (".zprofile", include_str!("terminal/zprofile.zsh")),
    (".zshrc", include_str!("terminal/zshrc.zsh")),
    (".zlogin", include_str!("terminal/zlogin.zsh")),
];
const BASH_INIT: &str = "init.bash";
const BASH_FILES: [(&str, &str); 1] = [(BASH_INIT, include_str!("terminal/init.bash"))];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalInfo {
    /// The shell's file name, such as `zsh`
    pub shell: String,
    /// Where the shell started
    pub cwd: String,
    pub pid: Option<u32>,
    /// A running shell was attached to the new channel
    pub reattached: bool,
}

/// `terminal://exit`: a shell ended on its own (not through `terminal_kill`).
#[derive(Debug, Clone, Serialize)]
pub struct ExitEvent {
    pub key: String,
    /// None when a signal ended it
    pub code: Option<i32>,
}

/// `terminal://title`: the terminal's foreground process changed, or a tab re-attached.
#[derive(Debug, Clone, Serialize)]
pub struct TitleEvent {
    pub key: String,
    /// The process's name, such as `zsh` or `vim`
    pub title: String,
}

/// What a shell's tab hears about besides its output.
#[derive(Debug, Clone)]
pub enum Event {
    Exit(ExitEvent),
    Title(TitleEvent),
}

type Sessions = Arc<Mutex<HashMap<String, Arc<Session>>>>;
type Output = Arc<Mutex<Channel<InvokeResponseBody>>>;
type Notify = Arc<dyn Fn(Event) + Send + Sync>;

/// Every running shell, by tab key.
pub struct Terminals {
    sessions: Sessions,
    /// Bumped by [`Terminals::kill_all`]: an open that started before it belongs to a closed window
    generation: AtomicU64,
    /// Where the zsh and bash startup files are written
    integration_dir: PathBuf,
    /// TERM_PROGRAM_VERSION
    version: String,
    notify: Notify,
    next_id: AtomicU64,
}

struct Session {
    id: u64,
    master: Mutex<Box<dyn MasterPty + Send>>,
    /// To the thread that writes to the PTY, which may block while the shell doesn't read
    input: mpsc::Sender<Vec<u8>>,
    /// The tab's channel, replaced when it re-attaches
    output: Output,
    pid: Option<u32>,
    shell: String,
    cwd: PathBuf,
    title: Arc<Title>,
    /// The shell has exited and been reaped
    exited: Arc<AtomicBool>,
}

/// A terminal's title, VS Code's `${process}`: the name of its foreground process (the shell, or
/// the job it runs), announced when it changes.
struct Title {
    key: String,
    current: Mutex<String>,
    notify: Notify,
}

/// A shell to start: program, arguments, directory, and its whole environment.
struct Launch {
    shell: PathBuf,
    args: Vec<String>,
    cwd: PathBuf,
    env: HashMap<String, String>,
}

impl Terminals {
    pub fn new(integration_dir: PathBuf, version: String, notify: impl Fn(Event) + Send + Sync + 'static) -> Arc<Self> {
        Arc::new(Self {
            sessions: Arc::default(),
            generation: AtomicU64::new(0),
            integration_dir,
            version,
            notify: Arc::new(notify),
            next_id: AtomicU64::new(1),
        })
    }

    /// Changes when every shell ends with the window; see [`Terminals::open`].
    fn generation(&self) -> u64 {
        self.generation.load(Ordering::SeqCst)
    }

    /// Attaches `key`'s shell to `on_data`, or starts the one `launch` describes if there is none.
    /// Refused when the window's shells ended since `generation` was read: the tab that asked is
    /// gone, and a shell started for it would run unseen until the app quits.
    fn open(
        &self,
        key: String,
        generation: u64,
        size: PtySize,
        on_data: Channel<InvokeResponseBody>,
        launch: impl FnOnce() -> Launch,
    ) -> Result<TerminalInfo> {
        // Held while spawning, so a second open of the same key (a remount) can't start another
        let mut sessions = self.sessions.lock().unwrap();
        if self.generation() != generation {
            return Err(pty_error("the window closed"));
        }
        if let Some(session) = sessions.get(&key) {
            *session.output.lock().unwrap() = on_data;
            session.resize(size)?;
            // The new page has no title yet
            session.title.announce();
            return Ok(session.info(true));
        }
        let session = self.spawn(&key, launch(), size, on_data)?;
        let info = session.info(false);
        sessions.insert(key, session);
        Ok(info)
    }

    fn spawn(
        &self,
        key: &str,
        launch: Launch,
        size: PtySize,
        on_data: Channel<InvokeResponseBody>,
    ) -> Result<Arc<Session>> {
        let pty = native_pty_system().openpty(size).map_err(pty_error)?;
        let reader = pty
            .master
            .as_raw_fd()
            // SAFETY: the master is open for the duration of the borrow
            .map(|fd| unsafe { BorrowedFd::borrow_raw(fd) }.try_clone_to_owned().map(File::from))
            .ok_or_else(|| pty_error("no file descriptor"))??;
        let writer = pty.master.take_writer().map_err(pty_error)?;
        let mut cmd = CommandBuilder::new(&launch.shell);
        cmd.args(&launch.args);
        cmd.cwd(&launch.cwd);
        cmd.env_clear();
        for (name, value) in &launch.env {
            cmd.env(name, value);
        }
        let mut child =
            pty.slave.spawn_command(cmd).map_err(|e| Error::Other(format!("{}: {e}", launch.shell.display())))?;
        // Only the shell and its jobs hold the terminal now, so reads end when they are gone
        drop(pty.slave);
        let pid = child.process_id();

        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let output: Output = Arc::new(Mutex::new(on_data));
        let title =
            Arc::new(Title { key: key.to_owned(), current: Mutex::default(), notify: Arc::clone(&self.notify) });
        let (input, pending) = mpsc::channel();
        let (flushed, output_done) = mpsc::channel();
        let exited = Arc::new(AtomicBool::new(false));
        thread::spawn(move || write_input(writer, pending));
        thread::spawn({
            let (output, title) = (Arc::clone(&output), Arc::clone(&title));
            move || {
                read_output(reader, &output, &title);
                let _ = flushed.send(());
            }
        });
        thread::spawn({
            let (sessions, notify, exited, key) =
                (Arc::clone(&self.sessions), Arc::clone(&self.notify), Arc::clone(&exited), key.to_owned());
            move || {
                let status = child.wait();
                exited.store(true, Ordering::SeqCst);
                let _ = output_done.recv_timeout(FLUSH_TIMEOUT);
                let ended = {
                    let mut sessions = sessions.lock().unwrap();
                    if sessions.get(&key).is_some_and(|s| s.id == id) { sessions.remove(&key) } else { None }
                };
                // A killed session was removed already, and gets no event
                if ended.is_some() {
                    let code = status.ok().filter(|s| s.signal().is_none()).map(|s| s.exit_code() as i32);
                    notify(Event::Exit(ExitEvent { key, code }));
                }
            }
        });

        let shell = launch.shell.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        Ok(Arc::new(Session {
            id,
            master: Mutex::new(pty.master),
            input,
            output,
            pid,
            shell,
            cwd: launch.cwd,
            title,
            exited,
        }))
    }

    /// Sends typed or pasted text to the shell; does nothing once it has ended.
    pub fn write(&self, key: &str, data: Vec<u8>) {
        if let Some(session) = self.sessions.lock().unwrap().get(key) {
            let _ = session.input.send(data);
        }
    }

    pub fn resize(&self, key: &str, cols: u16, rows: u16) -> Result<()> {
        let session = self.sessions.lock().unwrap().get(key).cloned();
        session.map_or(Ok(()), |s| s.resize(pty_size(cols, rows)))
    }

    /// Whether closing `key`'s tab would end something the shell runs; false once it has ended.
    pub fn has_child_processes(&self, key: &str) -> bool {
        let session = self.sessions.lock().unwrap().get(key).cloned();
        session.is_some_and(|s| s.has_child_processes())
    }

    /// Ends the shell without an exit event (the tab closed).
    pub fn kill(&self, key: &str) {
        let session = self.sessions.lock().unwrap().remove(key);
        if let Some(session) = session {
            session.hang_up();
        }
    }

    /// Ends every shell (the detail window closed, or the app quits).
    pub fn kill_all(&self) {
        let sessions: Vec<_> = {
            let mut sessions = self.sessions.lock().unwrap();
            self.generation.fetch_add(1, Ordering::SeqCst);
            sessions.drain().map(|(_, s)| s).collect()
        };
        for session in sessions {
            session.hang_up();
        }
    }

    /// The user's login shell in `cwd`, with the login environment `vars` and a LANG for the UI
    /// language `locale`.
    fn launch(&self, shell: PathBuf, cwd: PathBuf, vars: &HashMap<String, String>, locale: Option<&str>) -> Launch {
        let mut env = shell_env(vars, &self.version, locale);
        env.insert("SHELL".into(), shell.display().to_string());
        let args = match shell.file_name().and_then(|n| n.to_str()) {
            Some("zsh") => zsh_integration(&mut env, &self.integration_dir),
            Some("bash") => bash_integration(&self.integration_dir),
            _ => None,
        };
        Launch { shell, args: args.unwrap_or_else(|| vec!["-l".into()]), cwd, env }
    }
}

impl Session {
    fn info(&self, reattached: bool) -> TerminalInfo {
        TerminalInfo { shell: self.shell.clone(), cwd: self.cwd.display().to_string(), pid: self.pid, reattached }
    }

    fn resize(&self, size: PtySize) -> Result<()> {
        self.master.lock().unwrap().resize(size).map_err(pty_error)
    }

    /// Whether the shell has child processes, as VS Code's `ChildProcessMonitor` decides whether
    /// closing a terminal asks first (`terminal.integrated.confirmOnKill`): a job in the foreground
    /// or the background.
    fn has_child_processes(&self) -> bool {
        let Some(pid) = self.pid.filter(|_| !self.exited.load(Ordering::SeqCst)) else {
            return false;
        };
        let mut children = [0 as libc::pid_t; 16];
        // SAFETY: the buffer's size in bytes goes with it
        let found = unsafe {
            libc::proc_listchildpids(
                pid as libc::pid_t,
                children.as_mut_ptr().cast(),
                std::mem::size_of_val(&children) as libc::c_int,
            )
        };
        found > 0
    }

    /// Ends the shell and what runs in its terminal, as closing a terminal does: SIGHUP to the
    /// shell's process group and to the terminal's foreground job, then SIGKILL to the group if
    /// the shell is still there after [`KILL_GRACE`].
    fn hang_up(&self) {
        let Some(group) = self.pid.map(|pid| pid as libc::pid_t) else {
            return;
        };
        // A job-control shell runs its foreground job in a process group of its own
        let foreground = self.master.lock().unwrap().process_group_leader().filter(|&g| g != group);
        // SAFETY: killpg only sends a signal
        unsafe {
            libc::killpg(group, libc::SIGHUP);
            if let Some(foreground) = foreground {
                libc::killpg(foreground, libc::SIGHUP);
            }
        }
        let exited = Arc::clone(&self.exited);
        thread::spawn(move || {
            thread::sleep(KILL_GRACE);
            if !exited.load(Ordering::SeqCst) {
                // SAFETY: as above
                unsafe { libc::killpg(group, libc::SIGKILL) };
            }
        });
    }
}

impl Title {
    /// Reads the terminal's foreground process, and announces it if it changed.
    fn check(&self, terminal: RawFd) {
        let Some(name) = foreground_process(terminal) else {
            return;
        };
        let mut current = self.current.lock().unwrap();
        if *current != name {
            *current = name;
            // Under the lock, so a re-attach can't announce an older title after this one
            self.send(&current);
        }
    }

    /// Announces the current title again, if there is one yet.
    fn announce(&self) {
        let current = self.current.lock().unwrap();
        if !current.is_empty() {
            self.send(&current);
        }
    }

    fn send(&self, title: &str) {
        (self.notify)(Event::Title(TitleEvent { key: self.key.clone(), title: title.to_owned() }));
    }
}

impl Drop for Terminals {
    fn drop(&mut self) {
        self.kill_all();
    }
}

/// Sends the shell's output to the tab until the terminal closes. A PTY read returns at most
/// 1 KiB on macOS, so what arrives within [`BATCH_WINDOW`] of a first read goes out together.
/// The title is looked at after each batch, and once more [`TITLE_RECHECK`] after output stops.
fn read_output(reader: File, output: &Output, title: &Title) {
    // Sent even with nobody listening (a tab between mounts), so the shell never blocks on a
    // full terminal
    let send = |data: &[u8]| {
        let _ = output.lock().unwrap().send(InvokeResponseBody::Raw(data.to_vec()));
    };
    let terminal = reader.as_raw_fd();
    let mut buf = vec![0; READ_SIZE];
    let mut len = 0;
    let mut batch_until: Option<Instant> = None;
    let mut recheck_at: Option<Instant> = None;
    loop {
        if let Some(until) = batch_until {
            if len == buf.len() || quiet(&reader, until) {
                send(&buf[..len]);
                (len, batch_until) = (0, None);
                title.check(terminal);
                recheck_at = Some(Instant::now() + TITLE_RECHECK);
                continue;
            }
        } else if let Some(at) = recheck_at
            && quiet(&reader, at)
        {
            title.check(terminal);
            recheck_at = None;
            continue;
        }
        match (&reader).read(&mut buf[len..]) {
            Ok(0) => break,
            Ok(n) => {
                len += n;
                batch_until.get_or_insert_with(|| Instant::now() + BATCH_WINDOW);
            }
            Err(e) if e.kind() == ErrorKind::Interrupted => {}
            // EIO: the shell and its jobs closed the terminal
            Err(_) => break,
        }
    }
    if len > 0 {
        send(&buf[..len]);
    }
}

/// Whether the terminal stays without output, and open, until `until`.
fn quiet(reader: &File, until: Instant) -> bool {
    let wait = until.saturating_duration_since(Instant::now());
    if wait.is_zero() {
        return true;
    }
    let mut fd = libc::pollfd { fd: reader.as_raw_fd(), events: libc::POLLIN, revents: 0 };
    let ms = wait.as_millis().clamp(1, i32::MAX as u128) as i32;
    // SAFETY: one valid pollfd
    unsafe { libc::poll(&mut fd, 1, ms) <= 0 }
}

/// The name of the terminal's foreground process group leader, as node-pty reports VS Code's
/// `process`: the shell while it waits at the prompt, else the job it runs.
fn foreground_process(terminal: RawFd) -> Option<String> {
    // SAFETY: tcgetpgrp only reads the terminal's foreground process group
    let group = unsafe { libc::tcgetpgrp(terminal) };
    if group <= 0 {
        return None;
    }
    let mut name = [0u8; 64];
    // SAFETY: proc_name writes at most the buffer's size
    let len = unsafe { libc::proc_name(group, name.as_mut_ptr().cast(), name.len() as u32) };
    let name = name.get(..usize::try_from(len).ok()?)?;
    (!name.is_empty()).then(|| String::from_utf8_lossy(name).into_owned())
}

fn write_input(mut writer: Box<dyn Write + Send>, pending: mpsc::Receiver<Vec<u8>>) {
    for data in pending {
        if writer.write_all(&data).and_then(|()| writer.flush()).is_err() {
            break;
        }
    }
}

fn pty_size(cols: u16, rows: u16) -> PtySize {
    // As VS Code does: a zero size (a hidden terminal) upsets programs
    PtySize { rows: rows.max(1), cols: cols.max(1), pixel_width: 0, pixel_height: 0 }
}

fn pty_error(e: impl std::fmt::Display) -> Error {
    Error::Other(format!("terminal: {e}"))
}

/// The login shell: SHELL from the login environment, then gitmenu's own, then macOS's default.
fn login_shell(vars: &HashMap<String, String>) -> PathBuf {
    vars.get("SHELL")
        .cloned()
        .into_iter()
        .chain(std::env::var("SHELL").ok())
        .map(PathBuf::from)
        .find(|p| p.is_absolute() && p.is_file())
        .unwrap_or_else(|| PathBuf::from("/bin/zsh"))
}

/// The requested directory, else the active project's first repository (or its folder when it
/// has none), else home.
fn start_dir(requested: Option<PathBuf>, projects: &Projects, home: &Path) -> PathBuf {
    let project = || projects.active().and_then(|id| projects.info(&id).ok());
    requested
        .filter(|d| d.is_dir())
        .or_else(|| project().and_then(|p| p.repos.first().map(|r| r.root.clone()).or(Some(p.id))))
        .filter(|d| d.is_dir())
        .unwrap_or_else(|| home.to_path_buf())
}

/// The shell's environment: the login environment without askpass plumbing, plus what VS
/// Code's terminal adds (`addTerminalEnvironmentKeys`).
fn shell_env(vars: &HashMap<String, String>, version: &str, locale: Option<&str>) -> HashMap<String, String> {
    let mut env = vars.clone();
    for name in PLUMBING_VARS.iter().chain(&RESOLVER_VARS) {
        env.remove(*name);
    }
    env.insert("TERM".into(), "xterm-256color".into());
    env.insert("COLORTERM".into(), "truecolor".into());
    env.insert("TERM_PROGRAM".into(), "gitmenu".into());
    env.insert("TERM_PROGRAM_VERSION".into(), version.into());
    // `terminal.integrated.detectLocale` "auto": a UTF-8 LANG unless the user's is one already
    let unicode = env.get("LANG").is_some_and(|lang| {
        lang.ends_with(".UTF-8") || lang.ends_with(".utf8") || lang.find(".euc").is_some_and(|i| lang.len() > i + 4)
    });
    if !unicode {
        env.insert("LANG".into(), lang_for(locale));
    }
    env
}

/// VS Code's `getLangEnvVariable`: LANG for the UI language, such as `ko` → `ko_KR.UTF-8` and
/// `zh-tw` → `zh_TW.UTF-8`; `en_US.UTF-8` when there is none.
fn lang_for(locale: Option<&str>) -> String {
    let mut parts: Vec<String> =
        locale.filter(|l| !l.is_empty()).map(|l| l.split('-').map(str::to_owned).collect()).unwrap_or_default();
    match parts.as_mut_slice() {
        [] => return "en_US.UTF-8".into(),
        [language] => {
            // The language's original or most prominent variant (VS Code's list, from macOS's `locale -a`)
            let region = match language.as_str() {
                "af" => "ZA",
                "am" => "ET",
                "be" => "BY",
                "bg" => "BG",
                "ca" | "es" | "eu" => "ES",
                "cs" => "CZ",
                "da" => "DK",
                "de" => "DE",
                "el" => "GR",
                "en" => "US",
                "et" => "EE",
                "fi" => "FI",
                "fr" => "FR",
                "he" => "IL",
                "hr" => "HR",
                "hu" => "HU",
                "hy" => "AM",
                "is" => "IS",
                "it" => "IT",
                "ja" => "JP",
                "kk" => "KZ",
                "ko" => "KR",
                "lt" => "LT",
                "nl" => "NL",
                "no" => "NO",
                "pl" => "PL",
                "pt" => "BR",
                "ro" => "RO",
                "ru" => "RU",
                "sk" => "SK",
                "sl" => "SI",
                "sr" => "YU",
                "sv" => "SE",
                "tr" => "TR",
                "uk" => "UA",
                "zh" => "CN",
                _ => "",
            };
            if !region.is_empty() {
                parts.push(region.into());
            }
        }
        [_, region, ..] => *region = region.to_uppercase(),
    }
    format!("{}.UTF-8", parts.join("_"))
}

/// zsh reads its startup files from ZDOTDIR: ours run the user's from USER_ZDOTDIR, then enable
/// completion if theirs didn't. `-il` as VS Code starts zsh on macOS.
fn zsh_integration(env: &mut HashMap<String, String>, integration_dir: &Path) -> Option<Vec<String>> {
    let dir = integration_dir.join("zsh");
    write_files(&dir, &ZSH_FILES)?;
    let user_dir = env.get("ZDOTDIR").filter(|d| !d.is_empty()).or_else(|| env.get("HOME")).cloned();
    env.insert("USER_ZDOTDIR".into(), user_dir.unwrap_or_default());
    env.insert("ZDOTDIR".into(), dir.display().to_string());
    Some(vec!["-il".into()])
}

/// bash's `--init-file` replaces ~/.bashrc; ours runs the login files, then git's completion.
fn bash_integration(integration_dir: &Path) -> Option<Vec<String>> {
    let dir = integration_dir.join("bash");
    write_files(&dir, &BASH_FILES)?;
    Some(vec!["--init-file".into(), dir.join(BASH_INIT).display().to_string(), "-i".into()])
}

/// Writes the startup files that are missing or from another version of the app. A shell
/// starts without them (a plain login shell) if they can't be written.
fn write_files(dir: &Path, files: &[(&str, &str)]) -> Option<()> {
    let result = std::fs::create_dir_all(dir).map_err(Error::from).and_then(|()| {
        files
            .iter()
            .filter(|(name, text)| std::fs::read(dir.join(name)).ok().as_deref() != Some(text.as_bytes()))
            .try_for_each(|(name, text)| write_atomic(&dir.join(name), text))
    });
    result.map_err(|e| log::warn!("terminal startup files not written to {}: {e}", dir.display())).ok()
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn terminal_open(
    webview: Webview,
    terminals: State<'_, Arc<Terminals>>,
    env: State<'_, Arc<GitEnv>>,
    projects: State<'_, Arc<Projects>>,
    key: String,
    cwd: Option<PathBuf>,
    cols: u16,
    rows: u16,
    locale: Option<String>,
    on_data: Channel<InvokeResponseBody>,
) -> Result<TerminalInfo> {
    // The window's shells end with it (kill_all), which may happen while this waits for the login
    // environment; `open` then refuses. A window already gone by now is caught here.
    let generation = terminals.generation();
    if webview.app_handle().get_webview_window(webview.label()).is_none() {
        return Err(pty_error("the window closed"));
    }
    let resolved = env.resolved().await?;
    let vars = &resolved.vars;
    let home = vars.get("HOME").cloned().or_else(|| std::env::var("HOME").ok()).unwrap_or_else(|| "/".into());
    terminals.open(key, generation, pty_size(cols, rows), on_data, || {
        terminals.launch(login_shell(vars), start_dir(cwd, &projects, Path::new(&home)), vars, locale.as_deref())
    })
}

#[tauri::command]
pub fn terminal_write(terminals: State<'_, Arc<Terminals>>, key: String, data: String) -> Result<()> {
    terminals.write(&key, data.into_bytes());
    Ok(())
}

/// Bytes that aren't text, such as xterm's mouse reports in the default encoding (`onBinary`).
#[tauri::command]
pub fn terminal_write_binary(terminals: State<'_, Arc<Terminals>>, key: String, data: Vec<u8>) -> Result<()> {
    terminals.write(&key, data);
    Ok(())
}

#[tauri::command]
pub fn terminal_resize(terminals: State<'_, Arc<Terminals>>, key: String, cols: u16, rows: u16) -> Result<()> {
    terminals.resize(&key, cols, rows)
}

#[tauri::command]
pub fn terminal_has_child_processes(terminals: State<'_, Arc<Terminals>>, key: String) -> Result<bool> {
    Ok(terminals.has_child_processes(&key))
}

#[tauri::command]
pub fn terminal_kill(terminals: State<'_, Arc<Terminals>>, key: String) -> Result<()> {
    terminals.kill(&key);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const WAIT: Duration = Duration::from_secs(10);

    struct Fixture {
        terminals: Arc<Terminals>,
        events: mpsc::Receiver<Event>,
        dir: tempfile::TempDir,
    }

    impl Fixture {
        fn new() -> Self {
            let dir = tempfile::tempdir().unwrap();
            std::fs::create_dir(dir.path().join("home")).unwrap();
            let (tx, events) = mpsc::channel();
            let terminals = Terminals::new(dir.path().join("integration"), "0.0.0-test".into(), move |event| {
                let _ = tx.send(event);
            });
            Self { terminals, events, dir }
        }

        fn home(&self) -> PathBuf {
            self.dir.path().join("home")
        }

        /// A login environment that doesn't involve the user's own files.
        fn vars(&self) -> HashMap<String, String> {
            HashMap::from([
                ("HOME".into(), self.home().display().to_string()),
                ("PATH".into(), "/usr/bin:/bin:/usr/sbin:/sbin".into()),
                ("USER".into(), std::env::var("USER").unwrap_or_default()),
                ("GIT_ASKPASS".into(), "/nowhere/askpass".into()),
                ("SHLVL".into(), "1".into()),
            ])
        }

        fn launch(&self, shell: &str) -> Launch {
            self.terminals.launch(PathBuf::from(shell), self.home(), &self.vars(), None)
        }

        fn open(&self, key: &str, shell: &str) -> (TerminalInfo, Arc<Mutex<Vec<u8>>>) {
            let (channel, out) = sink();
            let generation = self.terminals.generation();
            let info =
                self.terminals.open(key.into(), generation, pty_size(80, 24), channel, || self.launch(shell)).unwrap();
            (info, out)
        }

        /// The next exit event within `timeout`, skipping title changes.
        fn exit(&self, timeout: Duration) -> Option<ExitEvent> {
            let deadline = Instant::now() + timeout;
            loop {
                match self.events.recv_timeout(deadline.saturating_duration_since(Instant::now())).ok()? {
                    Event::Exit(exit) => return Some(exit),
                    Event::Title(_) => {}
                }
            }
        }

        /// Waits for `key`'s title to become `title`.
        fn title(&self, key: &str, title: &str) -> bool {
            let deadline = Instant::now() + WAIT;
            while let Ok(event) = self.events.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
                if let Event::Title(event) = event
                    && event.key == key
                    && event.title == title
                {
                    return true;
                }
            }
            false
        }
    }

    /// A channel that collects the bytes sent to it.
    fn sink() -> (Channel<InvokeResponseBody>, Arc<Mutex<Vec<u8>>>) {
        let out = Arc::new(Mutex::new(Vec::new()));
        let channel = Channel::new({
            let out = Arc::clone(&out);
            move |body| {
                if let InvokeResponseBody::Raw(bytes) = body {
                    out.lock().unwrap().extend(bytes);
                }
                Ok(())
            }
        });
        (channel, out)
    }

    fn wait_for(out: &Mutex<Vec<u8>>, needle: &str) -> bool {
        until(|| String::from_utf8_lossy(&out.lock().unwrap()).contains(needle))
    }

    fn until(done: impl Fn() -> bool) -> bool {
        let started = Instant::now();
        while started.elapsed() < WAIT {
            if done() {
                return true;
            }
            thread::sleep(Duration::from_millis(20));
        }
        false
    }

    fn alive(pid: u32) -> bool {
        // SAFETY: signal 0 only checks that the process exists
        unsafe { libc::kill(pid as libc::pid_t, 0) == 0 }
    }

    #[test]
    fn runs_the_shell_with_the_terminal_environment() {
        let fx = Fixture::new();
        let (info, out) = fx.open("a", "/bin/sh");
        assert_eq!(info.shell, "sh");
        assert_eq!(info.cwd, fx.home().display().to_string());
        assert!(!info.reattached && info.pid.is_some());

        fx.terminals.write("a", b"echo hi\n".to_vec());
        assert!(wait_for(&out, "\nhi\r\n"), "{}", String::from_utf8_lossy(&out.lock().unwrap()));
        fx.terminals
            .write("a", b"echo \"[$TERM_PROGRAM|$TERM|$COLORTERM|${GIT_ASKPASS-none}|$SHLVL|$LANG]\"\n".to_vec());
        assert!(wait_for(&out, "[gitmenu|xterm-256color|truecolor|none|1|en_US.UTF-8]"));
    }

    #[test]
    fn writes_bytes_that_are_not_utf8() {
        let fx = Fixture::new();
        let (_, out) = fx.open("a", "/bin/sh");
        // A mouse report past column 95 in xterm's default encoding carries bytes above 0x7f
        fx.terminals.write("a", b"stty raw -echo; echo go; head -c 3 | xxd -p; stty sane\n".to_vec());
        assert!(wait_for(&out, "\ngo"));
        fx.terminals.write("a", vec![0x20, 0xa0, 0xff]);
        assert!(wait_for(&out, "20a0ff"), "{}", String::from_utf8_lossy(&out.lock().unwrap()));
    }

    #[test]
    fn resizes() {
        let fx = Fixture::new();
        let (_, out) = fx.open("a", "/bin/sh");
        fx.terminals.resize("a", 100, 30).unwrap();
        fx.terminals.write("a", b"stty size\n".to_vec());
        assert!(wait_for(&out, "\n30 100\r\n"), "{}", String::from_utf8_lossy(&out.lock().unwrap()));
        // A missing session is not an error: the tab may resize after its shell exited
        fx.terminals.resize("gone", 100, 30).unwrap();
    }

    #[test]
    fn reattaches_to_a_running_shell() {
        let fx = Fixture::new();
        let (first, old) = fx.open("a", "/bin/sh");
        let (second, new) = fx.open("a", "/bin/false");
        assert!(second.reattached);
        assert_eq!((second.pid, second.shell), (first.pid, first.shell));
        fx.terminals.write("a", b"echo again\n".to_vec());
        assert!(wait_for(&new, "\nagain\r\n"));
        assert!(!String::from_utf8_lossy(&old.lock().unwrap()).contains("again"));
    }

    #[test]
    fn an_open_from_before_the_window_closed_starts_nothing() {
        let fx = Fixture::new();
        // terminal_open read the generation, then waited for the login environment
        let generation = fx.terminals.generation();
        fx.terminals.kill_all();
        let (channel, _) = sink();
        let launched = AtomicBool::new(false);
        let result = fx.terminals.open("a".into(), generation, pty_size(80, 24), channel, || {
            launched.store(true, Ordering::SeqCst);
            fx.launch("/bin/sh")
        });
        assert!(result.is_err());
        assert!(!launched.load(Ordering::SeqCst));
        assert!(fx.terminals.sessions.lock().unwrap().is_empty());
        // The reopened window's tabs start shells as usual
        assert!(!fx.open("a", "/bin/sh").0.reattached);
    }

    #[test]
    fn title_and_child_processes_follow_the_foreground_job() {
        let fx = Fixture::new();
        let (_, out) = fx.open("a", "/bin/sh");
        fx.terminals.write("a", b"echo ready\n".to_vec());
        assert!(wait_for(&out, "\nready\r\n"));
        let terminal = fx.terminals.sessions.lock().unwrap()["a"].master.lock().unwrap().as_raw_fd().unwrap();
        let shell = foreground_process(terminal).expect("the shell's name");
        assert!(!fx.terminals.has_child_processes("a"));

        // A command that prints nothing: the title changes on the second look
        fx.terminals.write("a", b"sleep 30\n".to_vec());
        assert!(fx.title("a", "sleep"));
        assert!(fx.terminals.has_child_processes("a"));
        // A tab that re-attaches hears the current title
        fx.open("a", "/bin/sh");
        assert!(fx.title("a", "sleep"));

        fx.terminals.write("a", b"\x03".to_vec());
        assert!(fx.title("a", &shell));
        assert!(until(|| !fx.terminals.has_child_processes("a")));
        // Background jobs count too, as in VS Code
        fx.terminals.write("a", b"sleep 30 &\n".to_vec());
        assert!(until(|| fx.terminals.has_child_processes("a")));
        fx.terminals.kill("a");
        assert!(!fx.terminals.has_child_processes("a"));
    }

    #[test]
    fn kill_ends_the_shell_without_an_exit_event() {
        let fx = Fixture::new();
        let (info, out) = fx.open("a", "/bin/sh");
        fx.terminals.write("a", b"echo ready\n".to_vec());
        assert!(wait_for(&out, "\nready\r\n"));
        fx.terminals.kill("a");
        assert!(fx.terminals.sessions.lock().unwrap().is_empty());
        let pid = info.pid.unwrap();
        assert!(until(|| !alive(pid)));
        assert!(fx.exit(FLUSH_TIMEOUT * 4).is_none());
        // Killing again, or an unknown key, does nothing
        fx.terminals.kill("a");
    }

    #[test]
    fn reports_the_exit_code() {
        let fx = Fixture::new();
        let (_, out) = fx.open("a", "/bin/sh");
        fx.terminals.write("a", b"echo bye; exit 3\n".to_vec());
        let exit = fx.exit(WAIT).unwrap();
        assert_eq!((exit.key.as_str(), exit.code), ("a", Some(3)));
        assert!(String::from_utf8_lossy(&out.lock().unwrap()).contains("\nbye\r\n"));
        assert!(fx.terminals.sessions.lock().unwrap().is_empty());
        // Input after the exit goes nowhere
        fx.terminals.write("a", b"echo\n".to_vec());
    }

    #[test]
    fn batches_output() {
        let fx = Fixture::new();
        let sizes = Arc::new(Mutex::new(Vec::new()));
        let (channel, out) = sink();
        let channel_sizes = Channel::new({
            let sizes = Arc::clone(&sizes);
            move |body: InvokeResponseBody| {
                if let InvokeResponseBody::Raw(bytes) = &body {
                    sizes.lock().unwrap().push(bytes.len());
                }
                channel.send(body)
            }
        });
        fx.terminals.open("a".into(), 0, pty_size(80, 24), channel_sizes, || fx.launch("/bin/sh")).unwrap();
        fx.terminals.write("a", b"head -c 3000000 /dev/zero | tr '\\0' x; exit\n".to_vec());
        assert_eq!(fx.exit(WAIT).unwrap().code, Some(0));
        // Everything arrived, in order, in far fewer messages than 1 KiB reads
        let out = out.lock().unwrap();
        let longest = out.split(|b| *b != b'x').map(<[u8]>::len).max();
        assert_eq!(longest, Some(3_000_000));
        let sizes = sizes.lock().unwrap();
        assert!(sizes.len() < 3_000_000 / 1024 / 4, "{} messages", sizes.len());
        assert!(sizes.iter().all(|&n| n <= READ_SIZE));
    }

    #[test]
    fn environment_follows_vs_code() {
        let vars = HashMap::from([
            ("GITMENU_IPC".into(), "/tmp/gitmenu.sock".into()),
            ("GIT_EDITOR".into(), "gitmenu --editor".into()),
            ("PWD".into(), "/somewhere".into()),
            ("EDITOR".into(), "vim".into()),
        ]);
        let env = shell_env(&vars, "1.2.3", None);
        assert!(["GITMENU_IPC", "GIT_EDITOR", "PWD"].iter().all(|k| !env.contains_key(*k)));
        assert_eq!(env["EDITOR"], "vim");
        assert_eq!(env["TERM_PROGRAM_VERSION"], "1.2.3");
        assert_eq!(env["LANG"], "en_US.UTF-8");
        for (lang, kept) in [("ko_KR.UTF-8", true), ("de_DE.utf8", true), ("ja_JP.eucJP", true), ("C", false)] {
            let env = shell_env(&HashMap::from([("LANG".into(), lang.into())]), "1", Some("fr"));
            assert_eq!(env["LANG"] == lang, kept, "{lang}");
        }
        // Without a UTF-8 LANG of the user's, the UI language's (getLangEnvVariable)
        for (locale, lang) in [
            ("ko", "ko_KR.UTF-8"),
            ("ja", "ja_JP.UTF-8"),
            ("zh-cn", "zh_CN.UTF-8"),
            ("zh-tw", "zh_TW.UTF-8"),
            ("pt-br", "pt_BR.UTF-8"),
            ("de", "de_DE.UTF-8"),
            ("es", "es_ES.UTF-8"),
            ("en", "en_US.UTF-8"),
            ("", "en_US.UTF-8"),
        ] {
            let env = shell_env(&HashMap::from([("LANG".into(), "C".into())]), "1", Some(locale));
            assert_eq!(env["LANG"], lang, "{locale}");
        }
    }

    /// zsh -il through our ZDOTDIR, printing what the user's startup files left behind.
    fn zsh_startup(fx: &Fixture, vars: &HashMap<String, String>) -> String {
        let launch = fx.terminals.launch(PathBuf::from("/bin/zsh"), fx.home(), vars, None);
        assert_eq!(launch.args, ["-il"]);
        let script = r#"print -r -- "$ENV_MARK$PROFILE_MARK$RC_MARK$LOGIN_MARK|$RC_ZDOTDIR|${ZDOTDIR-unset}|${USER_ZDOTDIR-unset}|$+functions[compdef]|$HISTFILE""#;
        let output = std::process::Command::new(&launch.shell)
            .args(&launch.args)
            .args(["-c", script])
            .env_clear()
            .envs(&launch.env)
            .current_dir(&launch.cwd)
            .stdin(std::process::Stdio::null())
            .output()
            .unwrap();
        String::from_utf8_lossy(&output.stdout).trim().to_owned()
    }

    fn write_zsh_files(dir: &Path) {
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(dir.join(".zshenv"), "ENV_MARK=e\n").unwrap();
        std::fs::write(dir.join(".zprofile"), "PROFILE_MARK=p\n").unwrap();
        std::fs::write(dir.join(".zshrc"), "RC_MARK=r\nRC_ZDOTDIR=$ZDOTDIR\n").unwrap();
        std::fs::write(dir.join(".zlogin"), "LOGIN_MARK=l\n").unwrap();
    }

    #[test]
    fn zsh_runs_the_users_startup_files() {
        if !Path::new("/bin/zsh").exists() {
            return;
        }
        let fx = Fixture::new();
        let history = |dir: &Path| {
            let file = dir.join(".zsh_history").display().to_string();
            move |h: &str| h.is_empty() || h == file
        };

        // The user's own ZDOTDIR: restored afterwards
        let user_dir = fx.dir.path().join("zdotdir");
        write_zsh_files(&user_dir);
        let mut vars = fx.vars();
        vars.insert("ZDOTDIR".into(), user_dir.display().to_string());
        let out = zsh_startup(&fx, &vars);
        let fields: Vec<&str> = out.split('|').collect();
        let user = user_dir.display().to_string();
        assert_eq!(fields[..5], ["eprl", &user, &user, "unset", "1"], "{out}");
        assert!(history(&user_dir)(fields[5]), "{out}");

        // A ZDOTDIR with a space, and a .zshenv that splits words: every file still runs
        let spaced = fx.dir.path().join("z dot");
        write_zsh_files(&spaced);
        std::fs::write(spaced.join(".zshenv"), "ENV_MARK=e\nsetopt shwordsplit\n").unwrap();
        vars.insert("ZDOTDIR".into(), spaced.display().to_string());
        let out = zsh_startup(&fx, &vars);
        let spaced = spaced.display().to_string();
        assert_eq!(out.split('|').take(4).collect::<Vec<_>>(), ["eprl", &spaced, &spaced, "unset"], "{out}");

        // None (files in home): ZDOTDIR ends up unset, as it was
        write_zsh_files(&fx.home());
        std::fs::write(
            fx.home().join(".zshrc"),
            "RC_MARK=r\nRC_ZDOTDIR=$ZDOTDIR\nautoload -Uz compinit\ncompdef() {}\n",
        )
        .unwrap();
        let out = zsh_startup(&fx, &fx.vars());
        let fields: Vec<&str> = out.split('|').collect();
        let home = fx.home().display().to_string();
        assert_eq!(fields[..5], ["eprl", &home, "unset", "unset", "1"], "{out}");
        assert!(history(&fx.home())(fields[5]), "{out}");
        // The user's config defined compdef, so completion wasn't set up again (and never in home)
        assert!(!fx.home().join(".zcompdump").exists());
        assert!(fx.dir.path().join("integration/zsh/.zcompdump").exists());
    }

    #[test]
    fn bash_runs_the_login_files_and_git_completion() {
        if !Path::new("/bin/bash").exists() {
            return;
        }
        let fx = Fixture::new();
        std::fs::write(fx.home().join(".bash_profile"), "PROFILE_MARK=p\n").unwrap();
        std::fs::write(fx.home().join(".profile"), "OTHER_MARK=o\n").unwrap();
        let launch = fx.terminals.launch(PathBuf::from("/bin/bash"), fx.home(), &fx.vars(), None);
        assert_eq!(launch.args[0], "--init-file");
        let script = r#"echo "$PROFILE_MARK${OTHER_MARK-}|$(declare -F __git_complete >/dev/null && echo git)""#;
        let output = std::process::Command::new(&launch.shell)
            .args(&launch.args)
            .args(["-c", script])
            .env_clear()
            .envs(&launch.env)
            .stdin(std::process::Stdio::null())
            .output()
            .unwrap();
        let out = String::from_utf8_lossy(&output.stdout).trim().to_owned();
        assert!(out.starts_with("p|"), "{out}");
        if Path::new("/Library/Developer/CommandLineTools/usr/share/git-core/git-completion.bash").exists() {
            assert_eq!(out, "p|git");
        }
    }
}
