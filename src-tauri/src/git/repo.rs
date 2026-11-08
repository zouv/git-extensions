use std::path::Path;

use serde::Serialize;

use super::open;
use crate::error::{GitError, GitResult};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoInfo {
    pub path: String,
    pub name: String,
    pub head_branch: Option<String>,
    pub head_oid: Option<String>,
    pub is_empty: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    pub name: String,
    pub is_head: bool,
    pub is_remote: bool,
    pub oid: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeInfo {
    pub name: String,
    pub path: String,
    pub locked: bool,
}

/// 列出当前仓库的 linked worktree；主工作区不在 git2 的 worktrees 列表中。
pub fn worktree_list(path: String) -> GitResult<Vec<WorktreeInfo>> {
    let repo = open(&path)?;
    let mut worktrees = Vec::new();
    for name in repo.worktrees()?.iter().flatten() {
        let Ok(worktree) = repo.find_worktree(name) else {
            continue;
        };
        let locked = matches!(
            worktree.is_locked(),
            Ok(git2::WorktreeLockStatus::Locked(_))
        );
        worktrees.push(WorktreeInfo {
            name: name.to_string(),
            path: worktree.path().to_string_lossy().into_owned(),
            locked,
        });
    }
    worktrees.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(worktrees)
}

/// index 中的普通 tracked 文件；排除 gitlink 与冲突 stage 重复项。
pub fn list_tracked_files(path: String) -> GitResult<Vec<String>> {
    let repo = open(&path)?;
    let index = repo.index()?;
    let mut files: Vec<String> = index
        .iter()
        .filter(|entry| {
            ((entry.flags >> 12) & 0x3) == 0
                && matches!(
                    entry.mode,
                    mode if mode == u32::from(git2::FileMode::Blob)
                        || mode == u32::from(git2::FileMode::BlobGroupWritable)
                        || mode == u32::from(git2::FileMode::BlobExecutable)
                        || mode == u32::from(git2::FileMode::Link)
                )
        })
        .map(|entry| String::from_utf8_lossy(&entry.path).replace('\\', "/"))
        .collect();
    files.sort();
    files.dedup();
    Ok(files)
}

pub fn open_repo(path: String) -> GitResult<RepoInfo> {
    let repo = open(&path)?;
    repo_info(&repo)
}

fn repo_info(repo: &git2::Repository) -> GitResult<RepoInfo> {
    let workdir = repo
        .workdir()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| repo.path().to_path_buf());
    let name = workdir
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| workdir.to_string_lossy().into_owned());
    let head_branch = repo
        .head()
        .ok()
        .and_then(|h| h.shorthand().map(|s| s.to_string()));
    Ok(RepoInfo {
        path: workdir.to_string_lossy().into_owned(),
        name,
        head_branch,
        head_oid: repo
            .head()
            .ok()
            .and_then(|h| h.target())
            .map(|oid| oid.to_string()),
        is_empty: repo.is_empty()?,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerTarget {
    pub repo: RepoInfo,
    /// repository | directory | file
    pub scope: String,
    /// 仓库根下的 POSIX 相对路径；仓库根自身为 None。
    pub relative_path: Option<String>,
}

/// Explorer 传入的可能是仓库子目录或普通文件。先找到实际工作区，再保留
/// 用户选中的范围，避免前端只拿到仓库根后丢失“当前目录/当前文件”语义。
pub fn resolve_explorer_target(path: String) -> GitResult<ExplorerTarget> {
    if path.trim().is_empty() || path.contains('\0') {
        return Err(GitError::InvalidInput("Explorer path is empty".into()));
    }
    let selected = Path::new(&path).canonicalize().map_err(|error| {
        GitError::InvalidInput(format!("cannot resolve Explorer path {path}: {error}"))
    })?;
    let metadata = std::fs::metadata(&selected)?;
    let discovery_root = if metadata.is_dir() {
        selected.as_path()
    } else if metadata.is_file() {
        selected
            .parent()
            .ok_or_else(|| GitError::InvalidInput("Explorer file has no parent".into()))?
    } else {
        return Err(GitError::InvalidInput(
            "Explorer path is not a regular file or directory".into(),
        ));
    };
    let repo = open(&discovery_root.to_string_lossy())?;
    let root = repo
        .workdir()
        .ok_or_else(|| GitError::InvalidInput("bare repository has no worktree".into()))?
        .canonicalize()?;
    let git_dir = repo.path().canonicalize()?;
    if !selected.starts_with(&root) || selected.starts_with(&git_dir) {
        return Err(GitError::InvalidInput(
            "Explorer path is outside the repository worktree".into(),
        ));
    }
    let info = repo_info(&repo)?;
    let relative = selected
        .strip_prefix(&root)
        .ok()
        .filter(|path| !path.as_os_str().is_empty());
    let relative_path = relative
        .map(|path| {
            path.to_str()
                .map(|path| path.replace('\\', "/"))
                .ok_or_else(|| GitError::InvalidInput("Explorer path is not valid Unicode".into()))
        })
        .transpose()?;
    let scope = if metadata.is_file() {
        "file"
    } else if relative_path.is_some() {
        "directory"
    } else {
        "repository"
    };
    Ok(ExplorerTarget {
        repo: info,
        scope: scope.into(),
        relative_path,
    })
}

pub fn get_branches(path: String) -> GitResult<Vec<BranchInfo>> {
    let repo = open(&path)?;
    let mut branches = Vec::new();
    for item in repo.branches(None)? {
        let (branch, kind) = item?;
        let reference = branch.get();
        let oid = reference
            .target()
            .map(|o| o.to_string())
            .unwrap_or_default();
        branches.push(BranchInfo {
            name: branch.name()?.unwrap_or_default().to_string(),
            is_head: branch.is_head(),
            is_remote: kind == git2::BranchType::Remote,
            oid,
        });
    }
    branches.sort_by(|a, b| a.is_remote.cmp(&b.is_remote).then(a.name.cmp(&b.name)));
    Ok(branches)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AheadBehind {
    pub ahead: usize,
    pub behind: usize,
}

/// 当前分支相对其 upstream 的 ahead/behind；无 upstream 时返回 None。
pub fn get_ahead_behind(path: String) -> GitResult<Option<AheadBehind>> {
    let repo = open(&path)?;
    let head = match repo.head() {
        Ok(h) => h,
        Err(_) => return Ok(None),
    };
    let Some(name) = head.shorthand() else {
        return Ok(None);
    };
    let local_oid = match head.target() {
        Some(oid) => oid,
        None => return Ok(None),
    };
    let branch = match repo.find_branch(name, git2::BranchType::Local) {
        Ok(b) => b,
        Err(_) => return Ok(None),
    };
    let upstream = match branch.upstream() {
        Ok(u) => u,
        Err(_) => return Ok(None),
    };
    let Some(upstream_oid) = upstream.get().target() else {
        return Ok(None);
    };
    let (ahead, behind) = repo.graph_ahead_behind(local_oid, upstream_oid)?;
    Ok(Some(AheadBehind { ahead, behind }))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteInfo {
    pub name: String,
    pub fetch_url: String,
    pub push_url: String,
}

/// 列出仓库已配置的全部远程及其 fetch/push URL。
pub fn remote_list(path: String) -> GitResult<Vec<RemoteInfo>> {
    let repo = open(&path)?;
    let mut remotes = Vec::new();
    for name in repo.remotes()?.iter().flatten() {
        let Ok(remote) = repo.find_remote(name) else {
            continue;
        };
        let fetch_url = remote.url().unwrap_or_default().to_string();
        let push_url = remote
            .pushurl()
            .or_else(|| remote.url())
            .unwrap_or_default()
            .to_string();
        remotes.push(RemoteInfo {
            name: name.to_string(),
            fetch_url,
            push_url,
        });
    }
    remotes.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(remotes)
}

/// 列出已完全合并到当前 HEAD 的本地分支（排除当前 HEAD 分支及主干保护名 main/master/develop/dev）。
pub fn get_merged_branches(path: String) -> GitResult<Vec<String>> {
    let repo = open(&path)?;
    let head_commit = match repo.head().and_then(|h| h.peel_to_commit()) {
        Ok(commit) => commit,
        Err(_) => return Ok(Vec::new()),
    };
    let head_id = head_commit.id();
    let mut merged = Vec::new();
    for item in repo.branches(Some(git2::BranchType::Local))? {
        let (branch, _) = item?;
        if branch.is_head() {
            continue;
        }
        let Some(name) = branch.name()? else {
            continue;
        };
        if matches!(name, "main" | "master" | "develop" | "dev") {
            continue;
        }
        let Some(branch_oid) = branch.get().target() else {
            continue;
        };
        if branch_oid == head_id || repo.graph_descendant_of(head_id, branch_oid)? {
            merged.push(name.to_string());
        }
    }
    merged.sort();
    Ok(merged)
}

