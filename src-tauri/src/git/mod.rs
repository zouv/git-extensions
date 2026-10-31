pub mod cli;
pub mod diff;
pub mod history;
pub mod log;
pub mod repo;
pub mod status;

use git2::Repository;

use crate::error::{GitError, GitResult};

/// 每个命令都按路径重新打开仓库：打开很快，且无全局状态，
/// 天然避免跨仓库缓存串数据的问题。
pub fn open(path: &str) -> GitResult<Repository> {
    if path.trim().is_empty() {
        return Err(GitError::InvalidInput("repository path is empty".into()));
    }
    Ok(Repository::discover(path)?)
}
