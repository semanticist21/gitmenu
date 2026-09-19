//! Commit messages from Apple's on-device Foundation Models (macOS 26+), through the Swift
//! bridge in bridge.swift. The model's window is small (4096 tokens) and it drifts from
//! formats, so: strict instructions, per-file summaries when the diff doesn't fit, and the
//! answer is checked against the Conventional Commits shape (one retry). It writes English
//! best, so the subject line is written in English and then translated.

use std::{
    ffi::{CStr, CString, c_char},
    path::Path,
    sync::Arc,
};

use serde::Serialize;

use crate::{
    env::GitEnv,
    error::{Error, Result},
    settings::Settings,
};

unsafe extern "C" {
    fn gitmenu_fm_availability() -> i32;
    fn gitmenu_fm_token_count(text: *const c_char) -> i64;
    fn gitmenu_fm_context_size() -> i64;
    fn gitmenu_fm_generate(instructions: *const c_char, prompt: *const c_char, error: *mut i32) -> *mut c_char;
    fn gitmenu_fm_free(pointer: *mut c_char);
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Availability {
    Available,
    DeviceNotEligible,
    AppleIntelligenceNotEnabled,
    ModelNotReady,
    UnsupportedOs,
    Unknown,
}

pub fn availability() -> Availability {
    match unsafe { gitmenu_fm_availability() } {
        0 => Availability::Available,
        1 => Availability::DeviceNotEligible,
        2 => Availability::AppleIntelligenceNotEnabled,
        3 => Availability::ModelNotReady,
        4 => Availability::UnsupportedOs,
        _ => Availability::Unknown,
    }
}

#[derive(Debug)]
enum GenerateError {
    ContextWindow,
    Guardrail,
    Other,
}

fn generate(instructions: &str, prompt: &str) -> std::result::Result<String, GenerateError> {
    let instructions = CString::new(instructions.replace('\0', "")).unwrap();
    let prompt = CString::new(prompt.replace('\0', "")).unwrap();
    let mut code = 0i32;
    let pointer = unsafe { gitmenu_fm_generate(instructions.as_ptr(), prompt.as_ptr(), &mut code) };
    if pointer.is_null() {
        return Err(match code {
            10 => GenerateError::ContextWindow,
            11 => GenerateError::Guardrail,
            _ => GenerateError::Other,
        });
    }
    let text = unsafe { CStr::from_ptr(pointer) }.to_string_lossy().into_owned();
    unsafe { gitmenu_fm_free(pointer) };
    Ok(text)
}

/// Tokens in `text`: exact on macOS 26.4+, otherwise a conservative estimate.
fn tokens(text: &str) -> usize {
    let c = CString::new(text.replace('\0', "")).unwrap();
    let count = unsafe { gitmenu_fm_token_count(c.as_ptr()) };
    if count >= 0 {
        count as usize
    } else {
        // Code tokenizes at roughly 3 characters per token
        text.len().div_ceil(3)
    }
}

fn context_size() -> usize {
    let size = unsafe { gitmenu_fm_context_size() };
    if size > 0 { size as usize } else { 4096 }
}

const TYPES: [&str; 11] =
    ["feat", "fix", "docs", "style", "refactor", "perf", "test", "build", "ci", "chore", "revert"];

/// The model writes English best, so the subject is written in English and then translated.
fn instructions(custom: &str) -> String {
    let mut text = format!(
        "You write the subject line of a git commit message for the change the user gives you.\n\
         Format: type(scope): summary\n\
         - type is one of: {types}. Pick it from what the diff changes: feat adds a feature people can use; \
         fix repairs a bug; refactor restructures code without changing behavior; docs changes only documentation \
         or text meant for readers; test changes only tests; build changes dependencies, version numbers or build \
         configuration; style changes only formatting; perf makes something faster; chore is anything else.\n\
         - scope is optional: one lowercase word for the part of the project, taken from the changed file paths. \
         Leave out the scope and its parentheses when the files don't share one.\n\
         - summary is an imperative verb phrase saying what this diff does, using the names, words and numbers \
         in the diff. Not what was wrong before, not a full sentence, no period.\n\
         - The whole line is at most 72 characters.\n\
         Output only that one line: no body, bullet points, explanation, markdown or quotes.",
        types = TYPES.join(", "),
    );
    if !custom.trim().is_empty() {
        text.push_str("\nAdditional instructions from the user:\n");
        text.push_str(custom.trim());
    }
    text
}

/// How commit summaries read in a language: examples for the translation step
fn style(language: &str) -> &'static str {
    match language.to_lowercase().as_str() {
        "korean" | "한국어" => {
            "\nExamples:\nadd dark mode toggle to settings → 설정에 다크 모드 토글 추가\n\
             fix crash when the repository is empty → 빈 저장소에서 발생하는 크래시 수정\n\
             update README install steps → README 설치 단계 업데이트"
        }
        "japanese" | "日本語" => {
            "\nExamples:\nadd dark mode toggle to settings → 設定にダークモード切り替えを追加\n\
             fix crash when the repository is empty → 空のリポジトリでのクラッシュを修正\n\
             update README install steps → README のインストール手順を更新"
        }
        "chinese" | "simplified chinese" | "中文" | "简体中文" => {
            "\nExamples:\nadd dark mode toggle to settings → 在设置中添加深色模式开关\n\
             fix crash when the repository is empty → 修复仓库为空时的崩溃\n\
             update README install steps → 更新 README 安装步骤"
        }
        "traditional chinese" | "繁體中文" => {
            "\nExamples:\nadd dark mode toggle to settings → 在設定中新增深色模式開關\n\
             fix crash when the repository is empty → 修正儲存庫為空時的當機\n\
             update README install steps → 更新 README 安裝步驟"
        }
        _ => "",
    }
}

