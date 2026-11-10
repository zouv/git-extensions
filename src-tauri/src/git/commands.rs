// 异步 IPC 适配层；同步实现仍供集成测试调用，互斥由实现层保证。
use super::{cli, operations::run_blocking, rebase};
use crate::error::GitResult;
use tauri::Emitter;

pub const CLONE_PROGRESS_EVENT: &str = "clone-progress";

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloneProgress {
    pub operation_id: String,
    pub line: String,
}

#[tauri::command]
pub async fn clone_repository(path: String, url: String) -> GitResult<String> {
    run_blocking(move || cli::clone_repository(path, url)).await
}

#[tauri::command]
pub async fn clone_repository_with_progress(
    app: tauri::AppHandle,
    path: String,
    url: String,
    operation_id: String,
) -> GitResult<String> {
    run_blocking(move || {
        cli::clone_repository_with_progress(path, url, |line| {
            if let Err(error) = app.emit(
                CLONE_PROGRESS_EVENT,
                CloneProgress {
                    operation_id: operation_id.clone(),
                    line: line.to_owned(),
                },
            ) {
                eprintln!("emit clone-progress failed: {error}");
            }
        })
    })
    .await
}

#[tauri::command]
pub async fn create_repository(path: String, bare: Option<bool>) -> GitResult<String> {
    run_blocking(move || cli::create_repository_ex(path, bare.unwrap_or(false))).await
}

#[tauri::command]
pub async fn preview_add_files(
    path: String,
    filter: String,
    force: Option<bool>,
) -> GitResult<cli::CommandOutput> {
    super::operations::run_read(move || {
        cli::preview_add_files(path, filter, force.unwrap_or(false))
    })
    .await
}

#[tauri::command]
pub async fn add_files(
    path: String,
    filter: String,
    force: Option<bool>,
) -> GitResult<cli::CommandOutput> {
    run_blocking(move || cli::add_files(path, filter, force.unwrap_or(false))).await
}

#[tauri::command]
pub async fn checkout_revision(
    path: String,
    oid: String,
    force: Option<bool>,
) -> GitResult<String> {
    run_blocking(move || cli::checkout_revision_ex(path, oid, force.unwrap_or(false))).await
}

#[tauri::command]
pub async fn open_difftool(path: String, file: String, staged: bool) -> GitResult<String> {
    run_blocking(move || cli::open_difftool(path, file, staged)).await
}

#[tauri::command]
pub async fn get_file_content(
    path: String,
    file: String,
    oid: Option<String>,
) -> GitResult<cli::FileContent> {
    super::operations::run_read(move || cli::get_file_content(path, file, oid)).await
}

#[tauri::command]
pub async fn apply_patch(
    path: String,
    patch_path: String,
    expected_patch_oid: String,
) -> GitResult<String> {
    run_blocking(move || cli::apply_patch(path, patch_path, expected_patch_oid)).await
}

#[tauri::command]
pub async fn list_patch_directory(
    path: String,
    directory: String,
) -> GitResult<Vec<cli::PatchFileInfo>> {
    super::operations::run_read(move || cli::list_patch_directory(path, directory)).await
}

#[tauri::command]
pub async fn apply_patch_file(
    path: String,
    patch_path: String,
    ignore_whitespace: Option<bool>,
    sign_off: Option<bool>,
) -> GitResult<cli::CommandOutput> {
    run_blocking(move || {
        cli::apply_patch_file_ex(
            path,
            patch_path,
            ignore_whitespace.unwrap_or(false),
            sign_off.unwrap_or(false),
        )
    })
    .await
}

#[tauri::command]
pub async fn apply_patch_directory(
    path: String,
    directory: String,
    ignore_whitespace: Option<bool>,
    sign_off: Option<bool>,
) -> GitResult<cli::CommandOutput> {
    run_blocking(move || {
        cli::apply_patch_directory_ex(
            path,
            directory,
            ignore_whitespace.unwrap_or(false),
            sign_off.unwrap_or(false),
        )
    })
    .await
}

#[tauri::command]
pub async fn get_patch_apply_state(path: String) -> GitResult<cli::PatchApplyState> {
    super::operations::run_read(move || cli::get_patch_apply_state(path)).await
}

