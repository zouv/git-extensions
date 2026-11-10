use std::collections::VecDeque;
use std::ffi::OsStr;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use git2::RepositoryState;
use serde::Serialize;

use super::{
    open,
    operations::{acquire_target_write, acquire_write, WriteLease},
    resolve_worktree_path, validate_relative_path,
};
use crate::error::{GitError, GitResult};

const MAX_COMMAND_LOG_ENTRIES: usize = 200;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandLogEntry {
    pub timestamp: i64,
    pub repo_path: String,
    pub args: Vec<String>,
    pub duration_ms: u64,
    pub exit_code: Option<i32>,
    pub success: bool,
    pub stderr: String,
}

static COMMAND_LOG: OnceLock<Mutex<VecDeque<CommandLogEntry>>> = OnceLock::new();

fn command_log_store() -> &'static Mutex<VecDeque<CommandLogEntry>> {
    COMMAND_LOG.get_or_init(|| Mutex::new(VecDeque::with_capacity(MAX_COMMAND_LOG_ENTRIES)))
}

fn record_command_log(
    repo_path: &str,
    args: &[String],
    duration_ms: u64,
    output: &std::process::Output,
) {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let mut stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if stderr.len() > 1024 {
        stderr.truncate(stderr.floor_char_boundary(1024));
        stderr.push('…');
    }
    if let Ok(mut guard) = command_log_store().lock() {
        if guard.len() >= MAX_COMMAND_LOG_ENTRIES {
            guard.pop_front();
        }
        guard.push_back(CommandLogEntry {
            timestamp,
            repo_path: repo_path.to_string(),
            args: args.to_vec(),
            duration_ms,
            exit_code: output.status.code(),
            success: output.status.success(),
            stderr,
        });
    }
}

pub fn get_command_log(path: Option<String>) -> GitResult<Vec<CommandLogEntry>> {
    let filter_path = path.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let guard = command_log_store()
        .lock()
        .map_err(|_| GitError::Cli("command log lock poisoned".into()))?;
    let mut items: Vec<CommandLogEntry> = guard
        .iter()
        .filter(|entry| filter_path.is_none_or(|p| entry.repo_path == p))
        .cloned()
        .collect();
    items.reverse();
    Ok(items)
}

pub fn clear_command_log() -> GitResult<()> {
    let mut guard = command_log_store()
        .lock()
        .map_err(|_| GitError::Cli("command log lock poisoned".into()))?;
    guard.clear();
    Ok(())
}

/// 写操作统一走 git CLI：hooks 会执行，行为与命令行完全一致。
/// GUI 程序派生控制台进程时不弹出黑色控制台窗口。
/// 只读但 git2 不便实现的查询（file log 等）也复用此入口。
pub(crate) fn run_git(repo_path: &str, args: &[String]) -> GitResult<String> {
    run_git_with_env(repo_path, args, &[])
}

fn git_command(repo_path: &str, args: &[String], envs: &[(&str, &OsStr)]) -> Command {
    git_command_mode(repo_path, args, envs, true)
}

/// 绝大多数写操作都用 `--literal-pathspecs` 禁止 glob；Add files 的 Filter
/// 是用户显式输入的 Git pathspec，需要按 Git 原生语义展开，因此单独走
/// `literal_pathspecs = false` 的命令。
fn git_command_mode(
    repo_path: &str,
    args: &[String],
    envs: &[(&str, &OsStr)],
    literal_pathspecs: bool,
) -> Command {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(repo_path);
    if literal_pathspecs {
        cmd.arg("--literal-pathspecs");
    }
    cmd.args(args).envs(envs.iter().copied());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

fn command_failure_details(output: &std::process::Output) -> String {
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    match (stdout.trim().is_empty(), stderr.trim().is_empty()) {
        (false, false) => format!("{}\n{}", stdout.trim(), stderr.trim()),
        (false, true) => stdout.trim().to_string(),
        (true, false) => stderr.trim().to_string(),
        (true, true) => format!("git exited with status {}", output.status),
    }
}

fn git_output(output: std::process::Output) -> GitResult<String> {
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        Err(GitError::Cli(command_failure_details(&output)))
    }
}

fn run_git_mode(repo_path: &str, args: &[String], literal_pathspecs: bool) -> GitResult<String> {
    let started = Instant::now();
    let output = git_command_mode(repo_path, args, &[], literal_pathspecs)
        .stdin(Stdio::null())
        .output()?;
    record_command_log(
        repo_path,
        args,
        started.elapsed().as_millis() as u64,
        &output,
    );
    git_output(output)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
}

fn capture_git(repo_path: &str, args: &[String]) -> GitResult<CommandOutput> {
    let started = Instant::now();
    let output = git_command(repo_path, args, &[])
        .stdin(Stdio::null())
        .output()?;
    record_command_log(
        repo_path,
        args,
        started.elapsed().as_millis() as u64,
        &output,
    );
    if !output.status.success() {
        return Err(GitError::Cli(command_failure_details(&output)));
    }
    Ok(CommandOutput {
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        exit_code: output.status.code(),
    })
}

/// 保留退出码和输出的捕获入口；Add files 的 Show/Add 需要把 Git 的原始
/// 结果展示给用户，而不是在非 0 时直接变成异常。
fn capture_git_output(
    repo_path: &str,
    args: &[String],
    literal_pathspecs: bool,
) -> GitResult<CommandOutput> {
    let started = Instant::now();
    let output = git_command_mode(repo_path, args, &[], literal_pathspecs)
        .stdin(Stdio::null())
        .output()?;
    record_command_log(
        repo_path,
        args,
        started.elapsed().as_millis() as u64,
        &output,
    );
    Ok(CommandOutput {
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        exit_code: output.status.code(),
    })
}

/// 与 run_git 相同，但允许为 Git 及其 hooks 设置受控环境变量。
pub(crate) fn run_git_with_env(
    repo_path: &str,
    args: &[String],
    envs: &[(&str, &OsStr)],
) -> GitResult<String> {
    let started = Instant::now();
    let output = git_command(repo_path, args, envs)
        .stdin(Stdio::null())
        .output()?;
    record_command_log(
        repo_path,
        args,
        started.elapsed().as_millis() as u64,
        &output,
    );
    git_output(output)
}

/// 将确定的字节写入 Git stdin；并发写出 stdout/stderr，避免大 patch 管道互等。
pub(crate) fn run_git_with_stdin(
    repo_path: &str,
    args: &[String],
    input: &[u8],
) -> GitResult<String> {
    let started = Instant::now();
    let mut child = git_command(repo_path, args, &[])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| GitError::Cli("cannot open git stdin".into()))?;
    let (output, written) = std::thread::scope(|scope| {
        let writer = scope.spawn(move || stdin.write_all(input));
        let output = child.wait_with_output();
        let written = writer.join();
        (output, written)
    });
    let output = output?;
    record_command_log(
        repo_path,
        args,
        started.elapsed().as_millis() as u64,
        &output,
    );
    match written {
        Ok(Ok(())) => {}
        // Git 校验失败提前退出时，BrokenPipe 的真实原因在 stderr 中。
        Ok(Err(error)) if error.kind() == std::io::ErrorKind::BrokenPipe => {}
        Ok(Err(error)) => return Err(error.into()),
        Err(_) => return Err(GitError::Cli("git stdin writer failed".into())),
    }
    git_output(output)
}

/// Git progress uses `\r` to rewrite the same line; split on both `\r` and `\n`
/// and forward each non-empty line while still collecting the raw stderr for
/// error reporting.
fn read_git_progress(
    mut reader: impl Read,
    progress: &mut dyn FnMut(&str),
) -> std::io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    let mut line = Vec::new();
    let mut buffer = [0u8; 4096];
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        bytes.extend_from_slice(&buffer[..read]);
        for &byte in &buffer[..read] {
            if byte == b'\r' || byte == b'\n' {
                let text = String::from_utf8_lossy(&line);
                let text = text.trim();
                if !text.is_empty() {
                    progress(text);
                }
                line.clear();
            } else {
                line.push(byte);
                if line.len() >= 4096 {
                    let text = String::from_utf8_lossy(&line);
                    let text = text.trim();
                    if !text.is_empty() {
                        progress(text);
                    }
                    line.clear();
                }
            }
        }
    }
    let text = String::from_utf8_lossy(&line);
    let text = text.trim();
    if !text.is_empty() {
        progress(text);
    }
    Ok(bytes)
}

/// 与 `run_git_with_env` 语义一致，但把 stderr 的进度行实时交给调用方。
fn run_git_with_progress<F>(repo_path: &str, args: &[String], mut progress: F) -> GitResult<String>
where
    F: FnMut(&str) + Send,
{
    let started = Instant::now();
    let mut child = git_command(repo_path, args, &[])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| GitError::Cli("cannot open git stdout".into()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| GitError::Cli("cannot open git stderr".into()))?;
    let (stdout_bytes, stderr_bytes, status) = std::thread::scope(|scope| {
        let stderr_reader = scope.spawn(|| read_git_progress(stderr, &mut progress));
        let mut stdout_bytes = Vec::new();
        let stdout_result = stdout.read_to_end(&mut stdout_bytes);
        let status = child.wait();
        let stderr_result = stderr_reader.join();
        (stdout_result.map(|_| stdout_bytes), stderr_result, status)
    });
    let stdout_bytes = stdout_bytes?;
    let status = status?;
    let stderr_bytes = match stderr_bytes {
        Ok(result) => result?,
        Err(_) => return Err(GitError::Cli("git progress reader failed".into())),
    };
    let output = std::process::Output {
        status,
        stdout: stdout_bytes,
        stderr: stderr_bytes,
    };
    record_command_log(
        repo_path,
        args,
        started.elapsed().as_millis() as u64,
        &output,
    );
    git_output(output)
}

/// 分支/标签名与 revision 是不同类型的输入，不能直接当 CLI 选项拼接。
fn validate_ref_name(name: &str, namespace: &str) -> GitResult<()> {
    if name.trim() != name
        || name.contains('\0')
        || name.starts_with('-')
        || name == "HEAD"
        || !git2::Reference::is_valid_name(&format!("refs/{namespace}/{name}"))
    {
        return Err(GitError::InvalidInput(format!(
            "invalid {namespace} name: {name}"
        )));
    }
    Ok(())
}

fn commit_argument(repo: &git2::Repository, value: &str) -> GitResult<String> {
    if value.is_empty() || value.starts_with('-') || value.contains(['\0', '\n', '\r']) {
        return Err(GitError::InvalidInput("invalid commit reference".into()));
    }
    Ok(repo
        .revparse_single(value)?
        .peel_to_commit()?
        .id()
        .to_string())
}

const MAX_FILE_CONTENT_BYTES: usize = 2 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    pub content: String,
    pub binary: bool,
    pub truncated: bool,
    pub size: u64,
}