/// Translates the summary part of a subject line, keeping type and scope
fn translate(subject: &str, language: &str) -> std::result::Result<String, GenerateError> {
    let Some((head, summary)) = subject.split_once(": ") else { return Ok(subject.to_owned()) };
    let instructions = format!(
        "You translate a git commit summary from English into {language}, as a short phrase the way commit \
         messages are written in {language}, not a sentence. Keep code identifiers, file names, component names, \
         commands and numbers exactly as they are. Output only the translation.{}",
        style(language)
    );
    let translated = generate(&instructions, summary)?;
    let translated = translated.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or(summary);
    let translated = translated.rsplit('→').next().unwrap_or(translated);
    let translated = unquote(translated).trim_end_matches(['.', '。']).trim();
    Ok(if translated.is_empty() { subject.to_owned() } else { format!("{head}: {translated}") })
}

/// Strips quotes around the whole text, not a quote that ends it (`bump to "1.2"`)
fn unquote(text: &str) -> &str {
    let text = text.trim();
    for q in ['"', '\'', '`', '“'] {
        let close = if q == '“' { '”' } else { q };
        if let Some(inner) = text.strip_prefix(q).and_then(|t| t.strip_suffix(close)) {
            return inner.trim();
        }
    }
    text
}

/// The imperative form of a summary's first word: "added X" or "adds X" → "add X"
fn imperative(summary: &str) -> String {
    const VERBS: [&str; 40] = [
        "add",
        "update",
        "fix",
        "remove",
        "change",
        "rename",
        "move",
        "bump",
        "improve",
        "refactor",
        "replace",
        "create",
        "delete",
        "implement",
        "introduce",
        "enable",
        "disable",
        "allow",
        "clean",
        "revert",
        "upgrade",
        "downgrade",
        "use",
        "make",
        "support",
        "handle",
        "show",
        "hide",
        "extract",
        "split",
        "merge",
        "simplify",
        "drop",
        "document",
        "adjust",
        "correct",
        "prevent",
        "avoid",
        "ensure",
        "include",
    ];
    let (word, rest) = summary.split_once(' ').unwrap_or((summary, ""));
    let lower = word.to_lowercase();
    let base = VERBS.iter().find(|v| {
        let v = **v;
        lower == format!("{v}s")
            || lower == format!("{v}es")
            || lower == format!("{v}ed")
            || lower == format!("{v}d")
            || (v.ends_with('y')
                && (lower == format!("{}ied", &v[..v.len() - 1]) || lower == format!("{}ies", &v[..v.len() - 1])))
            || (v == "split" && lower == "splits")
            || (v == "make" && (lower == "made" || lower == "makes"))
            || (v == "drop" && lower == "dropped")
    });
    match base {
        Some(v) if rest.is_empty() => (*v).to_owned(),
        Some(v) => format!("{v} {rest}"),
        None => summary.to_owned(),
    }
}

