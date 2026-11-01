// 异步 IPC 适配层；同步实现仍供集成测试调用，互斥由实现层保证。
use super::{cli, operations::run_blocking, rebase};
use crate::error::GitResult;

#[tauri::command]
pub async fn stage_files(path: String, paths: Vec<String>) -> GitResult<String> {
    run_blocking(move || cli::stage_files(path, paths)).await
}

#[tauri::command]
pub async fn unstage_files(path: String, paths: Vec<String>) -> GitResult<String> {
    run_blocking(move || cli::unstage_files(path, paths)).await
}

#[tauri::command]
pub async fn commit(path: String, message: String) -> GitResult<String> {
    run_blocking(move || cli::commit(path, message)).await
}

#[tauri::command]
pub async fn create_branch(
    path: String,
    name: String,
    start_point: Option<String>,
) -> GitResult<String> {
    run_blocking(move || cli::create_branch(path, name, start_point)).await
}

#[tauri::command]
pub async fn checkout_branch(path: String, name: String) -> GitResult<String> {
    run_blocking(move || cli::checkout_branch(path, name)).await
}

#[tauri::command]
pub async fn delete_branch(path: String, name: String, force: bool) -> GitResult<String> {
    run_blocking(move || cli::delete_branch(path, name, force)).await
}

#[tauri::command]
pub async fn fetch(path: String, remote: Option<String>) -> GitResult<String> {
    run_blocking(move || cli::fetch(path, remote)).await
}

#[tauri::command]
pub async fn pull(path: String) -> GitResult<String> {
    run_blocking(move || cli::pull(path)).await
}

#[tauri::command]
pub async fn push(
    path: String,
    remote: Option<String>,
    branch: Option<String>,
    expected_head: Option<String>,
    expected_branch: Option<String>,
) -> GitResult<String> {
    run_blocking(move || cli::push(path, remote, branch, expected_head, expected_branch)).await
}

#[tauri::command]
pub async fn stash_push(
    path: String,
    message: String,
    include_untracked: bool,
) -> GitResult<String> {
    run_blocking(move || cli::stash_push(path, message, include_untracked)).await
}

#[tauri::command]
pub async fn stash_apply(
    path: String,
    name: String,
    pop: bool,
    expected_oid: Option<String>,
) -> GitResult<String> {
    run_blocking(move || cli::stash_apply_checked(path, name, pop, expected_oid)).await
}

#[tauri::command]
pub async fn stash_drop(
    path: String,
    name: String,
    expected_oid: Option<String>,
) -> GitResult<String> {
    run_blocking(move || cli::stash_drop_checked(path, name, expected_oid)).await
}

#[tauri::command]
pub async fn cherry_pick(path: String, oid: String) -> GitResult<String> {
    run_blocking(move || cli::cherry_pick(path, oid)).await
}

#[tauri::command]
pub async fn revert(path: String, oid: String) -> GitResult<String> {
    run_blocking(move || cli::revert(path, oid)).await
}

#[tauri::command]
pub async fn rebase(path: String, onto: String) -> GitResult<String> {
    run_blocking(move || cli::rebase(path, onto)).await
}

#[tauri::command]
pub async fn discard_files(path: String, paths: Vec<String>) -> GitResult<String> {
    run_blocking(move || cli::discard_files(path, paths)).await
}

#[tauri::command]
pub async fn delete_untracked_files(path: String, paths: Vec<String>) -> GitResult<String> {
    run_blocking(move || cli::delete_untracked_files(path, paths)).await
}

#[tauri::command]
pub async fn save_resolved_file(
    path: String,
    file: String,
    content: String,
    resolve_as_deletion: Option<bool>,
    expected: Option<super::status::ConflictFile>,
) -> GitResult<super::status::OperationState> {
    run_blocking(move || {
        cli::save_resolved_file_checked(path, file, content, resolve_as_deletion, expected)
    })
    .await
}

#[tauri::command]
pub async fn continue_operation(path: String) -> GitResult<String> {
    run_blocking(move || cli::continue_operation(path)).await
}

#[tauri::command]
pub async fn abort_operation(path: String) -> GitResult<String> {
    run_blocking(move || cli::abort_operation(path)).await
}

#[tauri::command]
pub async fn create_tag(
    path: String,
    name: String,
    oid: Option<String>,
    message: Option<String>,
) -> GitResult<String> {
    run_blocking(move || cli::create_tag(path, name, oid, message)).await
}

#[tauri::command]
pub async fn delete_tag(path: String, name: String) -> GitResult<String> {
    run_blocking(move || cli::delete_tag(path, name)).await
}

#[tauri::command]
pub async fn submodule_update(path: String) -> GitResult<String> {
    run_blocking(move || cli::submodule_update(path)).await
}

#[tauri::command]
pub async fn get_push_info(path: String) -> GitResult<cli::PushInfo> {
    super::operations::run_read(move || cli::get_push_info(path)).await
}

#[tauri::command]
pub async fn prepare_interactive_rebase(
    path: String,
    oid: String,
) -> GitResult<rebase::RebasePlan> {
    super::operations::run_read(move || rebase::prepare_interactive_rebase(path, oid)).await
}

#[tauri::command]
pub async fn start_interactive_rebase(path: String, plan: rebase::RebasePlan) -> GitResult<String> {
    run_blocking(move || rebase::start_interactive_rebase(path, plan)).await
}

#[tauri::command]
pub async fn open_repo(path: String) -> GitResult<super::repo::RepoInfo> {
    super::operations::run_read(move || super::repo::open_repo(path)).await
}

