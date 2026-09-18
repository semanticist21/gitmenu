//! Project tabs, repository detection, file watching, and persisted UI state.
//!
//! A project is a folder the user opened; it holds one or more repositories (the folder's
//! own, submodules, nested repositories). Detection follows VS Code's git settings.
//! Every open project is watched. Only the active one triggers re-reads; the others just
//! get a "changed" dot and are re-read when activated.

use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, RwLock},
    time::Duration,
};

use notify::RecursiveMode;
use notify_debouncer_full::{DebounceEventResult, Debouncer, RecommendedCache, new_debouncer};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::{
    error::{Error, Result},
    queue::Queue,
    settings::{Settings, write_atomic},
};

const RECENT_LIMIT: usize = 20;
const WATCH_DEBOUNCE: Duration = Duration::from_millis(150);

/// Small JSON document of UI state (tabs, view layout, window sizes) the frontend owns.
pub struct UiState {
    path: PathBuf,
    values: RwLock<Map<String, Value>>,
}

impl UiState {
    pub fn load(dir: &Path) -> Arc<Self> {
        let path = dir.join("state.json");
        let values = fs::read_to_string(&path)
            .ok()
            .and_then(|t| serde_json::from_str::<Map<String, Value>>(&t).ok())
            .unwrap_or_default();
        Arc::new(Self { path, values: RwLock::new(values) })
    }

    pub fn get(&self, key: &str) -> Option<Value> {
        self.values.read().unwrap().get(key).cloned()
    }

    pub fn set(&self, key: &str, value: Value) {
        let text = {
            let mut values = self.values.write().unwrap();
            if value.is_null() {
                values.remove(key);
            } else {
                values.insert(key.to_owned(), value);
            }
            serde_json::to_string_pretty(&*values).unwrap_or_default()
        };
        if let Err(e) = write_atomic(&self.path, &text) {
            log::warn!("could not save UI state: {e}");
        }
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
    pub repos: Vec<RepoInfo>,
    /// A repository above the folder that the user hasn't accepted or declined yet
    pub parent_candidate: Option<PathBuf>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredProject {
    root: PathBuf,
    /// "accepted" / "declined" answer to the parent-repository question
    #[serde(default)]
    parent: Option<ParentAnswer>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "answer")]
enum ParentAnswer {
    Accepted { path: PathBuf },
    Declined,
}

struct Project {
    stored: StoredProject,
    info: ProjectInfo,
    _watcher: Option<Debouncer<notify::RecommendedWatcher, RecommendedCache>>,
}

pub struct Projects {
    app: AppHandle,
    settings: Arc<Settings>,
    ui: Arc<UiState>,
    queue: Arc<Queue>,
    inner: Mutex<Inner>,
}

#[derive(Default)]
struct Inner {
    order: Vec<PathBuf>,
    projects: HashMap<PathBuf, Project>,
    active: Option<PathBuf>,
}

impl Projects {
    pub fn new(app: AppHandle, settings: Arc<Settings>, ui: Arc<UiState>, queue: Arc<Queue>) -> Arc<Self> {
        Arc::new(Self { app, settings, ui, queue, inner: Mutex::new(Inner::default()) })
    }

