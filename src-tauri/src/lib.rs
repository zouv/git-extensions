pub mod error;
pub mod git;
pub mod system;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            git::commands::open_repo,
            git::commands::get_branches,
            git::commands::get_ahead_behind,
            git::log::start_log,
            git::log::cancel_log,
            git::log::report_frontend_state,
            git::commands::get_commit,
            git::commands::get_commit_diff,
            git::commands::get_commit_files,
            git::commands::get_commit_file_diff,
            git::commands::get_worktree_diff,
            git::commands::get_worktree_file_diff,
            git::commands::get_compare_diff,
            git::commands::get_compare_files,
            git::commands::get_compare_file_diff,
            git::commands::get_status,
            git::commands::get_operation_state,
            git::commands::get_conflict_file,
            git::commands::stage_files,
            git::commands::unstage_files,
            git::commands::commit,
            git::commands::create_branch,
            git::commands::checkout_branch,
            git::commands::delete_branch,
            git::commands::fetch,
            git::commands::pull,
            git::commands::push,
            git::commands::stash_list,
            git::commands::stash_push,
            git::commands::stash_apply,
            git::commands::stash_drop,
            git::commands::cherry_pick,
            git::commands::revert,
            git::commands::rebase,
            git::commands::get_contained_in,
            git::commands::tag_list,
            git::commands::create_tag,
            git::commands::delete_tag,
            git::commands::submodule_list,
            git::commands::submodule_update,
            git::commands::discard_files,
            git::commands::delete_untracked_files,
            git::commands::save_resolved_file,
            git::commands::continue_operation,
            git::commands::abort_operation,
            git::commands::skip_operation,
            git::commands::get_push_info,
            git::commands::get_reset_preview,
            git::commands::reset,
            git::commands::get_recovery_entries,
            git::commands::prepare_interactive_rebase,
            git::commands::start_interactive_rebase,
            system::open_path,
            system::reveal_path,
            git::commands::blame_file,
            git::commands::file_log,
        ])
        .on_window_event(|window, event| {
            // 主窗口销毁后显式结束命令循环，避免 WebView / 后台线程留下无窗口进程。
            if matches!(event, tauri::WindowEvent::Destroyed) {
                window.app_handle().exit(0);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
