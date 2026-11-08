use std::fs;
use std::io::Read;
use std::path::Path;

use git2::{Repository, RepositoryState, Status, StatusOptions};
use serde::{Deserialize, Serialize};

use super::{open, resolve_worktree_path};
use crate::error::{GitError, GitResult};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusEntry {
    pub path: String,
    /// renamed 时提供原路径，供 stage / unstage 同时处理两侧。
    pub old_path: Option<String>,
    /// new | modified | deleted | renamed | typechange | conflicted
    pub status: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusSnapshot {
    pub staged: Vec<StatusEntry>,
    pub unstaged: Vec<StatusEntry>,
}

fn classify(flags: Status) -> &'static str {
    if flags.contains(Status::CONFLICTED) {
        "conflicted"
    } else if flags.intersects(Status::INDEX_RENAMED | Status::WT_RENAMED) {
        "renamed"
    } else if flags.intersects(Status::INDEX_NEW | Status::WT_NEW) {
        "new"
    } else if flags.intersects(Status::INDEX_DELETED | Status::WT_DELETED) {
        "deleted"
    } else if flags.intersects(Status::INDEX_TYPECHANGE | Status::WT_TYPECHANGE) {
        "typechange"
    } else {
        "modified"
    }
}

pub fn get_status(path: String) -> GitResult<StatusSnapshot> {
    let repo = open(&path)?;
    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .renames_head_to_index(true)
        .renames_index_to_workdir(true);
    let statuses = repo.statuses(Some(&mut opts))?;
    let mut snapshot = StatusSnapshot {
        staged: Vec::new(),
        unstaged: Vec::new(),
    };
    for entry in statuses.iter() {
        let flags = entry.status();
        let path = entry.path().unwrap_or_default().to_string();
        if flags.intersects(
            Status::INDEX_NEW
                | Status::INDEX_MODIFIED
                | Status::INDEX_DELETED
                | Status::INDEX_RENAMED
                | Status::INDEX_TYPECHANGE,
        ) {
            let (path, old_path) = if flags.contains(Status::INDEX_RENAMED) {
                entry.head_to_index().map_or((path.clone(), None), |delta| {
                    (
                        delta
                            .new_file()
                            .path()
                            .map(|path| path.to_string_lossy().into_owned())
                            .unwrap_or_else(|| path.clone()),
                        delta
                            .old_file()
                            .path()
                            .map(|path| path.to_string_lossy().into_owned()),
                    )
                })
            } else {
                (path.clone(), None)
            };
            snapshot.staged.push(StatusEntry {
                old_path,
                path,
                status: classify(flags).to_string(),
            });
        }
        if flags.intersects(
            Status::WT_NEW
                | Status::WT_MODIFIED
                | Status::WT_DELETED
                | Status::WT_RENAMED
                | Status::WT_TYPECHANGE
                | Status::CONFLICTED,
        ) {
            let (path, old_path) = if flags.contains(Status::WT_RENAMED) {
                entry
                    .index_to_workdir()
                    .map_or((path.clone(), None), |delta| {
                        let old_path = delta
                            .old_file()
                            .path()
                            .map(|path| path.to_string_lossy().into_owned());
                        let new_path = delta
                            .new_file()
                            .path()
                            .map(|path| path.to_string_lossy().into_owned())
                            .unwrap_or_else(|| path.clone());
                        (new_path, old_path)
                    })
            } else {
                (path, None)
            };
            snapshot.unstaged.push(StatusEntry {
                old_path,
                path,
                status: classify(flags).to_string(),
            });
        }
    }
    let by_path = |a: &StatusEntry, b: &StatusEntry| a.path.cmp(&b.path);
    snapshot.staged.sort_by(by_path);
    snapshot.unstaged.sort_by(by_path);
    Ok(snapshot)
}

#[derive(Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OperationState {
    /// none | merge | cherryPick | revert | rebase
    pub kind: String,
    pub interactive: bool,
    pub current: Option<usize>,
    pub total: Option<usize>,
    pub onto: Option<String>,
    /// 传入侧的 ref / OID 标签。
    pub source: Option<String>,
    /// 当前分支或 rebase head-name。
    pub head_name: Option<String>,
    pub conflicts: Vec<String>,
}