    /// Reopens the tabs saved last time.
    pub fn restore(self: &Arc<Self>) {
        let stored: Vec<StoredProject> =
            self.ui.get("projects").and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default();
        let active = self.ui.get("activeProject").and_then(|v| serde_json::from_value::<PathBuf>(v).ok());
        for project in stored {
            self.insert(project);
        }
        let mut inner = self.inner.lock().unwrap();
        inner.active = active.filter(|a| inner.projects.contains_key(a)).or_else(|| inner.order.first().cloned());
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

    /// Opens a folder as a new tab (or switches to it) and makes it active.
    pub fn open(self: &Arc<Self>, root: PathBuf) -> Result<ProjectInfo> {
        let root = fs::canonicalize(&root).map_err(|_| Error::NotFound(root.display().to_string()))?;
        if !self.inner.lock().unwrap().projects.contains_key(&root) {
            self.insert(StoredProject { root: root.clone(), parent: None });
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
        let mut inner = self.inner.lock().unwrap();
        inner.projects.remove(id);
        inner.order.retain(|p| p != id);
        if inner.active.as_deref() == Some(id) {
            inner.active = inner.order.first().cloned();
        }
        drop(inner);
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
        project.info.dirty = false;
        inner.active = Some(id.to_path_buf());
        drop(inner);
        self.ui.set("activeProject", serde_json::to_value(id)?);
        self.emit_list();
        Ok(())
    }

    /// Points a missing tab at the folder's new location.
    pub fn relocate(self: &Arc<Self>, id: &Path, new_root: PathBuf) -> Result<ProjectInfo> {
        let new_root = fs::canonicalize(&new_root)?;
        let parent = {
            let mut inner = self.inner.lock().unwrap();
            let old = inner.projects.remove(id).ok_or_else(|| Error::NotFound(id.display().to_string()))?;
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
        self.insert_at(StoredProject { root: new_root.clone(), parent }, false);
        self.save();
        self.emit_list();
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
        self.emit_list();
        self.info(id)
    }

    /// Re-runs detection (after `git init`, a settings change, or a folder coming back).
    pub fn rescan(self: &Arc<Self>, id: &Path) -> Result<ProjectInfo> {
        let stored = {
            let inner = self.inner.lock().unwrap();
            inner.projects.get(id).ok_or_else(|| Error::NotFound(id.display().to_string()))?.stored.clone()
        };
        self.insert_at(stored, false);
        self.emit_list();
        self.info(id)
    }

    pub fn info(&self, id: &Path) -> Result<ProjectInfo> {
        let inner = self.inner.lock().unwrap();
        inner.projects.get(id).map(|p| p.info.clone()).ok_or_else(|| Error::NotFound(id.display().to_string()))
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

    fn insert(self: &Arc<Self>, stored: StoredProject) {
        self.insert_at(stored, true);
    }

    fn insert_at(self: &Arc<Self>, stored: StoredProject, append: bool) {
        let root = stored.root.clone();
        let missing = !root.is_dir();
        let (repos, parent_candidate) = if missing { (Vec::new(), None) } else { self.detect(&stored) };
        let info = ProjectInfo {
            id: root.clone(),
            name: root
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| root.display().to_string()),
            missing,
            dirty: false,
            repos,
            parent_candidate,
        };
        let watcher = self.watch(&info);
        let mut inner = self.inner.lock().unwrap();
        if append && !inner.order.contains(&root) {
            inner.order.push(root.clone());
        }
        inner.projects.insert(root, Project { stored, info, _watcher: watcher });
    }

    fn save(&self) {
        let inner = self.inner.lock().unwrap();
        let stored: Vec<&StoredProject> =
            inner.order.iter().filter_map(|id| inner.projects.get(id)).map(|p| &p.stored).collect();
        let value = serde_json::to_value(stored).unwrap_or_default();
        drop(inner);
        self.ui.set("projects", value);
    }

    fn emit_list(&self) {
        let _ = self.app.emit("projects://changed", self.list());
    }

    /// VS Code's detection: the folder itself, its parent (per `git.openRepositoryInParentFolders`),
    /// subfolders to `git.repositoryScanMaxDepth`, and submodules up to `git.detectSubmodulesLimit`.
    fn detect(&self, stored: &StoredProject) -> (Vec<RepoInfo>, Option<PathBuf>) {
        let root = &stored.root;
        let mut repos = Vec::new();
        let mut parent_candidate = None;

        if let Some(repo) = open_repo(root) {
            repos.push(repo_info(&repo, RepoKind::Root));
        } else if let Some(parent) = root.parent().and_then(discover_repo) {
            let parent_root = parent.workdir().map(Path::to_path_buf);
            let setting = self.settings.get_str("git.openRepositoryInParentFolders").unwrap_or_else(|| "prompt".into());
            match (&stored.parent, setting.as_str()) {
                (Some(ParentAnswer::Accepted { .. }), _) | (None, "always") => {
                    repos.push(repo_info(&parent, RepoKind::Root))
                }
                (Some(ParentAnswer::Declined), _) | (None, "never") => {}
                (None, _) => parent_candidate = parent_root,
            }
        }

        let auto = self.settings.get("git.autoRepositoryDetection");
        let scan_subfolders = auto.as_bool().unwrap_or(true) || auto.as_str() == Some("subFolders");
        if scan_subfolders {
            let depth = self.settings.get("git.repositoryScanMaxDepth").as_i64().unwrap_or(1);
            let ignored: HashSet<String> = self
                .settings
                .get("git.repositoryScanIgnoredFolders")
                .as_array()
                .map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_owned)).collect())
                .unwrap_or_default();
            // -1 means unlimited in VS Code; cap it so a home folder can't hang the app
            let depth = if depth < 0 { 8 } else { depth as usize };
            scan(root, depth, &ignored, &mut |path| {
                if repos.iter().any(|r| r.root == path) {
                    return;
                }
                if let Some(repo) = open_repo(path) {
                    repos.push(repo_info(&repo, RepoKind::Nested));
                }
            });
        }

        if self.settings.get("git.detectSubmodules").as_bool().unwrap_or(true) {
            let limit = self.settings.get("git.detectSubmodulesLimit").as_u64().unwrap_or(10) as usize;
            let parents: Vec<PathBuf> = repos.iter().map(|r| r.root.clone()).collect();
            for parent in parents {
                let Some(repo) = open_repo(&parent) else {
                    continue;
                };
                let Ok(Some(submodules)) = repo.submodules() else {
                    continue;
                };
                for submodule in submodules.take(limit) {
                    let Ok(Some(sub)) = submodule.open() else {
                        continue;
                    };
                    let info = repo_info(&sub, RepoKind::Submodule);
                    if !repos.iter().any(|r| r.root == info.root) {
                        repos.push(info);
                    }
                }
            }
        }
        (repos, parent_candidate)
    }