/// The subject line, cleaned up, if it has the Conventional Commits shape. A scope that names
/// none of the changed paths is dropped (the model tends to invent one).
fn validate(raw: &str, paths: &[String]) -> Option<String> {
    let first = raw
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty() && !l.starts_with("```"))?
        // A markdown heading or bullet, quotes, or the template's angle brackets: `<feat>(scope): …`
        .trim_start_matches(['#', '*', '-'])
        .trim();
    let first = unquote(first).replace(['<', '>'], "");
    let (head, summary) = first.split_once(": ")?;
    let kind = head.split('(').next()?.trim_end_matches('!').trim().to_lowercase();
    if !TYPES.contains(&kind.as_str()) || summary.trim().is_empty() || first.chars().count() > 100 {
        return None;
    }
    let breaking = if head.ends_with('!') { "!" } else { "" };
    let scope = head
        .split_once('(')
        .and_then(|(_, rest)| rest.split(')').next())
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty() && paths.iter().any(|p| p.to_lowercase().contains(s.as_str())))
        .map(|s| format!("({s})"))
        .unwrap_or_default();
    let summary = imperative(summary.trim().trim_end_matches(['.', '。']));
    // "Add X" → "add X"; leaves acronyms and other scripts alone
    let summary = match summary.chars().next() {
        Some(c) if c.is_ascii_uppercase() && summary.chars().nth(1).is_some_and(|n| n.is_ascii_lowercase()) => {
            format!("{}{}", c.to_ascii_lowercase(), &summary[1..])
        }
        _ => summary.to_owned(),
    };
    Some(format!("{kind}{scope}{breaking}: {summary}"))
}

fn map_error(e: GenerateError) -> Error {
    match e {
        GenerateError::ContextWindow => Error::Other("ai:contextWindow".into()),
        GenerateError::Guardrail => Error::Other("ai:guardrail".into()),
        GenerateError::Other => Error::Other("ai:failed".into()),
    }
}

/// Splits a unified diff into per-file chunks.
fn split_files(diff: &str) -> Vec<&str> {
    let mut starts: Vec<usize> = diff.match_indices("diff --git ").map(|(i, _)| i).collect();
    starts.push(diff.len());
    starts.windows(2).map(|w| &diff[w[0]..w[1]]).collect()
}