/// 文件历史 View 页签：读取指定 revision 的文件内容（默认 HEAD）。
pub fn get_file_content(path: String, file: String, oid: Option<String>) -> GitResult<FileContent> {
    let repo = open(&path)?;
    let relative = validate_relative_path(&file)?;
    let tree = match oid {
        Some(oid) => {
            let oid = commit_argument(&repo, &oid)?;
            repo.find_commit(git2::Oid::from_str(&oid)?)?.tree()?
        }
        None => repo.head()?.peel_to_tree()?,
    };
    let entry = tree
        .get_path(Path::new(&relative))
        .map_err(|_| GitError::InvalidInput(format!("file not found at revision: {file}")))?;
    let blob = repo.find_blob(entry.id())?;
    let bytes = blob.content();
    let size = bytes.len() as u64;
    let truncated = bytes.len() > MAX_FILE_CONTENT_BYTES;
    let limited = &bytes[..bytes.len().min(MAX_FILE_CONTENT_BYTES)];
    let binary = limited.contains(&0) || std::str::from_utf8(limited).is_err();
    Ok(FileContent {
        content: if binary {
            String::new()
        } else {
            String::from_utf8_lossy(limited).into_owned()
        },
        binary,
        truncated,
        size,
    })
}

struct NewRepositoryTarget {
    parent: PathBuf,
    target: PathBuf,
}

fn validate_new_target(path: &str, require_empty: bool) -> GitResult<NewRepositoryTarget> {
    if path.trim().is_empty() || path.contains('\0') {
        return Err(GitError::InvalidInput("target path is empty".into()));
    }
    let target = Path::new(path);
    if !target.is_absolute() {
        return Err(GitError::InvalidInput(
            "target path must be absolute".into(),
        ));
    }
    let name = target
        .file_name()
        .ok_or_else(|| GitError::InvalidInput("invalid target path".into()))?;
    let parent = target
        .parent()
        .ok_or_else(|| GitError::InvalidInput("target parent directory is missing".into()))?
        .canonicalize()?;
    if !parent.is_dir() {
        return Err(GitError::InvalidInput(
            "target parent is not a directory".into(),
        ));
    }
    let target = match std::fs::symlink_metadata(target) {
        Ok(metadata) => {
            if !metadata.is_dir() {
                return Err(GitError::InvalidInput(
                    "clone/init target must be a directory".into(),
                ));
            }
            if require_empty && std::fs::read_dir(target)?.next().is_some() {
                return Err(GitError::InvalidInput(
                    "clone target directory is not empty".into(),
                ));
            }
            target.canonicalize()?
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => parent.join(name),
        Err(error) => return Err(error.into()),
    };
    Ok(NewRepositoryTarget { parent, target })
}

fn path_string(path: &Path) -> String {
    let value = path.to_string_lossy().into_owned();
    #[cfg(windows)]
    {
        // Git for Windows 不接受 Rust canonicalize 返回的 verbatim 工作区路径。
        if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
            return format!(r"\\{rest}");
        }
        if let Some(rest) = value.strip_prefix(r"\\?\") {
            return rest.to_string();
        }
    }
    value
}

pub fn clone_repository(path: String, url: String) -> GitResult<String> {
    clone_repository_with_progress(path, url, |_| {})
}

pub fn clone_repository_with_progress<F>(
    path: String,
    url: String,
    progress: F,
) -> GitResult<String>
where
    F: FnMut(&str) + Send,
{
    let _write = acquire_target_write(&path)?;
    if url.trim().is_empty() || url.starts_with('-') || url.contains(['\0', '\n', '\r']) {
        return Err(GitError::InvalidInput("invalid clone URL".into()));
    }
    let target = validate_new_target(&path, true)?;
    run_git_with_progress(
        &path_string(&target.parent),
        &[
            "clone".into(),
            "--progress".into(),
            "--".into(),
            url,
            path_string(&target.target),
        ],
        progress,
    )?;
    Ok(path_string(&target.target.canonicalize()?))
}

pub fn create_repository(path: String) -> GitResult<String> {
    create_repository_ex(path, false)
}

pub fn create_repository_ex(path: String, bare: bool) -> GitResult<String> {
    let _write = acquire_target_write(&path)?;
    let target = validate_new_target(&path, false)?;
    let discovery_start = if target.target.exists() {
        &target.target
    } else {
        &target.parent
    };
    match git2::Repository::discover(discovery_start) {
        Ok(_) => {
            return Err(GitError::InvalidInput(
                "target is already inside a Git repository".into(),
            ))
        }
        Err(error) if error.code() == git2::ErrorCode::NotFound => {}
        Err(error) => return Err(error.into()),
    }
    let mut args = vec!["init".to_string()];
    if bare {
        // 与 Git Extensions 的 Central repository 对齐：中心仓库无工作区，
        // 并允许同机用户共享对象库。
        args.push("--bare".into());
        args.push("--shared=all".into());
    }
    args.push("--".into());
    args.push(path_string(&target.target));
    run_git(&path_string(&target.parent), &args)?;
    Ok(path_string(&target.target.canonicalize()?))
}

pub fn resolve_revision(path: String, revision: String) -> GitResult<String> {
    commit_argument(&open(&path)?, &revision)
}

fn full_commit_oid(repo: &git2::Repository, value: &str) -> GitResult<String> {
    if value.len() != 40 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(GitError::InvalidInput(
            "checkout requires a full commit OID".into(),
        ));
    }
    let oid = git2::Oid::from_str(value)
        .map_err(|_| GitError::InvalidInput("invalid full commit OID".into()))?;
    repo.find_commit(oid)?;
    Ok(oid.to_string())
}

pub fn checkout_revision(path: String, oid: String) -> GitResult<String> {
    checkout_revision_ex(path, oid, false)
}

pub fn checkout_revision_ex(path: String, oid: String, force: bool) -> GitResult<String> {
    let _write = acquire_write(&path)?;
    let repo = open(&path)?;
    let oid = full_commit_oid(&repo, &oid)?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| GitError::InvalidInput("bare repository has no worktree".into()))?;
    let mut args = vec!["switch".to_string(), "--detach".into()];
    if force {
        args.push("--force".into());
    }
    args.push("--".into());
    args.push(oid);
    run_git(&path_string(workdir), &args)
}

pub fn open_difftool(path: String, file: String, staged: bool) -> GitResult<String> {
    let file = validate_relative_path(&file)?;
    let repo = open(&path)?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| GitError::InvalidInput("bare repository has no worktree".into()))?;
    let mut args = vec!["difftool".into(), "--no-prompt".into()];
    if staged {
        args.push("--cached".into());
    }
    args.push("--".into());
    args.push(file.to_string_lossy().replace('\\', "/"));
    run_git(&path_string(workdir), &args)
}

const MAX_PATCH_BYTES: u64 = 16 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchPreview {
    pub patch_oid: String,
    pub summary: String,
}