    fn watch(self: &Arc<Self>, info: &ProjectInfo) -> Option<Debouncer<notify::RecommendedWatcher, RecommendedCache>> {
        let this = Arc::downgrade(self);
        let project_id = info.id.clone();
        let mut debouncer = new_debouncer(WATCH_DEBOUNCE, None, move |result: DebounceEventResult| {
            let (Some(this), Ok(events)) = (this.upgrade(), result) else {
                return;
            };
            let paths: Vec<PathBuf> = events.into_iter().flat_map(|e| e.event.paths).collect();
            this.on_fs_events(&project_id, paths);
        })
        .ok()?;
        if info.missing {
            // Watch the nearest existing ancestor so the tab recovers when the folder returns
            let ancestor = info.id.ancestors().skip(1).find(|p| p.is_dir())?;
            debouncer.watch(ancestor, RecursiveMode::NonRecursive).ok()?;
            return Some(debouncer);
        }
        debouncer.watch(&info.id, RecursiveMode::Recursive).ok()?;
        // Git directories outside the folder (linked worktrees, a parent repository)
        for repo in &info.repos {
            for dir in [&repo.git_dir, &repo.common_dir] {
                if !dir.starts_with(&info.id) {
                    let _ = debouncer.watch(dir, RecursiveMode::Recursive);
                }
            }
        }
        Some(debouncer)
    }

