#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if let Some(result) = git_extensions_lib::git::rebase::internal_editor_entry() {
        if let Err(error) = result {
            eprintln!("internal Git editor failed: {error}");
            std::process::exit(1);
        }
        return;
    }
    let launch_request = match git_extensions_lib::launch::parse_process_launch_request() {
        Ok(request) => request,
        Err(error) => {
            eprintln!("invalid Explorer launch arguments: {error}");
            std::process::exit(2);
        }
    };
    git_extensions_lib::run(launch_request)
}