fn read_patch_file(patch_path: &str) -> GitResult<Vec<u8>> {
    if patch_path.trim().is_empty() || patch_path.contains('\0') {
        return Err(GitError::InvalidInput("patch path is empty".into()));
    }
    let path = Path::new(patch_path);
    if !path.is_absolute() {
        return Err(GitError::InvalidInput(
            "patch path must be an absolute user-selected file".into(),
        ));
    }
    let file = std::fs::File::open(path)?;
    let metadata = file.metadata()?;
    if !metadata.is_file() {
        return Err(GitError::InvalidInput(
            "patch path must select a regular file".into(),
        ));
    }
    if metadata.len() > MAX_PATCH_BYTES {
        return Err(GitError::InvalidInput(
            "patch file exceeds 16 MiB limit".into(),
        ));
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(MAX_PATCH_BYTES + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_PATCH_BYTES {
        return Err(GitError::InvalidInput(
            "patch file exceeds 16 MiB limit".into(),
        ));
    }
    Ok(bytes)
}

fn hash_patch(repo_path: &str, bytes: &[u8]) -> GitResult<String> {
    let output = run_git_with_stdin(repo_path, &["hash-object".into(), "--stdin".into()], bytes)?;
    let oid = output.trim();
    if oid.len() != 40 || git2::Oid::from_str(oid).is_err() {
        return Err(GitError::Cli("git returned an invalid patch OID".into()));
    }
    Ok(oid.to_string())
}

fn check_patch(repo_path: &str, bytes: &[u8]) -> GitResult<()> {
    run_git_with_stdin(
        repo_path,
        &["apply".into(), "--check".into(), "-".into()],
        bytes,
    )?;
    Ok(())
}

pub fn preview_patch(path: String, patch_path: String) -> GitResult<PatchPreview> {
    let repo = open(&path)?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| GitError::InvalidInput("bare repository has no worktree".into()))?;
    let repo_path = path_string(workdir);
    let bytes = read_patch_file(&patch_path)?;
    let patch_oid = hash_patch(&repo_path, &bytes)?;
    check_patch(&repo_path, &bytes)?;
    let summary = run_git_with_stdin(
        &repo_path,
        &["apply".into(), "--stat".into(), "-".into()],
        &bytes,
    )?;
    Ok(PatchPreview { patch_oid, summary })
}

pub fn apply_patch(
    path: String,
    patch_path: String,
    expected_patch_oid: String,
) -> GitResult<String> {
    let _write = acquire_write(&path)?;
    let repo = open(&path)?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| GitError::InvalidInput("bare repository has no worktree".into()))?;
    let repo_path = path_string(workdir);
    let bytes = read_patch_file(&patch_path)?;
    let actual_oid = hash_patch(&repo_path, &bytes)?;
    if actual_oid != expected_patch_oid {
        return Err(GitError::InvalidInput(
            "patch file changed; preview it again before applying".into(),
        ));
    }
    check_patch(&repo_path, &bytes)?;
    run_git_with_stdin(&repo_path, &["apply".into(), "-".into()], &bytes)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchFileInfo {
    pub path: String,
    pub name: String,
    pub subject: String,
    pub author: String,
    pub date: String,
    pub mailbox: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchApplyState {
    pub in_progress: bool,
    pub conflicts: Vec<String>,
}

fn validate_patch_path(patch_path: &str) -> GitResult<PathBuf> {
    let bytes = read_patch_file(patch_path)?;
    let _ = bytes;
    Ok(PathBuf::from(patch_path))
}

fn patch_file_metadata(path: &Path) -> GitResult<PatchFileInfo> {
    let bytes = read_patch_file(&path.to_string_lossy())?;
    let text = String::from_utf8_lossy(&bytes);
    let mut subject = String::new();
    let mut author = String::new();
    let mut date = String::new();
    let mut saw_from_line = false;
    let mut saw_subject = false;
    for line in text.lines().take(80) {
        if line.starts_with("From ") || line.starts_with("From:") {
            saw_from_line = true;
            author = line.trim_start_matches("From:").trim().to_string();
        } else if let Some(value) = line.strip_prefix("Subject:") {
            saw_subject = true;
            subject = value.trim().to_string();
        } else if let Some(value) = line.strip_prefix("Date:") {
            date = value.trim().to_string();
        } else if line.starts_with("diff --git") || line.starts_with("Index: ") {
            break;
        }
    }
    let mailbox = saw_from_line && saw_subject;
    if !mailbox && subject.is_empty() {
        subject = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default();
    }
    Ok(PatchFileInfo {
        path: path_to_string(path),
        name: path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default(),
        subject,
        author,
        date,
        mailbox,
    })
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn patch_files_in_directory(directory: &str) -> GitResult<Vec<PathBuf>> {
    let directory = Path::new(directory);
    if !directory.is_absolute() {
        return Err(GitError::InvalidInput(
            "patch directory must be an absolute path".into(),
        ));
    }
    if !directory.is_dir() {
        return Err(GitError::InvalidInput(
            "patch directory does not exist".into(),
        ));
    }
    let mut files = Vec::new();
    for entry in std::fs::read_dir(directory)? {
        let entry = entry?;
        if !entry.file_type()?.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_lowercase();
        if name.ends_with(".patch") || name.ends_with(".diff") || name.ends_with(".mbox") {
            files.push(entry.path());
        }
    }
    files.sort_by(|a, b| a.file_name().cmp(&b.file_name()));
    Ok(files)
}

pub fn list_patch_directory(path: String, directory: String) -> GitResult<Vec<PatchFileInfo>> {
    let _ = open(&path)?;
    let files = patch_files_in_directory(&directory)?;
    let mut result = Vec::with_capacity(files.len());
    for file in files {
        result.push(patch_file_metadata(&file)?);
    }
    Ok(result)
}

fn patch_apply_args(
    patch: &Path,
    mailbox: bool,
    ignore_whitespace: bool,
    sign_off: bool,
) -> Vec<String> {
    let mut args = if mailbox {
        vec!["am".to_string()]
    } else {
        vec!["apply".to_string()]
    };
    if ignore_whitespace {
        args.push("--ignore-whitespace".into());
    }
    if mailbox && sign_off {
        args.push("--signoff".into());
    }
    args.push("--".into());
    args.push(path_to_string(patch));
    args
}

fn detect_mailbox_patch(bytes: &[u8]) -> bool {
    let text = String::from_utf8_lossy(bytes);
    let mut saw_from = false;
    let mut saw_subject = false;
    for line in text.lines().take(80) {
        if line.starts_with("From ") || line.starts_with("From:") {
            saw_from = true;
        } else if line.starts_with("Subject:") {
            saw_subject = true;
        } else if line.starts_with("diff --git") || line.starts_with("Index: ") {
            break;
        }
    }
    saw_from && saw_subject
}

fn run_patch_apply_locked(
    repo_path: &str,
    patch: &Path,
    bytes: &[u8],
    ignore_whitespace: bool,
    sign_off: bool,
) -> GitResult<CommandOutput> {
    let mailbox = detect_mailbox_patch(bytes);
    let args = patch_apply_args(patch, mailbox, ignore_whitespace, sign_off);
    capture_git_output(repo_path, &args, true)
}

pub fn apply_patch_file_ex(
    path: String,
    patch_path: String,
    ignore_whitespace: bool,
    sign_off: bool,
) -> GitResult<CommandOutput> {
    let _write = acquire_write(&path)?;
    let workdir = repository_workdir(&path)?;
    let patch = validate_patch_path(&patch_path)?;
    let bytes = read_patch_file(&patch_path)?;
    run_patch_apply_locked(&workdir, &patch, &bytes, ignore_whitespace, sign_off)
}

pub fn apply_patch_directory_ex(
    path: String,
    directory: String,
    ignore_whitespace: bool,
    sign_off: bool,
) -> GitResult<CommandOutput> {
    let _write = acquire_write(&path)?;
    let workdir = repository_workdir(&path)?;
    let files = patch_files_in_directory(&directory)?;
    if files.is_empty() {
        return Err(GitError::InvalidInput(
            "patch directory contains no .patch/.diff/.mbox files".into(),
        ));
    }
    let mut stdout = String::new();
    let mut stderr = String::new();
    let mut exit_code = Some(0);
    for file in files {
        let bytes = read_patch_file(&path_to_string(&file))?;
        stdout.push_str(&format!(
            "==> {}\n",
            file.file_name().unwrap_or_default().to_string_lossy()
        ));
        let output = run_patch_apply_locked(&workdir, &file, &bytes, ignore_whitespace, sign_off)?;
        stdout.push_str(&output.stdout);
        stderr.push_str(&output.stderr);
        exit_code = output.exit_code;
        if output.exit_code != Some(0) {
            break;
        }
    }
    Ok(CommandOutput {
        stdout,
        stderr,
        exit_code,
    })
}

pub fn get_patch_apply_state(path: String) -> GitResult<PatchApplyState> {
    let repo = open(&path)?;
    let applying = repo.path().join("rebase-apply").join("applying").exists();
    let in_progress = applying || matches!(repo.state(), RepositoryState::ApplyMailbox);
    let mut conflicts = Vec::new();
    if let Ok(index) = repo.index() {
        if let Ok(iterator) = index.conflicts() {
            for conflict in iterator.flatten() {
                for entry in [conflict.ancestor, conflict.our, conflict.their]
                    .into_iter()
                    .flatten()
                {
                    let path = String::from_utf8_lossy(&entry.path).into_owned();
                    if !path.is_empty() && !conflicts.contains(&path) {
                        conflicts.push(path);
                    }
                }
            }
        }
    }
    conflicts.sort();
    Ok(PatchApplyState {
        in_progress,
        conflicts,
    })
}

fn continue_patch_args(command: &str) -> Vec<String> {
    vec!["am".to_string(), command.to_string()]
}

pub fn continue_patch(path: String) -> GitResult<CommandOutput> {
    let _write = acquire_write(&path)?;
    let workdir = repository_workdir(&path)?;
    let envs = [("GIT_EDITOR", OsStr::new("true"))];
    let started = Instant::now();
    let args = continue_patch_args("--continue");
    let output = git_command_mode(&workdir, &args, &envs, true)
        .stdin(Stdio::null())
        .output()?;
    record_command_log(
        &workdir,
        &args,
        started.elapsed().as_millis() as u64,
        &output,
    );
    Ok(CommandOutput {
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        exit_code: output.status.code(),
    })
}

pub fn skip_patch(path: String) -> GitResult<CommandOutput> {
    let _write = acquire_write(&path)?;
    let workdir = repository_workdir(&path)?;
    let args = continue_patch_args("--skip");
    capture_git_output(&workdir, &args, true)
}

pub fn abort_patch(path: String) -> GitResult<CommandOutput> {
    let _write = acquire_write(&path)?;
    let workdir = repository_workdir(&path)?;
    let args = continue_patch_args("--abort");
    capture_git_output(&workdir, &args, true)
}

fn local_branch(repo: &git2::Repository) -> GitResult<String> {
    let head = repo.head()?;
    head.name()
        .and_then(|name| name.strip_prefix("refs/heads/"))
        .map(ToOwned::to_owned)
        .ok_or_else(|| {
            GitError::InvalidInput("push requires a local branch; HEAD is detached".into())
        })
}

fn config_value(config: &git2::Config, key: &str) -> GitResult<Option<String>> {
    match config.get_string(key) {
        Ok(value) => Ok(Some(value)),
        Err(error) if error.code() == git2::ErrorCode::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

fn validate_remote(repo: &git2::Repository, name: &str) -> GitResult<()> {
    if name.is_empty() || name.starts_with('-') || name.contains(['\0', '\n', '\r']) {
        return Err(GitError::InvalidInput("invalid remote name".into()));
    }
    // 只接受仓库中配置的远程，不能传入 URL、路径或 Git 选项。
    repo.find_remote(name)?;
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PushInfo {
    pub branch: String,
    pub branch_ref: String,
    pub head_oid: String,
    pub has_upstream: bool,
    pub upstream: Option<String>,
    pub remotes: Vec<String>,
}

pub fn get_push_info(path: String) -> GitResult<PushInfo> {
    let repo = open(&path)?;
    let branch = local_branch(&repo)?;
    let config = repo.config()?;
    let remote = config_value(&config, &format!("branch.{branch}.remote"))?;
    let merge = config_value(&config, &format!("branch.{branch}.merge"))?;
    let upstream = remote
        .filter(|remote| !remote.is_empty())
        .zip(merge.filter(|merge| !merge.is_empty()))
        .map(|(remote, merge)| {
            format!(
                "{remote}/{}",
                merge.strip_prefix("refs/heads/").unwrap_or(&merge)
            )
        });
    let remotes = repo
        .remotes()?
        .iter()
        .flatten()
        .map(ToOwned::to_owned)
        .collect();
    let head_oid = repo.head()?.peel_to_commit()?.id().to_string();
    Ok(PushInfo {
        branch_ref: format!("refs/heads/{branch}"),
        branch,
        head_oid,
        has_upstream: upstream.is_some(),
        upstream,
        remotes,
    })
}

fn paths_args(paths: &[String]) -> GitResult<Vec<String>> {
    if paths.is_empty() {
        return Err(GitError::InvalidInput("no paths given".into()));
    }
    let mut args = Vec::with_capacity(paths.len() + 1);
    args.push("--".to_string());
    args.extend(paths.iter().cloned());
    Ok(args)
}

fn expand_rename_paths(
    repo: &git2::Repository,
    paths: &[String],
    staged: bool,
) -> GitResult<Vec<String>> {
    if paths.is_empty() {
        return Err(GitError::InvalidInput("no paths given".into()));
    }
    let mut expanded: Vec<String> = paths
        .iter()
        .map(|path| {
            validate_relative_path(path).map(|path| path.to_string_lossy().replace('\\', "/"))
        })
        .collect::<GitResult<_>>()?;
    let mut options = git2::StatusOptions::new();
    options
        .include_untracked(true)
        .recurse_untracked_dirs(true)
        .renames_head_to_index(true)
        .renames_index_to_workdir(true);
    let statuses = repo.statuses(Some(&mut options))?;
    for entry in statuses.iter() {
        let relevant = if staged {
            entry.status().contains(git2::Status::INDEX_RENAMED)
        } else {
            entry.status().contains(git2::Status::WT_RENAMED)
        };
        if !relevant {
            continue;
        }
        let delta = if staged {
            entry.head_to_index()
        } else {
            entry.index_to_workdir()
        };
        let Some(delta) = delta else { continue };
        let old_path = delta
            .old_file()
            .path()
            .map(|path| path.to_string_lossy().replace('\\', "/"));
        let new_path = delta
            .new_file()
            .path()
            .map(|path| path.to_string_lossy().replace('\\', "/"));
        let selected = expanded
            .iter()
            .any(|path| Some(path) == old_path.as_ref() || Some(path) == new_path.as_ref());
        if selected {
            expanded.extend([old_path, new_path].into_iter().flatten());
        }
    }
    let mut unique = Vec::new();
    for path in expanded {
        if !unique.contains(&path) {
            unique.push(path);
        }
    }
    Ok(unique)
}

fn validate_add_filter(filter: &str) -> GitResult<String> {
    let filter = filter.trim();
    if filter.is_empty() || filter.contains(['\0', '\n', '\r']) {
        return Err(GitError::InvalidInput("invalid add filter".into()));
    }
    Ok(filter.to_string())
}

fn add_files_args(filter: &str, force: bool, dry_run: bool) -> Vec<String> {
    let mut args = vec!["add".to_string()];
    if dry_run {
        args.push("--dry-run".into());
    }
    if force {
        args.push("-f".into());
    }
    args.push("--".into());
    args.push(filter.to_string());
    args
}

fn repository_workdir(path: &str) -> GitResult<String> {
    let repo = open(path)?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| GitError::InvalidInput("bare repository has no worktree".into()))?;
    Ok(path_string(workdir))
}

/// 预览 `git add` 会添加哪些文件；Filter 按 Git pathspec 语义解释。
pub fn preview_add_files(path: String, filter: String, force: bool) -> GitResult<CommandOutput> {
    let filter = validate_add_filter(&filter)?;
    let workdir = repository_workdir(&path)?;
    capture_git_output(&workdir, &add_files_args(&filter, force, true), false)
}

/// 执行 `git add`；Filter 允许目录、文件或通配符，与 Git Extensions 的
/// Add files 对话框一致。
pub fn add_files(path: String, filter: String, force: bool) -> GitResult<CommandOutput> {
    let _write = acquire_write(&path)?;
    let filter = validate_add_filter(&filter)?;
    let workdir = repository_workdir(&path)?;
    capture_git_output(&workdir, &add_files_args(&filter, force, false), false)
}

pub fn stage_files(path: String, paths: Vec<String>) -> GitResult<String> {
    let write = acquire_write(&path)?;
    stage_files_with_lease(&path, &paths, &write)
}

// 保存冲突结果与 stage 属于同一写操作，复用已有 lease，不重新申请锁。
fn stage_files_with_lease(path: &str, paths: &[String], _write: &WriteLease) -> GitResult<String> {
    let repo = open(path)?;
    let paths = expand_rename_paths(&repo, paths, false)?;
    let mut args = vec!["add".to_string()];
    args.extend(paths_args(&paths)?);
    run_git(&path, &args)
}

pub fn unstage_files(path: String, paths: Vec<String>) -> GitResult<String> {
    let _write = acquire_write(&path)?;
    let repo = open(&path)?;
    let paths = expand_rename_paths(&repo, &paths, true)?;
    let mut args = vec!["restore".to_string(), "--staged".to_string()];
    args.extend(paths_args(&paths)?);
    // 新仓库还没有 HEAD 时 restore --staged 会失败，退回 reset
    match run_git(&path, &args) {
        Ok(out) => Ok(out),
        Err(_) => {
            let mut args = vec!["reset".to_string(), "-q".to_string()];
            args.extend(paths_args(&paths)?);
            run_git(&path, &args)
        }
    }
}

pub fn commit(path: String, message: String) -> GitResult<String> {
    commit_ex(path, message, false)
}

pub fn commit_ex(path: String, message: String, amend: bool) -> GitResult<String> {
    commit_ex_scoped(path, message, amend, None)
}

/// 目录 / 文件作用域的提交：只提交 `scope` 下已暂存的内容，仓库其它目录的
/// 已暂存改动保持原样。实现上用临时 index：从 HEAD 建树，把 `scope` 的
/// `--cached` 补丁应用到临时 index 后再提交；真实 index 不被改写。
/// amend 也因此保留 scope 外的文件内容，只替换 scope 内的暂存部分。
pub fn commit_ex_scoped(
    path: String,
    message: String,
    amend: bool,
    scope: Option<String>,
) -> GitResult<String> {
    let _write = acquire_write(&path)?;
    if message.trim().is_empty() {
        return Err(GitError::InvalidInput("commit message is empty".into()));
    }
    let scope = scope
        .filter(|scope| !scope.trim().is_empty() && scope.trim() != ".")
        .map(|scope| validate_relative_path(&scope))
        .transpose()?
        .map(|scope| scope.to_string_lossy().replace('\\', "/"));
    let Some(scope) = scope else {
        return run_commit_command(&path, &message, amend, &[]);
    };

    let repo = open(&path)?;
    // 作用域提交使用独立临时 index，会绕过 Git 自己对 merge / rebase /
    // 未解决冲突的拒绝，因此在这里显式阻止。
    if repo.state() != RepositoryState::Clean || repo.index()?.has_conflicts() {
        return Err(GitError::InvalidInput(
            "cannot commit a directory scope while a Git operation or conflict is in progress"
                .into(),
        ));
    }
    let files = ScopedCommitFiles::new(repo.path());
    let envs: [(&str, &OsStr); 1] = [("GIT_INDEX_FILE", files.index.as_os_str())];
    let empty = repo.is_empty()?;
    let mut read_tree = vec!["read-tree".to_string()];
    read_tree.push(if empty {
        "--empty".to_string()
    } else {
        "HEAD".to_string()
    });
    run_git_with_env(&path, &read_tree, &envs)?;

    // 真实 index 中 scope 相对 HEAD 的暂存差异；临时 index 的基线也是 HEAD，
    // 因此补丁可以原样应用，且不会把 scope 外的暂存内容带进提交。
    let mut diff = vec![
        "diff".to_string(),
        "--cached".to_string(),
        "--binary".to_string(),
        "--no-ext-diff".to_string(),
        "--no-textconv".to_string(),
    ];
    if !empty {
        diff.push("HEAD".to_string());
    }
    diff.push("--".to_string());
    diff.push(scope.clone());
    let patch = run_git(&path, &diff)?;
    if patch.trim().is_empty() {
        // Amend 可以只改提交信息：临时 index 已是 HEAD 树，不需要应用补丁。
        if !amend {
            return Err(GitError::InvalidInput(format!(
                "no staged changes under {scope}"
            )));
        }
    } else {
        std::fs::write(&files.patch, patch)?;
        run_git_with_env(
            &path,
            &[
                "apply".to_string(),
                "--cached".to_string(),
                "--binary".to_string(),
                files.patch.to_string_lossy().into_owned(),
            ],
            &envs,
        )?;
    }
    run_commit_command(&path, &message, amend, &envs)
}

fn run_commit_command(
    path: &str,
    message: &str,
    amend: bool,
    envs: &[(&str, &OsStr)],
) -> GitResult<String> {
    let mut args = vec!["commit".to_string()];
    if amend {
        args.push("--amend".to_string());
    }
    args.push("-m".to_string());
    args.push(message.to_string());
    run_git_with_env(path, &args, envs)
}

/// 作用域提交的临时 index / 补丁文件；无论成功失败都在 Drop 时清理。
struct ScopedCommitFiles {
    index: PathBuf,
    patch: PathBuf,
}

impl ScopedCommitFiles {
    fn new(git_dir: &Path) -> Self {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default();
        let base = git_dir.join(format!(
            "git-extensions-scope-commit-{}-{stamp}",
            std::process::id()
        ));
        let files = Self {
            index: base.with_extension("index"),
            patch: base.with_extension("patch"),
        };
        // 上一次异常退出可能留下同名文件（时间戳相同几乎不可能）；先清掉，
        // 保证 read-tree 从空 index 开始。
        let _ = std::fs::remove_file(&files.index);
        let _ = std::fs::remove_file(&files.patch);
        files
    }
}

impl Drop for ScopedCommitFiles {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.index);
        let _ = std::fs::remove_file(&self.patch);
    }
}

pub fn commit_fixup(path: String, target_oid: String, squash: bool) -> GitResult<String> {
    let _write = acquire_write(&path)?;
    let repo = open(&path)?;
    let oid = commit_argument(&repo, &target_oid)?;
    let args = if squash {
        vec![
            "commit".to_string(),
            "--no-edit".to_string(),
            format!("--squash={oid}"),
        ]
    } else {
        vec!["commit".to_string(), format!("--fixup={oid}")]
    };
    run_git(&path, &args)
}

pub fn apply_diff_patch(
    path: String,
    patch: String,
    cached: bool,
    reverse: bool,
) -> GitResult<String> {
    let _write = acquire_write(&path)?;
    if patch.trim().is_empty() {
        return Err(GitError::InvalidInput("hunk patch is empty".into()));
    }
    let repo = open(&path)?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| GitError::InvalidInput("bare repository has no worktree".into()))?;
    let mut args = vec![
        "apply".to_string(),
        "--recount".to_string(),
        "--unidiff-zero".to_string(),
    ];
    if cached {
        args.push("--cached".to_string());
    }
    if reverse {
        args.push("-R".to_string());
    }
    args.push("-".to_string());
    run_git_with_stdin(&path_string(workdir), &args, patch.as_bytes())
}

pub fn create_branch(path: String, name: String, start_point: Option<String>) -> GitResult<String> {
    create_branch_ex(path, name, start_point, false, false)
}

pub fn create_branch_ex(
    path: String,
    name: String,
    start_point: Option<String>,
    checkout: bool,
    orphan: bool,
) -> GitResult<String> {
    let _write = acquire_write(&path)?;
    validate_ref_name(&name, "heads")?;
    if orphan {
        return run_git(&path, &["switch".into(), "--orphan".into(), name]);
    }
    let repo = open(&path)?;
    let mut args = vec!["branch".into(), "--".into(), name.clone()];
    if let Some(start) = start_point {
        args.push(commit_argument(&repo, &start)?);
    }
    let mut output = run_git(&path, &args)?;
    if checkout {
        output.push_str(&run_git(
            &path,
            &["switch".into(), "--no-guess".into(), "--".into(), name],
        )?);
    }
    Ok(output)
}

fn stash_before_checkout(path: &str) -> GitResult<bool> {
    let before = run_git(path, &["stash".into(), "list".into(), "--format=%H".into()])?;
    run_git_mode(
        path,
        &[
            "stash".into(),
            "push".into(),
            "-u".into(),
            "-m".into(),
            "git-extensions: auto stash before checkout".into(),
        ],
        false,
    )?;
    let after = run_git(path, &["stash".into(), "list".into(), "--format=%H".into()])?;
    Ok(before.lines().next() != after.lines().next())
}

fn checkout_with_strategy(path: &str, switch_args: &[String], strategy: &str) -> GitResult<String> {
    match strategy {
        "" | "default" => run_git(path, switch_args),
        "stash" => {
            let stashed = stash_before_checkout(path)?;
            match run_git(path, switch_args) {
                Ok(output) => {
                    let mut result = output;
                    if stashed {
                        result.push_str(&run_git(path, &["stash".into(), "pop".into()])?);
                    }
                    Ok(result)
                }
                Err(error) => {
                    if stashed {
                        let _ = run_git(path, &["stash".into(), "pop".into()]);
                    }
                    Err(error)
                }
            }
        }
        "reset" => {
            let mut forced = Vec::with_capacity(switch_args.len() + 1);
            if let Some(first) = switch_args.first() {
                forced.push(first.clone());
                forced.push("--force".into());
                forced.extend(switch_args.iter().skip(1).cloned());
                run_git(path, &forced)
            } else {
                Err(GitError::InvalidInput("empty checkout arguments".into()))
            }
        }
        other => Err(GitError::InvalidInput(format!(
            "unsupported checkout strategy: {other}"
        ))),
    }
}

pub fn checkout_branch(path: String, name: String) -> GitResult<String> {
    checkout_branch_ex(path, name, None)
}

pub fn checkout_branch_ex(
    path: String,
    name: String,
    strategy: Option<String>,
) -> GitResult<String> {
    let _write = acquire_write(&path)?;
    validate_ref_name(&name, "heads")?;
    open(&path)?.find_branch(&name, git2::BranchType::Local)?;
    let args = vec!["switch".to_string(), "--no-guess".into(), "--".into(), name];
    checkout_with_strategy(&path, &args, strategy.as_deref().unwrap_or("default"))
}

pub fn checkout_remote_branch(
    path: String,
    remote_branch: String,
    local_name: Option<String>,
) -> GitResult<String> {
    checkout_remote_branch_ex(path, remote_branch, local_name, None)
}

pub fn checkout_remote_branch_ex(
    path: String,
    remote_branch: String,
    local_name: Option<String>,
    strategy: Option<String>,
) -> GitResult<String> {
    let _write = acquire_write(&path)?;
    let repo = open(&path)?;
    repo.find_branch(&remote_branch, git2::BranchType::Remote)?;
    let default_local = remote_branch
        .split_once('/')
        .map(|(_, rest)| rest.to_string())
        .ok_or_else(|| GitError::InvalidInput("invalid remote branch name".into()))?;
    let local = local_name
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or(default_local);
    validate_ref_name(&local, "heads")?;
    let args = vec![
        "switch".into(),
        "-c".into(),
        local,
        "--track".into(),
        format!("refs/remotes/{remote_branch}"),
    ];
    checkout_with_strategy(&path, &args, strategy.as_deref().unwrap_or("default"))
}

pub fn rename_branch(path: String, old_name: String, new_name: String) -> GitResult<String> {
    let _write = acquire_write(&path)?;
    validate_ref_name(&old_name, "heads")?;
    validate_ref_name(&new_name, "heads")?;
    open(&path)?.find_branch(&old_name, git2::BranchType::Local)?;
    run_git(
        &path,
        &[
            "branch".into(),
            "-m".into(),
            "--".into(),
            old_name,
            new_name,
        ],
    )
}

pub fn delete_branch(path: String, name: String, force: bool) -> GitResult<String> {
    let _write = acquire_write(&path)?;
    validate_ref_name(&name, "heads")?;
    run_git(
        &path,
        &[
            "branch".to_string(),
            if force { "-D" } else { "-d" }.to_string(),
            "--".into(),
            name,
        ],
    )
}

pub fn delete_branches(path: String, names: Vec<String>, force: bool) -> GitResult<String> {
    let _write = acquire_write(&path)?;
    if names.is_empty() {
        return Err(GitError::InvalidInput("no branches selected".into()));
    }
    for name in &names {
        validate_ref_name(name, "heads")?;
    }
    let mut args = vec![
        "branch".to_string(),
        if force { "-D" } else { "-d" }.to_string(),
        "--".into(),
    ];
    args.extend(names);
    run_git(&path, &args)
}

pub fn delete_remote_branch(path: String, remote_branch: String) -> GitResult<String> {
    let _write = acquire_write(&path)?;
    let repo = open(&path)?;
    repo.find_branch(&remote_branch, git2::BranchType::Remote)?;
    let mut matched: Option<(String, String)> = None;
    for remote in repo.remotes()?.iter().flatten() {
        let prefix = format!("{remote}/");
        if let Some(branch) = remote_branch.strip_prefix(&prefix) {
            if matched.as_ref().is_none_or(|(r, _)| remote.len() > r.len()) {
                matched = Some((remote.to_string(), branch.to_string()));
            }
        }
    }
    let (remote_name, branch_name) =
        matched.ok_or_else(|| GitError::InvalidInput("cannot resolve remote for branch".into()))?;
    validate_remote(&repo, &remote_name)?;
    validate_ref_name(&branch_name, "heads")?;
    run_git(
        &path,
        &[
            "push".into(),
            "--delete".into(),
            "--".into(),
            remote_name,
            branch_name,
        ],
    )
}

pub fn merge_branch(
    path: String,
    target: String,
    mode: Option<String>,
    message: Option<String>,
) -> GitResult<String> {
    let _write = acquire_write(&path)?;
    let repo = open(&path)?;
    if repo.state() != RepositoryState::Clean {
        return Err(GitError::InvalidInput(
            "finish or abort the current operation before merging".into(),
        ));
    }
    let target = target.trim().to_string();
    if target.is_empty() || target.starts_with('-') || target.contains(['\0', '\n', '\r']) {
        return Err(GitError::InvalidInput("invalid merge target".into()));
    }
    repo.revparse_single(&target)?.peel_to_commit()?;
    let mode_str = mode.as_deref().unwrap_or("default");
    let mut args = vec!["merge".to_string()];
    match mode_str {
        "default" => {}
        "no-ff" => args.push("--no-ff".into()),
        "ff-only" => args.push("--ff-only".into()),
        "squash" => args.push("--squash".into()),
        other => {
            return Err(GitError::InvalidInput(format!(
                "unsupported merge mode: {other}"
            )))
        }
    }
    if mode_str != "squash" {
        if let Some(msg) = message.filter(|m| !m.trim().is_empty()) {
            args.push("-m".into());
            args.push(msg);
        } else {
            args.push("--no-edit".into());
        }
    }
    args.push("--".into());
    args.push(target);
    run_git(&path, &args)
}

fn validate_new_remote_name(name: &str) -> GitResult<()> {
    if name.trim() != name
        || name.is_empty()
        || name.starts_with('-')
        || name.contains(['\0', '\n', '\r', ' ', '\t'])
        || !git2::Reference::is_valid_name(&format!("refs/remotes/{name}/main"))
    {
        return Err(GitError::InvalidInput(format!(
            "invalid remote name: {name}"
        )));
    }
    Ok(())
}

fn validate_remote_url(url: &str) -> GitResult<()> {
    if url.trim().is_empty() || url.starts_with('-') || url.contains(['\0', '\n', '\r']) {
        return Err(GitError::InvalidInput("invalid remote URL".into()));
    }
    Ok(())
}

pub fn remote_add(path: String, name: String, url: String) -> GitResult<String> {
    let _write = acquire_write(&path)?;
    validate_new_remote_name(&name)?;
    validate_remote_url(&url)?;
    run_git(
        &path,
        &["remote".into(), "add".into(), "--".into(), name, url],
    )
}

pub fn remote_set_url(path: String, name: String, url: String, push: bool) -> GitResult<String> {
    let _write = acquire_write(&path)?;
    validate_remote(&open(&path)?, &name)?;
    validate_remote_url(&url)?;
    let mut args = vec!["remote".into(), "set-url".into()];
    if push {
        args.push("--push".into());
    }
    args.extend(["--".into(), name, url]);
    run_git(&path, &args)
}

pub fn remote_rename(path: String, old_name: String, new_name: String) -> GitResult<String> {
    let _write = acquire_write(&path)?;
    validate_remote(&open(&path)?, &old_name)?;
    validate_new_remote_name(&new_name)?;
    run_git(
        &path,
        &[
            "remote".into(),
            "rename".into(),
            "--".into(),
            old_name,
            new_name,
        ],
    )
}

pub fn remote_remove(path: String, name: String) -> GitResult<String> {
    let _write = acquire_write(&path)?;
    validate_remote(&open(&path)?, &name)?;
    run_git(
        &path,
        &["remote".into(), "remove".into(), "--".into(), name],
    )
}

pub fn fetch(path: String, remote: Option<String>) -> GitResult<String> {
    fetch_ex(path, remote, false)
}

pub fn fetch_ex(path: String, remote: Option<String>, prune: bool) -> GitResult<String> {
    let _write = acquire_write(&path)?;
    let mut args = vec!["fetch".to_string()];
    if prune {
        args.push("--prune".to_string());
    }
    if let Some(remote) = remote.filter(|r| !r.trim().is_empty()) {
        validate_remote(&open(&path)?, &remote)?;
        args.push("--".into());
        args.push(remote);
    }
    run_git(&path, &args)
}

pub fn pull(path: String) -> GitResult<String> {
    pull_ex(path, None, false)
}

pub fn pull_ex(path: String, mode: Option<String>, autostash: bool) -> GitResult<String> {
    pull_ex_advanced(path, mode, autostash, None, None, false, false, None)
}

pub fn pull_ex_advanced(
    path: String,
    mode: Option<String>,
    autostash: bool,
    remote: Option<String>,
    branch: Option<String>,
    fetch_only: bool,
    prune: bool,
    tags_mode: Option<String>,
) -> GitResult<String> {
    let _write = acquire_write(&path)?;
    let tags_mode = tags_mode.as_deref().unwrap_or("auto");
    if !matches!(tags_mode, "auto" | "all" | "none") {
        return Err(GitError::InvalidInput(format!(
            "unsupported tag mode: {tags_mode}"
        )));
    }
    let remote = remote
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let branch = branch
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if branch.is_some() && remote.is_none() {
        return Err(GitError::InvalidInput(
            "a remote branch requires an explicit remote".into(),
        ));
    }
    if let Some(remote) = &remote {
        validate_remote(&open(&path)?, remote)?;
    }
    if let Some(branch) = &branch {
        if branch.starts_with('-') || branch.contains(['\0', '\n', '\r']) {
            return Err(GitError::InvalidInput("invalid remote branch".into()));
        }
    }
    if fetch_only {
        let mut args = vec!["fetch".to_string()];
        if prune {
            args.push("--prune".into());
        }
        if tags_mode == "all" {
            args.push("--tags".into());
        } else if tags_mode == "none" {
            args.push("--no-tags".into());
        }
        if let Some(remote) = remote {
            args.push(remote);
        }
        return run_git(&path, &args);
    }
    let mut args = vec!["pull".to_string()];
    match mode.as_deref().unwrap_or("default") {
        "default" => {}
        "rebase" => args.push("--rebase".into()),
        "ff-only" => args.push("--ff-only".into()),
        "no-ff" => args.push("--no-ff".into()),
        other => {
            return Err(GitError::InvalidInput(format!(
                "unsupported pull mode: {other}"
            )))
        }
    }
    if autostash {
        args.push("--autostash".into());
    }
    if prune {
        args.push("--prune".into());
    }
    if tags_mode == "all" {
        args.push("--tags".into());
    } else if tags_mode == "none" {
        args.push("--no-tags".into());
    }
    if let Some(remote) = remote {
        args.push(remote);
        if let Some(branch) = branch {
            args.push(branch);
        }
    }
    run_git(&path, &args)
}

/// Pull 的工作流窗口需要分别展示 stdout / stderr；失败仍沿用统一原始错误。
pub fn pull_with_output(path: String) -> GitResult<CommandOutput> {
    let _write = acquire_write(&path)?;
    capture_git(&path, &["pull".to_string()])
}

pub fn push(
    path: String,
    remote: Option<String>,
    branch: Option<String>,
    expected_head: Option<String>,
    expected_branch: Option<String>,
) -> GitResult<String> {
    push_ex(
        path,
        remote,
        branch,
        expected_head,
        expected_branch,
        false,
        false,
    )
}

pub fn push_ex(
    path: String,
    remote: Option<String>,
    branch: Option<String>,
    expected_head: Option<String>,
    expected_branch: Option<String>,
    force_with_lease: bool,
    push_tags: bool,
) -> GitResult<String> {
    push_ex_advanced(
        path,
        remote,
        branch,
        expected_head,
        expected_branch,
        force_with_lease,
        push_tags,
        false,
        false,
    )
}

pub fn push_ex_advanced(
    path: String,
    remote: Option<String>,
    branch: Option<String>,
    expected_head: Option<String>,
    expected_branch: Option<String>,
    force_with_lease: bool,
    push_tags: bool,
    force: bool,
    recurse_submodules: bool,
) -> GitResult<String> {
    if force && force_with_lease {
        return Err(GitError::InvalidInput(
            "--force and --force-with-lease are mutually exclusive".into(),
        ));
    }
    let _write = acquire_write(&path)?;
    let info = get_push_info(path.clone())?;
    if expected_head
        .as_ref()
        .is_some_and(|head| head != &info.head_oid)
        || expected_branch
            .as_ref()
            .is_some_and(|branch| branch != &info.branch_ref)
    {
        return Err(GitError::InvalidInput(
            "push preview is stale; branch or HEAD changed".into(),
        ));
    }
    let mut flags = Vec::new();
    if force {
        flags.push("--force".to_string());
    } else if force_with_lease {
        flags.push("--force-with-lease".to_string());
    }
    if push_tags {
        flags.push("--tags".to_string());
    }
    if recurse_submodules {
        flags.push("--recurse-submodules=check".to_string());
    }
    match (remote, branch) {
        (None, None) => {
            if !info.has_upstream {
                return Err(GitError::InvalidInput(
                    "no upstream configured; choose a remote and target branch explicitly".into(),
                ));
            }
            // 尊重 Git push 配置；任何失败原样返回，不换远程、不修改 upstream。
            let mut args = vec!["push".into()];
            args.extend(flags);
            run_git(&path, &args)
        }
        (Some(remote), Some(branch)) => {
            if expected_head.is_none() || expected_branch.is_none() {
                return Err(GitError::InvalidInput(
                    "explicit push requires the preview branch and HEAD".into(),
                ));
            }
            validate_remote(&open(&path)?, &remote)?;
            validate_ref_name(&branch, "heads")?;
            let refspec = format!("{}:refs/heads/{branch}", info.branch_ref);
            let mut args = vec!["push".into(), "--set-upstream".into()];
            args.extend(flags);
            args.extend(["--".into(), remote, refspec]);
            run_git(&path, &args)
        }
        _ => Err(GitError::InvalidInput(
            "remote and target branch must be supplied together".into(),
        )),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StashInfo {
    /// stash@{0} 形式的引用名，apply/pop/drop 用它定位
    pub name: String,
    pub oid: String,
    pub message: String,
}

pub fn stash_list(path: String) -> GitResult<Vec<StashInfo>> {
    let out = run_git(
        &path,
        &[
            "stash".to_string(),
            "list".to_string(),
            "--format=%gd%x09%H%x09%gs".to_string(),
        ],
    )?;
    let mut stashes = Vec::new();
    for line in out.lines() {
        let mut parts = line.splitn(3, '\t');
        let (Some(name), Some(oid), message) = (parts.next(), parts.next(), parts.next()) else {
            continue;
        };
        stashes.push(StashInfo {
            name: name.to_string(),
            oid: oid.to_string(),
            message: message.unwrap_or_default().to_string(),
        });
    }
    Ok(stashes)
}

pub fn stash_push(path: String, message: String, include_untracked: bool) -> GitResult<String> {
    stash_push_ex(path, message, include_untracked, false, Vec::new())
}

pub fn stash_push_ex(
    path: String,
    message: String,
    include_untracked: bool,
    keep_index: bool,
    paths: Vec<String>,
) -> GitResult<String> {
    let _write = acquire_write(&path)?;
    let mut args = vec!["stash".to_string(), "push".to_string()];
    if include_untracked {
        args.push("-u".to_string());
    }
    if keep_index {
        args.push("-k".to_string());
    }
    if !message.trim().is_empty() {
        args.push("-m".to_string());
        args.push(message);
    }
    if !paths.is_empty() {
        for file in &paths {
            validate_relative_path(file)?;
        }
        args.push("--".into());
        args.extend(paths.into_iter().map(|file| format!(":(literal){file}")));
    }
    // --literal-pathspecs 会让 `git stash -u` 不清理未跟踪文件，因此这条命令
    // 使用默认 pathspec 模式，并用 `:(literal)` 保护用户路径。
    run_git_mode(&path, &args, false)
}

// 限定真实 stash 序号，并用预览 OID 防止列表变化后 apply/drop 错条目。
fn checked_stash(path: &str, name: &str, expected_oid: Option<&str>) -> GitResult<String> {
    let digits = name
        .strip_prefix("stash@{")
        .and_then(|s| s.strip_suffix('}'))
        .filter(|s| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()))
        .ok_or_else(|| GitError::InvalidInput("stash name must be stash@{index}".into()))?;
    let index: usize = digits
        .parse()
        .map_err(|_| GitError::InvalidInput("invalid stash index".into()))?;
    let repo = open(path)?;
    let log = repo.reflog("refs/stash")?;
    let oid = log
        .get(index)
        .ok_or_else(|| GitError::InvalidInput("stash entry no longer exists".into()))?
        .id_new()
        .to_string();
    if expected_oid.is_some_and(|expected| expected != oid) {
        return Err(GitError::InvalidInput(
            "stash list changed; refresh and select again".into(),
        ));
    }
    Ok(oid)
}
pub fn stash_apply(path: String, name: String, pop: bool) -> GitResult<String> {
    stash_apply_checked(path, name, pop, None)
}
pub fn stash_apply_checked(
    path: String,
    name: String,
    pop: bool,
    expected_oid: Option<String>,
) -> GitResult<String> {
    let _write = acquire_write(&path)?;
    let oid = checked_stash(&path, &name, expected_oid.as_deref())?;
    run_git(
        &path,
        &[
            "stash".into(),
            if pop { "pop" } else { "apply" }.into(),
            "--".into(),
            if pop { name } else { oid },
        ],
    )
}
pub fn stash_drop(path: String, name: String) -> GitResult<String> {
    stash_drop_checked(path, name, None)
}
pub fn stash_drop_checked(
    path: String,
    name: String,
    expected_oid: Option<String>,
) -> GitResult<String> {
    let _write = acquire_write(&path)?;
    checked_stash(&path, &name, expected_oid.as_deref())?;
    run_git(&path, &["stash".into(), "drop".into(), "--".into(), name])
}

pub fn cherry_pick(path: String, oid: String) -> GitResult<String> {
    let _write = acquire_write(&path)?;
    let oid = commit_argument(&open(&path)?, &oid)?;
    run_git(&path, &["cherry-pick".to_string(), oid])
}

pub fn revert(path: String, oid: String) -> GitResult<String> {
    let _write = acquire_write(&path)?;
    let oid = commit_argument(&open(&path)?, &oid)?;
    run_git(&path, &["revert".to_string(), "--no-edit".to_string(), oid])
}

pub fn rebase(path: String, onto: String) -> GitResult<String> {
    let _write = acquire_write(&path)?;
    let repo = open(&path)?;
    if repo.state() != RepositoryState::Clean {
        return Err(GitError::InvalidInput(
            "finish or abort the current operation before rebasing".into(),
        ));
    }
    let onto = commit_argument(&repo, &onto)?;
    let head = repo.head()?.peel_to_commit()?.id().to_string();
    let backup = super::reset::create_backup(&path, &head, "rebase")?;
    run_git(&path, &["rebase".to_string(), onto])
        .map(|output| format!("{output}\nOriginal HEAD backup: {backup}"))
        .map_err(|error| GitError::Cli(format!("{error}; original HEAD preserved in {backup}")))
}

pub fn discard_files(path: String, paths: Vec<String>) -> GitResult<String> {
    let _write = acquire_write(&path)?;
    let _ = open(&path)?;
    for file in &paths {
        validate_relative_path(file)?;
    }
    let mut args = vec!["restore".to_string(), "--worktree".to_string()];
    args.extend(paths_args(&paths)?);
    run_git(&path, &args)
}

fn validate_rename_name(name: &str) -> GitResult<&str> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed != name || name.contains('\0') {
        return Err(GitError::InvalidInput(
            "new name is empty or has leading/trailing whitespace".into(),
        ));
    }
    if trimmed == "." || trimmed == ".." || trimmed.eq_ignore_ascii_case(".git") {
        return Err(GitError::InvalidInput(format!(
            "invalid file name: {trimmed}"
        )));
    }
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err(GitError::InvalidInput(
            "new name must be a single file name, not a path".into(),
        ));
    }
    if trimmed.ends_with('.') || trimmed.ends_with(' ') {
        return Err(GitError::InvalidInput(
            "Windows does not allow names ending with a dot or space".into(),
        ));
    }
    if trimmed
        .chars()
        .any(|character| matches!(character, '<' | '>' | ':' | '"' | '|' | '?' | '*'))
        || trimmed.chars().any(char::is_control)
    {
        return Err(GitError::InvalidInput(format!(
            "new name contains characters Windows does not allow: {trimmed}"
        )));
    }
    let stem = trimmed
        .split('.')
        .next()
        .unwrap_or(trimmed)
        .to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.as_bytes()[3].is_ascii_digit());
    if reserved {
        return Err(GitError::InvalidInput(format!(
            "new name is reserved on Windows: {trimmed}"
        )));
    }
    Ok(trimmed)
}

