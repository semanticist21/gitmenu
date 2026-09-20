//! Project tabs, repository detection, file watching, and persisted UI state.
//!
//! A project is a folder the user opened; it holds one or more repositories (the folder's
//! own, submodules, nested repositories). Detection follows VS Code's git settings.
//! Every open project is watched. Only the active one triggers re-reads; the others just
//! get a "changed" dot and are re-read when activated.
//!
//! Opening a folder is two phases: the tab appears at once (`scanning`), and the scan runs on
//! a blocking worker, streaming repositories in as it finds them. Nothing here may run on the
//! main thread: a folder like `~/code` holds a million files.

use std::{
    collections::{HashMap, HashSet, VecDeque},
    fs,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex, RwLock, Weak,
        atomic::{AtomicU64, Ordering},
        mpsc,
    },
    time::{Duration, Instant},
};

use notify::RecursiveMode;
use notify_debouncer_full::{DebounceEventResult, Debouncer, NoCache, new_debouncer_opt};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::{
    error::{Error, Result},
    queue::Queue,
    settings::{Settings, write_atomic},
};

const RECENT_LIMIT: usize = 20;
/// How long the watcher gathers file events before handing them over.
const WATCH_DEBOUNCE: Duration = Duration::from_millis(150);
/// VS Code's `Model.eventuallyScanPossibleGitRepositories` delay before opening a folder where
/// a `.git` appeared (model.ts).
const CANDIDATE_DEBOUNCE: Duration = Duration::from_millis(500);
/// At most one re-read per repository per second while events keep arriving.
const REFRESH_FLOOR: Duration = Duration::from_secs(1);
/// Directories one scan may read. VS Code traverses unbounded; a menu bar app cannot spend
/// minutes stat-ing a home folder, so `git.repositoryScanMaxDepth: -1` stops here instead.
const SCAN_DIR_BUDGET: usize = 50_000;
const SCAN_TIME_BUDGET: Duration = Duration::from_secs(10);
/// Repositories, or milliseconds, between two partial results (SPEC 성능 규칙: stream results).
const SCAN_EMIT_EVERY: usize = 10;
const SCAN_EMIT_INTERVAL: Duration = Duration::from_millis(100);
/// Projects scanned at once, like VS Code's `Model._initialStatusLimiter`.
const SCAN_CONCURRENCY: usize = 2;
/// Trailing delay before `state.json` is written, so a burst of `ui_state_set` writes once.
const UI_STATE_WRITE_DELAY: Duration = Duration::from_millis(200);

/// Small JSON document of UI state (tabs, view layout, window sizes) the frontend owns.
/// Writes are coalesced onto a trailing worker so a burst of settings costs one file write.
pub struct UiState {
    path: PathBuf,
    values: RwLock<Map<String, Value>>,
    writing: Mutex<bool>,
}

impl UiState {
    pub fn load(dir: &Path) -> Arc<Self> {
        let path = dir.join("state.json");
        let values = fs::read_to_string(&path)
            .ok()
            .and_then(|t| serde_json::from_str::<Map<String, Value>>(&t).ok())
            .unwrap_or_default();
        Arc::new(Self { path, values: RwLock::new(values), writing: Mutex::new(false) })
    }

    pub fn get(&self, key: &str) -> Option<Value> {
        self.values.read().unwrap().get(key).cloned()
    }

    pub fn set(self: &Arc<Self>, key: &str, value: Value) {
        {
            let mut values = self.values.write().unwrap();
            if value.is_null() {
                values.remove(key);
            } else {
                values.insert(key.to_owned(), value);
            }
        }
        {
            let mut writing = self.writing.lock().unwrap();
            if *writing {
                return;
            }
            *writing = true;
        }
        let this = Arc::clone(self);
        std::thread::spawn(move || {
            std::thread::sleep(UI_STATE_WRITE_DELAY);
            *this.writing.lock().unwrap() = false;
            this.flush();
        });
    }

    /// Writes whatever is pending right now (app exit).
    pub fn flush(&self) {
        let text = serde_json::to_string_pretty(&*self.values.read().unwrap()).unwrap_or_default();
        if let Err(e) = write_atomic(&self.path, &text) {
            log::warn!("could not save UI state: {e}");
        }
    }
}

/// Where project changes go: the app emits them to the windows, tests record them.
pub trait ProjectEvents: Send + Sync + 'static {
    fn projects_changed(&self, projects: Vec<ProjectInfo>, active: Option<PathBuf>);
    fn repo_changed(&self, root: &Path);
}

/// The app's `ProjectEvents`: the same payload `projects_list` returns, so a window can apply
/// it without asking again.
pub struct AppEvents(pub AppHandle);

impl ProjectEvents for AppEvents {
    fn projects_changed(&self, projects: Vec<ProjectInfo>, active: Option<PathBuf>) {
        let _ = self.0.emit("projects://changed", (projects, active));
    }

    fn repo_changed(&self, root: &Path) {
        let _ = self.0.emit("repo://changed", root);
    }
}

/// Worktrees with a git write running; their file events are the write's own echo.
pub trait Writes: Send + Sync + 'static {
    fn is_writing(&self, worktree: &Path) -> bool;
}

impl Writes for Queue {
    fn is_writing(&self, worktree: &Path) -> bool {
        Queue::is_writing(self, worktree)
    }
}

/// Repositories whose status hit `git.statusLimit`. VS Code stops refreshing these
/// (`Repository.isRepositoryHuge`, repository.ts), and so do we.
#[derive(Default)]
pub struct HugeRepos(Mutex<HashSet<PathBuf>>);

impl HugeRepos {
    pub fn set(&self, root: &Path, huge: bool) {
        let mut set = self.0.lock().unwrap();
        if huge {
            set.insert(root.to_path_buf());
        } else {
            set.remove(root);
        }
    }

    pub fn contains(&self, root: &Path) -> bool {
        self.0.lock().unwrap().contains(root)
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RepoKind {
    /// The project folder itself, or its parent repository the user accepted
    Root,
    Submodule,
    Nested,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoInfo {
    /// Worktree root; the repository's identity everywhere in the app
    pub root: PathBuf,
    pub git_dir: PathBuf,
    pub common_dir: PathBuf,
    pub kind: RepoKind,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    /// The opened folder's path, also its id
    pub id: PathBuf,
    pub name: String,
    pub missing: bool,
    pub dirty: bool,
    /// A background scan is still looking for repositories in this folder
    pub scanning: bool,
    /// The scan stopped at its budget; the list may be short
    pub scan_truncated: bool,
    pub repos: Vec<RepoInfo>,
    /// A repository above the folder that the user hasn't accepted or declined yet
    pub parent_candidate: Option<PathBuf>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredProject {
    root: PathBuf,
    /// "accepted" / "declined" answer to the parent-repository question
    #[serde(default)]
    parent: Option<ParentAnswer>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "answer")]
pub enum ParentAnswer {
    Accepted { path: PathBuf },
    Declined,
}

/// The `git.*` settings detection reads, resolved once per scan.
#[derive(Debug, Clone)]
pub struct ScanConfig {
    /// `git.autoRepositoryDetection` is not `false`: a new `.git` becomes a repository
    pub detect: bool,
    /// `git.autoRepositoryDetection` is `true` or `"subFolders"`
    pub subfolders: bool,
    /// `git.repositoryScanMaxDepth`; `-1` is unlimited, within the traversal budget
    pub max_depth: i64,
    /// `git.repositoryScanIgnoredFolders`, lowercased: the scan skips them, the watcher does
    /// not. VS Code compares with `pathEquals`, which is case-insensitive on macOS (util.ts)
    pub ignored: HashSet<String>,
    pub submodules: bool,
    pub submodule_limit: usize,
    /// `git.openRepositoryInParentFolders`
    pub parent: String,
}

impl Default for ScanConfig {
    fn default() -> Self {
        Self {
            detect: true,
            subfolders: true,
            max_depth: 1,
            ignored: ["node_modules".to_owned()].into_iter().collect(),
            submodules: true,
            submodule_limit: 10,
            parent: "prompt".to_owned(),
        }
    }
}

impl ScanConfig {
    pub fn from_settings(settings: &Settings) -> Self {
        let auto = settings.get("git.autoRepositoryDetection");
        Self {
            detect: auto.as_bool() != Some(false),
            // `"openEditors"` opens the folder's own repository but never walks subfolders
            // (model.ts `onDidChangeConfiguration`: `!== true && !== 'subFolders'` returns)
            subfolders: auto.as_bool() == Some(true) || auto.as_str() == Some("subFolders"),
            max_depth: settings.get("git.repositoryScanMaxDepth").as_i64().unwrap_or(1),
            ignored: settings
                .get("git.repositoryScanIgnoredFolders")
                .as_array()
                .map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_lowercase)).collect())
                .unwrap_or_default(),
            submodules: settings.get("git.detectSubmodules").as_bool().unwrap_or(true),
            submodule_limit: settings.get("git.detectSubmodulesLimit").as_u64().unwrap_or(10) as usize,
            parent: settings.get_str("git.openRepositoryInParentFolders").unwrap_or_else(|| "prompt".into()),
        }
    }
}

