//! Measures what `project_open` costs for a large folder (the "open ~/code froze the UI" bug).
//!
//! Every phase calls the shipped code in `gitmenu_lib::project` -- `scan_project`, `watcher`,
//! `classify`, `Excludes` -- so the numbers cannot drift from what the app runs.
//!
//! Run (release, reusing the app's target dir):
//!   cargo build --release --example freeze_bench
//!   FREEZE_DIR=/path/to/folder ./target/release/examples/freeze_bench [phase ...]
//!
//! Phases: `detect`, `status`, `watchsplit`, `watch`, `rescan`, `mainthread`, `all`
//! (default `detect status`).
//! `watch` writes files; it refuses to run outside a scratchpad path unless
//! FREEZE_ALLOW_WRITES=1 is set. Everything else is read-only.

use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, AtomicUsize, Ordering},
        mpsc,
    },
    time::{Duration, Instant},
};

use gitmenu_lib::project::{Change, Excludes, RepoInfo, ScanConfig, classify, scan_project, watcher};
use notify::RecursiveMode;

// ---------------------------------------------------------------- detect

struct DetectTimings {
    total: Duration,
    repos: usize,
    visited: usize,
    truncated: bool,
    parent_candidate: Option<PathBuf>,
    /// Time from the call to the first partial result the panel could draw
    first_result: Duration,
}

/// `project.rs::scan_project` with the shipped defaults from `configuration.json`.
fn detect(root: &Path) -> (Vec<RepoInfo>, DetectTimings) {
    let cfg = ScanConfig::default();
    let never = || false;
    let start = Instant::now();
    let mut first_result = None;
    let mut partial = |repos: &[RepoInfo], _: Option<&Path>| {
        if !repos.is_empty() && first_result.is_none() {
            first_result = Some(start.elapsed());
        }
    };
    let result = scan_project(root, None, &cfg, &never, &mut partial).expect("scan was not cancelled");
    let total = start.elapsed();
    let timings = DetectTimings {
        total,
        repos: result.repos.len(),
        visited: result.visited,
        truncated: result.truncated,
        parent_candidate: result.parent_candidate.clone(),
        first_result: first_result.unwrap_or(total),
    };
    (result.repos, timings)
}

fn print_detect(label: &str, t: &DetectTimings) {
    println!("detect[{label}]  total {:>9.1?}", t.total);
    println!("  first result the panel can draw  {:>9.1?}", t.first_result);
    println!("  directories read                 {:>9}", t.visited);
    println!("  repositories found               {:>9}", t.repos);
    if t.truncated {
        println!("  TRUNCATED at the traversal budget");
    }
    if let Some(p) = &t.parent_candidate {
        println!("  parent candidate      {}", p.display());
    }
}

/// What a repository appearing costs now: the watcher stays, one folder is opened.
/// (It used to be a full `detect()` plus a brand-new recursive watcher.)
fn bench_rescan(root: &Path, repos: &[RepoInfo]) {
    println!("\nincremental watcher update  ({})", root.display());
    let mut debouncer = watcher(|_, _| {}).expect("debouncer");
    let s = Instant::now();
    debouncer.watch(root, RecursiveMode::Recursive).expect("watch");
    println!("  first watch of the folder     : {:.1?}", s.elapsed());

    // `update_watch_roots`: add and drop the git dirs outside the folder, never rebuild
    let outside: Vec<PathBuf> =
        repos.iter().flat_map(|r| [r.git_dir.clone(), r.common_dir.clone()]).filter(|d| !d.starts_with(root)).collect();
    let s = Instant::now();
    for dir in &outside {
        let _ = debouncer.watch(dir, RecursiveMode::Recursive);
    }
    let added = s.elapsed();
    let s = Instant::now();
    for dir in &outside {
        let _ = debouncer.unwatch(dir);
    }
    println!("  {} outside git dirs added     : {added:.1?}", outside.len());
    println!("  the same dirs unwatched       : {:.1?}", s.elapsed());

    // One candidate folder resolved, which is all a new `.git` costs
    let s = Instant::now();
    let cfg = ScanConfig { subfolders: false, submodules: false, ..ScanConfig::default() };
    let never = || false;
    let mut ignore = |_: &[RepoInfo], _: Option<&Path>| {};
    let target = repos.first().map(|r| r.root.clone()).unwrap_or_else(|| root.to_path_buf());
    let _ = scan_project(&target, None, &cfg, &never, &mut ignore);
    println!("  one candidate folder opened   : {:.1?}", s.elapsed());
}