#[tauri::command]
pub async fn get_branches(path: String) -> GitResult<Vec<super::repo::BranchInfo>> {
    super::operations::run_read(move || super::repo::get_branches(path)).await
}

#[tauri::command]
pub async fn get_ahead_behind(path: String) -> GitResult<Option<super::repo::AheadBehind>> {
    super::operations::run_read(move || super::repo::get_ahead_behind(path)).await
}

#[tauri::command]
pub async fn get_status(path: String) -> GitResult<super::status::StatusSnapshot> {
    super::operations::run_read(move || super::status::get_status(path)).await
}

#[tauri::command]
pub async fn get_operation_state(path: String) -> GitResult<super::status::OperationState> {
    super::operations::run_read(move || super::status::get_operation_state(path)).await
}

#[tauri::command]
pub async fn get_conflict_file(
    path: String,
    file: String,
) -> GitResult<super::status::ConflictFile> {
    super::operations::run_read(move || super::status::get_conflict_file(path, file)).await
}

#[tauri::command]
pub async fn get_commit(path: String, oid: String) -> GitResult<super::diff::CommitDetail> {
    super::operations::run_read(move || super::diff::get_commit(path, oid)).await
}

#[tauri::command]
pub async fn get_commit_diff(path: String, oid: String) -> GitResult<Vec<super::diff::FileDiff>> {
    super::operations::run_read(move || super::diff::get_commit_diff(path, oid)).await
}

#[tauri::command]
pub async fn get_commit_files(path: String, oid: String) -> GitResult<Vec<super::diff::FileDiff>> {
    super::operations::run_read(move || super::diff::get_commit_files(path, oid)).await
}

#[tauri::command]
pub async fn get_commit_file_diff(
    path: String,
    oid: String,
    file: String,
    old_file: Option<String>,
) -> GitResult<Vec<super::diff::FileDiff>> {
    super::operations::run_read(move || {
        super::diff::get_commit_file_diff_with_old(path, oid, file, old_file)
    })
    .await
}

#[tauri::command]
pub async fn get_worktree_diff(
    path: String,
    staged: bool,
) -> GitResult<Vec<super::diff::FileDiff>> {
    super::operations::run_read(move || super::diff::get_worktree_diff(path, staged)).await
}

#[tauri::command]
pub async fn get_worktree_file_diff(
    path: String,
    staged: bool,
    file: String,
    old_file: Option<String>,
) -> GitResult<Vec<super::diff::FileDiff>> {
    super::operations::run_read(move || {
        super::diff::get_worktree_file_diff_with_old(path, staged, file, old_file)
    })
    .await
}

#[tauri::command]
pub async fn get_compare_diff(
    path: String,
    base: String,
    target: String,
) -> GitResult<super::diff::CompareDiff> {
    super::operations::run_read(move || super::diff::get_compare_diff(path, base, target)).await
}

#[tauri::command]
pub async fn get_compare_files(
    path: String,
    base: String,
    target: String,
) -> GitResult<super::diff::CompareDiff> {
    super::operations::run_read(move || super::diff::get_compare_files(path, base, target)).await
}

#[tauri::command]
pub async fn get_compare_file_diff(
    path: String,
    base: String,
    target: String,
    file: String,
    old_file: Option<String>,
) -> GitResult<Vec<super::diff::FileDiff>> {
    super::operations::run_read(move || {
        super::diff::get_compare_file_diff(path, base, target, file, old_file)
    })
    .await
}

#[tauri::command]
pub async fn blame_file(
    path: String,
    file: String,
    oid: Option<String>,
) -> GitResult<Vec<super::history::BlameLine>> {
    super::operations::run_read(move || super::history::blame_file(path, file, oid)).await
}

#[tauri::command]
pub async fn file_log(
    path: String,
    file: String,
    max_count: Option<u32>,
) -> GitResult<Vec<super::history::FileLogEntry>> {
    super::operations::run_read(move || super::history::file_log(path, file, max_count)).await
}

#[tauri::command]
pub async fn stash_list(path: String) -> GitResult<Vec<super::cli::StashInfo>> {
    super::operations::run_read(move || super::cli::stash_list(path)).await
}

#[tauri::command]
pub async fn tag_list(path: String) -> GitResult<Vec<super::cli::TagInfo>> {
    super::operations::run_read(move || super::cli::tag_list(path)).await
}

#[tauri::command]
pub async fn submodule_list(path: String) -> GitResult<Vec<super::cli::SubmoduleInfo>> {
    super::operations::run_read(move || super::cli::submodule_list(path)).await
}

#[tauri::command]
pub async fn get_contained_in(path: String, oid: String) -> GitResult<super::cli::ContainedInfo> {
    super::operations::run_read(move || super::cli::get_contained_in(path, oid)).await
}

#[tauri::command]
pub async fn get_reset_preview(
    path: String,
    target: String,
    mode: super::reset::ResetMode,
) -> GitResult<super::reset::ResetPreview> {
    super::operations::run_read(move || super::reset::get_reset_preview(path, target, mode)).await
}
#[tauri::command]
pub async fn reset(
    path: String,
    preview: super::reset::ResetPreview,
) -> GitResult<super::reset::ResetResult> {
    run_blocking(move || super::reset::reset(path, preview)).await
}
#[tauri::command]
pub async fn get_recovery_entries(path: String) -> GitResult<Vec<super::reset::RecoveryEntry>> {
    super::operations::run_read(move || super::reset::get_recovery_entries(path)).await
}

#[tauri::command]
pub async fn skip_operation(
    path: String,
    expected: super::status::OperationState,
) -> GitResult<String> {
    run_blocking(move || cli::skip_operation(path, expected)).await
}
