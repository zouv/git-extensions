pub mod error;
pub mod git;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            git::repo::open_repo,
            git::repo::get_branches,
            git::repo::get_ahead_behind,
            git::log::start_log,
            git::diff::get_commit,
            git::diff::get_commit_diff,
            git::diff::get_worktree_diff,
            git::status::get_status,
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
            git::history::blame_file,
            git::history::file_log,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