/// What one scan found. `None` from `scan_project` means it was cancelled.
#[derive(Debug, Default)]
pub struct ScanResult {
    pub repos: Vec<RepoInfo>,
    pub parent_candidate: Option<PathBuf>,
    /// The traversal hit `SCAN_DIR_BUDGET` or `SCAN_TIME_BUDGET`
    pub truncated: bool,
    /// Directories read, the budget's counter
    pub visited: usize,
}

struct Project {
    stored: StoredProject,
    info: ProjectInfo,
    /// Bumped by every rescan, relocate and close; a scan stops when it no longer matches
    generation: Arc<AtomicU64>,
}

struct ProjectWatcher {
    debouncer: Debouncer<notify::RecommendedWatcher, NoCache>,
    /// Git directories outside the project folder (linked worktrees, a parent repository)
    outside: HashSet<PathBuf>,
    /// The folder was missing when this watcher was made, so it watches an ancestor instead
    missing: bool,
}

/// One debounced batch of file events, handed from the watcher thread to the worker.
struct Batch {
    project: PathBuf,
    paths: Vec<PathBuf>,
    /// FSEvents dropped events (`kFSEventStreamEventFlagMustScanSubDirs`)
    need_rescan: bool,
}

pub struct Projects {
    events: Arc<dyn ProjectEvents>,
    settings: Arc<Settings>,
    ui: Arc<UiState>,
    writes: Arc<dyn Writes>,
    huge: Arc<HugeRepos>,
    inner: Mutex<Inner>,
    watchers: Mutex<HashMap<PathBuf, ProjectWatcher>>,
    /// Keeps the order of the `project_*` commands now that they are async, like VS Code's
    /// `@sequentialize` on `Model.openRepository`. Held around the in-memory phase only.
    lane: Arc<tokio::sync::Mutex<()>>,
    slots: Arc<tokio::sync::Semaphore>,
    batches: mpsc::Sender<Batch>,
}

#[derive(Default)]
struct Inner {
    order: Vec<PathBuf>,
    projects: HashMap<PathBuf, Project>,
    active: Option<PathBuf>,
}

impl Projects {
    pub fn new(
        events: Arc<dyn ProjectEvents>,
        settings: Arc<Settings>,
        ui: Arc<UiState>,
        writes: Arc<dyn Writes>,
        huge: Arc<HugeRepos>,
    ) -> Arc<Self> {
        let (batches, rx) = mpsc::channel();
        let this = Arc::new(Self {
            events,
            settings,
            ui,
            writes,
            huge,
            inner: Mutex::new(Inner::default()),
            watchers: Mutex::new(HashMap::new()),
            lane: Arc::new(tokio::sync::Mutex::new(())),
            slots: Arc::new(tokio::sync::Semaphore::new(SCAN_CONCURRENCY)),
            batches,
        });
        let weak = Arc::downgrade(&this);
        let _ = std::thread::Builder::new().name("gitmenu-watch".into()).spawn(move || watch_worker(weak, rx));
        this
    }

    /// Guards the order of the async `project_*` commands.
    pub async fn lane(&self) -> tokio::sync::OwnedMutexGuard<()> {
        Arc::clone(&self.lane).lock_owned().await
    }

    /// Reopens the tabs saved last time. The tabs appear immediately; their folders are
    /// scanned in the background, the active one first.
    pub fn restore(self: &Arc<Self>) {
        let stored: Vec<StoredProject> =
            self.ui.get("projects").and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default();
        let active = self.ui.get("activeProject").and_then(|v| serde_json::from_value::<PathBuf>(v).ok());
        let mut scans: Vec<(ProjectInfo, Arc<AtomicU64>, u64)> =
            stored.into_iter().map(|project| self.insert_record(project, true)).collect();
        {
            let mut inner = self.inner.lock().unwrap();
            inner.active = active.filter(|a| inner.projects.contains_key(a)).or_else(|| inner.order.first().cloned());
        }
        let active = self.active();
        scans.sort_by_key(|(info, ..)| active.as_deref() != Some(info.id.as_path()));
        self.emit_list();
        for (info, generation, epoch) in scans {
            if !info.missing {
                self.schedule_scan(info.id, generation, epoch);
            }
        }
    }

    pub fn list(&self) -> Vec<ProjectInfo> {
        let inner = self.inner.lock().unwrap();
        inner.order.iter().filter_map(|id| inner.projects.get(id)).map(|p| p.info.clone()).collect()
    }

    pub fn active(&self) -> Option<PathBuf> {
        self.inner.lock().unwrap().active.clone()
    }

    pub fn recent(&self) -> Vec<PathBuf> {
        self.ui.get("recentProjects").and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default()
    }

    /// Opens a folder as a new tab (or switches to it) and makes it active. Returns as soon as
    /// the tab exists; the repositories arrive over `projects://changed`.
    pub fn open(self: &Arc<Self>, root: PathBuf) -> Result<ProjectInfo> {
        let root = fs::canonicalize(&root).map_err(|_| Error::NotFound(root.display().to_string()))?;
        if !self.inner.lock().unwrap().projects.contains_key(&root) {
            self.insert_at(StoredProject { root: root.clone(), parent: None }, true);
        }
        self.activate(&root)?;
        let mut recent = self.recent();
        recent.retain(|p| p != &root);
        recent.insert(0, root.clone());
        recent.truncate(RECENT_LIMIT);
        self.ui.set("recentProjects", serde_json::to_value(recent)?);
        self.save();
        self.info(&root)
    }

    pub fn close(&self, id: &Path) {
        {
            let mut inner = self.inner.lock().unwrap();
            if let Some(project) = inner.projects.remove(id) {
                project.generation.fetch_add(1, Ordering::SeqCst);
            }
            inner.order.retain(|p| p != id);
            if inner.active.as_deref() == Some(id) {
                inner.active = inner.order.first().cloned();
            }
        }
        self.watchers.lock().unwrap().remove(id);
        self.save();
        self.emit_list();
    }

    pub fn reorder(&self, order: Vec<PathBuf>) {
        let mut inner = self.inner.lock().unwrap();
        let known: HashSet<_> = inner.order.iter().cloned().collect();
        if order.len() == known.len() && order.iter().all(|p| known.contains(p)) {
            inner.order = order;
        }
        drop(inner);
        self.save();
    }

    pub fn activate(&self, id: &Path) -> Result<()> {
        let mut inner = self.inner.lock().unwrap();
        let project = inner.projects.get_mut(id).ok_or_else(|| Error::NotFound(id.display().to_string()))?;
        let was_dirty = std::mem::take(&mut project.info.dirty);
        let roots: Vec<PathBuf> = project.info.repos.iter().map(|r| r.root.clone()).collect();
        inner.active = Some(id.to_path_buf());
        drop(inner);
        self.save();
        self.emit_list();
        // Changes while the tab was inactive only set the dot; the views re-read now
        if was_dirty {
            for root in roots {
                self.events.repo_changed(&root);
            }
        }
        Ok(())
    }

