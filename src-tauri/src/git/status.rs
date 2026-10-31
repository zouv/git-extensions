use git2::{Status, StatusOptions};
use serde::Serialize;

use super::open;
use crate::error::GitResult;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusEntry {
    pub path: String,
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

#[tauri::command]
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
            snapshot.staged.push(StatusEntry {
                path: path.clone(),
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
            snapshot.unstaged.push(StatusEntry {
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
