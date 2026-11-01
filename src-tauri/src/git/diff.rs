use super::{open, validate_relative_path};
use crate::error::{GitError, GitResult};
use git2::{Delta, Diff, DiffOptions};
use serde::Serialize;
const MAX_PATCH_BYTES: usize = 512 * 1024;
const MAX_TOTAL_PATCH_BYTES: usize = 4 * 1024 * 1024;
const MAX_DIFF_FILE_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub path: String,
    pub old_path: Option<String>,
    pub status: String,
    pub is_binary: bool,
    pub truncated: bool,
    pub patch: String,
}
fn status_str(delta: Delta) -> &'static str {
    match delta {
        Delta::Added | Delta::Untracked => "added",
        Delta::Deleted => "deleted",
        Delta::Renamed => "renamed",
        Delta::Copied => "copied",
        Delta::Typechange => "typechange",
        Delta::Conflicted => "conflicted",
        _ => "modified",
    }
}
// 文件清单只读元数据；patch 按单文件生成，避免全量 to_buf 的内存峰值。
// libgit2 工作区 delta 的 size/OID 可能尚未填充；在生成 patch 前补查磁盘/对象头。
fn oversized(repo: &git2::Repository, delta: &git2::DiffDelta<'_>) -> bool {
    [delta.old_file(), delta.new_file()].iter().any(|file| {
        if file.size() > MAX_DIFF_FILE_BYTES {
            return true;
        }
        if !file.id().is_zero() {
            return repo
                .odb()
                .ok()
                .and_then(|odb| odb.read_header(file.id()).ok())
                .is_some_and(|(size, _)| size as u64 > MAX_DIFF_FILE_BYTES);
        }
        repo.workdir()
            .zip(file.path())
            .and_then(|(root, path)| std::fs::symlink_metadata(root.join(path)).ok())
            .is_some_and(|meta| meta.is_file() && meta.len() > MAX_DIFF_FILE_BYTES)
    })
}
fn collect(repo: &git2::Repository, diff: &Diff<'_>, patches: bool) -> GitResult<Vec<FileDiff>> {
    let mut files = Vec::with_capacity(diff.deltas().len());
    let mut budget = MAX_TOTAL_PATCH_BYTES;
    for idx in 0..diff.deltas().len() {
        let delta = diff.get_delta(idx).expect("delta in range");
        let path = delta
            .new_file()
            .path()
            .or_else(|| delta.old_file().path())
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default();
        let mut file = FileDiff {
            path,
            old_path: if matches!(delta.status(), Delta::Renamed | Delta::Copied) {
                delta
                    .old_file()
                    .path()
                    .map(|p| p.to_string_lossy().into_owned())
            } else {
                None
            },
            status: status_str(delta.status()).into(),
            is_binary: delta.flags().is_binary(),
            truncated: false,
            patch: String::new(),
        };
        if patches {
            if oversized(repo, &delta) || budget == 0 {
                file.truncated = true;
            } else {
                // from_diff 才会读取内容并确定 binary；不要使用生成 patch 前的 flags。
                let patch = git2::Patch::from_diff(diff, idx)?;
                file.is_binary = diff.get_delta(idx).unwrap().flags().is_binary();
                if let Some(mut patch) = patch {
                    file.is_binary = patch.delta().flags().is_binary();
                    if !file.is_binary {
                        let limit = MAX_PATCH_BYTES.min(budget);
                        let mut bytes = Vec::new();
                        let result = patch.print(&mut |_, _, line| {
                            let prefix = matches!(line.origin(), '+' | '-' | ' ');
                            let required = line.content().len() + usize::from(prefix);
                            if bytes.len() + required > limit {
                                file.truncated = true;
                                return false;
                            }
                            if prefix {
                                bytes.push(line.origin() as u8);
                            }
                            bytes.extend_from_slice(line.content());
                            true
                        });
                        if !file.truncated {
                            result?;
                        }
                        file.patch = String::from_utf8_lossy(&bytes).into_owned();
                        budget = budget.saturating_sub(file.patch.len());
                    }
                }
            }
        }
        files.push(file);
    }
    Ok(files)
}
fn options(file: Option<&str>) -> GitResult<DiffOptions> {
    let mut opts = DiffOptions::new();
    // 自己对大文本做截断，不把大文本伪装成 binary。
    opts.max_size(i64::MAX);
    if let Some(file) = file {
        validate_relative_path(file)?;
        opts.disable_pathspec_match(true).pathspec(file);
    }
    Ok(opts)
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareDiff {
    pub base_oid: String,
    pub target_oid: String,
    pub files: Vec<FileDiff>,
}
fn compare(
    path: String,
    base: String,
    target: String,
    file: Option<&str>,
    old_file: Option<&str>,
    patches: bool,
) -> GitResult<CompareDiff> {
    let repo = open(&path)?;
    let base_commit = repo.revparse_single(&base)?.peel_to_commit()?;
    let target_commit = repo.revparse_single(&target)?.peel_to_commit()?;
    let mut opts = options(file)?;
    if let Some(old) = old_file {
        validate_relative_path(old)?;
        opts.pathspec(old);
    }
    let mut diff = repo.diff_tree_to_tree(
        Some(&base_commit.tree()?),
        Some(&target_commit.tree()?),
        Some(&mut opts),
    )?;
    // 全清单检测 rename；单文件匹配保留原 delta 对象，避免搜索全部文件内容。
    if file.is_none() || old_file.is_some() {
        diff.find_similar(Some(&mut git2::DiffFindOptions::new()))?;
    }
    Ok(CompareDiff {
        base_oid: base_commit.id().to_string(),
        target_oid: target_commit.id().to_string(),
        files: collect(&repo, &diff, patches)?,
    })
}
pub fn get_compare_diff(path: String, base: String, target: String) -> GitResult<CompareDiff> {
    compare(path, base, target, None, None, true)
}
pub fn get_compare_files(path: String, base: String, target: String) -> GitResult<CompareDiff> {
    compare(path, base, target, None, None, false)
}
pub fn get_compare_file_diff(
    path: String,
    base: String,
    target: String,
    file: String,
    old_file: Option<String>,
) -> GitResult<Vec<FileDiff>> {
    Ok(compare(path, base, target, Some(&file), old_file.as_deref(), true)?.files)
}
fn commit_diff(
    path: String,
    oid: String,
    file: Option<&str>,
    old_file: Option<&str>,
    patches: bool,
) -> GitResult<Vec<FileDiff>> {
    let repo = open(&path)?;
    let oid =
        git2::Oid::from_str(&oid).map_err(|_| GitError::InvalidInput(format!("bad oid: {oid}")))?;
    let commit = repo.find_commit(oid)?;
    let tree = commit.tree()?;
    let parent = if commit.parent_count() == 0 {
        None
    } else {
        Some(commit.parent(0)?.tree()?)
    };
    let mut opts = options(file)?;
    if let Some(old) = old_file {
        validate_relative_path(old)?;
        opts.pathspec(old);
    }
    let mut diff = repo.diff_tree_to_tree(parent.as_ref(), Some(&tree), Some(&mut opts))?;
    if file.is_none() || old_file.is_some() {
        diff.find_similar(Some(&mut git2::DiffFindOptions::new()))?;
    }
    collect(&repo, &diff, patches)
}
pub fn get_commit_diff(path: String, oid: String) -> GitResult<Vec<FileDiff>> {
    commit_diff(path, oid, None, None, true)
}
pub fn get_commit_files(path: String, oid: String) -> GitResult<Vec<FileDiff>> {
    commit_diff(path, oid, None, None, false)
}
pub fn get_commit_file_diff(path: String, oid: String, file: String) -> GitResult<Vec<FileDiff>> {
    commit_diff(path, oid, Some(&file), None, true)
}
fn worktree(
    path: String,
    staged: bool,
    file: Option<&str>,
    old_file: Option<&str>,
) -> GitResult<Vec<FileDiff>> {
    let repo = open(&path)?;
    let mut opts = options(file)?;
    if let Some(old) = old_file {
        validate_relative_path(old)?;
        opts.pathspec(old);
    }
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .show_untracked_content(true);
    let mut diff = if staged {
        let head = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
        repo.diff_tree_to_index(head.as_ref(), None, Some(&mut opts))?
    } else {
        repo.diff_index_to_workdir(None, Some(&mut opts))?
    };
    if file.is_none() || old_file.is_some() {
        diff.find_similar(Some(&mut git2::DiffFindOptions::new()))?;
    }
    collect(&repo, &diff, true)
}
pub fn get_worktree_diff(path: String, staged: bool) -> GitResult<Vec<FileDiff>> {
    worktree(path, staged, None, None)
}
pub fn get_worktree_file_diff(
    path: String,
    staged: bool,
    file: String,
) -> GitResult<Vec<FileDiff>> {
    worktree(path, staged, Some(&file), None)
}

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

pub fn get_worktree_file_diff_with_old(
    path: String,
    staged: bool,
    file: String,
    old_file: Option<String>,
) -> GitResult<Vec<FileDiff>> {
    worktree(path, staged, Some(&file), old_file.as_deref())
}

pub fn get_commit_file_diff_with_old(
    path: String,
    oid: String,
    file: String,
    old_file: Option<String>,
) -> GitResult<Vec<FileDiff>> {
    commit_diff(path, oid, Some(&file), old_file.as_deref(), true)
}