#[tauri::command]
pub async fn continue_patch(path: String) -> GitResult<cli::CommandOutput> {
    run_blocking(move || cli::continue_patch(path)).await
}

#[tauri::command]
pub async fn skip_patch(path: String) -> GitResult<cli::CommandOutput> {
    run_blocking(move || cli::skip_patch(path)).await
}

#[tauri::command]
pub async fn abort_patch(path: String) -> GitResult<cli::CommandOutput> {
    run_blocking(move || cli::abort_patch(path)).await
}

#[tauri::command]
pub async fn resolve_revision(path: String, revision: String) -> GitResult<String> {
    super::operations::run_read(move || cli::resolve_revision(path, revision)).await
}

#[tauri::command]
pub async fn list_tracked_files(path: String) -> GitResult<Vec<String>> {
    super::operations::run_read(move || super::repo::list_tracked_files(path)).await
}

#[tauri::command]
pub async fn list_head_files(path: String) -> GitResult<Vec<String>> {
    super::operations::run_read(move || super::repo::list_head_files(path)).await
}

#[tauri::command]
pub async fn preview_patch(path: String, patch_path: String) -> GitResult<cli::PatchPreview> {
    super::operations::run_read(move || cli::preview_patch(path, patch_path)).await
}

#[tauri::command]
pub async fn stage_files(path: String, paths: Vec<String>) -> GitResult<String> {
    run_blocking(move || cli::stage_files(path, paths)).await
}

#[tauri::command]
pub async fn unstage_files(path: String, paths: Vec<String>) -> GitResult<String> {
    run_blocking(move || cli::unstage_files(path, paths)).await
}

#[tauri::command]
pub async fn commit(
    path: String,
    message: String,
    amend: Option<bool>,
    scope: Option<String>,
) -> GitResult<String> {
    run_blocking(move || cli::commit_ex_scoped(path, message, amend.unwrap_or(false), scope)).await
}

#[tauri::command]
pub async fn commit_fixup(
    path: String,
    target_oid: String,
    squash: Option<bool>,
) -> GitResult<String> {
    run_blocking(move || cli::commit_fixup(path, target_oid, squash.unwrap_or(false))).await
}

#[tauri::command]
pub async fn apply_diff_patch(
    path: String,
    patch: String,
    cached: bool,
    reverse: bool,
) -> GitResult<String> {
    run_blocking(move || cli::apply_diff_patch(path, patch, cached, reverse)).await
}

#[tauri::command]
pub async fn create_branch(
    path: String,
    name: String,
    start_point: Option<String>,
    checkout: Option<bool>,
    orphan: Option<bool>,
) -> GitResult<String> {
    run_blocking(move || {
        cli::create_branch_ex(
            path,
            name,
            start_point,
            checkout.unwrap_or(false),
            orphan.unwrap_or(false),
        )
    })
    .await
}

#[tauri::command]
pub async fn checkout_branch(
    path: String,
    name: String,
    strategy: Option<String>,
) -> GitResult<String> {
    run_blocking(move || cli::checkout_branch_ex(path, name, strategy)).await
}

#[tauri::command]
pub async fn checkout_remote_branch(
    path: String,
    remote_branch: String,
    local_name: Option<String>,
    strategy: Option<String>,
) -> GitResult<String> {
    run_blocking(move || cli::checkout_remote_branch_ex(path, remote_branch, local_name, strategy))
        .await
}

#[tauri::command]
pub async fn rename_branch(path: String, old_name: String, new_name: String) -> GitResult<String> {
    run_blocking(move || cli::rename_branch(path, old_name, new_name)).await
}

#[tauri::command]
pub async fn delete_branch(path: String, name: String, force: bool) -> GitResult<String> {
    run_blocking(move || cli::delete_branch(path, name, force)).await
}

#[tauri::command]
pub async fn delete_branches(
    path: String,
    names: Vec<String>,
    force: Option<bool>,
) -> GitResult<String> {
    run_blocking(move || cli::delete_branches(path, names, force.unwrap_or(false))).await
}

