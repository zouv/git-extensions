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
#[tauri::command]
pub fn blame_file(path: String, file: String, oid: Option<String>) -> GitResult<Vec<BlameLine>> {
    let repo = open(&path)?;
    let rel = std::path::Path::new(&file);
    let mut opts = git2::BlameOptions::new();
    if let Some(oid) = oid.as_deref().filter(|s| !s.trim().is_empty()) {
        let parsed = git2::Oid::from_str(oid)
            .map_err(|_| GitError::InvalidInput(format!("bad oid: {oid}")))?;
        opts.newest_commit(parsed);
    }
    let blame = repo.blame_file(rel, Some(&mut opts))?;

    // blame 只给行号，内容按版本来源读取
    let content: String = if let Some(oid) = oid.as_deref().filter(|s| !s.trim().is_empty()) {
        let parsed = git2::Oid::from_str(oid).unwrap();
        let commit = repo.find_commit(parsed)?;
        let tree = commit.tree()?;
        let entry = tree.get_path(rel)?;
        let blob = entry.to_object(&repo)?.peel_to_blob()?;
        String::from_utf8_lossy(blob.content()).into_owned()
    } else {
        let workdir = repo
            .workdir()
            .ok_or_else(|| GitError::InvalidInput("bare repository".into()))?;
        std::fs::read_to_string(workdir.join(rel))?
    };
    let lines: Vec<&str> = content.lines().collect();
    if lines.len() > MAX_BLAME_LINES {
        return Err(GitError::InvalidInput(format!(
            "file has {} lines, blame limit is {MAX_BLAME_LINES}",
            lines.len()
        )));
    }

    let mut result = Vec::with_capacity(lines.len());
    for hunk in blame.iter() {
        let oid = hunk.final_commit_id();
        let sig = hunk.final_signature();
        let start = hunk.final_start_line();
        let count = hunk.lines_in_hunk();
        for offset in 0..count {
            let line_no = start + offset;
            result.push(BlameLine {
                short_id: oid.to_string()[..7].to_string(),
                oid: oid.to_string(),
                author: sig.name().unwrap_or_default().to_string(),
                time: sig.when().seconds(),
                line: line_no,
                content: lines.get(line_no - 1).unwrap_or(&"").to_string(),
            });
        }
    }
    result.sort_by_key(|l| l.line);
    Ok(result)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileLogEntry {
    pub oid: String,
    pub short_id: String,
    pub author_name: String,
    pub author_time: i64,
    pub subject: String,
}

/// 单文件提交历史（--follow 跟踪改名）。git2 不支持按路径过滤 revwalk，走 CLI。
#[tauri::command]
pub fn file_log(
    path: String,
    file: String,
    max_count: Option<u32>,
) -> GitResult<Vec<FileLogEntry>> {
    let max = max_count.unwrap_or(200).to_string();
    let out = run_git(
        &path,
        &[
            "log".to_string(),
            "--follow".to_string(),
            "--format=%H%x09%an%x09%at%x09%s".to_string(),
            "-n".to_string(),
            max,
            "--".to_string(),
            file,
        ],
    )?;
    let mut entries = Vec::new();
    for line in out.lines() {
        let mut parts = line.splitn(4, '\t');
        let (Some(oid), Some(author), Some(time), subject) =
            (parts.next(), parts.next(), parts.next(), parts.next())
        else {
            continue;
        };
        entries.push(FileLogEntry {
            oid: oid.to_string(),
            short_id: oid[..7.min(oid.len())].to_string(),
            author_name: author.to_string(),
            author_time: time.parse().unwrap_or_default(),
            subject: subject.unwrap_or_default().to_string(),
        });
    }
    Ok(entries)
}