/// 用 `git mv` 重命名工作区中的文件或目录。只接受同一目录下的新名称，
/// 不跨目录移动；目标已存在、名称非法或路径是仓库根时拒绝执行。
pub fn rename_path(path: String, relative: String, new_name: String) -> GitResult<String> {
    let _write = acquire_write(&path)?;
    let repo = open(&path)?;
    if repo.workdir().is_none() {
        return Err(GitError::InvalidInput(
            "bare repository has no worktree".into(),
        ));
    }
    let new_name = validate_rename_name(&new_name)?.to_owned();
    let old_relative = validate_relative_path(&relative)?;
    if old_relative.components().any(|component| {
        component
            .as_os_str()
            .to_string_lossy()
            .eq_ignore_ascii_case(".git")
    }) {
        return Err(GitError::InvalidInput(
            "refusing to rename a path inside .git".into(),
        ));
    }
    let old_absolute = resolve_worktree_path(&repo, &relative)?;
    if !old_absolute.exists() {
        return Err(GitError::InvalidInput(format!(
            "path does not exist: {relative}"
        )));
    }
    let parent = old_relative
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty());
    let new_relative = parent
        .map(|parent| parent.join(&new_name))
        .unwrap_or_else(|| std::path::PathBuf::from(&new_name));
    if new_relative == old_relative {
        return Err(GitError::InvalidInput("new name is unchanged".into()));
    }
    let root = repo
        .workdir()
        .ok_or_else(|| GitError::InvalidInput("bare repository has no worktree".into()))?
        .canonicalize()?;
    let new_absolute = root.join(&new_relative);
    if new_absolute.exists() {
        // Windows 大小写不敏感：仅改大小写时 canonicalize 会得到同一路径。
        let same_file = new_absolute
            .canonicalize()
            .ok()
            .zip(old_absolute.canonicalize().ok())
            .is_some_and(|(new_path, old_path)| new_path == old_path);
        if !same_file {
            return Err(GitError::InvalidInput(format!(
                "target already exists: {}",
                new_relative.to_string_lossy().replace('\\', "/")
            )));
        }
    }
    let old_arg = old_relative.to_string_lossy().replace('\\', "/");
    let new_arg = new_relative.to_string_lossy().replace('\\', "/");
    let args = vec!["mv".to_string(), "--".to_string(), old_arg, new_arg.clone()];
    // Windows 对目录改名会检查共享冲突：杀毒 / 索引的瞬时占用重试即可恢复；
    // 若目录被其它进程作为当前工作目录，重试无效，保留 Git 原始错误交给
    // Rename 面板解释。只有工作区完全没动过时才重试，避免部分改名后重复执行。
    let mut attempt = 0;
    loop {
        match run_git(&path, &args) {
            Ok(_) => return Ok(new_arg),
            Err(GitError::Cli(message))
                if attempt < 2
                    && is_rename_permission_error(&message)
                    && old_absolute.exists()
                    && !new_absolute.exists() =>
            {
                attempt += 1;
                std::thread::sleep(std::time::Duration::from_millis(150));
            }
            Err(error) => return Err(error),
        }
    }
}

