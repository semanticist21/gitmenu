//! Author avatars, in GitLens's order: GitHub noreply addresses map straight to an avatar;
//! on a GitHub remote with `gh` signed in, commit authors are looked up in one GraphQL call;
//! everything else gets a Gravatar URL (the window falls back to initials when it 404s).
//! Lookups are cached on disk by email.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::env::GitEnv;

/// Found avatars are re-checked after a week, misses after a day (like GitLens's cache).
const HIT_TTL: i64 = 7 * 24 * 3600;
const MISS_TTL: i64 = 24 * 3600;
/// After `gh` fails (not installed, signed out), don't try again for a while.
const GH_RETRY: Duration = Duration::from_secs(10 * 60);
const BATCH: usize = 100;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Entry {
    url: Option<String>,
    at: i64,
}

pub struct Avatars {
    cache: Mutex<HashMap<String, Entry>>,
    file: PathBuf,
    gh_failed: Mutex<Option<SystemTime>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvatarRequest {
    pub email: String,
    /// A commit by this author, for the GitHub lookup
    pub sha: Option<String>,
}

fn now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or_default()
}

/// `123+user@users.noreply.github.com` and `user@users.noreply.github.com`.
pub fn noreply(email: &str) -> Option<String> {
    let local = email.strip_suffix("@users.noreply.github.com")?;
    match local.split_once('+') {
        Some((id, _)) if id.chars().all(|c| c.is_ascii_digit()) => {
            Some(format!("https://avatars.githubusercontent.com/u/{id}?s=64&v=4"))
        }
        _ => Some(format!("https://avatars.githubusercontent.com/{local}?s=64")),
    }
}

pub fn gravatar(email: &str) -> String {
    let hash = Sha256::digest(email.trim().to_lowercase().as_bytes());
    let hex: String = hash.iter().map(|b| format!("{b:02x}")).collect();
    format!("https://www.gravatar.com/avatar/{hex}?s=64&d=404")
}

/// `owner/name` of a github.com remote URL (https, ssh or scp-like).
pub fn github_repo(url: &str) -> Option<(String, String)> {
    let rest = url
        .strip_prefix("git@github.com:")
        .or_else(|| url.split_once("github.com/").map(|(_, r)| r))
        .or_else(|| url.split_once("github.com:").map(|(_, r)| r))?;
    let mut parts = rest.trim_end_matches('/').trim_end_matches(".git").splitn(3, '/');
    let owner = parts.next()?.to_owned();
    let name = parts.next()?.to_owned();
    (!owner.is_empty() && !name.is_empty()).then_some((owner, name))
}

impl Avatars {
    pub fn new(cache_dir: &Path) -> Self {
        let file = cache_dir.join("avatars.json");
        let cache = std::fs::read(&file).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
        Self { cache: Mutex::new(cache), file, gh_failed: Mutex::new(None) }
    }

    fn save(&self) {
        let data = serde_json::to_vec(&*self.cache.lock().unwrap()).unwrap_or_default();
        if let Some(dir) = self.file.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(&self.file, data);
    }

    fn cached(&self, email: &str) -> Option<Option<String>> {
        let cache = self.cache.lock().unwrap();
        let entry = cache.get(email)?;
        let ttl = if entry.url.is_some() { HIT_TTL } else { MISS_TTL };
        (now() - entry.at < ttl).then(|| entry.url.clone())
    }

