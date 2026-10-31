use std::collections::{HashMap, HashSet};
use std::ffi::{OsStr, OsString};
use std::fs;
use std::path::{Path, PathBuf};

use git2::{Oid, Repository, RepositoryState};
use serde::{Deserialize, Serialize};

use super::cli::run_git_with_env;
use super::open;
use crate::error::{GitError, GitResult};

const PLAN_DIR: &str = "git-extensions-rebase";
const PLAN_FILE: &str = "plan.json";
const TODO_FILE: &str = "todo";
const MAX_MESSAGE_BYTES: usize = 1024 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RebaseEntry {
    pub oid: String,
    pub short_id: String,
    pub subject: String,
    /// reword / squash 时作为非交互编辑器的替换提交信息。
    pub message: String,
    /// pick | reword | squash | fixup | drop
    pub action: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RebasePlan {
    pub onto: String,
    pub original_head: String,
    pub branch: Option<String>,
    /// 与 git-rebase-todo 相同：最旧在上，最新在下。
    pub entries: Vec<RebaseEntry>,
}

fn parse_oid(value: &str, label: &str) -> GitResult<Oid> {
    Oid::from_str(value).map_err(|_| GitError::InvalidInput(format!("bad {label} oid: {value}")))
}

fn current_branch(repo: &Repository) -> GitResult<Option<String>> {
    let head = repo.head()?;
    Ok(head
        .name()
        .and_then(|name| name.strip_prefix("refs/heads/"))
        .map(ToOwned::to_owned))
}

fn ensure_clean(repo: &Repository) -> GitResult<()> {
    if repo.state() != RepositoryState::Clean {
        return Err(GitError::InvalidInput(format!(
            "another Git operation is already in progress: {:?}",
            repo.state()
        )));
    }
    let mut options = git2::StatusOptions::new();
    options.include_untracked(true).recurse_untracked_dirs(true);
    if !repo.statuses(Some(&mut options))?.is_empty() {
        return Err(GitError::InvalidInput(
            "interactive rebase requires a clean worktree and index".into(),
        ));
    }
    Ok(())
}

/// 用 first-parent 链验证 onto..HEAD 是完整线性范围，并返回最旧优先的提交。
fn expected_plan(repo: &Repository, onto: Oid) -> GitResult<RebasePlan> {
    let original_head = repo.head()?.peel_to_commit()?;
    let onto_commit = repo.find_commit(onto)?;
    let mut chain = Vec::new();
    let mut current = original_head.clone();
    loop {
        if current.parent_count() != 1 {
            return Err(GitError::InvalidInput(
                "interactive rebase only supports a linear, non-root range without merges".into(),
            ));
        }
        let parent = current.parent(0)?;
        chain.push(current.clone());
        if parent.id() == onto_commit.id() {
            break;
        }
        current = parent;
        if chain.len() > 100_000 {
            return Err(GitError::InvalidInput("rebase range is too large".into()));
        }
    }
    chain.reverse();
    let entries = chain
        .into_iter()
        .map(|commit| {
            let oid = commit.id().to_string();
            let message = String::from_utf8_lossy(commit.message_bytes()).into_owned();
            RebaseEntry {
                short_id: oid[..7].to_string(),
                oid,
                subject: commit.summary().unwrap_or_default().to_string(),
                message,
                action: "pick".to_string(),
            }
        })
        .collect();
    Ok(RebasePlan {
        onto: onto.to_string(),
        original_head: original_head.id().to_string(),
        branch: current_branch(repo)?,
        entries,
    })
}

#[tauri::command]
pub fn prepare_interactive_rebase(path: String, oid: String) -> GitResult<RebasePlan> {
    let repo = open(&path)?;
    ensure_clean(&repo)?;
    let start = repo.find_commit(parse_oid(&oid, "start")?)?;
    if start.parent_count() != 1 {
        return Err(GitError::InvalidInput(
            "start commit must have exactly one parent (root and merge commits are unsupported)"
                .into(),
        ));
    }
    let onto = start.parent(0)?.id();
    expected_plan(&repo, onto)
}

fn validate_plan(repo: &Repository, plan: &RebasePlan) -> GitResult<()> {
    ensure_clean(repo)?;
    let onto = parse_oid(&plan.onto, "onto")?;
    let expected = expected_plan(repo, onto)?;
    if plan.original_head != expected.original_head || plan.branch != expected.branch {
        return Err(GitError::InvalidInput(
            "rebase plan is stale or targets a different branch".into(),
        ));
    }
    if plan.entries.is_empty() || plan.entries.len() != expected.entries.len() {
        return Err(GitError::InvalidInput(
            "rebase plan must contain every commit exactly once".into(),
        ));
    }
    if matches!(
        plan.entries
            .iter()
            .find(|entry| entry.action != "drop")
            .map(|entry| entry.action.as_str()),
        Some("squash" | "fixup")
    ) {
        return Err(GitError::InvalidInput(
            "the first non-drop rebase entry cannot be squash or fixup".into(),
        ));
    }

    let expected_by_oid: HashMap<&str, &RebaseEntry> = expected
        .entries
        .iter()
        .map(|entry| (entry.oid.as_str(), entry))
        .collect();
    let mut seen = HashSet::new();
    for entry in &plan.entries {
        if !seen.insert(entry.oid.as_str()) {
            return Err(GitError::InvalidInput(format!(
                "duplicate commit in rebase plan: {}",
                entry.oid
            )));
        }
        let original = expected_by_oid.get(entry.oid.as_str()).ok_or_else(|| {
            GitError::InvalidInput(format!("commit is outside the rebase range: {}", entry.oid))
        })?;
        if entry.short_id != original.short_id || entry.subject != original.subject {
            return Err(GitError::InvalidInput(format!(
                "commit metadata does not match: {}",
                entry.oid
            )));
        }
        if !matches!(
            entry.action.as_str(),
            "pick" | "reword" | "squash" | "fixup" | "drop"
        ) {
            return Err(GitError::InvalidInput(format!(
                "unsupported rebase action: {}",
                entry.action
            )));
        }
        if entry.message.len() > MAX_MESSAGE_BYTES {
            return Err(GitError::InvalidInput(
                "replacement commit message exceeds 1 MiB".into(),
            ));
        }
        if matches!(entry.action.as_str(), "reword" | "squash") && entry.message.trim().is_empty() {
            return Err(GitError::InvalidInput(format!(
                "{} requires a non-empty commit message",
                entry.action
            )));
        }
    }
    Ok(())
}

fn plan_dir(repo: &Repository) -> PathBuf {
    repo.path().join(PLAN_DIR)
}

pub(crate) fn has_internal_rebase_plan(repo: &Repository) -> bool {
    let dir = plan_dir(repo);
    dir.join(PLAN_FILE).is_file() && dir.join(TODO_FILE).is_file()
}

fn controlled_todo(plan: &RebasePlan) -> String {
    let mut todo = String::new();
    for entry in &plan.entries {
        todo.push_str(&entry.action);
        todo.push(' ');
        todo.push_str(&entry.oid);
        todo.push('\n');
    }
    todo
}

fn write_plan_files(repo: &Repository, plan: &RebasePlan) -> GitResult<()> {
    let dir = plan_dir(repo);
    fs::create_dir_all(&dir)?;
    fs::write(dir.join(PLAN_FILE), serde_json::to_vec_pretty(plan)?)?;
    fs::write(dir.join(TODO_FILE), controlled_todo(plan))?;
    Ok(())
}

pub(crate) fn cleanup_rebase_files(repo: &Repository) {
    let dir = plan_dir(repo);
    if let Err(error) = fs::remove_dir_all(&dir) {
        if error.kind() != std::io::ErrorKind::NotFound {
            eprintln!("failed to clean internal rebase files: {error}");
        }
    }
}

fn shell_quote(value: &OsStr) -> String {
    // Git 在 Windows 和 Unix 上都通过其 POSIX shell 解析编辑器命令。
    format!("'{}'", value.to_string_lossy().replace('\'', "'\\''"))
}

fn editor_environment(repo_path: &str, editor_exe: &Path) -> Vec<(&'static str, OsString)> {
    let exe = shell_quote(editor_exe.as_os_str());
    let repo = shell_quote(OsStr::new(repo_path));
    vec![
        (
            "GIT_SEQUENCE_EDITOR",
            OsString::from(format!("{exe} --ge-sequence-editor {repo}")),
        ),
        (
            "GIT_EDITOR",
            OsString::from(format!("{exe} --ge-message-editor {repo}")),
        ),
        ("GIT_TERMINAL_PROMPT", OsString::from("0")),
    ]
}

fn run_rebase(repo_path: &str, args: &[String], editor_exe: &Path) -> GitResult<String> {
    let environment = editor_environment(repo_path, editor_exe);
    let refs: Vec<(&str, &OsStr)> = environment
        .iter()
        .map(|(key, value)| (*key, value.as_os_str()))
        .collect();
    run_git_with_env(repo_path, args, &refs)
}

#[tauri::command]
pub fn start_interactive_rebase(
    path: String,
    onto: String,
    original_head: String,
    entries: Vec<RebaseEntry>,
) -> GitResult<String> {
    let repo = open(&path)?;
    let plan = RebasePlan {
        onto,
        original_head,
        branch: current_branch(&repo)?,
        entries,
    };
    let editor = std::env::current_exe()?;
    start_interactive_rebase_with_editor(path, plan, &editor)
}

/// 集成测试传入 Cargo 构建的应用二进制；生产 IPC 始终使用 current_exe。
#[doc(hidden)]
pub fn start_interactive_rebase_with_editor(
    path: String,
    plan: RebasePlan,
    editor_exe: &Path,
) -> GitResult<String> {
    let repo = open(&path)?;
    validate_plan(&repo, &plan)?;
    write_plan_files(&repo, &plan)?;
    let args = vec![
        "rebase".to_string(),
        "--interactive".to_string(),
        "--no-autosquash".to_string(),
        plan.onto.clone(),
    ];
    match run_rebase(&path, &args, editor_exe) {
        Ok(output) => {
            cleanup_rebase_files(&repo);
            Ok(output)
        }
        Err(error) => {
            if repo.state() == RepositoryState::Clean {
                cleanup_rebase_files(&repo);
            }
            Err(error)
        }
    }
}

pub(crate) fn continue_rebase(path: &str) -> GitResult<String> {
    let editor = std::env::current_exe()?;
    continue_rebase_with_editor(path, &editor)
}

#[doc(hidden)]
pub fn continue_rebase_with_editor(path: &str, editor_exe: &Path) -> GitResult<String> {
    run_rebase(
        path,
        &["rebase".to_string(), "--continue".to_string()],
        editor_exe,
    )
}

fn read_plan(repo: &Repository) -> GitResult<RebasePlan> {
    let bytes = fs::read(plan_dir(repo).join(PLAN_FILE)).map_err(|error| {
        GitError::InvalidInput(format!("internal rebase plan is unavailable: {error}"))
    })?;
    Ok(serde_json::from_slice(&bytes)?)
}

fn sequence_editor(repo_path: &str, todo_path: &Path) -> GitResult<()> {
    let repo = open(repo_path)?;
    let todo = fs::read(plan_dir(&repo).join(TODO_FILE)).map_err(|error| {
        GitError::InvalidInput(format!("internal rebase todo is unavailable: {error}"))
    })?;
    fs::write(todo_path, todo)?;
    Ok(())
}

fn message_editor(repo_path: &str, message_path: &Path) -> GitResult<()> {
    let repo = open(repo_path)?;
    let plan = read_plan(&repo)?;
    let done = fs::read_to_string(repo.path().join("rebase-merge").join("done"))?;
    let last_oid = done
        .lines()
        .rev()
        .filter(|line| !line.trim().is_empty() && !line.trim_start().starts_with('#'))
        .find_map(|line| line.split_whitespace().nth(1))
        .ok_or_else(|| {
            GitError::InvalidInput("cannot find last commit in rebase done file".into())
        })?;
    if let Some(entry) = plan.entries.iter().find(|entry| {
        matches!(entry.action.as_str(), "reword" | "squash") && entry.oid.starts_with(last_oid)
    }) {
        let mut message = entry.message.clone();
        if !message.ends_with('\n') {
            message.push('\n');
        }
        fs::write(message_path, message)?;
    }
    Ok(())
}

/// main.rs 在启动 Tauri 前调用；普通应用参数返回 None。
pub fn internal_editor_entry() -> Option<GitResult<()>> {
    let args: Vec<OsString> = std::env::args_os().collect();
    let mode = args.get(1)?.to_str()?;
    if mode != "--ge-sequence-editor" && mode != "--ge-message-editor" {
        return None;
    }
    Some((|| {
        if args.len() != 4 {
            return Err(GitError::InvalidInput(format!(
                "{mode} requires repository and Git file paths"
            )));
        }
        let repo_path = args[2].to_string_lossy().into_owned();
        let git_file = PathBuf::from(&args[3]);
        if mode == "--ge-sequence-editor" {
            sequence_editor(&repo_path, &git_file)
        } else {
            message_editor(&repo_path, &git_file)
        }
    })())
}

impl From<serde_json::Error> for GitError {
    fn from(error: serde_json::Error) -> Self {
        GitError::InvalidInput(format!("invalid internal rebase plan: {error}"))
    }
}
