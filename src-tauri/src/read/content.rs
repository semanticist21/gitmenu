//! File contents at HEAD, in the index, in the worktree, or at a commit, and the line diff
//! between two of them (for the diff tab and for staging parts of a file).

use std::path::Path;

use gix::bstr::ByteSlice;
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

/// Where one side of a diff comes from.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Side {
    Empty,
    Head,
    Index,
    Worktree,
    /// Any revision git understands (`abc123`, `HEAD~2`, `stash@{0}`)
    Commit {
        rev: String,
    },
}

/// Reads `path` from `side`; `Ok(None)` when it doesn't exist there.
pub fn load(repo: &gix::Repository, root: &Path, path: &str, side: &Side) -> Result<Option<Vec<u8>>> {
    let err = |e: &dyn std::fmt::Display| Error::Repo(e.to_string());
    match side {
        Side::Empty => Ok(None),
        Side::Worktree => {
            let full = root.join(path);
            match std::fs::symlink_metadata(&full) {
                Ok(meta) if meta.file_type().is_symlink() => {
                    Ok(Some(std::fs::read_link(&full)?.to_string_lossy().into_owned().into_bytes()))
                }
                Ok(meta) if meta.is_file() => Ok(Some(std::fs::read(&full)?)),
                _ => Ok(None),
            }
        }
        Side::Index => {
            let index = repo.index_or_empty().map_err(|e| err(&e))?;
            let Some(entry) = index.entry_by_path(path.as_bytes().as_bstr()) else { return Ok(None) };
            let object = repo.find_object(entry.id).map_err(|e| err(&e))?;
            Ok(Some(object.data.clone()))
        }
        Side::Head => tree_blob(repo, "HEAD", path),
        Side::Commit { rev } => tree_blob(repo, rev, path),
    }
}

fn tree_blob(repo: &gix::Repository, rev: &str, path: &str) -> Result<Option<Vec<u8>>> {
    let err = |e: &dyn std::fmt::Display| Error::Repo(e.to_string());
    let Ok(id) = repo.rev_parse_single(rev) else { return Ok(None) };
    let commit = id.object().map_err(|e| err(&e))?.peel_to_commit().map_err(|e| err(&e))?;
    let tree = commit.tree().map_err(|e| err(&e))?;
    let Some(entry) = tree.lookup_entry_by_path(path).map_err(|e| err(&e))? else { return Ok(None) };
    let object = entry.object().map_err(|e| err(&e))?;
    Ok(Some(object.data.clone()))
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ContentKind {
    Text,
    Binary,
    Image,
    TooLarge,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SideContent {
    pub exists: bool,
    pub size: u64,
    /// Text for text files
    pub text: Option<String>,
    /// `data:` URL for images
    pub data_url: Option<String>,
}

/// A changed region: `left` lines `[left_start, left_start + left_count)` became `right` lines.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Hunk {
    pub left_start: u32,
    pub left_count: u32,
    pub right_start: u32,
    pub right_count: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffResult {
    pub kind: ContentKind,
    pub left: SideContent,
    pub right: SideContent,
    pub hunks: Vec<Hunk>,
}

const IMAGE_EXTENSIONS: [(&str, &str); 9] = [
    ("png", "image/png"),
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("jpe", "image/jpeg"),
    ("gif", "image/gif"),
    ("webp", "image/webp"),
    ("avif", "image/avif"),
    ("bmp", "image/bmp"),
    ("ico", "image/x-icon"),
];
/// Images larger than this are summarized like other binary files
const IMAGE_PREVIEW_LIMIT: usize = 20 * 1024 * 1024;

fn is_binary(bytes: &[u8]) -> bool {
    bytes[..bytes.len().min(8000)].contains(&0)
}

fn image_mime(path: &str) -> Option<&'static str> {
    let ext = path.rsplit('.').next()?.to_ascii_lowercase();
    if ext == "svg" {
        return Some("image/svg+xml");
    }
    IMAGE_EXTENSIONS.iter().find(|(e, _)| *e == ext).map(|(_, m)| *m)
}

fn data_url(mime: &str, bytes: &[u8]) -> String {
    use base64::Engine;
    format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes))
}

pub struct DiffOptions {
    pub max_bytes: u64,
    pub ignore_trim_whitespace: bool,
}