/// Keeps the start of `text` within `budget` tokens.
fn clip(text: &str, budget: usize) -> &str {
    if tokens(text) <= budget {
        return text;
    }
    let mut end = (budget * 3).min(text.len());
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

pub async fn commit_message(env: &Arc<GitEnv>, settings: &Settings, root: &Path) -> Result<String> {
    match availability() {
        Availability::Available => {}
        other => {
            return Err(Error::Other(format!("ai:{}", serde_json::to_value(other)?.as_str().unwrap_or("unknown"))));
        }
    }
    let excludes: Vec<String> = settings
        .get("gitmenu.ai.exclude")
        .as_array()
        .map(|a| a.iter().filter_map(|v| v.as_str().map(|p| format!(":(exclude,glob){p}"))).collect())
        .unwrap_or_default();
    // Staged changes, or everything when nothing is staged (the commit would stage all)
    let mut staged = true;
    let mut diff = git_diff(env, root, staged, "--unified=2", &excludes).await?;
    if diff.trim().is_empty() {
        staged = false;
        diff = git_diff(env, root, staged, "--unified=2", &excludes).await?;
    }
    if diff.trim().is_empty() {
        return Err(Error::Other("ai:noChanges".into()));
    }
    let files = git_diff(env, root, staged, "--name-status", &excludes).await?;
    let paths: Vec<String> = files.lines().filter_map(|l| l.split('\t').next_back()).map(str::to_owned).collect();
    let language = settings.get_str("gitmenu.ai.commitMessage.language").unwrap_or_else(|| "English".into());
    let custom = settings.get_str("gitmenu.ai.commitMessage.customInstructions").unwrap_or_default();
    let instructions = instructions(&custom);

    tauri::async_runtime::spawn_blocking(move || {
        // In the user's language when it isn't English; the English subject if translation fails
        let localized = |subject: String| {
            if language.eq_ignore_ascii_case("english") {
                subject
            } else {
                translate(&subject, &language).unwrap_or(subject)
            }
        };
        if let Some(subject) = version_bump(&diff) {
            return Ok(localized(subject));
        }
        let window = context_size();
        // At most a quarter of the window lists files; the rest holds the instructions, the change
        // and a one-line answer
        let files = clip_files(&files, window / 4);
        let budget = window.saturating_sub(tokens(&instructions) + tokens(&files) + 200);
        let change = if tokens(&diff) <= budget { diff } else { summarize_files(&diff, budget)? };
        let prompt = prompt(&files, &change);
        for attempt in 0..2 {
            let prompt = if attempt == 0 {
                prompt.clone()
            } else {
                format!("{prompt}\nAnswer with one line shaped like: fix(scope): summary")
            };
            let raw = generate(&instructions, &prompt).map_err(map_error)?;
            if let Some(subject) = validate(&raw, &paths) {
                return Ok(localized(subject));
            }
        }
        Err(Error::Other("ai:format".into()))
    })
    .await
    .map_err(|e| Error::Other(e.to_string()))?
}

/// The change as the model sees it: the changed files, then the diff or per-file summaries.
fn prompt(files: &str, change: &str) -> String {
    format!("Changed files:\n{}\n\n{}\n\nWrite the subject line.", files.trim(), change.trim())
}

/// The changed-file list within `budget` tokens (estimated), then how many more there are
fn clip_files(files: &str, budget: usize) -> String {
    let lines: Vec<&str> = files.lines().filter(|l| !l.trim().is_empty()).collect();
    let mut used = 0;
    for (i, line) in lines.iter().enumerate() {
        used += line.len().div_ceil(3) + 1;
        if used > budget {
            return format!("{}\n… and {} more files", lines[..i].join("\n"), lines.len() - i);
        }
    }
    lines.join("\n")
}

/// `chore: bump version to X` when the change only edits the version field of manifests
/// (package.json, Cargo.toml, tauri.conf.json): the model calls that a feature
fn version_bump(diff: &str) -> Option<String> {
    let mut version = None;
    for line in diff.lines() {
        if line.starts_with("+++") || line.starts_with("---") {
            continue;
        }
        let Some(body) = line.strip_prefix('+').or_else(|| line.strip_prefix('-')) else { continue };
        let value = version_value(body.trim())?;
        if line.starts_with('+') {
            version = Some(value);
        }
    }
    version.map(|v| format!("chore: bump version to {v}"))
}

/// The value of a `"version": "1.2.0",` (JSON) or `version = "1.2.0"` (TOML) line
fn version_value(line: &str) -> Option<String> {
    let rest = match line.strip_prefix("\"version\"") {
        Some(rest) => rest.trim_start().strip_prefix(':')?,
        None => line.strip_prefix("version")?.trim_start().strip_prefix('=')?,
    };
    let value = rest.trim().trim_end_matches(',').trim().strip_prefix('"')?.strip_suffix('"')?;
    let valid = !value.is_empty() && value.chars().all(|c| c.is_ascii_alphanumeric() || ".-+".contains(c));
    valid.then(|| value.to_owned())
}

/// One line per file, then those lines become the change description. The first files get a
/// sentence from the model each; the rest are listed by name.
fn summarize_files(diff: &str, budget: usize) -> Result<String> {
    const SUMMARIZED: usize = 12;
    let summary_instructions =
        "Describe what this diff of one file changes, in one short English sentence. Output only the sentence.";
    let per_file = budget.saturating_sub(tokens(summary_instructions) + 100);
    let mut lines = Vec::new();
    for (i, file) in split_files(diff).into_iter().enumerate() {
        let header = file.lines().next().unwrap_or_default().trim_start_matches("diff --git ");
        if i >= SUMMARIZED || per_file < 100 {
            lines.push(format!("- {header}"));
        } else {
            let sentence = generate(summary_instructions, clip(file, per_file)).map_err(map_error)?;
            lines.push(format!("- {header}: {}", sentence.trim()));
        }
        if tokens(&lines.join("\n")) > budget {
            lines.pop();
            lines.push("- (more files changed)".into());
            break;
        }
    }
    Ok(format!("Summary of the changed files:\n{}", lines.join("\n")))
}

async fn git_diff(env: &GitEnv, root: &Path, staged: bool, format: &str, excludes: &[String]) -> Result<String> {
    let mut args = vec!["diff", "--no-color", "--no-ext-diff", format];
    if staged {
        args.push("--cached");
    }
    args.push("--");
    args.push(".");
    let excludes: Vec<&str> = excludes.iter().map(String::as_str).collect();
    args.extend(excludes);
    let output = env.git(root, &args).await?.output().await?;
    if !output.status.success() {
        return Err(Error::Git {
            message: "git diff failed".into(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
            code: output.status.code(),
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_conventional_commits() {
        let paths = ["src-tauri/src/queue.rs".to_owned(), "src/features/scm/ScmView.tsx".to_owned()];
        let v = |raw: &str| validate(raw, &paths);
        assert_eq!(v("feat(scm): add amend button").as_deref(), Some("feat(scm): add amend button"));
        assert_eq!(v("```\nfix: handle empty repo.\n```").as_deref(), Some("fix: handle empty repo"));
        // Only the subject line is kept
        assert_eq!(
            v("refactor(queue): split queue\n\n- keeps writes per worktree").as_deref(),
            Some("refactor(queue): split queue")
        );
        assert_eq!(v("## fix(queue): 재시도 추가").as_deref(), Some("fix(queue): 재시도 추가"));
        assert_eq!(v("*   feat(SCM): Adds retries").as_deref(), Some("feat(scm): add retries"));
        // A scope that names none of the files is dropped
        assert_eq!(v("fix(package): 버전 올림").as_deref(), Some("fix: 버전 올림"));
        assert_eq!(v("feat(api)!: drop v1").as_deref(), Some("feat!: drop v1"));
        assert_eq!(v("feat: added version \"0.3.2\"").as_deref(), Some("feat: add version \"0.3.2\""));
        assert_eq!(v("\"refactor: Adds LOCK_RETRIES\"").as_deref(), Some("refactor: add LOCK_RETRIES"));
        assert_eq!(v("fix: Simplified queue").as_deref(), Some("fix: simplify queue"));
        assert!(v("Added a button").is_none());
        assert!(v("feature: something").is_none());
    }

    #[test]
    fn a_version_only_change_is_a_version_bump() {
        // The user's report: package.json with only its version changed
        let diff = "diff --git a/package.json b/package.json\nindex 1..2 100644\n--- a/package.json\n+++ b/package.json\n@@ -1,4 +1,4 @@\n {\n   \"name\": \"hannote\",\n-  \"version\": \"0.3.1\",\n+  \"version\": \"0.3.2\",\n   \"private\": true,\n";
        assert_eq!(version_bump(diff).as_deref(), Some("chore: bump version to 0.3.2"));
        let cargo =
            "--- a/Cargo.toml\n+++ b/Cargo.toml\n@@ -2 +2 @@\n-version = \"0.1.0\"\n+version = \"0.2.0-beta.1\"\n";
        assert_eq!(version_bump(cargo).as_deref(), Some("chore: bump version to 0.2.0-beta.1"));
        let mixed = format!("{diff}diff --git a/src/a.ts b/src/a.ts\n+export const a = 1\n");
        assert_eq!(version_bump(&mixed), None);
        assert_eq!(version_bump("+  \"description\": \"x\",\n"), None);
    }

    #[test]
    fn long_file_lists_are_cut_with_a_count() {
        let files = (0..100).map(|i| format!("M\tsrc/file{i}.ts")).collect::<Vec<_>>().join("\n");
        let clipped = clip_files(&files, 40);
        assert!(clipped.ends_with("more files"), "{clipped}");
        assert!(clipped.len() < 200);
        assert_eq!(clip_files("M\ta\nA\tb", 100), "M\ta\nA\tb");
    }

    #[test]
    fn splits_diff_per_file() {
        let diff = "diff --git a/a b/a\n+1\ndiff --git a/b b/b\n+2\n";
        assert_eq!(split_files(diff).len(), 2);
    }

    /// Talks to the real model; run with `cargo test ai:: -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn generates_on_this_machine() {
        println!("availability: {:?}, context: {}", availability(), context_size());
        if availability() != Availability::Available {
            return;
        }
        let cases = [
            (
                "M\tpackage.json",
                "diff --git a/package.json b/package.json\n--- a/package.json\n+++ b/package.json\n@@ -1,4 +1,4 @@\n {\n   \"name\": \"hannote\",\n-  \"version\": \"0.3.1\",\n+  \"version\": \"0.3.2\",\n   \"private\": true,\n",
            ),
            (
                "M\tsrc/agent/tools/webSearch.ts",
                "diff --git a/src/agent/tools/webSearch.ts b/src/agent/tools/webSearch.ts\n--- a/src/agent/tools/webSearch.ts\n+++ b/src/agent/tools/webSearch.ts\n@@ -8,7 +8,7 @@ export const webSearch = tool({\n   name: 'web_search',\n-  description: 'Search the web.',\n+  description: 'Search the live web and return the top results with titles, URLs and snippets. Use it for recent events.',\n   parameters: z.object({ query: z.string() }),\n",
            ),
            (
                "M\tsrc-tauri/src/queue.rs",
                "diff --git a/src-tauri/src/queue.rs b/src-tauri/src/queue.rs\n--- a/src-tauri/src/queue.rs\n+++ b/src-tauri/src/queue.rs\n@@ -10,6 +10,9 @@\n+/// Retries when another git process holds index.lock\n+const LOCK_RETRIES: [u64; 5] = [50, 100, 200, 400, 800];\n",
            ),
            (
                "A\tsrc/components/Avatar.tsx\nM\tsrc/features/history/nodes.tsx",
                "diff --git a/src/components/Avatar.tsx b/src/components/Avatar.tsx\nnew file mode 100644\n--- /dev/null\n+++ b/src/components/Avatar.tsx\n@@ -0,0 +1,6 @@\n+export function Avatar({ email }: { email: string }) {\n+  const url = useAvatar(email)\n+  return <img src={url} className=\"size-4 rounded-full\" alt=\"\" />\n+}\ndiff --git a/src/features/history/nodes.tsx b/src/features/history/nodes.tsx\n@@ -40,6 +40,7 @@\n+      <Avatar email={commit.email} />\n       <span>{commit.message}</span>\n",
            ),
        ];
        println!("version bump, Korean: {:?}", translate("chore: bump version to 0.3.2", "Korean").ok());
        let instructions = instructions("");
        for (files, diff) in cases {
            let paths: Vec<String> =
                files.lines().filter_map(|l| l.split('\t').next_back()).map(str::to_owned).collect();
            let started = std::time::Instant::now();
            let raw = generate(&instructions, &prompt(files, diff)).unwrap();
            let subject = validate(&raw, &paths);
            println!("{:?} raw: {raw:?} → {subject:?}", started.elapsed());
            if let Some(subject) = subject {
                for language in ["Korean", "Japanese"] {
                    println!("  {language}: {:?}", translate(&subject, language).unwrap());
                }
            }
        }
    }

    #[test]
    fn availability_is_callable() {
        // Runs on every macOS; the answer depends on the machine
        let _ = availability();
    }
}
