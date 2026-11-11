pub mod error;
pub mod git;
pub mod launch;
pub mod system;
pub mod window_host;

use std::ffi::OsString;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run(launch_request: Option<launch::LaunchRequest>) {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            let request =
                launch::parse_launch_request(argv.into_iter().skip(1).map(OsString::from));
            match request {
                Ok(Some(request)) => window_host::route_request(app, request),
                Ok(None) => window_host::queue_main_request(app, None),
                Err(error) => {
                    eprintln!("invalid Explorer launch arguments from second instance: {error}")
                }
            }
        }))
        .manage(window_host::LaunchState::default())
        .setup(move |app| {
            window_host::initialize(app.handle(), launch_request);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            git::commands::open_repo,
            git::commands::clone_repository,
            git::commands::clone_repository_with_progress,
            git::commands::create_repository,
            git::commands::resolve_revision,
            git::commands::checkout_revision,
            git::commands::open_difftool,
            git::commands::get_file_content,
            git::commands::list_tracked_files,
            git::commands::list_head_files,
            git::commands::preview_patch,
            git::commands::apply_patch,
            git::commands::list_patch_directory,
            git::commands::apply_patch_file,
            git::commands::apply_patch_directory,
            git::commands::get_patch_apply_state,
            git::commands::continue_patch,
            git::commands::skip_patch,
            git::commands::abort_patch,
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
            git::commands::preview_add_files,
            git::commands::add_files,
            git::commands::reset_changes,
            git::commands::rename_path,
            git::commands::commit,
            git::commands::commit_fixup,
            git::commands::apply_diff_patch,
            git::commands::create_branch,
            git::commands::checkout_branch,
            git::commands::checkout_remote_branch,
            git::commands::rename_branch,
            git::commands::delete_branch,
            git::commands::delete_branches,
            git::commands::delete_remote_branch,
            git::commands::get_branch_delete_status,
            git::commands::merge_branch,
            git::commands::remote_list,
            git::commands::remote_add,
            git::commands::remote_set_url,
            git::commands::remote_rename,
            git::commands::remote_remove,
            git::commands::get_merged_branches,
            git::commands::fetch,
            git::commands::pull,
            git::commands::pull_with_output,
            git::commands::resolve_explorer_target,
            git::commands::scoped_history,
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
            git::commands::submodule_sync,
            git::commands::git_maintenance,
            git::commands::worktree_list,
            git::commands::worktree_add,
            git::commands::worktree_remove,
            git::commands::worktree_lock,
            git::commands::worktree_prune,
            git::commands::ignore_file,
            git::commands::get_command_log,
            git::commands::clear_command_log,
            git::commands::search_commits,
            git::commands::git_grep,
            git::commands::bisect_start,
            git::commands::bisect_mark,
            git::commands::bisect_reset,
            git::commands::format_patch,
            git::commands::archive_commit,
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
            system::edit_repo_file,
            system::get_explorer_integration_info,
            system::set_explorer_context_menu_enabled,
            window_host::get_window_bootstrap,
            window_host::take_pending_launches,
            window_host::show_current_window,
            window_host::focus_main_window,
            window_host::open_repository_in_main,
            git::commands::blame_file,
            git::commands::file_log,
        ])
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                window_host::window_destroyed(window.app_handle(), window.label());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