struct ConflictContent {
    content: String,
    is_binary: bool,
    truncated: bool,
}

#[derive(Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ConflictFile {
    pub path: String,
    pub base: Option<String>,
    pub ours: Option<String>,
    pub theirs: Option<String>,
    pub worktree: Option<String>,
    pub ours_label: String,
    pub theirs_label: String,
    pub truncated: bool,
    pub binary: bool,
}

const MAX_CONFLICT_CONTENT_BYTES: usize = 512 * 1024;

fn read_metadata(path: &Path) -> Option<String> {
    fs::read_to_string(path)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn read_progress(path: &Path) -> Option<usize> {
    read_metadata(path)?.parse().ok()
}

fn head_label(repo: &Repository) -> Option<String> {
    repo.head()
        .ok()
        .and_then(|h| h.shorthand().map(ToOwned::to_owned))
}

fn conflict_paths(repo: &Repository) -> GitResult<Vec<String>> {
    let index = repo.index()?;
    let mut paths = Vec::new();
    for conflict in index.conflicts()? {
        let conflict = conflict?;
        let entry = conflict
            .our
            .as_ref()
            .or(conflict.their.as_ref())
            .or(conflict.ancestor.as_ref());
        if let Some(entry) = entry {
            paths.push(String::from_utf8_lossy(&entry.path).into_owned());
        }
    }
    paths.sort();
    paths.dedup();
    Ok(paths)
}

pub fn get_operation_state(path: String) -> GitResult<OperationState> {
    let repo = open(&path)?;
    let git_dir = repo.path();
    let rebase_merge = git_dir.join("rebase-merge");
    let rebase_apply = git_dir.join("rebase-apply");
    let state = repo.state();
    let (operation, interactive) = match state {
        RepositoryState::Clean => ("none", false),
        RepositoryState::Merge => ("merge", false),
        RepositoryState::CherryPick | RepositoryState::CherryPickSequence => ("cherryPick", false),
        RepositoryState::Revert | RepositoryState::RevertSequence => ("revert", false),
        RepositoryState::Bisect => ("bisect", false),
        RepositoryState::Rebase
        | RepositoryState::RebaseInteractive
        | RepositoryState::RebaseMerge
        | RepositoryState::ApplyMailboxOrRebase => {
            ("rebase", rebase_merge.join("interactive").exists())
        }
        other => {
            return Err(GitError::InvalidInput(format!(
                "unsupported repository operation state: {other:?}"
            )));
        }
    };

    let (current, total, onto, branch) = if operation == "rebase" {
        let dir = if rebase_merge.is_dir() {
            &rebase_merge
        } else {
            &rebase_apply
        };
        let branch = read_metadata(&dir.join("head-name"))
            .map(|name| {
                name.strip_prefix("refs/heads/")
                    .unwrap_or(&name)
                    .to_string()
            })
            .or_else(|| head_label(&repo));
        (
            read_progress(&dir.join("msgnum")).or_else(|| read_progress(&dir.join("next"))),
            read_progress(&dir.join("end")).or_else(|| read_progress(&dir.join("last"))),
            read_metadata(&dir.join("onto")),
            branch,
        )
    } else if operation == "bisect" {
        let branch = read_metadata(&git_dir.join("BISECT_START")).or_else(|| head_label(&repo));
        let steps = fs::read_to_string(git_dir.join("BISECT_LOG"))
            .ok()
            .map(|log| {
                log.lines()
                    .filter(|line| {
                        line.starts_with("git bisect good")
                            || line.starts_with("git bisect bad")
                            || line.starts_with("git bisect skip")
                    })
                    .count()
            });
        (steps, None, None, branch)
    } else {
        (None, None, None, head_label(&repo))
    };

    let source = match operation {
        "merge" => read_metadata(&git_dir.join("MERGE_HEAD")),
        "cherryPick" => read_metadata(&git_dir.join("CHERRY_PICK_HEAD")),
        "revert" => read_metadata(&git_dir.join("REVERT_HEAD")),
        "bisect" => repo
            .head()
            .ok()
            .and_then(|h| h.target().map(|oid| oid.to_string())),
        "rebase" => branch
            .clone()
            .or_else(|| read_metadata(&rebase_merge.join("orig-head"))),
        _ => None,
    };

    Ok(OperationState {
        kind: operation.to_string(),
        interactive,
        current,
        total,
        onto,
        source,
        head_name: branch,
        conflicts: conflict_paths(&repo)?,
    })
}

fn limited_content(bytes: &[u8]) -> ConflictContent {
    let truncated = bytes.len() > MAX_CONFLICT_CONTENT_BYTES;
    let end = bytes.len().min(MAX_CONFLICT_CONTENT_BYTES);
    let mut visible = &bytes[..end];
    let mut invalid_utf8 = false;
    let content = match std::str::from_utf8(visible) {
        Ok(text) => text.to_string(),
        Err(error) if truncated && error.error_len().is_none() => {
            // 截断点落在 UTF-8 字符中间不是二进制，裁到完整字符边界。
            visible = &visible[..error.valid_up_to()];
            std::str::from_utf8(visible)
                .expect("valid UTF-8 prefix")
                .to_string()
        }
        Err(_) => {
            invalid_utf8 = true;
            String::from_utf8_lossy(visible).into_owned()
        }
    };
    ConflictContent {
        content,
        is_binary: invalid_utf8 || visible.contains(&0),
        truncated,
    }
}

fn worktree_content(repo: &Repository, path: &str) -> GitResult<Option<ConflictContent>> {
    let full_path = resolve_worktree_path(repo, path)?;
    let file = match fs::File::open(full_path) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.into()),
    };
    let mut bytes = Vec::new();
    file.take((MAX_CONFLICT_CONTENT_BYTES + 1) as u64)
        .read_to_end(&mut bytes)?;
    Ok(Some(limited_content(&bytes)))
}

