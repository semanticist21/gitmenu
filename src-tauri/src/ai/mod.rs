//! Commit messages from Apple's on-device Foundation Models (macOS 26+), through the Swift
//! bridge in bridge.swift. The model's window is small (4096 tokens) and it drifts from
//! formats, so: strict instructions, per-file summaries when the diff doesn't fit, and the
//! answer is checked against the Conventional Commits shape (one retry).

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
    fn gitside_fm_availability() -> i32;
    fn gitside_fm_token_count(text: *const c_char) -> i64;
    fn gitside_fm_context_size() -> i64;
    fn gitside_fm_generate(
        instructions: *const c_char,
        prompt: *const c_char,
        error: *mut i32,
    ) -> *mut c_char;
    fn gitside_fm_free(pointer: *mut c_char);
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
    match unsafe { gitside_fm_availability() } {
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
    let pointer = unsafe { gitside_fm_generate(instructions.as_ptr(), prompt.as_ptr(), &mut code) };
    if pointer.is_null() {
        return Err(match code {
            10 => GenerateError::ContextWindow,
            11 => GenerateError::Guardrail,
            _ => GenerateError::Other,
        });
    }
    let text = unsafe { CStr::from_ptr(pointer) }
        .to_string_lossy()
        .into_owned();
    unsafe { gitside_fm_free(pointer) };
    Ok(text)
}

/// Tokens in `text`: exact on macOS 26.4+, otherwise a conservative estimate.
fn tokens(text: &str) -> usize {
    let c = CString::new(text.replace('\0', "")).unwrap();
    let count = unsafe { gitside_fm_token_count(c.as_ptr()) };
    if count >= 0 {
        count as usize
    } else {
        // Code tokenizes at roughly 3 characters per token
        text.len().div_ceil(3)
    }
}

fn context_size() -> usize {
    let size = unsafe { gitside_fm_context_size() };
    if size > 0 { size as usize } else { 4096 }
}

const TYPES: [&str; 11] = [
    "feat", "fix", "docs", "style", "refactor", "perf", "test", "build", "ci", "chore", "revert",
];

fn instructions(language: &str, custom: &str) -> String {
    let example = if language.eq_ignore_ascii_case("english") {
        "fix(queue): retry while another git process holds index.lock"
    } else {
        "fix(queue): <the summary written in the requested language>"
    };
    let mut text = format!(
        "You write one git commit message in the Conventional Commits format for the change the user gives you.\n\
         Output only the commit message: no explanation, no markdown, no code fences, no quotes, no angle brackets.\n\
         The first line looks exactly like these examples:\n\
         feat(scm): add amend to the commit menu\n\
         {example}\n\
         docs: explain the settings file location\n\
         Rules for the first line:\n\
         - It starts with one type word: {types}\n\
         - feat adds something users can do; fix repairs wrong behavior; refactor changes code without changing behavior; \
         docs only touches documentation; test only touches tests; build is dependencies or build config; chore is anything else\n\
         - An optional scope in parentheses names the area, then a colon and a space\n\
         - The summary is imperative (\"add\", not \"added\" or \"adds\"), has no trailing period, and the line is at most 72 characters\n\
         Only if it helps, add a blank line and at most three short lines starting with \"- \" that say why.\n\
         Language: write the summary and the body in {language}. The type and scope stay in English.",
        types = TYPES.join(", "),
    );
    if !custom.trim().is_empty() {
        text.push_str("\nAdditional instructions from the user:\n");
        text.push_str(custom.trim());
    }
    text
}