// ---------------------------------------------------------------- status

/// Same work `read::status::status` does: a full index-vs-worktree + tree-vs-index walk
/// with untracked files, then HEAD and ahead/behind.
fn status_once(repo: &gix::Repository) -> std::result::Result<usize, String> {
    let iter = repo
        .status(gix::progress::Discard)
        .map_err(|e| e.to_string())?
        .untracked_files(gix::status::UntrackedFiles::Files)
        .into_iter(None)
        .map_err(|e| e.to_string())?;
    let mut n = 0;
    for item in iter {
        item.map_err(|e| e.to_string())?;
        n += 1;
    }
    let head = repo.head().ok();
    if let Some(head) = head
        && let Some(name) = head.referent_name().map(|n| n.as_bstr().to_string())
        && let Ok(id) = head.id().ok_or("no id")
    {
        let _ = (name, id);
    }
    Ok(n)
}

fn bench_status(repos: &[RepoInfo]) {
    println!("\nstatus  ({} repositories)", repos.len());
    if repos.is_empty() {
        return;
    }
    // Cold: a fresh gix handle per repo, like `Repos::get` on the first read after open.
    let mut cold = Vec::new();
    for r in repos {
        let s = Instant::now();
        let Ok(handle) = gix::open(&r.root) else { continue };
        let open = s.elapsed();
        let s = Instant::now();
        let n = status_once(&handle).unwrap_or(0);
        cold.push((r.root.clone(), open, s.elapsed(), n));
    }
    let total: Duration = cold.iter().map(|c| c.1 + c.2).sum();
    let slowest = cold.iter().max_by_key(|c| c.2).expect("a repository");
    println!("  sequential, cold handles: {:>9.1?} total, {:>8.1?} mean/repo", total, total / repos.len() as u32);
    println!(
        "  slowest repo            : {:>9.1?}  ({} items)  {}",
        slowest.2,
        slowest.3,
        slowest.0.file_name().unwrap_or_default().to_string_lossy()
    );

    // Warm: handles kept, like `Repos` after the first read.
    let handles: Vec<gix::ThreadSafeRepository> =
        repos.iter().filter_map(|r| gix::ThreadSafeRepository::open(&r.root).ok()).collect();
    let s = Instant::now();
    for h in &handles {
        let _ = status_once(&h.to_thread_local());
    }
    let warm = s.elapsed();
    println!("  sequential, warm handles: {:>9.1?} total, {:>8.1?} mean/repo", warm, warm / handles.len() as u32);

    // All at once, the way the panel would if it ever read every repository.
    let s = Instant::now();
    let threads: Vec<_> = handles
        .iter()
        .map(|h| {
            let h = h.to_thread_local();
            std::thread::spawn(move || status_once(&h))
        })
        .collect();
    for t in threads {
        let _ = t.join();
    }
    println!("  {} at once (N threads)  : {:>9.1?} wall", handles.len(), s.elapsed());
}

// ---------------------------------------------------------------- watcher

#[derive(Default)]
struct Counters {
    events: AtomicU64,
    batches: AtomicU64,
    paths: AtomicU64,
    candidates: AtomicU64,
    classify_nanos: AtomicU64,
    relevant_nanos: AtomicU64,
    max_batch: AtomicUsize,
    need_rescan: AtomicU64,
}

