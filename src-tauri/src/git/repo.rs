use serde::Serialize;

use super::open;
use crate::error::GitResult;

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

pub fn open_repo(path: String) -> GitResult<RepoInfo> {
    let repo = open(&path)?;
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