    fn on_fs_events(self: &Arc<Self>, project_id: &Path, paths: Vec<PathBuf>) {
        let (missing, repos, is_active) = {
            let inner = self.inner.lock().unwrap();
            let Some(project) = inner.projects.get(project_id) else {
                return;
            };
            (project.info.missing, project.info.repos.clone(), inner.active.as_deref() == Some(project_id))
        };
        if missing {
            if project_id.is_dir() {
                let _ = self.rescan(project_id);
            }
            return;
        }
        if !project_id.is_dir() {
            let _ = self.rescan(project_id);
            return;
        }
        let mut rescan = false;
        let mut by_repo: HashMap<PathBuf, Vec<&Path>> = HashMap::new();
        for path in &paths {
            // A new or removed repository under the folder changes the repository list
            if path.file_name().is_some_and(|n| n == ".git" || n == ".gitmodules") {
                rescan = true;
            }
            if let Some(repo) = owning_repo(&repos, path) {
                by_repo.entry(repo.root.clone()).or_default().push(path);
            }
        }
        let mut changed: HashSet<PathBuf> = by_repo
            .into_iter()
            .filter(|(root, paths)| {
                repos.iter().find(|r| &r.root == root).is_some_and(|repo| any_relevant(repo, paths))
            })
            .map(|(root, _)| root)
            .collect();
        if rescan {
            let _ = self.rescan(project_id);
        }
        // Writes re-read on their own when they finish; drop their echoes
        changed.retain(|root| !self.queue.is_writing(root));
        if changed.is_empty() {
            return;
        }
        if is_active {
            for root in changed {
                let _ = self.app.emit("repo://changed", root);
            }
        } else {
            let mut inner = self.inner.lock().unwrap();
            if let Some(project) = inner.projects.get_mut(project_id)
                && !project.info.dirty
            {
                project.info.dirty = true;
                drop(inner);
                self.emit_list();
            }
        }
    }
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

fn repo_info(repo: &gix::Repository, kind: RepoKind) -> RepoInfo {
    let root = repo.workdir().expect("non-bare").to_path_buf();
    let root = fs::canonicalize(&root).unwrap_or(root);
    RepoInfo {
        name: root.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
        git_dir: repo.git_dir().to_path_buf(),
        common_dir: repo.common_dir().to_path_buf(),
        kind,
        root,
    }
}

fn scan(dir: &Path, depth: usize, ignored: &HashSet<String>, found: &mut dyn FnMut(&Path)) {
    if depth == 0 {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if !kind.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if name == ".git" || ignored.contains(&name) {
            continue;
        }
        let path = entry.path();
        found(&path);
        scan(&path, depth - 1, ignored, found);
    }
}

fn owning_repo<'a>(repos: &'a [RepoInfo], path: &Path) -> Option<&'a RepoInfo> {
    repos
        .iter()
        .filter(|r| path.starts_with(&r.root) || path.starts_with(&r.git_dir) || path.starts_with(&r.common_dir))
        .max_by_key(|r| r.root.as_os_str().len())
}

/// Whether any changed path can change what the panel shows for `repo`.
/// `.gitignore`d paths never show in status, so their churn (build output) is dropped here.
fn any_relevant(repo: &RepoInfo, paths: &[&Path]) -> bool {
    let mut worktree_paths = Vec::new();
    for path in paths {
        let in_git_dir = path.starts_with(&repo.git_dir)
            || path.starts_with(&repo.common_dir)
            || path.components().any(|c| c.as_os_str() == ".git");
        if !in_git_dir {
            worktree_paths.push(*path);
            continue;
        }
        let name = path.file_name().map(|n| n.to_string_lossy()).unwrap_or_default();
        let noise =
            name.ends_with(".lock") || path.components().any(|c| c.as_os_str() == "objects" || c.as_os_str() == "logs");
        if !noise {
            return true;
        }
    }
    if worktree_paths.is_empty() {
        return false;
    }
    let Some(handle) = open_repo(&repo.root) else {
        return true;
    };
    let Ok(index) = handle.index_or_empty() else {
        return true;
    };
    let Ok(mut stack) =
        handle.excludes(&index, None, gix::worktree::stack::state::ignore::Source::WorktreeThenIdMappingIfNotSkipped)
    else {
        return true;
    };
    worktree_paths.into_iter().any(|path| {
        let Ok(rel) = path.strip_prefix(&repo.root) else {
            return false;
        };
        let mode = if path.is_dir() { gix::index::entry::Mode::DIR } else { gix::index::entry::Mode::FILE };
        !stack.at_path(rel, Some(mode)).map(|p| p.is_excluded()).unwrap_or(false)
    })
}

pub fn app_support_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .home_dir()
        .map(|h| h.join("Library/Application Support/gitside"))
        .unwrap_or_else(|_| PathBuf::from("/tmp/gitside"))
}