#[tauri::command]
pub async fn delete_remote_branch(path: String, remote_branch: String) -> GitResult<String> {
    run_blocking(move || cli::delete_remote_branch(path, remote_branch)).await
}

#[tauri::command]
pub async fn merge_branch(
    path: String,
    target: String,
    mode: Option<String>,
    message: Option<String>,
) -> GitResult<String> {
    run_blocking(move || cli::merge_branch(path, target, mode, message)).await
}

#[tauri::command]
pub async fn remote_list(path: String) -> GitResult<Vec<super::repo::RemoteInfo>> {
    super::operations::run_read(move || super::repo::remote_list(path)).await
}

#[tauri::command]
pub async fn remote_add(path: String, name: String, url: String) -> GitResult<String> {
    run_blocking(move || cli::remote_add(path, name, url)).await
}

#[tauri::command]
pub async fn remote_set_url(
    path: String,
    name: String,
    url: String,
    push: Option<bool>,
) -> GitResult<String> {
    run_blocking(move || cli::remote_set_url(path, name, url, push.unwrap_or(false))).await
}

#[tauri::command]
pub async fn remote_rename(path: String, old_name: String, new_name: String) -> GitResult<String> {
    run_blocking(move || cli::remote_rename(path, old_name, new_name)).await
}

#[tauri::command]
pub async fn remote_remove(path: String, name: String) -> GitResult<String> {
    run_blocking(move || cli::remote_remove(path, name)).await
}

#[tauri::command]
pub async fn get_merged_branches(path: String) -> GitResult<Vec<String>> {
    super::operations::run_read(move || super::repo::get_merged_branches(path)).await
}

#[tauri::command]
pub async fn fetch(path: String, remote: Option<String>, prune: Option<bool>) -> GitResult<String> {
    run_blocking(move || cli::fetch_ex(path, remote, prune.unwrap_or(false))).await
}

#[tauri::command]
pub async fn pull(
    path: String,
    mode: Option<String>,
    autostash: Option<bool>,
    remote: Option<String>,
    branch: Option<String>,
    fetch_only: Option<bool>,
    prune: Option<bool>,
    tags_mode: Option<String>,
) -> GitResult<String> {
    run_blocking(move || {
        cli::pull_ex_advanced(
            path,
            mode,
            autostash.unwrap_or(false),
            remote,
            branch,
            fetch_only.unwrap_or(false),
            prune.unwrap_or(false),
            tags_mode,
        )
    })
    .await
}

#[tauri::command]
pub async fn pull_with_output(path: String) -> GitResult<cli::CommandOutput> {
    run_blocking(move || cli::pull_with_output(path)).await
}

#[tauri::command]
pub async fn resolve_explorer_target(path: String) -> GitResult<super::repo::ExplorerTarget> {
    super::operations::run_read(move || super::repo::resolve_explorer_target(path)).await
}

#[tauri::command]
pub async fn scoped_history(
    path: String,
    file: Option<String>,
    follow: bool,
    max_count: Option<u32>,
) -> GitResult<Vec<super::history::ScopedHistoryEntry>> {
    super::operations::run_read(move || {
        super::history::scoped_history(path, file, follow, max_count)
    })
    .await
}

#[tauri::command]
pub async fn push(
    path: String,
    remote: Option<String>,
    branch: Option<String>,
    expected_head: Option<String>,
    expected_branch: Option<String>,
    force_with_lease: Option<bool>,
    push_tags: Option<bool>,
    force: Option<bool>,
    recurse_submodules: Option<bool>,
) -> GitResult<String> {
    run_blocking(move || {
        cli::push_ex_advanced(
            path,
            remote,
            branch,
            expected_head,
            expected_branch,
            force_with_lease.unwrap_or(false),
            push_tags.unwrap_or(false),
            force.unwrap_or(false),
            recurse_submodules.unwrap_or(false),
        )
    })
    .await
}