fn is_rename_permission_error(message: &str) -> bool {
    let message = message.to_ascii_lowercase();
    message.contains("permission denied")
        || message.contains("access is denied")
        || message.contains("being used by another process")
}

/// 重置工作区/暂存区变更（Reset changes 菜单）。paths 为空表示整个仓库；
/// delete_new 为 true 时同时删除新增（未跟踪）文件。
pub fn reset_changes(path: String, paths: Vec<String>, delete_new: bool) -> GitResult<String> {
    let _write = acquire_write(&path)?;
    let repo = open(&path)?;
    if paths.is_empty() {
        let mut output = run_git(&path, &["reset".into(), "--hard".into(), "HEAD".into()])?;
        if delete_new {
            output.push_str(&run_git(
                &path,
                &["clean".into(), "-f".into(), "-d".into()],
            )?);
        }
        return Ok(output);
    }

    let mut restore = Vec::new();
    let mut unstage = Vec::new();
    let mut delete = Vec::new();
    for file in paths {
        let relative = validate_relative_path(&file)?;
        let status = repo.status_file(&relative)?;
        if status.contains(git2::Status::CONFLICTED) {
            return Err(GitError::InvalidInput(format!(
                "cannot reset conflicted file: {file}"
            )));
        }
        if status.contains(git2::Status::INDEX_NEW) {
            // 新增文件先取消暂存；用户勾选“同时删除新增文件”时再 clean。
            unstage.push(file.clone());
            if delete_new {
                delete.push(file);
            }
        } else if status.contains(git2::Status::WT_NEW) {
            if delete_new {
                delete.push(file);
            }
        } else {
            restore.push(file);
        }
    }

    let mut output = String::new();
    if !unstage.is_empty() {
        let mut args = vec![
            "reset".to_string(),
            "-q".to_string(),
            "HEAD".into(),
            "--".into(),
        ];
        args.extend(unstage);
        output.push_str(&run_git(&path, &args)?);
    }
    if !restore.is_empty() {
        let mut args = vec![
            "restore".to_string(),
            "--source=HEAD".into(),
            "--staged".into(),
            "--worktree".into(),
            "--".into(),
        ];
        args.extend(restore);
        output.push_str(&run_git(&path, &args)?);
    }
    if !delete.is_empty() {
        let mut args = vec![
            "clean".to_string(),
            "-f".to_string(),
            "-d".into(),
            "--".into(),
        ];
        args.extend(delete);
        output.push_str(&run_git(&path, &args)?);
    }
    Ok(output)
}