fn bench_watch(root: &Path, repos: Vec<RepoInfo>) {
    let writes_ok = root.to_string_lossy().contains("scratchpad") || std::env::var("FREEZE_ALLOW_WRITES").is_ok();

    println!("\nwatch  ({})", root.display());
    let c = Arc::new(Counters::default());
    // The worker's per-repository exclude stacks, kept open between batches
    let excludes: Arc<Mutex<HashMap<PathBuf, Excludes>>> = Arc::new(Mutex::new(HashMap::new()));

    let mut debouncer = {
        let (c, excludes, repos) = (Arc::clone(&c), Arc::clone(&excludes), repos.clone());
        watcher(move |paths: Vec<PathBuf>, need_rescan: bool| {
            c.events.fetch_add(paths.len() as u64, Ordering::Relaxed);
            c.batches.fetch_add(1, Ordering::Relaxed);
            c.paths.fetch_add(paths.len() as u64, Ordering::Relaxed);
            c.max_batch.fetch_max(paths.len(), Ordering::Relaxed);
            if need_rescan {
                c.need_rescan.fetch_add(1, Ordering::Relaxed);
            }
            // What the watcher worker runs: classification, then one gitignore test per repo
            let t0 = Instant::now();
            let mut worktree: HashMap<PathBuf, Vec<PathBuf>> = HashMap::new();
            for path in paths {
                match classify(&repos, &path, true) {
                    Change::Worktree(root) => worktree.entry(root).or_default().push(path),
                    Change::Candidate(_) => {
                        c.candidates.fetch_add(1, Ordering::Relaxed);
                    }
                    _ => {}
                }
            }
            c.classify_nanos.fetch_add(t0.elapsed().as_nanos() as u64, Ordering::Relaxed);
            let t1 = Instant::now();
            let mut cache = excludes.lock().unwrap();
            for (root, paths) in worktree {
                let entry = cache.entry(root.clone()).or_insert_with(|| Excludes::open(&root));
                let _ = entry.any_relevant(&paths);
            }
            c.relevant_nanos.fetch_add(t1.elapsed().as_nanos() as u64, Ordering::Relaxed);
        })
        .expect("debouncer")
    };

    let s = Instant::now();
    debouncer.watch(root, RecursiveMode::Recursive).expect("watch");
    let register = s.elapsed();
    println!("  debouncer.watch(Recursive) on the folder: {register:.1?}");
    let mut extra = Duration::ZERO;
    for repo in &repos {
        for dir in [&repo.git_dir, &repo.common_dir] {
            if !dir.starts_with(root) {
                let s = Instant::now();
                let _ = debouncer.watch(dir, RecursiveMode::Recursive);
                extra += s.elapsed();
            }
        }
    }
    if !extra.is_zero() {
        println!("  extra git dirs outside the folder      : {extra:.1?}");
    }

    if !writes_ok || repos.is_empty() {
        println!("  (churn skipped: {} is outside the scratchpad, or holds no repository)", root.display());
        return;
    }

    // Churn: files written into an ignored build-output directory, like a bundler or cargo.
    let churn_root = repos[0].root.join("node_modules").join("churn");
    let files: usize = std::env::var("FREEZE_CHURN").ok().and_then(|v| v.parse().ok()).unwrap_or(5_000);
    println!("  churn: writing {files} files under {}", churn_root.display());
    let w = Instant::now();
    for i in 0..files {
        let dir = churn_root.join(format!("d{:03}", i / 100));
        if i % 100 == 0 {
            let _ = fs::create_dir_all(&dir);
        }
        let _ = fs::write(dir.join(format!("f{i:05}.js")), b"// churn\n");
    }
    let write_time = w.elapsed();
    std::thread::sleep(Duration::from_secs(4));
    let settle = w.elapsed();

    let ev = c.events.load(Ordering::Relaxed);
    let b = c.batches.load(Ordering::Relaxed);
    let p = c.paths.load(Ordering::Relaxed);
    let class = Duration::from_nanos(c.classify_nanos.load(Ordering::Relaxed));
    let relevant = Duration::from_nanos(c.relevant_nanos.load(Ordering::Relaxed));
    println!("  wrote {files} files in {write_time:.1?}; settled after {settle:.1?}");
    println!("  debounced events reaching the callback: {ev}  ({p} paths, {b} batches)");
    println!("  events/second while writing           : {:.0}", ev as f64 / write_time.as_secs_f64());
    println!("  largest single batch                  : {} paths", c.max_batch.load(Ordering::Relaxed));
    println!("  classify()                            : {class:.1?}  ({:.1?} per path)", class / p.max(1) as u32);
    println!(
        "  gitignore test, cached stacks         : {relevant:.1?}  ({:.1?} mean/batch)",
        if b > 0 { relevant / b as u32 } else { Duration::ZERO }
    );
    println!("  batches that asked for a full rescan  : 0  (there is no such path any more)");
    println!("  FSEvents dropped-event notices        : {}", c.need_rescan.load(Ordering::Relaxed));

    // The same churn under a directory git does NOT ignore.
    let tracked_churn = repos[0].root.join("src").join("churn");
    let _ = fs::create_dir_all(&tracked_churn);
    c.events.store(0, Ordering::Relaxed);
    c.batches.store(0, Ordering::Relaxed);
    c.classify_nanos.store(0, Ordering::Relaxed);
    c.relevant_nanos.store(0, Ordering::Relaxed);
    let n = files.min(2_000);
    let w = Instant::now();
    for i in 0..n {
        let _ = fs::write(tracked_churn.join(format!("t{i:05}.js")), b"// churn\n");
    }
    let tracked_write = w.elapsed();
    std::thread::sleep(Duration::from_secs(4));
    let b = c.batches.load(Ordering::Relaxed);
    let work =
        Duration::from_nanos(c.classify_nanos.load(Ordering::Relaxed) + c.relevant_nanos.load(Ordering::Relaxed));
    println!(
        "  NOT-ignored churn: {n} files in {tracked_write:.1?} -> {} events, worker {work:.1?} ({:.1?} mean/batch)",
        c.events.load(Ordering::Relaxed),
        if b > 0 { work / b as u32 } else { Duration::ZERO }
    );

    // A `.git` directory appearing under the folder: one candidate, never a re-detect.
    c.events.store(0, Ordering::Relaxed);
    c.candidates.store(0, Ordering::Relaxed);
    let probe = root.join("fresh-repo");
    let _ = fs::create_dir_all(probe.join(".git"));
    std::thread::sleep(Duration::from_secs(2));
    println!(
        "  creating one `.git` dir -> candidate folders: {}  (each costs one gix::open)",
        c.candidates.load(Ordering::Relaxed)
    );
    let _ = fs::remove_dir_all(&probe);
    let _ = fs::remove_dir_all(&churn_root);
    let _ = fs::remove_dir_all(&tracked_churn);
}

