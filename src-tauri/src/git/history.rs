use serde::Serialize;

use super::cli::run_git;
use super::open;
use crate::error::{GitError, GitResult};

/// 单文件 blame 行数上限，防止巨型文件拖垮 IPC 与渲染。
const MAX_BLAME_LINES: usize = 20_000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlameLine {
    pub oid: String,
    pub short_id: String,
    pub author: String,
    pub time: i64,
    pub line: usize,
    pub content: String,
}

/// 逐行归属。oid 为空时 blame 工作区当前文件，否则 blame 指定提交中的版本。
pub fn blame_file(path: String, file: String, oid: Option<String>) -> GitResult<Vec<BlameLine>> {
    let repo = open(&path)?;
    let rel = super::validate_relative_path(&file)?;
    let selected = oid.as_deref().filter(|s| !s.trim().is_empty());
    let mut opts = git2::BlameOptions::new();
    let bytes = if let Some(oid) = selected {
        let parsed = git2::Oid::from_str(oid)
            .map_err(|_| GitError::InvalidInput(format!("bad oid: {oid}")))?;
        opts.newest_commit(parsed);
        let tree = repo.find_commit(parsed)?.tree()?;
        let entry = tree.get_path(&rel)?;
        if repo.odb()?.read_header(entry.id())?.0 > 2 * 1024 * 1024 {
            return Err(GitError::InvalidInput(
                "file exceeds blame size limit (2 MiB)".into(),
            ));
        }
        let blob = entry.to_object(&repo)?.peel_to_blob()?;
        if blob.size() > 2 * 1024 * 1024 {
            return Err(GitError::InvalidInput(
                "file exceeds blame size limit (2 MiB)".into(),
            ));
        }
        blob.content().to_vec()
    } else {
        let full = super::resolve_worktree_path(&repo, &file)?;
        if std::fs::metadata(&full)?.len() > 2 * 1024 * 1024 {
            return Err(GitError::InvalidInput(
                "file exceeds blame size limit (2 MiB)".into(),
            ));
        }
        use std::io::Read;
        let mut bytes = Vec::new();
        std::fs::File::open(full)?
            .take(2 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)?;
        if bytes.len() > 2 * 1024 * 1024 {
            return Err(GitError::InvalidInput(
                "file exceeds blame size limit".into(),
            ));
        }
        bytes
    };
    let content = std::str::from_utf8(&bytes)
        .map_err(|_| GitError::InvalidInput("blame requires UTF-8 text".into()))?;
    if content.contains('\0') {
        return Err(GitError::InvalidInput("cannot blame binary file".into()));
    }
    let lines: Vec<&str> = content.lines().collect();
    if lines.len() > MAX_BLAME_LINES {
        return Err(GitError::InvalidInput(format!(
            "file exceeds blame limit ({MAX_BLAME_LINES} lines)"
        )));
    }
    let committed = match repo.blame_file(&rel, Some(&mut opts)) {
        Ok(blame) => Some(blame),
        Err(e)
            if selected.is_none()
                && matches!(
                    e.code(),
                    git2::ErrorCode::NotFound | git2::ErrorCode::UnbornBranch
                ) =>
        {
            None
        }
        Err(e) => return Err(e.into()),
    };
    // 以工作区 buffer 修正插入/删除造成的行号移动，新增行使用零 OID。
    let adjusted = if selected.is_none() {
        committed
            .as_ref()
            .map(|b| b.blame_buffer(&bytes))
            .transpose()?
    } else {
        None
    };
    let blame = adjusted.as_ref().or(committed.as_ref());
    let mut result = Vec::with_capacity(lines.len());
    for (index, content) in lines.into_iter().enumerate() {
        let hunk = blame.and_then(|b| b.get_line(index + 1));
        let oid = hunk
            .as_ref()
            .map(|h| h.final_commit_id())
            .filter(|id| !id.is_zero());
        let sig = hunk
            .as_ref()
            .filter(|_| oid.is_some())
            .map(|h| h.final_signature());
        result.push(BlameLine {
            oid: oid.map(|id| id.to_string()).unwrap_or_default(),
            short_id: oid
                .map(|id| id.to_string()[..7].to_string())
                .unwrap_or_else(|| "未提交".into()),
            author: sig
                .as_ref()
                .and_then(|s| s.name())
                .unwrap_or("工作区")
                .into(),
            time: sig.as_ref().map(|s| s.when().seconds()).unwrap_or(0),
            line: index + 1,
            content: content.into(),
        });
    }
    Ok(result)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileLogEntry {
    pub file_path: String,
    pub oid: String,
    pub short_id: String,
    pub author_name: String,
    pub author_time: i64,
    pub subject: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopedHistoryEntry {
    pub oid: String,
    pub short_id: String,
    pub author_name: String,
    pub author_time: i64,
    pub subject: String,
}

/// 当前分支的历史，可按目录或不跟随改名的文件过滤。仓库作用域沿用
/// `HEAD`，不混入其它分支；文件作用域保留 `--follow` 以跨改名追溯。
pub fn scoped_history(
    path: String,
    file: Option<String>,
    follow: bool,
    max_count: Option<u32>,
) -> GitResult<Vec<ScopedHistoryEntry>> {
    let max = max_count.unwrap_or(500).clamp(1, 5000).to_string();
    let mut args = vec!["log".to_string()];
    if follow && file.is_some() {
        args.push("--follow".into());
    }
    args.extend([
        "--format=%x00%H%x00%an%x00%at%x00%s".into(),
        "-n".into(),
        max,
        "HEAD".into(),
    ]);
    if let Some(file) = file.as_deref() {
        super::validate_relative_path(file)?;
        args.extend(["--".into(), file.to_string()]);
    }
    let out = run_git(&path, &args)?;
    let mut entries = Vec::new();
    let mut fields = out.split('\0').filter(|field| !field.is_empty());
    while let Some(oid) = fields.next() {
        let oid = oid.trim_start_matches('\n');
        if oid.len() != 40 || !oid.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            continue;
        }
        let (Some(author), Some(time), Some(subject)) =
            (fields.next(), fields.next(), fields.next())
        else {
            break;
        };
        entries.push(ScopedHistoryEntry {
            oid: oid.into(),
            short_id: oid[..7].into(),
            author_name: author.into(),
            author_time: time.parse().unwrap_or_default(),
            subject: subject.trim_end_matches(['\r', '\n']).into(),
        });
    }
    Ok(entries)
}

pub fn file_log(
    path: String,
    file: String,
    max_count: Option<u32>,
) -> GitResult<Vec<FileLogEntry>> {
    super::validate_relative_path(&file)?;
    let max = max_count.unwrap_or(200).clamp(1, 1000).to_string();
    let out = run_git(
        &path,
        &[
            "log".into(),
            "--follow".into(),
            "--format=%x00%H%x00%an%x00%at%x00%s%x00".into(),
            "--name-status".into(),
            "-z".into(),
            "-n".into(),
            max,
            "--".into(),
            file.clone(),
        ],
    )?;
    let mut entries = Vec::new();
    let mut followed_path = file;
    // 全部字段用 NUL 定界；记录分隔符等控制字符可以合法出现在 author/subject 中。
    let mut fields = out.split('\0').peekable();
    while let Some(token) = fields.next() {
        let oid = token.trim_start_matches('\n');
        if oid.len() != 40 || !oid.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            continue;
        }
        let (Some(author), Some(time), Some(subject)) =
            (fields.next(), fields.next(), fields.next())
        else {
            break;
        };
        let mut commit_path = followed_path.clone();
        while let Some(token) = fields.peek() {
            let status = token.trim_start_matches('\n');
            if status.len() == 40 && status.bytes().all(|byte| byte.is_ascii_hexdigit()) {
                break;
            }
            fields.next();
            if status.is_empty() {
                continue;
            }
            let Some(first) = fields.next() else {
                break;
            };
            if status.starts_with('R') || status.starts_with('C') {
                let Some(second) = fields.next() else {
                    break;
                };
                if second == followed_path {
                    commit_path = second.into();
                    if status.starts_with('R') {
                        followed_path = first.into();
                    }
                }
            } else if first == followed_path {
                commit_path = first.into();
            }
        }
        entries.push(FileLogEntry {
            oid: oid.into(),
            short_id: oid[..7].into(),
            author_name: author.into(),
            author_time: time.parse().unwrap_or_default(),
            subject: subject.into(),
            file_path: commit_path,
        });
    }
    Ok(entries)
}