/// 只删除 Git 确认过的未跟踪普通文件；目录、ignored 和已跟踪文件一律拒绝。
pub fn delete_untracked_files(path: String, paths: Vec<String>) -> GitResult<String> {
    let _write = acquire_write(&path)?;
    let repo = open(&path)?;
    if paths.is_empty() {
        return Err(GitError::InvalidInput("no paths given".into()));
    }
    for file in &paths {
        let relative = validate_relative_path(file)?;
        let status = repo.status_file(&relative)?;
        if !status.contains(git2::Status::WT_NEW)
            || status.intersects(
                git2::Status::IGNORED
                    | git2::Status::INDEX_NEW
                    | git2::Status::INDEX_MODIFIED
                    | git2::Status::INDEX_DELETED
                    | git2::Status::INDEX_RENAMED,
            )
        {
            return Err(GitError::InvalidInput(format!(
                "not an untracked file: {file}"
            )));
        }
        let full_path = resolve_worktree_path(&repo, file)?;
        let metadata = std::fs::symlink_metadata(full_path)?;
        if !metadata.file_type().is_file() && !metadata.file_type().is_symlink() {
            return Err(GitError::InvalidInput(format!(
                "refusing to delete a directory or special file: {file}"
            )));
        }
    }
    let mut args = vec!["clean".to_string(), "-f".to_string()];
    args.extend(paths_args(&paths)?);
    run_git(&path, &args)
}