pub fn diff(
    left_path: &str,
    right_path: &str,
    left: Option<Vec<u8>>,
    right: Option<Vec<u8>>,
    options: &DiffOptions,
) -> DiffResult {
    let size = |b: &Option<Vec<u8>>| b.as_ref().map_or(0, |b| b.len() as u64);
    let side = |b: &Option<Vec<u8>>| SideContent { exists: b.is_some(), size: size(b), text: None, data_url: None };
    if size(&left) > options.max_bytes || size(&right) > options.max_bytes {
        return DiffResult { kind: ContentKind::TooLarge, left: side(&left), right: side(&right), hunks: Vec::new() };
    }
    // SVG is text, but VS Code previews it as an image
    let mime = image_mime(right_path).or_else(|| image_mime(left_path));
    let binary = left.as_deref().is_some_and(is_binary) || right.as_deref().is_some_and(is_binary);
    if let Some(mime) = mime
        && (binary || mime == "image/svg+xml")
    {
        let preview = |b: &Option<Vec<u8>>| {
            let mut s = side(b);
            s.data_url = b.as_ref().filter(|b| b.len() <= IMAGE_PREVIEW_LIMIT).map(|b| data_url(mime, b));
            s
        };
        return DiffResult {
            kind: ContentKind::Image,
            left: preview(&left),
            right: preview(&right),
            hunks: Vec::new(),
        };
    }
    if binary {
        return DiffResult { kind: ContentKind::Binary, left: side(&left), right: side(&right), hunks: Vec::new() };
    }
    let left_text = left.as_ref().map(|b| String::from_utf8_lossy(b).into_owned());
    let right_text = right.as_ref().map(|b| String::from_utf8_lossy(b).into_owned());
    let hunks = line_hunks(
        left_text.as_deref().unwrap_or_default(),
        right_text.as_deref().unwrap_or_default(),
        options.ignore_trim_whitespace,
    );
    DiffResult {
        kind: ContentKind::Text,
        left: SideContent { text: left_text, ..side(&left) },
        right: SideContent { text: right_text, ..side(&right) },
        hunks,
    }
}

/// Line hunks between two texts (histogram diff, like `git diff --histogram`).
/// With `ignore_trim_whitespace`, lines that differ only in leading/trailing whitespace match.
pub fn line_hunks(left: &str, right: &str, ignore_trim_whitespace: bool) -> Vec<Hunk> {
    use gix::diff::blob::{Algorithm, Diff, InternedInput};
    let normalize = |text: &str| -> String {
        if !ignore_trim_whitespace {
            return text.to_owned();
        }
        let mut out = String::with_capacity(text.len());
        for line in text.split_inclusive('\n') {
            out.push_str(line.trim());
            out.push('\n');
        }
        out
    };
    let (left, right) = (normalize(left), normalize(right));
    let input = InternedInput::new(left.as_str(), right.as_str());
    let mut diff = Diff::compute(Algorithm::Histogram, &input);
    diff.postprocess_lines(&input);
    diff.hunks()
        .map(|h| Hunk {
            left_start: h.before.start,
            left_count: h.before.end - h.before.start,
            right_start: h.after.start,
            right_count: h.after.end - h.after.start,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_line_hunks() {
        let hunks = line_hunks("a\nb\nc\nd\n", "a\nB\nc\nd\ne\n", false);
        assert_eq!(
            hunks,
            vec![
                Hunk { left_start: 1, left_count: 1, right_start: 1, right_count: 1 },
                Hunk { left_start: 4, left_count: 0, right_start: 4, right_count: 1 },
            ]
        );
    }

    #[test]
    fn ignores_trailing_whitespace_when_asked() {
        assert_eq!(line_hunks("a  \nb\n", "a\nb\n", true), vec![]);
        assert_eq!(line_hunks("a  \nb\n", "a\nb\n", false).len(), 1);
    }

    #[test]
    fn classifies_content() {
        let options = DiffOptions { max_bytes: 10, ignore_trim_whitespace: false };
        assert_eq!(diff("a.txt", "a.txt", Some(b"0123456789ab".to_vec()), None, &options).kind, ContentKind::TooLarge);
        let options = DiffOptions { max_bytes: 1 << 20, ignore_trim_whitespace: false };
        assert_eq!(diff("a.bin", "a.bin", Some(vec![0, 1]), Some(vec![0, 2]), &options).kind, ContentKind::Binary);
        let image = diff("a.png", "a.png", None, Some(vec![0x89, b'P', b'N', b'G', 0]), &options);
        assert_eq!(image.kind, ContentKind::Image);
        assert!(image.right.data_url.unwrap().starts_with("data:image/png;base64,"));
    }
}