    /// Points a missing tab at the folder's new location.
    pub fn relocate(self: &Arc<Self>, id: &Path, new_root: PathBuf) -> Result<ProjectInfo> {
        let new_root = fs::canonicalize(&new_root)?;
        let parent = {
            let mut inner = self.inner.lock().unwrap();
            let old = inner.projects.remove(id).ok_or_else(|| Error::NotFound(id.display().to_string()))?;
            old.generation.fetch_add(1, Ordering::SeqCst);
            for slot in inner.order.iter_mut() {
                if slot == id {
                    *slot = new_root.clone();
                }
            }
            if inner.active.as_deref() == Some(id) {
                inner.active = Some(new_root.clone());
            }
            old.stored.parent
        };
        self.watchers.lock().unwrap().remove(id);
        self.insert_at(StoredProject { root: new_root.clone(), parent }, false);
        self.save();
        self.info(&new_root)
    }

    /// Records the answer to "open the repository in the parent folder?".
    pub fn answer_parent(self: &Arc<Self>, id: &Path, accept: bool) -> Result<ProjectInfo> {
        let stored = {
            let inner = self.inner.lock().unwrap();
            let project = inner.projects.get(id).ok_or_else(|| Error::NotFound(id.display().to_string()))?;
            let mut stored = project.stored.clone();
            stored.parent = Some(match (&project.info.parent_candidate, accept) {
                (Some(path), true) => ParentAnswer::Accepted { path: path.clone() },
                _ => ParentAnswer::Declined,
            });
            stored
        };
        self.insert_at(stored, false);
        self.save();
        self.info(id)
    }

    /// Re-runs detection (after `git init`, a settings change, or a folder coming back).
    /// The watcher's own discovery is incremental and never comes through here.
    pub fn rescan(self: &Arc<Self>, id: &Path) -> Result<ProjectInfo> {
        let stored = {
            let inner = self.inner.lock().unwrap();
            inner.projects.get(id).ok_or_else(|| Error::NotFound(id.display().to_string()))?.stored.clone()
        };
        self.insert_at(stored, false);
        self.info(id)
    }

    /// Re-runs detection for every open tab (a `git.*` scan setting changed).
    pub fn rescan_all(self: &Arc<Self>) {
        let stored: Vec<StoredProject> = {
            let inner = self.inner.lock().unwrap();
            inner.order.iter().filter_map(|id| inner.projects.get(id)).map(|p| p.stored.clone()).collect()
        };
        for project in stored {
            self.insert_at(project, false);
        }
    }

    pub fn info(&self, id: &Path) -> Result<ProjectInfo> {
        let inner = self.inner.lock().unwrap();
        inner.projects.get(id).map(|p| p.info.clone()).ok_or_else(|| Error::NotFound(id.display().to_string()))
    }

    /// Whether a repository already covers this folder, so `git init` must not write there.
    /// The tab is published before its scan runs, so its repository list cannot answer this:
    /// ask git instead, the way VS Code's model knows the folder before `git.init` picks it.
    pub fn has_repo(&self, id: &Path) -> bool {
        if open_repo(id).is_some() {
            return true;
        }
        // A parent repository this tab opened (or would open) is the tab's repository:
        // initializing here would nest a second repository inside its worktree
        let answered = {
            let inner = self.inner.lock().unwrap();
            inner.projects.get(id).and_then(|p| p.stored.parent.clone())
        };
        let opens_parent = match answered {
            Some(ParentAnswer::Accepted { .. }) => true,
            Some(ParentAnswer::Declined) => false,
            None => self.settings.get_str("git.openRepositoryInParentFolders").as_deref() == Some("always"),
        };
        opens_parent && id.parent().and_then(discover_repo).is_some()
    }

    /// Finds the repository that owns `path` in any open project.
    pub fn repo_for(&self, path: &Path) -> Option<RepoInfo> {
        let inner = self.inner.lock().unwrap();
        inner
            .projects
            .values()
            .flat_map(|p| p.info.repos.iter())
            .filter(|r| path.starts_with(&r.root))
            .max_by_key(|r| r.root.as_os_str().len())
            .cloned()
    }

    /// Puts the tab in place (in-memory, microseconds), starts watching, and schedules the scan.
    fn insert_at(self: &Arc<Self>, stored: StoredProject, append: bool) {
        let (info, generation, epoch) = self.insert_record(stored, append);
        self.emit_list();
        if !info.missing {
            self.schedule_scan(info.id, generation, epoch);
        }
    }