fn contains_conflict_markers(content: &str) -> bool {
    content.lines().any(|line| {
        line.starts_with("<<<<<<<")
            || line.starts_with("=======")
            || line.starts_with(">>>>>>>")
            || line.starts_with("|||||||")
    })
}

pub fn save_resolved_file(
    path: String,
    file: String,
    content: String,
    resolve_as_deletion: Option<bool>,
) -> GitResult<super::status::OperationState> {
    save_resolved_file_checked(path, file, content, resolve_as_deletion, None)
}

pub fn save_resolved_file_checked(
    path: String,
    file: String,
    content: String,
    resolve_as_deletion: Option<bool>,
    expected: Option<super::status::ConflictFile>,
) -> GitResult<super::status::OperationState> {
    let _write = acquire_write(&path)?;
    // 先验证该文件确实仍有 index conflict，避免把此命令当任意文件写入接口。
    let conflict = super::status::get_conflict_file(path.clone(), file.clone())?;
    if expected.as_ref().is_some_and(|old| old != &conflict) {
        return Err(GitError::InvalidInput("conflict preview is stale; file or index stages changed; reload and reconcile your draft before saving".into()));
    }
    if conflict.truncated || conflict.binary {
        return Err(GitError::InvalidInput(
            "refusing to save truncated or binary conflict content".into(),
        ));
    }
    let repo = open(&path)?;
    let full_path = resolve_worktree_path(&repo, &file)?;
    if resolve_as_deletion.unwrap_or(false) {
        match std::fs::remove_file(full_path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
        // git add 对不存在的 literal path 会记录删除，不会留下空文件。
        stage_files_with_lease(&path, &[file], &_write)?;
        return super::status::get_operation_state(path);
    }
    if content.len() > 16 * 1024 * 1024 {
        return Err(GitError::InvalidInput(
            "resolved file exceeds 16 MiB limit".into(),
        ));
    }
    if contains_conflict_markers(&content) {
        return Err(GitError::InvalidInput(
            "resolved content still contains conflict markers".into(),
        ));
    }
    std::fs::write(full_path, content)?;
    stage_files_with_lease(&path, &[file], &_write)?;
    super::status::get_operation_state(path)
}

pub fn continue_operation(path: String) -> GitResult<String> {
    let _write = acquire_write(&path)?;
    let repo = open(&path)?;
    if repo.index()?.has_conflicts() {
        return Err(GitError::InvalidInput(
            "cannot continue while unmerged index entries remain".into(),
        ));
    }
    let state = repo.state();
    let output = match state {
        RepositoryState::Merge => run_git(&path, &["commit".to_string(), "--no-edit".to_string()])?,
        RepositoryState::CherryPick | RepositoryState::CherryPickSequence => run_git(
            &path,
            &["cherry-pick".to_string(), "--continue".to_string()],
        )?,
        RepositoryState::Revert | RepositoryState::RevertSequence => {
            run_git(&path, &["revert".to_string(), "--continue".to_string()])?
        }
        RepositoryState::Rebase
        | RepositoryState::RebaseInteractive
        | RepositoryState::RebaseMerge
        | RepositoryState::ApplyMailboxOrRebase => {
            if super::rebase::has_internal_rebase_plan(&repo) {
                super::rebase::continue_rebase(&path)?
            } else {
                // 外部启动的 rebase 没有私有计划；接受 Git 已保存的提交信息，
                // 不调用依赖私有 plan/done 映射的内部编辑器。
                run_git_with_env(
                    &path,
                    &["rebase".to_string(), "--continue".to_string()],
                    &[
                        ("GIT_EDITOR", OsStr::new("true")),
                        ("GIT_SEQUENCE_EDITOR", OsStr::new("true")),
                        ("GIT_TERMINAL_PROMPT", OsStr::new("0")),
                    ],
                )?
            }
        }
        RepositoryState::Clean => {
            return Err(GitError::InvalidInput("no operation to continue".into()));
        }
        other => {
            return Err(GitError::InvalidInput(format!(
                "unsupported operation to continue: {other:?}"
            )));
        }
    };
    if repo.state() == RepositoryState::Clean {
        super::rebase::cleanup_rebase_files(&repo);
    }
    Ok(output)
}

pub fn abort_operation(path: String) -> GitResult<String> {
    let _write = acquire_write(&path)?;
    let repo = open(&path)?;
    let args: &[&str] = match repo.state() {
        RepositoryState::Merge => &["merge", "--abort"],
        RepositoryState::CherryPick | RepositoryState::CherryPickSequence => {
            &["cherry-pick", "--abort"]
        }
        RepositoryState::Revert | RepositoryState::RevertSequence => &["revert", "--abort"],
        RepositoryState::Bisect => &["bisect", "reset"],
        RepositoryState::Rebase
        | RepositoryState::RebaseInteractive
        | RepositoryState::RebaseMerge
        | RepositoryState::ApplyMailboxOrRebase => &["rebase", "--abort"],
        RepositoryState::Clean => {
            return Err(GitError::InvalidInput("no operation to abort".into()));
        }
        other => {
            return Err(GitError::InvalidInput(format!(
                "unsupported operation to abort: {other:?}"
            )));
        }
    };
    let args: Vec<String> = args.iter().map(|s| s.to_string()).collect();
    let output = run_git(&path, &args)?;
    super::rebase::cleanup_rebase_files(&repo);
    Ok(output)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainedInfo {
    pub branches: Vec<String>,
    pub tags: Vec<String>,
    pub describe: Option<String>,
}

/// 提交详情增强：包含该提交的分支 / 标签、最近标签描述。
/// 三条命令都是只读；分支 / 标签很多时输出可能大，各限制 100 条。
pub fn get_contained_in(path: String, oid: String) -> GitResult<ContainedInfo> {
    let parse = |out: String| -> Vec<String> {
        out.lines()
            .map(|l| l.trim_start_matches(['*', ' ']).trim().to_string())
            .filter(|l| !l.is_empty())
            .take(100)
            .collect()
    };
    let branches = parse(run_git(
        &path,
        &[
            "branch".to_string(),
            "-a".to_string(),
            "--contains".to_string(),
            oid.clone(),
        ],
    )?);
    let tags = parse(run_git(
        &path,
        &["tag".to_string(), "--contains".to_string(), oid.clone()],
    )?);
    let describe = run_git(&path, &["describe".to_string(), "--tags".to_string(), oid])
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    Ok(ContainedInfo {
        branches,
        tags,
        describe,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagInfo {
    pub name: String,
    pub oid: String,
    pub subject: String,
}

pub fn tag_list(path: String) -> GitResult<Vec<TagInfo>> {
    let out = run_git(
        &path,
        &[
            "for-each-ref".to_string(),
            "--format=%(refname:short)%09%(objectname)%09%(contents:subject)".to_string(),
            "refs/tags".to_string(),
        ],
    )?;
    let mut tags = Vec::new();
    for line in out.lines() {
        let mut parts = line.splitn(3, '\t');
        let (Some(name), Some(oid), subject) = (parts.next(), parts.next(), parts.next()) else {
            continue;
        };
        tags.push(TagInfo {
            name: name.to_string(),
            oid: oid.to_string(),
            subject: subject.unwrap_or_default().to_string(),
        });
    }
    Ok(tags)
}

pub fn create_tag(
    path: String,
    name: String,
    oid: Option<String>,
    message: Option<String>,
) -> GitResult<String> {
    let _write = acquire_write(&path)?;
    validate_ref_name(&name, "tags")?;
    let mut args = vec!["tag".to_string()];
    if let Some(msg) = message.filter(|m| !m.trim().is_empty()) {
        args.push("-a".to_string());
        args.push("-m".to_string());
        args.push(msg);
    }
    args.push("--".into());
    args.push(name);
    if let Some(oid) = oid {
        args.push(commit_argument(&open(&path)?, &oid)?);
    }
    run_git(&path, &args)
}

pub fn delete_tag(path: String, name: String) -> GitResult<String> {
    let _write = acquire_write(&path)?;
    validate_ref_name(&name, "tags")?;
    run_git(&path, &["tag".into(), "-d".into(), "--".into(), name])
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmoduleInfo {
    pub path: String,
    pub oid: String,
    /// clean | modified | uninitialized | merge-conflict
    pub status: String,
}

pub fn submodule_list(path: String) -> GitResult<Vec<SubmoduleInfo>> {
    let out = run_git(&path, &["submodule".to_string(), "status".to_string()])?;
    let mut modules = Vec::new();
    for line in out.lines() {
        let (status, rest) = match line.chars().next() {
            Some('+') => ("modified", &line[1..]),
            Some('-') => ("uninitialized", &line[1..]),
            Some('U') => ("merge-conflict", &line[1..]),
            _ => ("clean", line),
        };
        let mut parts = rest.trim().split_whitespace();
        let (Some(oid), Some(path)) = (parts.next(), parts.next()) else {
            continue;
        };
        modules.push(SubmoduleInfo {
            path: path.to_string(),
            oid: oid.to_string(),
            status: status.to_string(),
        });
    }
    Ok(modules)
}

pub fn submodule_update(path: String) -> GitResult<String> {
    let _write = acquire_write(&path)?;
    run_git(
        &path,
        &[
            "submodule".to_string(),
            "update".to_string(),
            "--init".to_string(),
            "--recursive".to_string(),
        ],
    )
}

/// 跳过当前序列步骤，确认期间 Git 状态变化时拒绝旧意图。
pub fn skip_operation(path: String, expected: super::status::OperationState) -> GitResult<String> {
    let _write = acquire_write(&path)?;
    let current = super::status::get_operation_state(path.clone())?;
    if current != expected {
        return Err(GitError::InvalidInput(
            "operation state changed; refresh before skipping".into(),
        ));
    }
    let command = match current.kind.as_str() {
        "rebase" => "rebase",
        "cherryPick" => "cherry-pick",
        "revert" => "revert",
        _ => {
            return Err(GitError::InvalidInput(
                "this operation cannot skip a step".into(),
            ))
        }
    };
    let repo = open(&path)?;
    let output = run_git_with_env(
        &path,
        &[command.into(), "--skip".into()],
        &[
            ("GIT_EDITOR", OsStr::new("true")),
            ("GIT_SEQUENCE_EDITOR", OsStr::new("true")),
        ],
    )?;
    if repo.state() == RepositoryState::Clean {
        super::rebase::cleanup_rebase_files(&repo);
    }
    Ok(output)
}

pub fn worktree_add(
    path: String,
    worktree_path: String,
    branch: Option<String>,
    new_branch: bool,
    start_point: Option<String>,
) -> GitResult<String> {
    let _write = acquire_write(&path)?;
    let target = validate_new_target(&worktree_path, true)?;
    let repo = open(&path)?;
    let mut args = vec!["worktree".to_string(), "add".to_string()];
    let branch_trimmed = branch
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToOwned::to_owned);
    if new_branch {
        let Some(branch_name) = branch_trimmed else {
            return Err(GitError::InvalidInput(
                "new worktree branch name is required".into(),
            ));
        };
        validate_ref_name(&branch_name, "heads")?;
        args.push("-b".into());
        args.push(branch_name);
        args.push("--".into());
        args.push(path_string(&target.target));
        if let Some(start) = start_point
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            args.push(commit_argument(&repo, start)?);
        }
    } else if let Some(branch_name) = branch_trimmed {
        validate_ref_name(&branch_name, "heads")?;
        args.push("--".into());
        args.push(path_string(&target.target));
        args.push(branch_name);
    } else {
        args.push("--detach".into());
        args.push("--".into());
        args.push(path_string(&target.target));
        if let Some(start) = start_point
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            args.push(commit_argument(&repo, start)?);
        }
    }
    run_git(&path, &args)?;
    Ok(path_string(&target.target.canonicalize()?))
}

fn find_linked_worktree_path(repo: &git2::Repository, name: &str) -> GitResult<String> {
    let name = name.trim();
    if name.is_empty() || name.starts_with('-') || name.contains(['\0', '\n', '\r']) {
        return Err(GitError::InvalidInput("invalid worktree name".into()));
    }
    let wt = repo.find_worktree(name)?;
    Ok(path_string(wt.path()))
}

pub fn worktree_remove(path: String, name: String, force: bool) -> GitResult<String> {
    let _write = acquire_write(&path)?;
    let repo = open(&path)?;
    let wt_path = find_linked_worktree_path(&repo, &name)?;
    let mut args = vec!["worktree".to_string(), "remove".to_string()];
    if force {
        args.push("--force".into());
    }
    args.push("--".into());
    args.push(wt_path);
    run_git(&path, &args)
}

pub fn worktree_lock(path: String, name: String, lock: bool) -> GitResult<String> {
    let _write = acquire_write(&path)?;
    let repo = open(&path)?;
    let wt_path = find_linked_worktree_path(&repo, &name)?;
    let action = if lock { "lock" } else { "unlock" };
    run_git(
        &path,
        &["worktree".into(), action.into(), "--".into(), wt_path],
    )
}

pub fn worktree_prune(path: String) -> GitResult<String> {
    let _write = acquire_write(&path)?;
    run_git(&path, &["worktree".into(), "prune".into()])
}

pub fn ignore_file(path: String, pattern: String) -> GitResult<String> {
    let _write = acquire_write(&path)?;
    let entry = pattern.trim();
    if entry.is_empty() || entry.contains(['\0', '\n', '\r']) {
        return Err(GitError::InvalidInput("invalid gitignore pattern".into()));
    }
    let repo = open(&path)?;
    let gitignore_path = resolve_worktree_path(&repo, ".gitignore")?;
    let existing = match std::fs::read_to_string(&gitignore_path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => return Err(error.into()),
    };
    if existing.lines().any(|line| line.trim() == entry) {
        return Ok(format!("{entry} already in .gitignore"));
    }
    let mut updated = existing;
    if !updated.is_empty() && !updated.ends_with('\n') {
        updated.push('\n');
    }
    updated.push_str(entry);
    updated.push('\n');
    std::fs::write(&gitignore_path, updated)?;
    Ok(format!("Added {entry} to .gitignore"))
}

pub fn bisect_start(
    path: String,
    bad_rev: Option<String>,
    good_rev: Option<String>,
) -> GitResult<String> {
    let _write = acquire_write(&path)?;
    let repo = open(&path)?;
    if !matches!(
        repo.state(),
        RepositoryState::Clean | RepositoryState::Bisect
    ) {
        return Err(GitError::InvalidInput(
            "finish or abort the current operation before starting bisect".into(),
        ));
    }
    let mut out = run_git(&path, &["bisect".into(), "start".into()])?;
    if let Some(bad) = bad_rev.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        let bad_oid = commit_argument(&repo, bad)?;
        let step = run_git(&path, &["bisect".into(), "bad".into(), bad_oid])?;
        if !step.trim().is_empty() {
            out = format!("{}\n{}", out.trim(), step.trim());
        }
    }
    if let Some(good) = good_rev.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        let good_oid = commit_argument(&repo, good)?;
        let step = run_git(&path, &["bisect".into(), "good".into(), good_oid])?;
        if !step.trim().is_empty() {
            out = format!("{}\n{}", out.trim(), step.trim());
        }
    }
    Ok(out.trim().to_string())
}

pub fn bisect_mark(path: String, verdict: String, target: Option<String>) -> GitResult<String> {
    let _write = acquire_write(&path)?;
    let repo = open(&path)?;
    let subcmd = match verdict.as_str() {
        "good" => "good",
        "bad" => "bad",
        "skip" => "skip",
        other => {
            return Err(GitError::InvalidInput(format!(
                "invalid bisect verdict: {other}"
            )))
        }
    };
    if repo.state() != RepositoryState::Bisect {
        run_git(&path, &["bisect".into(), "start".into()])?;
    }
    let mut args = vec!["bisect".to_string(), subcmd.to_string()];
    if let Some(rev) = target.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        args.push(commit_argument(&repo, rev)?);
    }
    run_git(&path, &args)
}

