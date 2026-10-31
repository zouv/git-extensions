use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum GitError {
    #[error("git2: {0}")]
    Git2(#[from] git2::Error),
    #[error("git CLI: {0}")]
    Cli(String),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("invalid input: {0}")]
    InvalidInput(String),
}

impl Serialize for GitError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type GitResult<T> = Result<T, GitError>;
