#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if let Some(result) = git_extensions_lib::git::rebase::internal_editor_entry() {
        if let Err(error) = result {
            eprintln!("internal Git editor failed: {error}");
            std::process::exit(1);
        }
        return;
    }
    git_extensions_lib::run()
}