pub fn bisect_reset(path: String) -> GitResult<String> {
    let _write = acquire_write(&path)?;
    run_git(&path, &["bisect".into(), "reset".into()])
}

fn validate_export_file_path(output_path: &str) -> GitResult<PathBuf> {
    if output_path.trim().is_empty() || output_path.contains('\0') {
        return Err(GitError::InvalidInput("output path is empty".into()));
    }
    let target = Path::new(output_path);
    if !target.is_absolute() {
        return Err(GitError::InvalidInput(
            "output path must be an absolute path".into(),
        ));
    }
    let name = target
        .file_name()
        .ok_or_else(|| GitError::InvalidInput("invalid output file name".into()))?;
    let parent = target
        .parent()
        .ok_or_else(|| GitError::InvalidInput("output parent directory is missing".into()))?
        .canonicalize()?;
    if !parent.is_dir() {
        return Err(GitError::InvalidInput(
            "output parent is not a directory".into(),
        ));
    }
    if let Ok(meta) = std::fs::symlink_metadata(target) {
        if meta.is_dir() || meta.file_type().is_symlink() {
            return Err(GitError::InvalidInput(
                "refusing to overwrite a directory or symlink".into(),
            ));
        }
    }
    Ok(parent.join(name))
}

pub fn format_patch(path: String, oid: String, output_path: String) -> GitResult<String> {
    let repo = open(&path)?;
    let oid = commit_argument(&repo, &oid)?;
    let out_file = validate_export_file_path(&output_path)?;
    let patch_content = run_git(
        &path,
        &["format-patch".into(), "-1".into(), oid, "--stdout".into()],
    )?;
    std::fs::write(&out_file, patch_content.as_bytes())?;
    Ok(path_string(&out_file))
}

pub fn archive_commit(
    path: String,
    oid: String,
    output_path: String,
    format: Option<String>,
) -> GitResult<String> {
    let repo = open(&path)?;
    let oid = commit_argument(&repo, &oid)?;
    let out_file = validate_export_file_path(&output_path)?;
    let fmt = match format.as_deref() {
        Some("tar.gz") | Some("tgz") => "tar.gz",
        Some("tar") => "tar",
        Some("zip") => "zip",
        None => {
            let lower = out_file.to_string_lossy().to_ascii_lowercase();
            if lower.ends_with(".tar.gz") || lower.ends_with(".tgz") {
                "tar.gz"
            } else if lower.ends_with(".tar") {
                "tar"
            } else {
                "zip"
            }
        }
        Some(other) => {
            return Err(GitError::InvalidInput(format!(
                "unsupported archive format: {other}"
            )))
        }
    };
    let out_str = path_string(&out_file);
    run_git(
        &path,
        &[
            "archive".into(),
            format!("--format={fmt}"),
            "-o".into(),
            out_str.clone(),
            oid,
        ],
    )?;
    Ok(out_str)
}