// ---------------------------------------------------------------- watch cost, split

/// What `notify_debouncer_full::FileIdMap::add_path` used to do on every `watch()`:
/// `WalkDir::new(path).follow_links(true).max_depth(usize::MAX)` plus a `get_file_id`
/// (a stat) per entry. `project::watcher` uses `NoCache`, so none of this runs any more;
/// the phase stays to show what was removed.
fn walk_like_file_id_map(root: &Path) -> (usize, usize, Duration) {
    let s = Instant::now();
    let mut map: HashMap<PathBuf, (u64, u64)> = HashMap::new();
    let mut stack = vec![root.to_path_buf()];
    let mut entries = 0usize;
    // walkdir stops at symlink cycles and the error is dropped; approximate that.
    let mut seen_dirs: HashSet<(u64, u64)> = HashSet::new();
    while let Some(dir) = stack.pop() {
        let Ok(rd) = fs::read_dir(&dir) else { continue };
        for entry in rd.flatten() {
            let path = entry.path();
            entries += 1;
            // follow_links(true): metadata, not symlink_metadata
            if let Ok(meta) = fs::metadata(&path) {
                use std::os::unix::fs::MetadataExt;
                let id = (meta.dev(), meta.ino());
                map.insert(path.clone(), id);
                if meta.is_dir() && seen_dirs.insert(id) {
                    stack.push(path);
                }
            }
        }
    }
    (entries, map.len(), s.elapsed())
}

fn bench_watch_split(root: &Path) {
    println!("\nwatch cost, split  ({})", root.display());
    let s = Instant::now();
    {
        let mut raw = notify::recommended_watcher(|_: notify::Result<notify::Event>| {}).expect("watcher");
        use notify::Watcher;
        raw.watch(root, RecursiveMode::Recursive).expect("watch");
        println!("  notify FSEvents stream registration only: {:.1?}", s.elapsed());
    }
    let s = Instant::now();
    {
        let mut shipped = watcher(|_, _| {}).expect("watcher");
        shipped.watch(root, RecursiveMode::Recursive).expect("watch");
        println!("  project::watcher (NoCache) registration : {:.1?}", s.elapsed());
    }
    let (entries, unique, walked) = walk_like_file_id_map(root);
    println!("  what a FileIdMap would have cost        : {walked:.1?} for {entries} entries ({unique} unique)");
    println!("  -> {:.1?} per entry, no longer paid", walked / entries.max(1) as u32);
}

// ---------------------------------------------------------------- main-thread model