    fn insert_record(self: &Arc<Self>, stored: StoredProject, append: bool) -> (ProjectInfo, Arc<AtomicU64>, u64) {
        let root = stored.root.clone();
        let missing = !root.is_dir();
        let info = ProjectInfo {
            id: root.clone(),
            name: root
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| root.display().to_string()),
            missing,
            dirty: false,
            scanning: !missing,
            scan_truncated: false,
            repos: Vec::new(),
            parent_candidate: None,
        };
        let (generation, epoch) = {
            let mut inner = self.inner.lock().unwrap();
            if append && !inner.order.contains(&root) {
                inner.order.push(root.clone());
            }
            let generation = match inner.projects.get(&root) {
                Some(existing) => Arc::clone(&existing.generation),
                None => Arc::new(AtomicU64::new(0)),
            };
            let epoch = generation.fetch_add(1, Ordering::SeqCst) + 1;
            inner
                .projects
                .insert(root.clone(), Project { stored, info: info.clone(), generation: Arc::clone(&generation) });
            (generation, epoch)
        };
        self.ensure_watcher(&root, missing);
        (info, generation, epoch)
    }

    fn save(&self) {
        let inner = self.inner.lock().unwrap();
        let stored: Vec<&StoredProject> =
            inner.order.iter().filter_map(|id| inner.projects.get(id)).map(|p| &p.stored).collect();
        let value = serde_json::to_value(stored).unwrap_or_default();
        let active = serde_json::to_value(&inner.active).unwrap_or_default();
        drop(inner);
        self.ui.set("projects", value);
        self.ui.set("activeProject", active);
    }

    fn emit_list(&self) {
        let (list, active) = {
            let inner = self.inner.lock().unwrap();
            let list: Vec<ProjectInfo> =
                inner.order.iter().filter_map(|id| inner.projects.get(id)).map(|p| p.info.clone()).collect();
            (list, inner.active.clone())
        };
        self.events.projects_changed(list, active);
    }

    // ------------------------------------------------------------------ scanning

    fn schedule_scan(self: &Arc<Self>, id: PathBuf, generation: Arc<AtomicU64>, epoch: u64) {
        let this = Arc::clone(self);
        let slots = Arc::clone(&self.slots);
        tauri::async_runtime::spawn(async move {
            let Ok(permit) = slots.acquire_owned().await else {
                return;
            };
            let _ = tauri::async_runtime::spawn_blocking(move || {
                let _permit = permit;
                this.run_scan(&id, &generation, epoch);
            })
            .await;
        });
    }

    fn run_scan(self: &Arc<Self>, id: &Path, generation: &AtomicU64, epoch: u64) {
        let stored = {
            let inner = self.inner.lock().unwrap();
            match inner.projects.get(id) {
                Some(project) if generation.load(Ordering::SeqCst) == epoch => project.stored.clone(),
                _ => return,
            }
        };
        let cfg = ScanConfig::from_settings(&self.settings);
        let cancelled = || generation.load(Ordering::SeqCst) != epoch;
        let mut partial = |repos: &[RepoInfo], parent: Option<&Path>| {
            self.merge(id, generation, epoch, repos.to_vec(), parent.map(Path::to_path_buf), false, true);
        };
        if let Some(result) = scan_project(&stored.root, stored.parent.as_ref(), &cfg, &cancelled, &mut partial) {
            self.merge(id, generation, epoch, result.repos, result.parent_candidate, result.truncated, false);
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn merge(
        &self,
        id: &Path,
        generation: &AtomicU64,
        epoch: u64,
        repos: Vec<RepoInfo>,
        parent_candidate: Option<PathBuf>,
        truncated: bool,
        scanning: bool,
    ) {
        let outside = {
            let mut inner = self.inner.lock().unwrap();
            if generation.load(Ordering::SeqCst) != epoch {
                return;
            }
            let Some(project) = inner.projects.get_mut(id) else {
                return;
            };
            project.info.repos = repos;
            project.info.parent_candidate = parent_candidate;
            project.info.scan_truncated = truncated;
            project.info.scanning = scanning;
            outside_git_dirs(id, &project.info.repos)
        };
        self.update_watch_roots(id, outside);
        self.emit_list();
    }

    // ------------------------------------------------------------------ watching

    fn ensure_watcher(self: &Arc<Self>, id: &Path, missing: bool) {
        let mut watchers = self.watchers.lock().unwrap();
        if watchers.get(id).is_some_and(|w| w.missing == missing) {
            return;
        }
        watchers.remove(id);
        let batches = self.batches.clone();
        let project = id.to_path_buf();
        let Some(mut debouncer) = watcher(move |paths, need_rescan| {
            let _ = batches.send(Batch { project: project.clone(), paths, need_rescan });
        }) else {
            return;
        };
        let watched = if missing {
            // Watch the nearest existing ancestor so the tab recovers when the folder returns
            match id.ancestors().skip(1).find(|p| p.is_dir()) {
                Some(ancestor) => debouncer.watch(ancestor, RecursiveMode::NonRecursive).is_ok(),
                None => false,
            }
        } else {
            debouncer.watch(id, RecursiveMode::Recursive).is_ok()
        };
        if watched {
            watchers.insert(id.to_path_buf(), ProjectWatcher { debouncer, outside: HashSet::new(), missing });
        }
    }

    /// Adds and drops the git directories outside the project folder. The folder's own watch is
    /// registered once and never rebuilt: rebuilding it was the 45-60 s stall behind every rescan.
    fn update_watch_roots(&self, id: &Path, wanted: HashSet<PathBuf>) {
        let mut watchers = self.watchers.lock().unwrap();
        let Some(entry) = watchers.get_mut(id) else {
            return;
        };
        let added: Vec<PathBuf> = wanted.difference(&entry.outside).cloned().collect();
        let removed: Vec<PathBuf> = entry.outside.difference(&wanted).cloned().collect();
        for path in added {
            let _ = entry.debouncer.watch(&path, RecursiveMode::Recursive);
        }
        for path in removed {
            let _ = entry.debouncer.unwatch(&path);
        }
        entry.outside = wanted;
    }

    fn snapshot(&self, id: &Path) -> Option<(bool, Vec<RepoInfo>, bool)> {
        let inner = self.inner.lock().unwrap();
        let project = inner.projects.get(id)?;
        Some((project.info.missing, project.info.repos.clone(), inner.active.as_deref() == Some(id)))
    }

    fn handle_batch(self: &Arc<Self>, batch: Batch, pending: &mut Pending) {
        let Some((missing, repos, _)) = self.snapshot(&batch.project) else {
            return;
        };
        if missing {
            if batch.project.is_dir() {
                let _ = self.rescan(&batch.project);
            }
            return;
        }
        if !batch.project.is_dir() {
            let _ = self.rescan(&batch.project);
            return;
        }

        let detect = self.settings.get("git.autoRepositoryDetection").as_bool() != Some(false);
        let mut changed: HashSet<PathBuf> = HashSet::new();
        let mut worktree: HashMap<PathBuf, Vec<PathBuf>> = HashMap::new();
        let mut submodules: HashSet<PathBuf> = HashSet::new();
        if batch.need_rescan {
            changed.extend(repos.iter().map(|r| r.root.clone()));
        }
        for path in batch.paths {
            if invalidates_excludes(&path)
                && let Some(repo) = owning_repo(&repos, &path)
            {
                pending.excludes.remove(&repo.root);
            }
            match classify(&repos, &path, detect) {
                Change::Ignore => {}
                Change::GitDir(root) => {
                    changed.insert(root);
                }
                Change::Worktree(root) => worktree.entry(root).or_default().push(path),
                Change::Candidate(dir) => {
                    if dir.starts_with(&batch.project) {
                        pending.candidates.insert(dir, batch.project.clone());
                        pending.candidate_at.get_or_insert_with(|| Instant::now() + CANDIDATE_DEBOUNCE);
                    }
                }
                // `.gitmodules` is a tracked file at the repository root, so it is both a
                // submodule list to re-read and an ordinary worktree change to show
                Change::Submodules(root) => {
                    submodules.insert(root.clone());
                    worktree.entry(root).or_default().push(path);
                }
            }
        }
        for (root, paths) in worktree {
            if changed.contains(&root) {
                continue;
            }
            let Some(repo) = repos.iter().find(|r| r.root == root) else {
                continue;
            };
            if pending.relevant(repo, &paths) {
                changed.insert(root);
            }
        }
        for root in submodules {
            self.rescan_submodules(&batch.project, &root);
        }
        // VS Code stops re-reading when `git.autorefresh` is off or the repository is huge
        if !self.settings.get("git.autorefresh").as_bool().unwrap_or(true) {
            return;
        }
        for root in changed {
            if self.huge.contains(&root) || self.writes.is_writing(&root) {
                continue;
            }
            pending.emit.insert(root, batch.project.clone());
        }
    }

    fn flush_pending(self: &Arc<Self>, pending: &mut Pending) {
        let now = Instant::now();
        if pending.candidate_at.is_some_and(|at| at <= now) {
            pending.candidate_at = None;
            for (dir, project) in std::mem::take(&mut pending.candidates) {
                self.resolve_candidate(&project, &dir);
            }
        }
        let due: Vec<(PathBuf, PathBuf)> = pending
            .emit
            .iter()
            .filter(|(root, _)| pending.last_emit.get(*root).is_none_or(|t| now.duration_since(*t) >= REFRESH_FLOOR))
            .map(|(root, project)| (root.clone(), project.clone()))
            .collect();
        for (root, project) in due {
            pending.emit.remove(&root);
            pending.last_emit.insert(root.clone(), now);
            self.notify_changed(&project, &root);
        }
        pending.prune(now);
    }

    fn notify_changed(&self, project: &Path, root: &Path) {
        let mut inner = self.inner.lock().unwrap();
        if inner.active.as_deref() == Some(project) {
            drop(inner);
            self.events.repo_changed(root);
            return;
        }
        let Some(entry) = inner.projects.get_mut(project) else {
            return;
        };
        if entry.info.dirty {
            return;
        }
        entry.info.dirty = true;
        drop(inner);
        self.emit_list();
    }

    /// VS Code's `onPossibleGitRepositoryChange`: one folder where a `.git` appeared or went
    /// away, opened (or dropped) on its own. No re-detection of the project.
    fn resolve_candidate(self: &Arc<Self>, project: &Path, dir: &Path) {
        let Some((missing, repos, _)) = self.snapshot(project) else {
            return;
        };
        if missing {
            return;
        }
        let canonical = fs::canonicalize(dir).unwrap_or_else(|_| dir.to_path_buf());
        let known = repos.iter().any(|r| r.root == canonical);
        let opened = open_repo(dir);
        if known == opened.is_some() {
            return;
        }
        let added = match opened {
            Some(repo) => {
                let kind = if canonical == project { RepoKind::Root } else { RepoKind::Nested };
                let Some(info) = repo_info(&repo, kind) else {
                    return;
                };
                self.update_repos(project, |repos| {
                    if repos.iter().any(|r| r.root == info.root) {
                        return false;
                    }
                    repos.push(info.clone());
                    true
                });
                Some(canonical)
            }
            None => {
                // The project folder's own repository went away. Dropping its subtree would
                // drop the whole tab, and its submodules died with it, so re-detect instead:
                // this is the one case where a scan is cheaper than being wrong.
                if canonical == project {
                    let _ = self.rescan(project);
                    return;
                }
                self.update_repos(project, |repos| {
                    let before = repos.len();
                    repos.retain(|r| r.root != canonical && !r.root.starts_with(&canonical));
                    repos.len() != before
                });
                None
            }
        };
        if let Some(root) = added {
            self.rescan_submodules(project, &root);
        }
    }

    /// Re-reads one repository's submodules (its `.gitmodules` changed, or it just appeared).
    fn rescan_submodules(self: &Arc<Self>, project: &Path, root: &Path) {
        if !self.settings.get("git.detectSubmodules").as_bool().unwrap_or(true) {
            return;
        }
        let limit = self.settings.get("git.detectSubmodulesLimit").as_u64().unwrap_or(10) as usize;
        let Some(repo) = open_repo(root) else {
            return;
        };
        let mut found = Vec::new();
        if let Ok(Some(submodules)) = repo.submodules() {
            for submodule in submodules.take(limit) {
                if let Ok(Some(sub)) = submodule.open()
                    && let Some(info) = repo_info(&sub, RepoKind::Submodule)
                {
                    found.push(info);
                }
            }
        }
        let root = root.to_path_buf();
        self.update_repos(project, move |repos| {
            let keep: HashSet<&PathBuf> = found.iter().map(|r| &r.root).collect();
            let before = repos.len();
            repos.retain(|r| r.kind != RepoKind::Submodule || !r.root.starts_with(&root) || keep.contains(&r.root));
            let mut changed = repos.len() != before;
            for info in &found {
                if !repos.iter().any(|r| r.root == info.root) {
                    repos.push(info.clone());
                    changed = true;
                }
            }
            changed
        });
    }

    /// Edits one project's repository list in place, then re-points the watcher and the windows.
    fn update_repos(&self, project: &Path, edit: impl FnOnce(&mut Vec<RepoInfo>) -> bool) {
        let outside = {
            let mut inner = self.inner.lock().unwrap();
            let Some(entry) = inner.projects.get_mut(project) else {
                return;
            };
            if !edit(&mut entry.info.repos) {
                return;
            }
            outside_git_dirs(project, &entry.info.repos)
        };
        self.update_watch_roots(project, outside);
        self.emit_list();
    }
}

/// Repositories waiting on the watcher worker.
#[derive(Default)]
struct Pending {
    /// Repository root -> project id, waiting for its once-a-second slot
    emit: HashMap<PathBuf, PathBuf>,
    last_emit: HashMap<PathBuf, Instant>,
    /// Folder -> project id, waiting out `CANDIDATE_DEBOUNCE`
    candidates: HashMap<PathBuf, PathBuf>,
    candidate_at: Option<Instant>,
    /// One open repository and exclude stack per repository, so a batch costs no file reads
    excludes: HashMap<PathBuf, Excludes>,
}

impl Pending {
    fn relevant(&mut self, repo: &RepoInfo, paths: &[PathBuf]) -> bool {
        self.excludes.entry(repo.root.clone()).or_insert_with(|| Excludes::open(&repo.root)).any_relevant(paths)
    }

    fn next_deadline(&self, now: Instant) -> Option<Instant> {
        let emits = self
            .emit
            .keys()
            .map(|root| match self.last_emit.get(root) {
                Some(last) => *last + REFRESH_FLOOR,
                None => now,
            })
            .min();
        [self.candidate_at, emits].into_iter().flatten().min()
    }

    fn prune(&mut self, now: Instant) {
        if self.last_emit.len() > 64 {
            self.last_emit.retain(|_, at| now.duration_since(*at) < REFRESH_FLOOR);
        }
        // Closed projects leave their repositories behind; the cache is a convenience, not state
        if self.excludes.len() > 64 {
            self.excludes.clear();
        }
    }
}

/// The watcher's own thread: classification, gitignore filtering and repository discovery all
/// happen here, never on the FSEvents callback and never on the main thread.
fn watch_worker(projects: Weak<Projects>, batches: mpsc::Receiver<Batch>) {
    let mut pending = Pending::default();
    loop {
        let now = Instant::now();
        let message = match pending.next_deadline(now) {
            Some(at) => batches.recv_timeout(at.saturating_duration_since(now)),
            // Nothing is due: block instead of polling (SPEC 성능 규칙)
            None => batches.recv().map_err(|_| mpsc::RecvTimeoutError::Disconnected),
        };
        match message {
            Ok(batch) => {
                let Some(projects) = projects.upgrade() else {
                    return;
                };
                projects.handle_batch(batch, &mut pending);
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => return,
        }
        let Some(projects) = projects.upgrade() else {
            return;
        };
        projects.flush_pending(&mut pending);
    }
}

/// A debounced FSEvents watcher with no file-id cache.
///
/// `notify_debouncer_full`'s default cache on macOS is a `FileIdMap`, which walks the whole tree
/// and `stat`s every entry when a root is added: 45 s and 372 MB for `~/code`, where the OS
/// registers the watch in 3 ms. Only rename From/To pairing needs it, and nothing here reads
/// anything but `event.paths`. `NoCache` is the recommended cache on Linux already.
pub fn watcher(
    mut handler: impl FnMut(Vec<PathBuf>, bool) + Send + 'static,
) -> Option<Debouncer<notify::RecommendedWatcher, NoCache>> {
    new_debouncer_opt::<_, notify::RecommendedWatcher, NoCache>(
        WATCH_DEBOUNCE,
        None,
        move |result: DebounceEventResult| {
            let Ok(events) = result else {
                return;
            };
            let need_rescan = events.iter().any(|e| e.event.need_rescan());
            let paths: Vec<PathBuf> = events.into_iter().flat_map(|e| e.event.paths).collect();
            handler(paths, need_rescan);
        },
        NoCache::new(),
        notify::Config::default(),
    )
    .ok()
}

/// What one watched path means for a project.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Change {
    /// Nothing the panel shows can depend on it
    Ignore,
    /// Inside a repository's git directory: always worth a re-read
    GitDir(PathBuf),
    /// A file in a repository's worktree; `.gitignore` still decides
    Worktree(PathBuf),
    /// A `.git` appeared or vanished in this folder: open it, or drop the repository
    Candidate(PathBuf),
    /// This repository's `.gitmodules` changed
    Submodules(PathBuf),
}

/// Classifies one path against the repositories a project already knows. This is VS Code's
/// filter set (repository.ts): `.git/objects`, `.git/subtree-cache`, lock files and watchman
/// cookies are dropped, a new `.git` is a candidate folder, everything else belongs to a
/// repository. Nothing here re-detects the project.
pub fn classify(repos: &[RepoInfo], path: &Path, detect: bool) -> Change {
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    if name.starts_with(".watchman-cookie-") {
        return Change::Ignore;
    }
    let owner = owning_repo(repos, path);
    let in_git_dir = owner.is_some_and(|r| path.starts_with(&r.git_dir) || path.starts_with(&r.common_dir))
        || path.components().any(|c| c.as_os_str() == ".git");
    if in_git_dir
        && (name.ends_with(".lock")
            || path.components().any(|c| c.as_os_str() == "objects" || c.as_os_str() == "subtree-cache"))
    {
        return Change::Ignore;
    }
    if name == ".gitmodules" {
        return match owner {
            Some(repo) if path.parent() == Some(repo.root.as_path()) => Change::Submodules(repo.root.clone()),
            _ => Change::Ignore,
        };
    }
    if name == ".git" {
        return match path.parent() {
            Some(parent) if detect => Change::Candidate(parent.to_path_buf()),
            _ => Change::Ignore,
        };
    }
    match owner {
        Some(repo) if in_git_dir => Change::GitDir(repo.root.clone()),
        Some(repo) => Change::Worktree(repo.root.clone()),
        None => Change::Ignore,
    }
}

/// Whether a path changes what `.gitignore` says, so the cached exclude stack must go.
fn invalidates_excludes(path: &Path) -> bool {
    let Some(name) = path.file_name() else {
        return false;
    };
    name == ".gitignore" || name == "exclude" || name == "index"
}

/// One repository's exclude stack, kept open between batches. Reopening the repository and its
/// index per batch cost 18 ms for every batch of every repository.
pub struct Excludes {
    root: PathBuf,
    repo: Option<gix::Repository>,
    stack: Option<gix::worktree::Stack>,
}

impl Excludes {
    pub fn open(root: &Path) -> Self {
        let repo = open_repo(root);
        let stack = repo.as_ref().and_then(|repo| {
            let index = repo.index_or_empty().ok()?;
            let stack = repo
                .excludes(&index, None, gix::worktree::stack::state::ignore::Source::WorktreeThenIdMappingIfNotSkipped)
                .ok()?;
            Some(stack.detach())
        });
        Self { root: root.to_path_buf(), repo, stack }
    }

    /// Whether any changed path can change what the panel shows.
    /// `.gitignore`d paths never show in status, so their churn (build output) is dropped here.
    /// A file under an ignored directory can never be re-included, so one test per directory
    /// answers for all of its files -- that is what keeps a `node_modules` storm cheap.
    pub fn any_relevant(&mut self, paths: &[PathBuf]) -> bool {
        let (Some(repo), Some(stack)) = (&self.repo, &mut self.stack) else {
            return true;
        };
        let mut ignored_dirs: HashSet<&Path> = HashSet::new();
        for path in paths {
            let Ok(rel) = path.strip_prefix(&self.root) else {
                continue;
            };
            let dir = rel.parent().unwrap_or(Path::new(""));
            if !dir.as_os_str().is_empty() {
                if ignored_dirs.contains(dir) {
                    continue;
                }
                let excluded = stack
                    .at_path(dir, Some(gix::index::entry::Mode::DIR), &repo.objects)
                    .map(|p| p.is_excluded())
                    .unwrap_or(false);
                if excluded {
                    ignored_dirs.insert(dir);
                    continue;
                }
            }
            let mode = if path.is_dir() { gix::index::entry::Mode::DIR } else { gix::index::entry::Mode::FILE };
            let excluded = stack.at_path(rel, Some(mode), &repo.objects).map(|p| p.is_excluded()).unwrap_or(false);
            if !excluded {
                return true;
            }
        }
        false
    }
}

/// VS Code's detection: the folder itself, its parent (per `git.openRepositoryInParentFolders`),
/// subfolders to `git.repositoryScanMaxDepth`, and submodules up to `git.detectSubmodulesLimit`.
///
/// `found` receives the list so far as it grows, so the panel fills in while the scan runs.
/// Returns `None` when `cancelled` fired: a newer scan took over.
pub fn scan_project(
    root: &Path,
    parent: Option<&ParentAnswer>,
    cfg: &ScanConfig,
    cancelled: &dyn Fn() -> bool,
    found: &mut dyn FnMut(&[RepoInfo], Option<&Path>),
) -> Option<ScanResult> {
    let mut repos: Vec<RepoInfo> = Vec::new();
    let mut roots: HashSet<PathBuf> = HashSet::new();
    let mut handles: Vec<(PathBuf, gix::Repository)> = Vec::new();
    let mut parent_candidate: Option<PathBuf> = None;

    if let Some(repo) = open_repo(root) {
        add_repo(&mut repos, &mut roots, &mut handles, repo, RepoKind::Root);
    } else if let Some(above) = root.parent().and_then(discover_repo) {
        let above_root = above.workdir().map(Path::to_path_buf);
        match (parent, cfg.parent.as_str()) {
            (Some(ParentAnswer::Accepted { .. }), _) | (None, "always") => {
                add_repo(&mut repos, &mut roots, &mut handles, above, RepoKind::Root);
            }
            (Some(ParentAnswer::Declined), _) | (None, "never") => {}
            (None, _) => parent_candidate = above_root,
        }
    }
    found(&repos, parent_candidate.as_deref());
    if cancelled() {
        return None;
    }

    let mut truncated = false;
    let mut visited = 0usize;
    if cfg.subfolders {
        let deadline = Instant::now() + SCAN_TIME_BUDGET;
        let max_depth = if cfg.max_depth < 0 { usize::MAX } else { cfg.max_depth.max(0) as usize };
        let mut queue: VecDeque<(PathBuf, usize)> = VecDeque::from([(root.to_path_buf(), 0usize)]);
        let mut since_emit = 0usize;
        let mut last_emit = Instant::now();
        while let Some((dir, depth)) = queue.pop_front() {
            if depth >= max_depth {
                continue;
            }
            if cancelled() {
                return None;
            }
            if visited >= SCAN_DIR_BUDGET || Instant::now() >= deadline {
                truncated = true;
                log::warn!("stopped scanning {} after {visited} directories", root.display());
                break;
            }
            visited += 1;
            let Ok(entries) = fs::read_dir(&dir) else {
                continue;
            };
            for entry in entries.flatten() {
                if !entry.file_type().map(|k| k.is_dir()).unwrap_or(false) {
                    continue;
                }
                let name = entry.file_name();
                let name = name.to_string_lossy();
                if name == ".git" || cfg.ignored.contains(&name.to_lowercase()) {
                    continue;
                }
                let path = entry.path();
                if !roots.contains(&path)
                    && let Some(repo) = open_repo(&path)
                    && add_repo(&mut repos, &mut roots, &mut handles, repo, RepoKind::Nested)
                {
                    since_emit += 1;
                }
                queue.push_back((path, depth + 1));
            }
            if since_emit >= SCAN_EMIT_EVERY || (since_emit > 0 && last_emit.elapsed() >= SCAN_EMIT_INTERVAL) {
                found(&repos, parent_candidate.as_deref());
                since_emit = 0;
                last_emit = Instant::now();
            }
        }
        if since_emit > 0 {
            found(&repos, parent_candidate.as_deref());
        }
    }

    if cfg.submodules {
        // The handles are the ones the scan already opened; opening every repository a second
        // time cost 10.8 ms of the 67 ms submodule pass on `~/code`
        let mut subs = Vec::new();
        for (_, handle) in &handles {
            if cancelled() {
                return None;
            }
            let Ok(Some(submodules)) = handle.submodules() else {
                continue;
            };
            for submodule in submodules.take(cfg.submodule_limit) {
                if let Ok(Some(sub)) = submodule.open() {
                    subs.push(sub);
                }
            }
        }
        for sub in subs {
            add_repo(&mut repos, &mut roots, &mut handles, sub, RepoKind::Submodule);
        }
    }

    Some(ScanResult { repos, parent_candidate, truncated, visited })
}

fn add_repo(
    repos: &mut Vec<RepoInfo>,
    roots: &mut HashSet<PathBuf>,
    handles: &mut Vec<(PathBuf, gix::Repository)>,
    repo: gix::Repository,
    kind: RepoKind,
) -> bool {
    let Some(info) = repo_info(&repo, kind) else {
        return false;
    };
    if !roots.insert(info.root.clone()) {
        return false;
    }
    handles.push((info.root.clone(), repo));
    repos.push(info);
    true
}

fn outside_git_dirs(id: &Path, repos: &[RepoInfo]) -> HashSet<PathBuf> {
    repos.iter().flat_map(|r| [r.git_dir.clone(), r.common_dir.clone()]).filter(|dir| !dir.starts_with(id)).collect()
}

fn open_repo(path: &Path) -> Option<gix::Repository> {
    if !path.join(".git").exists() {
        return None;
    }
    gix::open(path).ok().filter(|r| r.workdir().is_some())
}

fn discover_repo(path: &Path) -> Option<gix::Repository> {
    gix::discover(path).ok().filter(|r| r.workdir().is_some())
}

fn repo_info(repo: &gix::Repository, kind: RepoKind) -> Option<RepoInfo> {
    // A bare repository (a gitdir-only submodule) has nothing to show
    let root = repo.workdir()?.to_path_buf();
    let root = fs::canonicalize(&root).unwrap_or(root);
    Some(RepoInfo {
        name: root.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
        git_dir: repo.git_dir().to_path_buf(),
        common_dir: repo.common_dir().to_path_buf(),
        kind,
        root,
    })
}

fn owning_repo<'a>(repos: &'a [RepoInfo], path: &Path) -> Option<&'a RepoInfo> {
    repos
        .iter()
        .filter(|r| path.starts_with(&r.root) || path.starts_with(&r.git_dir) || path.starts_with(&r.common_dir))
        .max_by_key(|r| r.root.as_os_str().len())
}

