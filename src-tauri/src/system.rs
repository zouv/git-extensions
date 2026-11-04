use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use crate::error::{GitError, GitResult};
pub mod explorer;

use crate::git::{open, validate_relative_path};

#[derive(Debug, Clone, Copy, serde::Serialize)]
pub struct ExplorerIntegrationInfo {
    pub supported: bool,
}

#[tauri::command]
pub fn get_explorer_integration_info() -> ExplorerIntegrationInfo {
    ExplorerIntegrationInfo {
        supported: explorer::supported(),
    }
}

#[tauri::command]
pub fn set_explorer_context_menu_enabled(
    enabled: bool,
    items: Vec<explorer::ExplorerMenuItem>,
    always_show_all_commands: bool,
) -> GitResult<()> {
    explorer::set_enabled(enabled, items, always_show_all_commands)
        .map_err(|error| GitError::Cli(format!("Explorer integration failed: {error}")))
}

fn repository_target(repo_path: &str, target: &str) -> GitResult<(PathBuf, PathBuf)> {
    let repo = open(repo_path)?;
    let root = repo
        .workdir()
        .ok_or_else(|| GitError::InvalidInput("bare repository has no worktree".into()))?
        .canonicalize()?;
    if target.trim().is_empty() || target.contains('\0') {
        return Err(GitError::InvalidInput("target path is empty".into()));
    }
    let input = Path::new(target);
    let candidate = if input.is_absolute() {
        input.to_path_buf()
    } else if target == "." {
        root.clone()
    } else {
        root.join(validate_relative_path(target)?)
    };
    let canonical = candidate.canonicalize().map_err(|error| {
        GitError::InvalidInput(format!("cannot open repository path {target}: {error}"))
    })?;
    if !canonical.starts_with(&root) {
        return Err(GitError::InvalidInput(format!(
            "path escapes the repository: {target}"
        )));
    }
    if !canonical.is_file() && !canonical.is_dir() {
        return Err(GitError::InvalidInput(format!(
            "not a regular file or directory: {target}"
        )));
    }
    Ok((root, canonical))
}

fn run_os_command(mut command: Command) -> GitResult<String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let output = command.stdin(Stdio::null()).output()?;
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).into_owned());
    }
    #[cfg(windows)]
    if output.status.code() == Some(1) {
        // Explorer 在已经成功打开/选中目标时也常返回 1；其详细错误不可可靠区分，
        // 与其它平台不同，仅对这个受控调用兼容该约定。
        return Ok(String::from_utf8_lossy(&output.stdout).into_owned());
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    Err(GitError::Cli(format!(
        "OS open command failed: {}{}",
        stdout.trim(),
        if stderr.trim().is_empty() {
            String::new()
        } else {
            format!("\n{}", stderr.trim())
        }
    )))
}

#[cfg(target_os = "windows")]
fn open_command(target: &Path) -> Command {
    let mut command = Command::new("explorer.exe");
    command.arg(target);
    command
}

#[cfg(target_os = "macos")]
fn open_command(target: &Path) -> Command {
    let mut command = Command::new("open");
    command.arg(target);
    command
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_command(target: &Path) -> Command {
    let mut command = Command::new("xdg-open");
    command.arg(target);
    command
}

#[cfg(target_os = "windows")]
fn reveal_command(root: &Path, target: &Path) -> Command {
    let mut command = Command::new("explorer.exe");
    if target != root {
        command.arg(format!("/select,{}", target.to_string_lossy()));
    } else {
        command.arg(target);
    }
    command
}

#[cfg(target_os = "macos")]
fn reveal_command(root: &Path, target: &Path) -> Command {
    let mut command = Command::new("open");
    if target != root {
        command.arg("-R");
    }
    command.arg(target);
    command
}

#[cfg(all(unix, not(target_os = "macos")))]
fn reveal_command(root: &Path, target: &Path) -> Command {
    let mut command = Command::new("xdg-open");
    command.arg(if target == root {
        target
    } else {
        target.parent().unwrap_or(root)
    });
    command
}

#[tauri::command]
pub fn open_path(path: String, file: String) -> GitResult<String> {
    let (_, target) = repository_target(&path, &file)?;
    run_os_command(open_command(&target))
}

#[tauri::command]
pub fn reveal_path(path: String, file: Option<String>) -> GitResult<String> {
    let file = file.unwrap_or_else(|| ".".into());
    let (root, target) = repository_target(&path, &file)?;
    run_os_command(reveal_command(&root, &target))
}
