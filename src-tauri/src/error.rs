use serde::{Serialize, Serializer};

/// Errors returned to the frontend as `{ kind, message }`.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Json(#[from] serde_json::Error),
    #[error("settings: {0}")]
    Settings(String),
    #[error("git is not installed or not found on PATH")]
    GitMissing,
    #[error("{message}")]
    Git { message: String, stderr: String, code: Option<i32> },
    #[error("{0}")]
    Repo(String),
    #[error("another process is holding {path}: {holder}")]
    IndexLocked { path: String, holder: String },
    #[error("{0} is already running")]
    AlreadyRunning(String),
    #[error("cancelled")]
    Cancelled,
    #[error("not found: {0}")]
    NotFound(String),
    #[error("{0}")]
    Other(String),
}

impl Error {
    fn kind(&self) -> &'static str {
        match self {
            Error::Io(_) => "io",
            Error::Json(_) => "json",
            Error::Settings(_) => "settings",
            Error::GitMissing => "gitMissing",
            Error::Git { .. } => "git",
            Error::Repo(_) => "repo",
            Error::IndexLocked { .. } => "indexLocked",
            Error::AlreadyRunning(_) => "alreadyRunning",
            Error::Cancelled => "cancelled",
            Error::NotFound(_) => "notFound",
            Error::Other(_) => "other",
        }
    }
}

impl Serialize for Error {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut s = serializer.serialize_struct("Error", 3)?;
        s.serialize_field("kind", self.kind())?;
        s.serialize_field("message", &self.to_string())?;
        let stderr = match self {
            Error::Git { stderr, .. } => Some(stderr.as_str()),
            _ => None,
        };
        s.serialize_field("stderr", &stderr)?;
        s.end()
    }
}

impl From<tauri::Error> for Error {
    fn from(e: tauri::Error) -> Self {
        Error::Other(e.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;
