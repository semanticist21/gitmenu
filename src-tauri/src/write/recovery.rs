//! Builds an exact worktree patch from the two trees in a recovery stash.
use std::{collections::HashSet, fmt::Display, io::Write};

use gix::{bstr::BStr, object::tree::Entry, zlib};

use crate::error::{Error, Result};

fn read_error(error: impl Display) -> Error {
    Error::Repo(error.to_string())
}

pub fn patch(repo: &gix::Repository, recovery: &str, paths: &[String]) -> Result<Vec<u8>> {
    let commit =
        repo.find_commit(gix::ObjectId::from_hex(recovery.as_bytes()).map_err(read_error)?).map_err(read_error)?;
    let index = commit.parent_ids().nth(1).ok_or_else(|| Error::Other("Recovery has no index snapshot".into()))?;
    let before = repo.find_commit(index).map_err(read_error)?.tree().map_err(read_error)?;
    let after = commit.tree().map_err(read_error)?;
    let null = gix::ObjectId::null(repo.object_hash());
    let mut patch = Vec::new();
    let mut seen = HashSet::new();
    for path in paths.iter().filter(|path| seen.insert(path.as_str())) {
        let old = before.lookup_entry_by_path(path).map_err(read_error)?;
        let new = after.lookup_entry_by_path(path).map_err(read_error)?;
        let identity = |entry: &Entry<'_>| (entry.object_id(), entry.mode());
        if old.as_ref().map(identity) == new.as_ref().map(identity) {
            continue;
        }
        if [old.as_ref(), new.as_ref()].into_iter().flatten().any(|entry| !entry.mode().is_blob_or_symlink()) {
            return Err(Error::Other(format!("Cannot restore non-file entry {path}")));
        }
        if let (Some(from), Some(to)) = (&old, &new)
            && from.mode().is_link() != to.mode().is_link()
        {
            entry_patch(&mut patch, path, old, None, null)?;
            entry_patch(&mut patch, path, None, new, null)?;
        } else {
            entry_patch(&mut patch, path, old, new, null)?;
        }
    }
    Ok(patch)
}

fn entry_patch(
    patch: &mut Vec<u8>,
    path: &str,
    old: Option<Entry<'_>>,
    new: Option<Entry<'_>>,
    null: gix::ObjectId,
) -> Result<()> {
    let a = format!("a/{path}");
    let b = format!("b/{path}");
    let a = gix::quote::ansi_c::quote(BStr::new(&a));
    let b = gix::quote::ansi_c::quote(BStr::new(&b));
    writeln!(patch, "diff --git {a} {b}")?;
    match (old.as_ref(), new.as_ref()) {
        (Some(old), Some(new)) if old.mode() != new.mode() => {
            writeln!(patch, "old mode {:06o}\nnew mode {:06o}", old.mode(), new.mode())?;
        }
        (None, Some(new)) => writeln!(patch, "new file mode {:06o}", new.mode())?,
        (Some(old), None) => writeln!(patch, "deleted file mode {:06o}", old.mode())?,
        _ => {}
    }
    let old_id = old.as_ref().map_or(null, Entry::object_id);
    let new_id = new.as_ref().map_or(null, Entry::object_id);
    if old_id != new_id {
        write!(patch, "index {old_id}..{new_id}")?;
        if let (Some(old), Some(new)) = (&old, &new)
            && old.mode() == new.mode()
        {
            write!(patch, " {:06o}", old.mode())?;
        }
        writeln!(patch, "\nGIT binary patch")?;
        for entry in [new, old] {
            let data = entry.map(|entry| entry.object().map_err(read_error)).transpose()?;
            literal(patch, data.as_ref().map_or(&[], |object| &object.data))?;
        }
    }
    Ok(())
}

/// A literal binary hunk makes Git check the entire preimage before writing, for text and binary alike.
fn literal(patch: &mut Vec<u8>, data: &[u8]) -> Result<()> {
    const BASE85: &[u8; 85] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+-;<=>?@^_`{|}~";
    writeln!(patch, "literal {}", data.len())?;
    let mut encoder = zlib::stream::deflate::Write::new(Vec::new(), zlib::Compression::BEST_SPEED);
    encoder.write_all(data)?;
    encoder.flush()?;
    for line in encoder.into_inner().chunks(52) {
        let len = line.len() as u8;
        patch.push(if len <= 26 { b'A' + len - 1 } else { b'a' + len - 27 });
        for group in line.chunks(4) {
            let mut bytes = [0; 4];
            bytes[..group.len()].copy_from_slice(group);
            let mut word = u32::from_be_bytes(bytes);
            let mut encoded = [0; 5];
            for digit in encoded.iter_mut().rev() {
                *digit = BASE85[(word % 85) as usize];
                word /= 85;
            }
            patch.extend_from_slice(&encoded);
        }
        patch.push(b'\n');
    }
    patch.push(b'\n');
    Ok(())
}
