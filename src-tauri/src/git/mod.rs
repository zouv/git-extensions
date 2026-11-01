pub mod cli;
pub mod commands;
pub mod diff;
pub mod history;
pub mod log;
mod operations;
pub mod rebase;
pub mod repo;
pub mod reset;
pub mod status;

use std::path::{Component, Path, PathBuf};

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

/// Git 文件参数必须是仓库内的普通相对路径；拒绝绝对路径、父目录跳转和前缀。
pub(crate) fn validate_relative_path(path: &str) -> GitResult<PathBuf> {
    if path.trim().is_empty() || path.contains('\0') {
        return Err(GitError::InvalidInput("file path is empty".into()));
    }
    let relative = Path::new(path);
    if relative.is_absolute() {
        return Err(GitError::InvalidInput(format!(
            "path must be repository-relative: {path}"
        )));
    }
    let mut clean = PathBuf::new();
    for component in relative.components() {
        match component {
            Component::Normal(part) => clean.push(part),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(GitError::InvalidInput(format!(
                    "path escapes the repository: {path}"
                )));
            }
        }
    }
    if clean.as_os_str().is_empty() {
        return Err(GitError::InvalidInput("file path is empty".into()));
    }
    Ok(clean)
}

/// 解析工作区内路径，并拒绝通过已有符号链接逃出仓库。
pub(crate) fn resolve_worktree_path(repo: &Repository, path: &str) -> GitResult<PathBuf> {
    let relative = validate_relative_path(path)?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| GitError::InvalidInput("bare repository has no worktree".into()))?;
    let root = workdir.canonicalize()?;
    let candidate = root.join(relative);
    let existing = match std::fs::symlink_metadata(&candidate) {
        // symlink_metadata 也能发现悬空 symlink；随后 canonicalize 失败会拒绝写入，
        // 避免 fs::write 跟随它在仓库外创建目标文件。
        Ok(_) => candidate.clone(),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => candidate
            .parent()
            .ok_or_else(|| GitError::InvalidInput("invalid file path".into()))?
            .to_path_buf(),
        Err(error) => return Err(error.into()),
    };
    let canonical = existing.canonicalize().map_err(|e| {
        GitError::InvalidInput(format!("cannot resolve repository path {path}: {e}"))
    })?;
    if !canonical.starts_with(&root) {
        return Err(GitError::InvalidInput(format!(
            "path escapes the repository: {path}"
        )));
    }
    Ok(candidate)
}