/// Models Tauri's main thread: a loop servicing queued work. A sync `#[tauri::command]`
/// body runs inline here (tauri-macros `body_blocking`), so nothing else is serviced
/// until it returns. The "UI frames" are the tasks that would render / handle input.
///
/// `project_open` is async now and the scan runs on a blocking worker, so what is measured
/// here is only the in-memory phase plus the watch registration -- what the tab costs.
fn bench_main_thread(root: &Path) {
    println!("\nmain-thread block model  ({})", root.display());
    let (tx, rx) = mpsc::channel::<Box<dyn FnOnce() + Send>>();
    let latencies = Arc::new(Mutex::new(Vec::<Duration>::new()));
    let stop = Arc::new(AtomicU64::new(0));

    let poster = {
        let (tx, latencies, stop) = (tx.clone(), Arc::clone(&latencies), Arc::clone(&stop));
        std::thread::spawn(move || {
            while stop.load(Ordering::Relaxed) == 0 {
                let queued = Instant::now();
                let latencies = Arc::clone(&latencies);
                if tx.send(Box::new(move || latencies.lock().unwrap().push(queued.elapsed()))).is_err() {
                    break;
                }
                std::thread::sleep(Duration::from_millis(16)); // ~60 fps
            }
        })
    };

    // Warm-up: drain a few frames so the baseline latency is measured.
    let warm_end = Instant::now() + Duration::from_millis(500);
    while Instant::now() < warm_end {
        if let Ok(task) = rx.recv_timeout(Duration::from_millis(50)) {
            task();
        }
    }
    let baseline: Vec<Duration> = latencies.lock().unwrap().drain(..).collect();
    let base_max = baseline.iter().max().copied().unwrap_or_default();

    // What the open path runs before it returns: the folder check and the watch.
    let blocked = Instant::now();
    let missing = !root.is_dir();
    let w = Instant::now();
    let mut debouncer = watcher(|_, _| {}).expect("debouncer");
    let _ = debouncer.watch(root, RecursiveMode::Recursive);
    let watch_time = w.elapsed();
    let total_block = blocked.elapsed();
    drop(debouncer);

    // Frames that piled up while the open path ran, measured before anything else.
    let mut drained = 0;
    while let Ok(task) = rx.try_recv() {
        task();
        drained += 1;
    }
    stop.store(1, Ordering::Relaxed);
    let _ = poster.join();
    let after: Vec<Duration> = latencies.lock().unwrap().drain(..).collect();
    let worst = after.iter().max().copied().unwrap_or_default();

    // The scan that used to run here, now on a blocking worker.
    let s = Instant::now();
    let (_repos, t) = detect(root);
    let scan_time = s.elapsed();

    println!("  baseline frame latency while idle : {base_max:.1?} worst of {} frames", baseline.len());
    println!("  folder check (missing = {missing})     : {:.1?}", total_block - watch_time);
    println!("  watcher registration              : {watch_time:.1?}");
    println!("  the open path blocks for          : {total_block:.1?}   <-- what the UI waits on");
    println!("  the scan, on a blocking worker    : {scan_time:.1?}  ({} repos)", t.repos);
    println!("  frames starved during the block   : {drained} (worst latency {worst:.1?})");
}

// ---------------------------------------------------------------- entry

fn main() {
    let root = std::env::var("FREEZE_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| Path::new(env!("CARGO_MANIFEST_DIR")).to_path_buf());
    let root = fs::canonicalize(&root).unwrap_or(root);
    let args: Vec<String> = std::env::args().skip(1).collect();
    let phases: Vec<&str> =
        if args.is_empty() { vec!["detect", "status"] } else { args.iter().map(String::as_str).collect() };
    let all = phases.contains(&"all");

    println!("FREEZE_DIR = {}", root.display());
    let mut repos = Vec::new();
    if all || phases.iter().any(|p| matches!(*p, "detect" | "status" | "watch" | "rescan")) {
        let (r, t) = detect(&root);
        print_detect("cold", &t);
        let (r2, t2) = detect(&root);
        print_detect("warm", &t2);
        repos = if r2.len() >= r.len() { r2 } else { r };
    }
    if all || phases.contains(&"status") {
        bench_status(&repos);
    }
    if all || phases.contains(&"rescan") {
        bench_rescan(&root, &repos);
    }
    if all || phases.contains(&"watchsplit") {
        bench_watch_split(&root);
    }
    if all || phases.contains(&"watch") {
        bench_watch(&root, repos.clone());
    }
    if all || phases.contains(&"mainthread") {
        bench_main_thread(&root);
    }
}