fn blob_content(
    repo: &Repository,
    entry: &Option<git2::IndexEntry>,
) -> GitResult<Option<ConflictContent>> {
    match entry {
        Some(entry) => Ok(Some(limited_content(repo.find_blob(entry.id)?.content()))),
        None => Ok(None),
    }
}

pub fn get_conflict_file(path: String, file: String) -> GitResult<ConflictFile> {
    let repo = open(&path)?;
    let normalized = super::validate_relative_path(&file)?
        .to_string_lossy()
        .replace('\\', "/");
    let index = repo.index()?;
    for conflict in index.conflicts()? {
        let conflict = conflict?;
        let conflict_path = conflict
            .our
            .as_ref()
            .or(conflict.their.as_ref())
            .or(conflict.ancestor.as_ref())
            .map(|entry| String::from_utf8_lossy(&entry.path).into_owned())
            .unwrap_or_default();
        if conflict_path == normalized {
            let base = blob_content(&repo, &conflict.ancestor)?;
            let ours = blob_content(&repo, &conflict.our)?;
            let theirs = blob_content(&repo, &conflict.their)?;
            let worktree = worktree_content(&repo, &conflict_path)?;
            let truncated = [&base, &ours, &theirs, &worktree]
                .into_iter()
                .flatten()
                .any(|side| side.truncated);
            let binary = [&base, &ours, &theirs, &worktree]
                .into_iter()
                .flatten()
                .any(|side| side.is_binary);
            let state = get_operation_state(path.clone())?;
            let (ours_label, theirs_label) = if state.kind == "rebase" {
                (state.onto, state.source)
            } else {
                (state.head_name, state.source)
            };
            return Ok(ConflictFile {
                path: normalized,
                base: base.map(|side| side.content),
                ours: ours.map(|side| side.content),
                theirs: theirs.map(|side| side.content),
                worktree: worktree.map(|side| side.content),
                ours_label: ours_label.unwrap_or_else(|| "ours".into()),
                theirs_label: theirs_label.unwrap_or_else(|| "theirs".into()),
                truncated,
                binary,
            });
        }
    }
    Err(GitError::InvalidInput(format!(
        "file is not conflicted: {file}"
    )))
}