    /// Avatar URL per requested email.
    pub async fn resolve(
        &self,
        env: &GitEnv,
        root: &Path,
        github: Option<(String, String)>,
        requests: Vec<AvatarRequest>,
    ) -> HashMap<String, String> {
        let mut out = HashMap::new();
        let mut lookup = Vec::new();
        for request in requests {
            let key = request.email.trim().to_lowercase();
            if out.contains_key(&request.email) {
                continue;
            }
            if let Some(url) = noreply(&key) {
                out.insert(request.email, url);
                continue;
            }
            match self.cached(&key) {
                Some(Some(url)) => {
                    out.insert(request.email, url);
                }
                Some(None) => {
                    out.insert(request.email.clone(), gravatar(&key));
                }
                None => match (&github, &request.sha) {
                    (Some(_), Some(sha)) => lookup.push((request.email, key, sha.clone())),
                    _ => {
                        out.insert(request.email.clone(), gravatar(&key));
                    }
                },
            }
        }
        if lookup.is_empty() {
            return out;
        }
        let found = match &github {
            Some((owner, name)) => self.github_lookup(env, root, owner, name, &lookup).await,
            None => None,
        };
        if let Some(found) = &found {
            let mut cache = self.cache.lock().unwrap();
            for (_, key, _) in &lookup {
                cache.insert(key.clone(), Entry { url: found.get(key).cloned(), at: now() });
            }
        }
        if found.is_some() {
            self.save();
        }
        for (email, key, _) in lookup {
            let url = found.as_ref().and_then(|f| f.get(&key).cloned()).unwrap_or_else(|| gravatar(&key));
            out.insert(email, url);
        }
        out
    }

    /// Commit author avatars through `gh api graphql`; `None` when `gh` can't be used.
    async fn github_lookup(
        &self,
        env: &GitEnv,
        root: &Path,
        owner: &str,
        name: &str,
        lookup: &[(String, String, String)],
    ) -> Option<HashMap<String, String>> {
        if self.gh_failed.lock().unwrap().is_some_and(|t| t.elapsed().unwrap_or_default() < GH_RETRY) {
            return None;
        }
        let mut found = HashMap::new();
        for chunk in lookup.chunks(BATCH) {
            let fields: String = chunk
                .iter()
                .enumerate()
                .filter(|(_, (_, _, sha))| sha.chars().all(|c| c.is_ascii_hexdigit()))
                .map(|(i, (_, _, sha))| {
                    format!("c{i}: object(oid: \"{sha}\") {{ ... on Commit {{ author {{ email avatarUrl(size: 64) }} }} }}\n")
                })
                .collect();
            let query = format!(
                "query($owner: String!, $name: String!) {{ repository(owner: $owner, name: $name) {{ {fields} }} }}"
            );
            let args = [
                "api".to_owned(),
                "graphql".to_owned(),
                "-f".to_owned(),
                format!("query={query}"),
                "-F".to_owned(),
                format!("owner={owner}"),
                "-F".to_owned(),
                format!("name={name}"),
            ];
            let output = match env.command("gh", root).await {
                Ok(mut cmd) => cmd.args(&args).output().await.ok(),
                Err(_) => None,
            };
            let Some(output) = output.filter(|o| o.status.success()) else {
                *self.gh_failed.lock().unwrap() = Some(SystemTime::now());
                return None;
            };
            let json: serde_json::Value = serde_json::from_slice(&output.stdout).ok()?;
            let Some(repo) = json.pointer("/data/repository").and_then(|r| r.as_object()) else { continue };
            for (i, (_, key, _)) in chunk.iter().enumerate() {
                if let Some(url) =
                    repo.get(&format!("c{i}")).and_then(|c| c.pointer("/author/avatarUrl")).and_then(|u| u.as_str())
                {
                    found.insert(key.clone(), url.to_owned());
                }
            }
        }
        Some(found)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn noreply_and_gravatar() {
        assert_eq!(
            noreply("123+ann@users.noreply.github.com").as_deref(),
            Some("https://avatars.githubusercontent.com/u/123?s=64&v=4")
        );
        assert_eq!(
            noreply("ann@users.noreply.github.com").as_deref(),
            Some("https://avatars.githubusercontent.com/ann?s=64")
        );
        assert_eq!(noreply("ann@example.com"), None);
        // Gravatar's documented SHA-256 example
        assert!(
            gravatar(" MyEmailAddress@example.com ")
                .contains("84059b07d4be67b806386c0aad8070a23f18836bbaae342275dc0a83414c32ee")
        );
    }

    #[test]
    fn github_repos() {
        let expected = Some(("kkom".to_owned(), "gitside".to_owned()));
        assert_eq!(github_repo("git@github.com:kkom/gitside.git"), expected);
        assert_eq!(github_repo("https://github.com/kkom/gitside"), expected);
        assert_eq!(github_repo("ssh://git@github.com/kkom/gitside.git"), expected);
        assert_eq!(github_repo("https://gitlab.com/kkom/gitside"), None);
    }
}
