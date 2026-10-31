use git2::{Delta, Diff, DiffOptions};
use serde::Serialize;

use super::open;
use crate::error::{GitError, GitResult};

/// 单文件 patch 超过该大小即截断，避免巨型 diff 撑爆 IPC 与前端渲染。
const MAX_PATCH_BYTES: usize = 512 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub path: String,
    pub old_path: Option<String>,
    /// added | deleted | modified | renamed | copied | typechange | untracked | conflicted
    pub status: String,
    pub is_binary: bool,
    pub truncated: bool,
    /// unified diff 文本（不含文件头之外的额外元信息）
    pub patch: String,
}

fn status_str(delta: Delta) -> &'static str {
    match delta {
        Delta::Added | Delta::Untracked => "added",
        Delta::Deleted => "deleted",
        Delta::Modified => "modified",
        Delta::Renamed => "renamed",
        Delta::Copied => "copied",
        Delta::Typechange => "typechange",
        Delta::Conflicted => "conflicted",
        _ => "modified",
    }
}

fn collect(diff: &Diff<'_>) -> GitResult<Vec<FileDiff>> {
    let mut files = Vec::with_capacity(diff.deltas().len());
    for idx in 0..diff.deltas().len() {
        let delta = diff.get_delta(idx).expect("delta index in range");
        let path = delta
            .new_file()
            .path()
            .or_else(|| delta.old_file().path())
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default();
        let old_path = delta
            .old_file()
            .path()
            .map(|p| p.to_string_lossy().into_owned());
        let mut file = FileDiff {
            path,
            old_path: (delta.status() == Delta::Renamed || delta.status() == Delta::Copied)
                .then_some(old_path)
                .flatten(),
            status: status_str(delta.status()).to_string(),
            is_binary: delta.flags().is_binary(),
            truncated: false,
            patch: String::new(),
        };
        if !file.is_binary {
            if let Some(mut patch) = git2::Patch::from_diff(diff, idx)? {
                let buf = patch.to_buf()?;
                let text = String::from_utf8_lossy(&buf);
                if text.len() > MAX_PATCH_BYTES {
                    let mut end = MAX_PATCH_BYTES;
                    while !text.is_char_boundary(end) {
                        end -= 1;
                    }
                    file.patch = text[..end].to_string();
                    file.truncated = true;
                } else {
                    file.patch = text.to_string();
                }
            }
        }
        files.push(file);
    }
    Ok(files)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareDiff {
    pub base_oid: String,
    pub target_oid: String,
    pub files: Vec<FileDiff>,
}

/// 比较两个 commit-ish 的 tree；base → target 的方向与 patch 一致。
#[tauri::command]
pub fn get_compare_diff(path: String, base: String, target: String) -> GitResult<CompareDiff> {
    let repo = open(&path)?;
    let base_commit = repo
        .revparse_single(&base)
        .map_err(|e| GitError::InvalidInput(format!("bad base revision {base}: {e}")))?
        .peel_to_commit()?;
    let target_commit = repo
        .revparse_single(&target)
        .map_err(|e| GitError::InvalidInput(format!("bad target revision {target}: {e}")))?
        .peel_to_commit()?;
    let base_tree = base_commit.tree()?;
    let target_tree = target_commit.tree()?;
    let mut diff = repo.diff_tree_to_tree(
        Some(&base_tree),
        Some(&target_tree),
        Some(&mut DiffOptions::new()),
    )?;
    diff.find_similar(Some(&mut git2::DiffFindOptions::new()))?;
    Ok(CompareDiff {
        base_oid: base_commit.id().to_string(),
        target_oid: target_commit.id().to_string(),
        files: collect(&diff)?,
    })
}

#[tauri::command]
pub fn get_commit_diff(path: String, oid: String) -> GitResult<Vec<FileDiff>> {
    let repo = open(&path)?;
    let oid = git2::Oid::from_str(&oid)
        .map_err(|_| crate::error::GitError::InvalidInput(format!("bad oid: {oid}")))?;
    let commit = repo.find_commit(oid)?;
    let tree = commit.tree()?;
    let parent_tree = match commit.parent_count() {
        0 => None,
        _ => Some(commit.parent(0)?.tree()?),
    };
    let mut opts = DiffOptions::new();
    let diff = repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), Some(&mut opts))?;
    collect(&diff)
}

/// Changes 面板的 diff：staged = HEAD vs index，unstaged = index vs workdir。
#[tauri::command]
pub fn get_worktree_diff(path: String, staged: bool) -> GitResult<Vec<FileDiff>> {
    let repo = open(&path)?;
    let mut opts = DiffOptions::new();
    opts.include_untracked(true).recurse_untracked_dirs(true);
    let mut diff = if staged {
        let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
        repo.diff_tree_to_index(head_tree.as_ref(), None, Some(&mut opts))?
    } else {
        repo.diff_index_to_workdir(None, Some(&mut opts))?
    };
    diff.find_similar(Some(&mut git2::DiffFindOptions::new()))?;
    collect(&diff)
}

#[tauri::command]
pub fn get_commit(path: String, oid: String) -> GitResult<CommitDetail> {
    let repo = open(&path)?;
    let oid = git2::Oid::from_str(&oid)
        .map_err(|_| crate::error::GitError::InvalidInput(format!("bad oid: {oid}")))?;
    let commit = repo.find_commit(oid)?;
    // author()/committer() 返回的 Signature 借用 commit，先绑定局部变量再构造结果
    let author = commit.author();
    let committer = commit.committer();
    let message = commit.message().unwrap_or_default().to_string();
    let parents = commit.parent_ids().map(|p| p.to_string()).collect();
    Ok(CommitDetail {
        oid: oid.to_string(),
        short_id: oid.to_string()[..7].to_string(),
        author_name: author.name().unwrap_or_default().to_string(),
        author_email: author.email().unwrap_or_default().to_string(),
        author_time: author.when().seconds(),
        committer_name: committer.name().unwrap_or_default().to_string(),
        committer_time: committer.when().seconds(),
        message,
        parents,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitDetail {
    pub oid: String,
    pub short_id: String,
    pub author_name: String,
    pub author_email: String,
    pub author_time: i64,
    pub committer_name: String,
    pub committer_time: i64,
    pub message: String,
    pub parents: Vec<String>,
}
