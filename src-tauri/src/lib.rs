pub mod error;
pub mod git;
pub mod system;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            git::repo::open_repo,
            git::repo::get_branches,
            git::repo::get_ahead_behind,
            git::log::start_log,
            git::log::report_frontend_state,
            git::diff::get_commit,
            git::diff::get_commit_diff,
            git::diff::get_worktree_diff,
            git::diff::get_compare_diff,
            git::status::get_status,
            git::status::get_operation_state,
            git::status::get_conflict_file,
            git::cli::stage_files,
            git::cli::unstage_files,
            git::cli::commit,
            git::cli::create_branch,
            git::cli::checkout_branch,
            git::cli::delete_branch,
            git::cli::fetch,
            git::cli::pull,
            git::cli::push,
            git::cli::stash_list,
            git::cli::stash_push,
            git::cli::stash_apply,
            git::cli::stash_drop,
            git::cli::cherry_pick,
            git::cli::revert,
            git::cli::rebase,
            git::cli::get_contained_in,
            git::cli::tag_list,
            git::cli::create_tag,
            git::cli::delete_tag,
            git::cli::submodule_list,
            git::cli::submodule_update,
            git::cli::discard_files,
            git::cli::delete_untracked_files,
            git::cli::save_resolved_file,
            git::cli::continue_operation,
            git::cli::abort_operation,
            git::rebase::prepare_interactive_rebase,
            git::rebase::start_interactive_rebase,
            system::open_path,
            system::reveal_path,
            git::history::blame_file,
            git::history::file_log,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
