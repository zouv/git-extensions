use super::{cli::run_git, open, operations::acquire_write};
use crate::error::{GitError, GitResult};
use serde::{Deserialize, Serialize};
use std::hash::{Hash, Hasher};
use std::io::Read;
use std::sync::atomic::{AtomicU64, Ordering};

#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ResetMode {
    Soft,
    Mixed,
    Hard,
}
impl ResetMode {
    fn flag(self) -> &'static str {
        match self {
            Self::Soft => "--soft",
            Self::Mixed => "--mixed",
            Self::Hard => "--hard",
        }
    }
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResetPreview {
    pub branch: String,
    pub head_oid: String,
    pub target_oid: String,
    pub target_subject: String,
    pub mode: ResetMode,
    pub fingerprint: String,
    pub staged: usize,
    pub unstaged: usize,
    pub untracked: usize,
    pub affected_files: Vec<String>,
    pub commits_to_leave: usize,
    pub count_limited: bool,
    pub blocked_paths: Vec<String>,
}
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ResetResult {
    pub backup_ref: String,
    pub previous_head: String,
    pub new_head: String,
    pub output: String,
}

fn ensure_idle(repo: &git2::Repository) -> GitResult<()> {
    if repo.is_bare() || repo.state() != git2::RepositoryState::Clean {
        return Err(GitError::InvalidInput(
            "reset requires a worktree with no merge/rebase/cherry-pick/revert in progress".into(),
        ));
    }
    Ok(())
}
// 比较 HEAD、index 及 dirty 文件的实际字节；同一 status 下再次修改也会拒绝旧预览。
fn fingerprint(repo: &git2::Repository) -> GitResult<String> {
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    let index_path = repo.path().join("index");
    if index_path.exists() {
        std::fs::read(index_path)?.hash(&mut hash);
    }
    let mut opts = git2::StatusOptions::new();
    opts.include_untracked(true).recurse_untracked_dirs(true);
    let statuses = repo.statuses(Some(&mut opts))?;
    for entry in statuses.iter() {
        entry.status().bits().hash(&mut hash);
        let name = entry.path().ok_or_else(|| {
            GitError::InvalidInput("non-UTF8 path cannot be previewed safely".into())
        })?;
        name.hash(&mut hash);
        let full = repo.workdir().unwrap().join(name);
        if let Ok(metadata) = std::fs::symlink_metadata(&full) {
            metadata.len().hash(&mut hash);
            metadata.modified().ok().hash(&mut hash);
            if metadata.file_type().is_symlink() {
                std::fs::read_link(&full)?.hash(&mut hash);
            } else if metadata.is_file() {
                let mut input = std::fs::File::open(full)?;
                let mut buffer = [0; 64 * 1024];
                loop {
                    let n = input.read(&mut buffer)?;
                    if n == 0 {
                        break;
                    }
                    buffer[..n].hash(&mut hash);
                }
            }
        }
    }
    Ok(format!("{:016x}", hash.finish()))
}
pub fn get_reset_preview(path: String, target: String, mode: ResetMode) -> GitResult<ResetPreview> {
    let repo = open(&path)?;
    ensure_idle(&repo)?;
    let head = repo.head()?;
    let head_oid = head.peel_to_commit()?.id();
    let target = repo.revparse_single(&target)?.peel_to_commit()?;
    let branch = if repo.head_detached()? {
        "HEAD (detached)".into()
    } else {
        head.name().unwrap_or("HEAD").into()
    };
    let status = super::status::get_status(path.clone())?;
    let mut opts = git2::StatusOptions::new();
    opts.include_untracked(true).recurse_untracked_dirs(true);
    let untracked = repo
        .statuses(Some(&mut opts))?
        .iter()
        .filter(|e| e.status().contains(git2::Status::WT_NEW))
        .count();
    let mut walk = repo.revwalk()?;
    walk.push(head_oid)?;
    walk.hide(target.id())?;
    let commits_to_leave = walk.take(10_001).collect::<Result<Vec<_>, _>>()?.len();
    let tree = target.tree()?;
    let diff = if mode == ResetMode::Soft {
        repo.diff_tree_to_tree(
            Some(&repo.find_commit(head_oid)?.tree()?),
            Some(&tree),
            None,
        )?
    } else {
        repo.diff_tree_to_index(Some(&tree), None, None)?
    };
    let affected_files = diff
        .deltas()
        .filter_map(|d| {
            d.new_file()
                .path()
                .or_else(|| d.old_file().path())
                .map(|p| p.to_string_lossy().into_owned())
        })
        .collect();
    let blocked_paths = hard_obstructions(&repo, &tree)?;
    Ok(ResetPreview {
        branch,
        head_oid: head_oid.to_string(),
        target_oid: target.id().to_string(),
        target_subject: target.summary().unwrap_or_default().into(),
        mode,
        fingerprint: fingerprint(&repo)?,
        staged: status.staged.len(),
        unstaged: status.unstaged.len(),
        untracked,
        affected_files,
        commits_to_leave: commits_to_leave.min(10_000),
        count_limited: commits_to_leave > 10_000,
        blocked_paths,
    })
}
// --hard 也可能覆盖未跟踪/ignored 的阻挡路径；不能仅依赖普通 status。
fn hard_obstructions(repo: &git2::Repository, tree: &git2::Tree<'_>) -> GitResult<Vec<String>> {
    let index = repo.index()?;
    let root = repo.workdir().unwrap();
    let mut blocked = Vec::new();
    tree.walk(git2::TreeWalkMode::PreOrder, |prefix, entry| {
        let Some(name) = entry.name() else {
            blocked.push("non-UTF8 target path".into());
            return git2::TreeWalkResult::Skip;
        };
        let relative = format!("{prefix}{name}");
        if let Ok(meta) = std::fs::symlink_metadata(root.join(&relative)) {
            if index.get_path(std::path::Path::new(&relative), 0).is_none()
                && (entry.kind() != Some(git2::ObjectType::Tree) || !meta.is_dir())
            {
                blocked.push(relative);
            }
        }
        git2::TreeWalkResult::Ok
    })?;
    Ok(blocked)
}
static BACKUP_ID: AtomicU64 = AtomicU64::new(0);
pub(crate) fn create_backup(path: &str, oid: &str, reason: &str) -> GitResult<String> {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let name = format!(
        "refs/git-extensions/backups/{reason}-{stamp}-{}",
        BACKUP_ID.fetch_add(1, Ordering::Relaxed)
    );
    run_git(
        path,
        &[
            "update-ref".into(),
            "--create-reflog".into(),
            "-m".into(),
            format!("git-extensions before {reason}"),
            name.clone(),
            oid.into(),
            "0000000000000000000000000000000000000000".into(),
        ],
    )?;
    Ok(name)
}
pub fn reset(path: String, preview: ResetPreview) -> GitResult<ResetResult> {
    let _write = acquire_write(&path)?;
    let current = get_reset_preview(path.clone(), preview.target_oid.clone(), preview.mode)?;
    if current.head_oid != preview.head_oid
        || current.branch != preview.branch
        || current.fingerprint != preview.fingerprint
    {
        return Err(GitError::InvalidInput(
            "reset preview is stale; HEAD, branch, index or worktree changed; preview again".into(),
        ));
    }
    if preview.mode == ResetMode::Hard
        && (current.staged > 0
            || current.unstaged > 0
            || current.untracked > 0
            || !current.blocked_paths.is_empty())
    {
        return Err(GitError::InvalidInput("hard reset requires a clean index/worktree; commit or stash all changes (including untracked files) first; HEAD backup does not preserve uncommitted files".into()));
    }
    let backup_ref = create_backup(&path, &current.head_oid, "reset")?;
    let output = run_git(
        &path,
        &[
            "reset".into(),
            current.mode.flag().into(),
            "--no-recurse-submodules".into(),
            current.target_oid.clone(),
            "--".into(),
        ],
    )
    .map_err(|e| GitError::Cli(format!("{e}; original HEAD preserved in {backup_ref}")))?;
    Ok(ResetResult {
        backup_ref,
        previous_head: current.head_oid,
        new_head: current.target_oid,
        output,
    })
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryEntry {
    pub oid: String,
    pub label: String,
    pub time: i64,
    pub backup_ref: Option<String>,
}
pub fn get_recovery_entries(path: String) -> GitResult<Vec<RecoveryEntry>> {
    let repo = open(&path)?;
    let mut result = Vec::new();
    for reference in repo
        .references_glob("refs/git-extensions/backups/*")?
        .flatten()
    {
        if let Ok(commit) = reference.peel_to_commit() {
            result.push(RecoveryEntry {
                oid: commit.id().to_string(),
                label: format!(
                    "备份 · {} · {}",
                    reference.shorthand().unwrap_or(""),
                    commit.summary().unwrap_or("")
                ),
                time: commit.time().seconds(),
                backup_ref: reference.name().map(str::to_owned),
            });
        }
    }
    result.reverse();
    result.truncate(100);
    if let Ok(log) = repo.reflog("HEAD") {
        for entry in log.iter().take(100) {
            if !entry.id_new().is_zero() && repo.find_commit(entry.id_new()).is_ok() {
                result.push(RecoveryEntry {
                    oid: entry.id_new().to_string(),
                    label: entry.message().unwrap_or("HEAD reflog").into(),
                    time: entry.committer().when().seconds(),
                    backup_ref: None,
                });
            }
        }
    }
    Ok(result)
}