/// A clean first line of the right shape, or `None`.
fn validate(raw: &str) -> Option<String> {
    let text = raw
        .trim()
        .trim_start_matches("```")
        .trim_start_matches("text")
        .trim_end_matches("```")
        .trim()
        .trim_matches('"')
        .trim();
    let mut lines = text.lines();
    // The model sometimes copies the template's angle brackets: `<feat>(scope): …`
    // …or starts it as a markdown heading
    let first = lines
        .next()?
        .trim()
        .trim_start_matches('#')
        .trim()
        .replace(['<', '>'], "");
    let (head, summary) = first.split_once(": ")?;
    let kind = head
        .split('(')
        .next()?
        .trim_end_matches('!')
        .trim()
        .to_lowercase();
    if !TYPES.contains(&kind.as_str()) || summary.trim().is_empty() || first.chars().count() > 100 {
        return None;
    }
    let scope = head.find('(').map(|i| &head[i..]).unwrap_or_default();
    let summary = summary.trim().trim_end_matches('.');
    // Imperative, lowercase start for English-style summaries ("Adds X" → "adds X" stays readable)
    let summary = match summary.chars().next() {
        Some(c)
            if c.is_ascii_uppercase()
                && summary
                    .chars()
                    .nth(1)
                    .is_some_and(|n| n.is_ascii_lowercase()) =>
        {
            format!("{}{}", c.to_ascii_lowercase(), &summary[1..])
        }
        _ => summary.to_owned(),
    };
    let body: Vec<&str> = lines
        .map(str::trim_end)
        .skip_while(|l| l.trim().is_empty())
        .collect();
    let first = format!("{kind}{scope}: {summary}");
    Some(if body.is_empty() {
        first
    } else {
        format!("{first}\n\n{}", body.join("\n"))
    })
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
            return Err(Error::Other(format!(
                "ai:{}",
                serde_json::to_value(other)?.as_str().unwrap_or("unknown")
            )));
        }
    }
    let excludes: Vec<String> = settings
        .get("gitside.ai.exclude")
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(|p| format!(":(exclude,glob){p}")))
                .collect()
        })
        .unwrap_or_default();
    // Staged changes, or everything when nothing is staged (the commit would stage all)
    let mut diff = git_diff(env, root, true, &excludes).await?;
    if diff.trim().is_empty() {
        diff = git_diff(env, root, false, &excludes).await?;
    }
    if diff.trim().is_empty() {
        return Err(Error::Other("ai:noChanges".into()));
    }
    let language = settings
        .get_str("gitside.ai.commitMessage.language")
        .unwrap_or_else(|| "English".into());
    let custom = settings
        .get_str("gitside.ai.commitMessage.customInstructions")
        .unwrap_or_default();
    let instructions = instructions(&language, &custom);

    tauri::async_runtime::spawn_blocking(move || {
        let window = context_size();
        // Room for the instructions and the answer
        let budget = window.saturating_sub(tokens(&instructions) + 400);
        let change = if tokens(&diff) <= budget {
            diff
        } else {
            summarize_files(&diff, budget)?
        };
        let prompt = format!("Write the commit message (summary in {language}) for this change:\n\n{change}");
        for attempt in 0..2 {
            let prompt = if attempt == 0 {
                prompt.clone()
            } else {
                format!("{prompt}\n\nRemember: the first line must be <type>(<scope>): <summary> with type from the list.")
            };
            let raw = generate(&instructions, &prompt).map_err(map_error)?;
            if let Some(message) = validate(&raw) {
                return Ok(message);
            }
        }
        Err(Error::Other("ai:format".into()))
    })
    .await
    .map_err(|e| Error::Other(e.to_string()))?
}

/// One line per file, then those lines become the change description.
fn summarize_files(diff: &str, budget: usize) -> Result<String> {
    let summary_instructions = "Describe what this diff of one file changes, in one short English sentence. Output only the sentence.";
    let per_file = budget.saturating_sub(tokens(summary_instructions) + 100);
    let mut lines = Vec::new();
    for file in split_files(diff) {
        let header = file
            .lines()
            .next()
            .unwrap_or_default()
            .trim_start_matches("diff --git ");
        let sentence = generate(summary_instructions, clip(file, per_file)).map_err(map_error)?;
        lines.push(format!("- {header}: {}", sentence.trim()));
        if tokens(&lines.join("\n")) > budget {
            lines.pop();
            lines.push("- (more files changed)".into());
            break;
        }
    }
    Ok(format!(
        "Summary of the changed files:\n{}",
        lines.join("\n")
    ))
}

async fn git_diff(env: &GitEnv, root: &Path, staged: bool, excludes: &[String]) -> Result<String> {
    let mut args = vec!["diff", "--no-color", "--no-ext-diff", "--unified=2"];
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
        assert_eq!(
            validate("feat(scm): add amend button").as_deref(),
            Some("feat(scm): add amend button")
        );
        assert_eq!(
            validate("```\nfix: handle empty repo.\n```").as_deref(),
            Some("fix: handle empty repo")
        );
        assert_eq!(
            validate("refactor: split queue\n\n- keeps writes per worktree").as_deref(),
            Some("refactor: split queue\n\n- keeps writes per worktree")
        );
        assert_eq!(
            validate("## fix(queue): 재시도 추가").as_deref(),
            Some("fix(queue): 재시도 추가")
        );
        assert_eq!(
            validate("<feat>(add): Adds retries").as_deref(),
            Some("feat(add): adds retries")
        );
        assert!(validate("Added a button").is_none());
        assert!(validate("feature: something").is_none());
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
        println!(
            "availability: {:?}, context: {}",
            availability(),
            context_size()
        );
        if availability() != Availability::Available {
            return;
        }
        let diff = "diff --git a/src/queue.rs b/src/queue.rs\n--- a/src/queue.rs\n+++ b/src/queue.rs\n@@ -10,6 +10,9 @@\n+/// Retries when another git process holds index.lock\n+const LOCK_RETRIES: [u64; 5] = [50, 100, 200, 400, 800];\n";
        let started = std::time::Instant::now();
        let raw = generate(
            &instructions("English", ""),
            &format!("Write the commit message (summary in English) for this change:\n\n{diff}"),
        )
        .unwrap();
        println!("raw ({:?}): {raw:?}", started.elapsed());
        println!("validated: {:?}", validate(&raw));
        let raw = generate(
            &instructions("Korean", ""),
            &format!("Write the commit message (summary in Korean) for this change:\n\n{diff}"),
        )
        .unwrap();
        println!("korean: {:?}", validate(&raw).unwrap_or(raw));
    }

    #[test]
    fn availability_is_callable() {
        // Runs on every macOS; the answer depends on the machine
        let _ = availability();
    }
}