pub fn app_support_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .home_dir()
        .map(|h| h.join("Library/Application Support/gitmenu"))
        .unwrap_or_else(|_| PathBuf::from("/tmp/gitmenu"))
}

#[cfg(test)]
mod tests {
    use std::{
        process::Command,
        sync::atomic::AtomicBool,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::*;

    fn tempdir(name: &str) -> PathBuf {
        let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("gitmenu-project-{name}-{}-{stamp}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::canonicalize(&dir).unwrap()
    }

    fn git_init(dir: &Path) {
        fs::create_dir_all(dir).unwrap();
        let status = Command::new("git").current_dir(dir).args(["init", "-q"]).status().unwrap();
        assert!(status.success());
    }

    /// A tree with `files` files spread over `dirs` directories, plus `repos` repositories.
    fn big_tree(dir: &Path, dirs: usize, files: usize, repos: usize) {
        for d in 0..dirs {
            let sub = dir.join(format!("pkg{d}"));
            fs::create_dir_all(&sub).unwrap();
            for f in 0..files {
                fs::write(sub.join(format!("f{f}.txt")), "x").unwrap();
            }
        }
        for r in 0..repos {
            git_init(&dir.join(format!("repo{r}")));
        }
    }

    #[derive(Default)]
    struct Recorder {
        lists: Mutex<Vec<(Vec<ProjectInfo>, Option<PathBuf>)>>,
        repos: Mutex<Vec<PathBuf>>,
    }

    impl ProjectEvents for Arc<Recorder> {
        fn projects_changed(&self, projects: Vec<ProjectInfo>, active: Option<PathBuf>) {
            self.lists.lock().unwrap().push((projects, active));
        }

        fn repo_changed(&self, root: &Path) {
            self.repos.lock().unwrap().push(root.to_path_buf());
        }
    }

    struct NoWrites;

    impl Writes for NoWrites {
        fn is_writing(&self, _worktree: &Path) -> bool {
            false
        }
    }

    fn projects(name: &str) -> (Arc<Projects>, Arc<Recorder>, PathBuf) {
        let support = tempdir(&format!("{name}-support"));
        let settings = Settings::load(support.clone()).unwrap();
        let ui = UiState::load(&support);
        let recorder = Arc::new(Recorder::default());
        let projects = Projects::new(
            Arc::new(Arc::clone(&recorder)),
            settings,
            ui,
            Arc::new(NoWrites),
            Arc::new(HugeRepos::default()),
        );
        (projects, recorder, support)
    }

    fn wait_for(mut done: impl FnMut() -> bool) -> bool {
        for _ in 0..600 {
            if done() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        false
    }

    /// The reported freeze: registering the watch used to walk and `stat` every file below the
    /// folder (60.2 s for `~/code`). It must not depend on how much is in the folder.
    #[test]
    fn watch_registration_is_constant_time() {
        let dir = tempdir("watch-const");
        big_tree(&dir, 40, 500, 0);
        let mut debouncer = watcher(|_, _| {}).expect("watcher");
        let start = Instant::now();
        debouncer.watch(&dir, RecursiveMode::Recursive).unwrap();
        let elapsed = start.elapsed();
        assert!(elapsed < Duration::from_millis(250), "watch registration took {elapsed:?}");
        let _ = fs::remove_dir_all(&dir);
    }

    /// Opening a folder must return before its repositories are known. The budget is loose
    /// on purpose: what it catches is the open path walking the folder again, which took
    /// seconds on this tree and 60 s on `~/code`.
    #[test]
    fn open_returns_before_the_scan_finishes() {
        let dir = tempdir("open-fast");
        big_tree(&dir, 40, 400, 6);
        let (projects, _events, _support) = projects("open-fast");
        let start = Instant::now();
        let info = projects.open(dir.clone()).unwrap();
        let elapsed = start.elapsed();
        assert!(elapsed < Duration::from_millis(500), "project_open took {elapsed:?}");
        assert!(info.scanning, "the tab claimed to be done before the scan ran");
        assert!(info.repos.is_empty(), "the scan ran on the caller's thread");
        assert!(wait_for(|| projects.info(&dir).is_ok_and(|i| !i.scanning)), "scan never finished");
        let done = projects.info(&dir).unwrap();
        assert_eq!(done.repos.len(), 6);
        assert!(!done.scan_truncated);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn classify_drops_noise_and_never_asks_for_a_rescan() {
        let root = PathBuf::from("/w/repo");
        let repos = vec![RepoInfo {
            root: root.clone(),
            git_dir: root.join(".git"),
            common_dir: root.join(".git"),
            kind: RepoKind::Root,
            name: "repo".into(),
        }];
        let cases: [(PathBuf, Change); 9] = [
            (root.join(".git/objects/ab/cdef"), Change::Ignore),
            (root.join(".git/subtree-cache/x"), Change::Ignore),
            (root.join(".git/index.lock"), Change::Ignore),
            (root.join(".git/worktrees/x/index.lock"), Change::Ignore),
            (root.join(".watchman-cookie-host-1"), Change::Ignore),
            (root.join(".git/HEAD"), Change::GitDir(root.clone())),
            (root.join("src/main.rs"), Change::Worktree(root.clone())),
            (PathBuf::from("/w/repo/nested/.git"), Change::Candidate(root.join("nested"))),
            (root.join(".gitmodules"), Change::Submodules(root.clone())),
        ];
        for (path, expected) in cases {
            assert_eq!(classify(&repos, &path, true), expected, "{}", path.display());
        }
        // `git.autoRepositoryDetection: false` stops discovery, it does not start a rescan
        assert_eq!(classify(&repos, &PathBuf::from("/w/repo/nested/.git"), false), Change::Ignore);
        // Nothing outside the known repositories belongs to the project
        assert_eq!(classify(&repos, &PathBuf::from("/elsewhere/file"), true), Change::Ignore);
    }

    /// `git init` in a subfolder adds one repository without re-detecting the project and
    /// without rebuilding the watcher.
    #[test]
    fn new_repository_appears_without_rescanning() {
        let dir = tempdir("candidate");
        git_init(&dir);
        let (projects, _events, _support) = projects("candidate");
        projects.open(dir.clone()).unwrap();
        assert!(wait_for(|| projects.info(&dir).is_ok_and(|i| !i.scanning)));
        let generation = {
            let inner = projects.inner.lock().unwrap();
            inner.projects[&dir].generation.load(Ordering::SeqCst)
        };
        git_init(&dir.join("child"));
        assert!(wait_for(|| projects.info(&dir).is_ok_and(|i| i.repos.len() == 2)), "child repository not found");
        let info = projects.info(&dir).unwrap();
        assert!(!info.scanning, "the project was re-detected instead of adding one repository");
        assert_eq!(
            projects.inner.lock().unwrap().projects[&dir].generation.load(Ordering::SeqCst),
            generation,
            "a rescan was started"
        );
        // The repository going away drops it again, still without a rescan
        fs::remove_dir_all(dir.join("child/.git")).unwrap();
        assert!(wait_for(|| projects.info(&dir).is_ok_and(|i| i.repos.len() == 1)), "repository not dropped");
        let _ = fs::remove_dir_all(&dir);
    }

    /// The project folder's own `.git` going away must not take the rest of the tab with it.
    ///
    /// Skipped on CI: on GitHub's macOS 26 runners the removal events never reach the watcher
    /// (they do on every machine tried, also under CPU load), so the wait times out. Left
    /// failing open on purpose: if this ever breaks for real, repositories would linger after
    /// their `.git` is deleted.
    #[test]
    fn losing_the_project_repository_keeps_the_others() {
        if std::env::var_os("CI").is_some() {
            return;
        }
        let dir = tempdir("root-gone");
        git_init(&dir);
        git_init(&dir.join("child"));
        let (projects, _events, _support) = projects("root-gone");
        projects.open(dir.clone()).unwrap();
        assert!(
            wait_for(|| projects.info(&dir).is_ok_and(|i| !i.scanning && i.repos.len() == 2)),
            "scan never finished"
        );
        fs::remove_dir_all(dir.join(".git")).unwrap();
        assert!(
            wait_for(|| projects
                .info(&dir)
                .is_ok_and(|i| !i.scanning && i.repos.len() == 1 && i.repos[0].root == dir.join("child"))),
            "the nested repository went away with the project's own"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    /// `.gitmodules` is a tracked worktree file: editing it re-reads the repository, not only
    /// its submodule list.
    #[test]
    fn editing_gitmodules_re_reads_the_repository() {
        let dir = tempdir("gitmodules");
        git_init(&dir);
        let (projects, events, _support) = projects("gitmodules");
        projects.open(dir.clone()).unwrap();
        assert!(wait_for(|| projects.info(&dir).is_ok_and(|i| !i.scanning)));
        events.repos.lock().unwrap().clear();
        fs::write(dir.join(".gitmodules"), "[submodule \"x\"]\n\tpath = x\n\turl = ../x\n").unwrap();
        assert!(
            wait_for(|| events.repos.lock().unwrap().iter().any(|r| r == &dir)),
            "the panel was never told the repository changed"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    /// `git.init` must not write where a repository already is. The tab is published before
    /// its scan runs, so the repository list cannot answer that.
    #[test]
    fn init_is_refused_where_a_repository_already_is() {
        let dir = tempdir("has-repo");
        git_init(&dir);
        let inside = dir.join("plain");
        fs::create_dir_all(&inside).unwrap();
        let (projects, _events, _support) = projects("has-repo");
        let info = projects.open(dir.clone()).unwrap();
        assert!(info.repos.is_empty(), "the scan ran on the caller's thread");
        assert!(projects.has_repo(&dir), "the folder's own repository was missed before the scan");
        // A folder inside a repository only counts when the tab opens that parent
        assert!(!projects.has_repo(&inside));
        projects.settings.set("git.openRepositoryInParentFolders", Value::String("always".into())).unwrap();
        assert!(projects.has_repo(&inside), "`always` opens the parent, so initializing here would nest inside it");
        let _ = fs::remove_dir_all(&dir);
    }

    /// `"openEditors"` opens the folder's own repository but never walks subfolders (model.ts),
    /// and ignored folder names are compared the way macOS compares paths.
    #[test]
    fn scan_config_follows_the_detection_settings() {
        let support = tempdir("scan-config");
        let settings = Settings::load(support.clone()).unwrap();
        settings.set("git.autoRepositoryDetection", Value::String("openEditors".into())).unwrap();
        settings.set("git.repositoryScanIgnoredFolders", serde_json::json!(["Node_Modules"])).unwrap();
        let cfg = ScanConfig::from_settings(&settings);
        assert!(cfg.detect, "openEditors still opens the folder's own repository");
        assert!(!cfg.subfolders, "openEditors walked the subfolders anyway");
        assert!(cfg.ignored.contains("node_modules"), "ignored folders are matched case-insensitively");
        settings.set("git.autoRepositoryDetection", Value::Bool(true)).unwrap();
        assert!(ScanConfig::from_settings(&settings).subfolders);
        settings.set("git.autoRepositoryDetection", Value::String("subFolders".into())).unwrap();
        assert!(ScanConfig::from_settings(&settings).subfolders);
        let _ = fs::remove_dir_all(&support);
    }

    #[test]
    fn scan_respects_depth_and_ignored_folders() {
        let dir = tempdir("depth");
        git_init(&dir.join("a"));
        git_init(&dir.join("b/deep"));
        git_init(&dir.join("node_modules/pkg"));
        let mut cfg = ScanConfig::default();
        let never = || false;
        let mut ignore = |_: &[RepoInfo], _: Option<&Path>| {};

        let shallow = scan_project(&dir, None, &cfg, &never, &mut ignore).unwrap();
        let names: HashSet<String> = shallow.repos.iter().map(|r| r.name.clone()).collect();
        assert_eq!(names, ["a".to_owned()].into_iter().collect::<HashSet<_>>());

        cfg.max_depth = 2;
        let deeper = scan_project(&dir, None, &cfg, &never, &mut ignore).unwrap();
        let names: HashSet<String> = deeper.repos.iter().map(|r| r.name.clone()).collect();
        assert_eq!(names, ["a".to_owned(), "deep".to_owned()].into_iter().collect::<HashSet<_>>());
        assert!(!deeper.repos.iter().any(|r| r.root.starts_with(dir.join("node_modules"))));

        // VS Code compares the names with `pathEquals`, which ignores case on macOS
        git_init(&dir.join("Vendor/pkg"));
        cfg.ignored = ["vendor".to_owned()].into_iter().collect();
        let cased = scan_project(&dir, None, &cfg, &never, &mut ignore).unwrap();
        assert!(!cased.repos.iter().any(|r| r.root.starts_with(dir.join("Vendor"))), "`Vendor` was searched");

        cfg.ignored.clear();
        let all = scan_project(&dir, None, &cfg, &never, &mut ignore).unwrap();
        assert!(all.repos.iter().any(|r| r.name == "pkg"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn scan_budget_stops_unlimited_depth() {
        let dir = tempdir("budget");
        big_tree(&dir, 60, 2, 0);
        let cfg = ScanConfig { max_depth: -1, ..ScanConfig::default() };
        let never = || false;
        let mut ignore = |_: &[RepoInfo], _: Option<&Path>| {};
        let result = scan_project(&dir, None, &cfg, &never, &mut ignore).unwrap();
        // 61 directories is well inside the budget, so unlimited depth still completes
        assert!(!result.truncated);
        assert_eq!(result.visited, 61);
        assert!(result.visited <= SCAN_DIR_BUDGET);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn scan_is_cancelled_by_a_newer_generation() {
        let dir = tempdir("cancel");
        big_tree(&dir, 20, 5, 3);
        let cfg = ScanConfig { max_depth: -1, ..ScanConfig::default() };
        let stop = AtomicBool::new(false);
        let cancelled = || stop.swap(true, Ordering::SeqCst);
        let mut ignore = |_: &[RepoInfo], _: Option<&Path>| {};
        assert!(scan_project(&dir, None, &cfg, &cancelled, &mut ignore).is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    /// Build output under a `.gitignore`d folder must not wake the panel.
    #[test]
    fn ignored_paths_are_not_relevant() {
        let dir = tempdir("ignore");
        git_init(&dir);
        fs::write(dir.join(".gitignore"), "node_modules/\n").unwrap();
        fs::create_dir_all(dir.join("node_modules/pkg")).unwrap();
        fs::write(dir.join("node_modules/pkg/index.js"), "x").unwrap();
        let mut excludes = Excludes::open(&dir);
        assert!(!excludes.any_relevant(&[dir.join("node_modules/pkg/index.js")]));
        assert!(excludes.any_relevant(&[dir.join("src/main.rs")]));
        let _ = fs::remove_dir_all(&dir);
    }
}