#[tauri::command]
pub async fn stash_push(
    path: String,
    message: String,
    include_untracked: bool,
    keep_index: Option<bool>,
    paths: Option<Vec<String>>,
) -> GitResult<String> {
    run_blocking(move || {
        cli::stash_push_ex(
            path,
            message,
            include_untracked,
            keep_index.unwrap_or(false),
            paths.unwrap_or_default(),
        )
    })
    .await
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
pub async fn reset_changes(
    path: String,
    paths: Vec<String>,
    delete_new: Option<bool>,
) -> GitResult<String> {
    run_blocking(move || cli::reset_changes(path, paths, delete_new.unwrap_or(false))).await
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
pub async fn worktree_list(path: String) -> GitResult<Vec<super::repo::WorktreeInfo>> {
    super::operations::run_read(move || super::repo::worktree_list(path)).await
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

#[tauri::command]
pub async fn worktree_add(
    path: String,
    worktree_path: String,
    branch: Option<String>,
    new_branch: Option<bool>,
    start_point: Option<String>,
) -> GitResult<String> {
    run_blocking(move || {
        cli::worktree_add(
            path,
            worktree_path,
            branch,
            new_branch.unwrap_or(false),
            start_point,
        )
    })
    .await
}

#[tauri::command]
pub async fn worktree_remove(path: String, name: String, force: Option<bool>) -> GitResult<String> {
    run_blocking(move || cli::worktree_remove(path, name, force.unwrap_or(false))).await
}

#[tauri::command]
pub async fn worktree_lock(path: String, name: String, lock: bool) -> GitResult<String> {
    run_blocking(move || cli::worktree_lock(path, name, lock)).await
}

#[tauri::command]
pub async fn worktree_prune(path: String) -> GitResult<String> {
    run_blocking(move || cli::worktree_prune(path)).await
}

#[tauri::command]
pub async fn ignore_file(path: String, pattern: String) -> GitResult<String> {
    run_blocking(move || cli::ignore_file(path, pattern)).await
}

#[tauri::command]
pub async fn get_command_log(path: Option<String>) -> GitResult<Vec<cli::CommandLogEntry>> {
    super::operations::run_read(move || cli::get_command_log(path)).await
}

#[tauri::command]
pub async fn clear_command_log() -> GitResult<()> {
    super::operations::run_read(cli::clear_command_log).await
}

#[tauri::command]
pub async fn search_commits(
    path: String,
    query: Option<String>,
    author: Option<String>,
    file: Option<String>,
    all_refs: Option<bool>,
    max_count: Option<u32>,
) -> GitResult<Vec<super::history::ScopedHistoryEntry>> {
    super::operations::run_read(move || {
        super::history::search_commits(
            path,
            query,
            author,
            file,
            all_refs.unwrap_or(false),
            max_count,
        )
    })
    .await
}

#[tauri::command]
pub async fn git_grep(
    path: String,
    pattern: String,
    revision: Option<String>,
    ignore_case: Option<bool>,
    max_count: Option<u32>,
) -> GitResult<Vec<super::history::GrepMatch>> {
    super::operations::run_read(move || {
        super::history::git_grep(
            path,
            pattern,
            revision,
            ignore_case.unwrap_or(false),
            max_count,
        )
    })
    .await
}

#[tauri::command]
pub async fn bisect_start(
    path: String,
    bad_rev: Option<String>,
    good_rev: Option<String>,
) -> GitResult<String> {
    run_blocking(move || cli::bisect_start(path, bad_rev, good_rev)).await
}

#[tauri::command]
pub async fn bisect_mark(
    path: String,
    verdict: String,
    target: Option<String>,
) -> GitResult<String> {
    run_blocking(move || cli::bisect_mark(path, verdict, target)).await
}

#[tauri::command]
pub async fn bisect_reset(path: String) -> GitResult<String> {
    run_blocking(move || cli::bisect_reset(path)).await
}

#[tauri::command]
pub async fn format_patch(path: String, oid: String, output_path: String) -> GitResult<String> {
    super::operations::run_read(move || cli::format_patch(path, oid, output_path)).await
}

#[tauri::command]
pub async fn archive_commit(
    path: String,
    oid: String,
    output_path: String,
    format: Option<String>,
) -> GitResult<String> {
    super::operations::run_read(move || cli::archive_commit(path, oid, output_path, format)).await
}

#[tauri::command]
pub async fn rename_path(path: String, relative: String, new_name: String) -> GitResult<String> {
    run_blocking(move || cli::rename_path(path, relative, new_name)).await
}
