use std::ffi::OsStr;
use std::process::{Command, Stdio};

use git2::RepositoryState;
use serde::Serialize;

use super::{
    open,
    operations::{acquire_write, WriteLease},
    resolve_worktree_path, validate_relative_path,
};
use crate::error::{GitError, GitResult};

/// 写操作统一走 git CLI：hooks 会执行，行为与命令行完全一致。
/// GUI 程序派生控制台进程时不弹出黑色控制台窗口。
/// 只读但 git2 不便实现的查询（file log 等）也复用此入口。
pub(crate) fn run_git(repo_path: &str, args: &[String]) -> GitResult<String> {
    run_git_with_env(repo_path, args, &[])
}

/// 与 run_git 相同，但允许为 Git 及其 hooks 设置受控环境变量。
pub(crate) fn run_git_with_env(
    repo_path: &str,
    args: &[String],
    envs: &[(&str, &OsStr)],
) -> GitResult<String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C")
        .arg(repo_path)
        // 所有用户文件参数都按字面值解释，禁用 glob 和 pathspec magic。
        .arg("--literal-pathspecs")
        .args(args)
        .envs(envs.iter().copied())
        .stdin(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let output = cmd.output()?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let details = match (stdout.trim().is_empty(), stderr.trim().is_empty()) {
            (false, false) => format!("{}\n{}", stdout.trim(), stderr.trim()),
            (false, true) => stdout.trim().to_string(),
            (true, false) => stderr.trim().to_string(),
            (true, true) => format!("git exited with status {}", output.status),
        };
        Err(GitError::Cli(details))
    }
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
    let _write = acquire_write(&path)?;
    if message.trim().is_empty() {
        return Err(GitError::InvalidInput("commit message is empty".into()));
    }
    run_git(&path, &["commit".to_string(), "-m".to_string(), message])
}

pub fn create_branch(path: String, name: String, start_point: Option<String>) -> GitResult<String> {
    let _write = acquire_write(&path)?;
    validate_ref_name(&name, "heads")?;
    let repo = open(&path)?;
    let mut args = vec!["branch".into(), "--".into(), name];
    if let Some(start) = start_point {
        args.push(commit_argument(&repo, &start)?);
    }
    run_git(&path, &args)
}

pub fn checkout_branch(path: String, name: String) -> GitResult<String> {
    let _write = acquire_write(&path)?;
    validate_ref_name(&name, "heads")?;
    open(&path)?.find_branch(&name, git2::BranchType::Local)?;
    run_git(
        &path,
        &["switch".into(), "--no-guess".into(), "--".into(), name],
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

pub fn fetch(path: String, remote: Option<String>) -> GitResult<String> {
    let _write = acquire_write(&path)?;
    let mut args = vec!["fetch".to_string()];
    if let Some(remote) = remote {
        validate_remote(&open(&path)?, &remote)?;
        args.push("--".into());
        args.push(remote);
    }
    run_git(&path, &args)
}

pub fn pull(path: String) -> GitResult<String> {
    let _write = acquire_write(&path)?;
    run_git(&path, &["pull".to_string()])
}

pub fn push(
    path: String,
    remote: Option<String>,
    branch: Option<String>,
    expected_head: Option<String>,
    expected_branch: Option<String>,
) -> GitResult<String> {
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
    match (remote, branch) {
        (None, None) => {
            if !info.has_upstream {
                return Err(GitError::InvalidInput(
                    "no upstream configured; choose a remote and target branch explicitly".into(),
                ));
            }
            // 尊重 Git push 配置；任何失败原样返回，不换远程、不修改 upstream。
            run_git(&path, &["push".into()])
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
            run_git(
                &path,
                &[
                    "push".into(),
                    "--set-upstream".into(),
                    "--".into(),
                    remote,
                    refspec,
                ],
            )
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
    let _write = acquire_write(&path)?;
    let mut args = vec!["stash".to_string(), "push".to_string()];
    if include_untracked {
        args.push("-u".to_string());
    }
    if !message.trim().is_empty() {
        args.push("-m".to_string());
        args.push(message);
    }
    run_git(&path, &args)
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
