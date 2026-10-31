use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};

use git2::{Oid, Repository, Sort};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use super::open;
use crate::error::GitResult;

/// 日志请求的代际号：前端发起新请求时旧流自动作废，
/// 避免旧请求的大数据在切换仓库 / 刷新后继续涌进 UI。
static LOG_GENERATION: AtomicU64 = AtomicU64::new(0);

const BATCH_SIZE: usize = 300;
pub const LOG_EVENT: &str = "log-batch";

/// 开发期诊断：同时输出到控制台和临时目录日志文件，避免 GUI 下控制台一闪而过。
macro_rules! ge_log {
    ($($arg:tt)*) => {{
        let msg = format!($($arg)*);
        eprintln!("[git-extensions] {}", msg);
        let path = std::env::temp_dir().join("git-extensions.log");
        if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
            use std::io::Write;
            let _ = writeln!(file, "[git-extensions] {}", msg);
        }
    }};
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RefLabel {
    pub name: String,
    /// head | branch | remote | tag | stash
    pub kind: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Revision {
    pub oid: String,
    pub short_id: String,
    pub parents: Vec<String>,
    pub author_name: String,
    pub author_time: i64,
    pub subject: String,
    pub refs: Vec<RefLabel>,
    /// 分支图：节点所在 lane
    pub lane: usize,
    /// 与 parents 一一对应，每个 parent 在下一行所在的 lane
    pub parent_lanes: Vec<usize>,
    /// 本行汇入节点的其它 lane（merge 线）
    pub merged_lanes: Vec<usize>,
    /// 处理完本节点后仍处于活跃状态的 lane（画竖线用）
    pub active_lanes: Vec<bool>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LogBatch {
    pub request_id: u64,
    pub revisions: Vec<Revision>,
    pub done: bool,
    pub error: Option<String>,
}

fn collect_refs(repo: &Repository) -> HashMap<Oid, Vec<RefLabel>> {
    let mut map: HashMap<Oid, Vec<RefLabel>> = HashMap::new();
    let head_name = repo
        .head()
        .ok()
        .and_then(|h| h.name().map(|s| s.to_string()));
    let references = match repo.references() {
        Ok(r) => r,
        Err(_) => return map,
    };
    for reference in references.flatten() {
        let Some(name) = reference.name() else {
            continue;
        };
        let (short, kind) = if name == "refs/stash" {
            ("stash".to_string(), "stash")
        } else if let Some(s) = name.strip_prefix("refs/heads/") {
            (s.to_string(), "branch")
        } else if let Some(s) = name.strip_prefix("refs/remotes/") {
            (s.to_string(), "remote")
        } else if let Some(s) = name.strip_prefix("refs/tags/") {
            (s.to_string(), "tag")
        } else {
            continue;
        };
        // annotated tag 指向 tag object，peel 到 commit 作为键
        let Some(oid) = reference.peel_to_commit().ok().map(|c| c.id()) else {
            continue;
        };
        let kind = if Some(name) == head_name.as_deref() {
            "head"
        } else {
            kind
        };
        map.entry(oid).or_default().push(RefLabel {
            name: short,
            kind: kind.to_string(),
        });
    }
    map
}

/// 逐行推进的分支图布局。
/// lanes[i] = Some(oid) 表示该 lane 正在等待 oid 出现。
struct GraphLayout {
    lanes: Vec<Option<Oid>>,
}

impl GraphLayout {
    fn new() -> Self {
        Self { lanes: Vec::new() }
    }

    fn vacant_lane(&mut self) -> usize {
        match self.lanes.iter().position(|l| l.is_none()) {
            Some(i) => i,
            None => {
                self.lanes.push(None);
                self.lanes.len() - 1
            }
        }
    }

    fn place(&mut self, oid: Oid, parents: &[Oid]) -> (usize, Vec<usize>, Vec<usize>, Vec<bool>) {
        let lane = match self.lanes.iter().position(|l| *l == Some(oid)) {
            Some(i) => i,
            None => {
                let i = self.vacant_lane();
                self.lanes[i] = Some(oid);
                i
            }
        };
        let merged_lanes: Vec<usize> = self
            .lanes
            .iter()
            .enumerate()
            .filter(|(i, l)| *i != lane && **l == Some(oid))
            .map(|(i, _)| i)
            .collect();

        let mut parent_lanes = Vec::with_capacity(parents.len());
        for (idx, parent) in parents.iter().enumerate() {
            if idx == 0 {
                self.lanes[lane] = Some(*parent);
                parent_lanes.push(lane);
            } else {
                let pl = match self.lanes.iter().position(|l| *l == Some(*parent)) {
                    Some(i) => i,
                    None => {
                        let i = self.vacant_lane();
                        self.lanes[i] = Some(*parent);
                        i
                    }
                };
                parent_lanes.push(pl);
            }
        }
        if parents.is_empty() {
            self.lanes[lane] = None;
        }
        for i in merged_lanes.iter().copied() {
            if self.lanes[i] == Some(oid) {
                self.lanes[i] = None;
            }
        }
        let active = self.lanes.iter().map(|l| l.is_some()).collect();
        (lane, parent_lanes, merged_lanes, active)
    }
}

#[tauri::command]
pub fn start_log(
    app: AppHandle,
    path: String,
    request_id: u64,
    max_count: Option<u32>,
    revspec: Option<String>,
) {
    LOG_GENERATION.store(request_id, Ordering::SeqCst);
    let max_count = max_count.unwrap_or(100_000) as usize;
    ge_log!(
        "start_log request_id={} path={} max_count={} revspec={:?}",
        request_id,
        path,
        max_count,
        revspec
    );
    std::thread::spawn(move || {
        let cancelled = || LOG_GENERATION.load(Ordering::SeqCst) != request_id;
        let emit = |batch: LogBatch| {
            if let Err(e) = app.emit(LOG_EVENT, batch) {
                ge_log!("emit log-batch failed: {}", e);
            }
        };
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            run_log(
                &path,
                request_id,
                max_count,
                revspec.as_deref(),
                &cancelled,
                &emit,
            )
        }));
        match result {
            Ok(Ok(())) => {}
            Ok(Err(e)) => {
                ge_log!("run_log error: {}", e);
                emit(LogBatch {
                    request_id,
                    revisions: Vec::new(),
                    done: true,
                    error: Some(e.to_string()),
                });
            }
            Err(_) => {
                ge_log!("run_log panicked");
                emit(LogBatch {
                    request_id,
                    revisions: Vec::new(),
                    done: true,
                    error: Some("日志加载线程发生内部错误".into()),
                });
            }
        }
    });
}

#[tauri::command]
pub fn report_frontend_state(state: String) {
    ge_log!("frontend state: {}", state);
}

/// 同步执行日志遍历；命令在后台线程调用，性能测量工具也可复用同一实现。
pub fn run_log(
    path: &str,
    request_id: u64,
    max_count: usize,
    revspec: Option<&str>,
    cancelled: &dyn Fn() -> bool,
    emit: &dyn Fn(LogBatch),
) -> GitResult<()> {
    ge_log!("run_log open repo: {}", path);
    let repo = open(path)?;
    let refs = collect_refs(&repo);
    ge_log!("collect_refs: {} oids", refs.len());
    let mut walk = repo.revwalk()?;
    walk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME)?;
    let mut pushed = 0usize;
    match revspec.filter(|s| !s.trim().is_empty()) {
        // 指定 ref（左侧面板过滤）：只从该 ref 出发
        Some(spec) => {
            let commit = repo.revparse_single(spec)?.peel_to_commit()?;
            walk.push(commit.id())?;
            pushed = 1;
        }
        // --all：把所有 ref 的 tip 作为起点，revwalk 自己去重
        None => {
            for reference in repo.references()?.flatten() {
                if let Ok(commit) = reference.peel_to_commit() {
                    let _ = walk.push(commit.id());
                    pushed += 1;
                }
            }
        }
    }
    ge_log!("revwalk pushed {} tips", pushed);
    if repo.is_empty()? {
        emit(LogBatch {
            request_id,
            revisions: Vec::new(),
            done: true,
            error: None,
        });
        return Ok(());
    }

    let mut layout = GraphLayout::new();
    let mut batch = Vec::with_capacity(BATCH_SIZE);
    let mut count = 0usize;
    for item in walk {
        if cancelled() || count >= max_count {
            ge_log!(
                "walk stop cancelled={} count={} max_count={}",
                cancelled(),
                count,
                max_count
            );
            break;
        }
        let oid = item?;
        let commit = repo.find_commit(oid)?;
        let parents: Vec<Oid> = commit.parent_ids().collect();
        let (lane, parent_lanes, merged_lanes, active_lanes) = layout.place(oid, &parents);
        batch.push(Revision {
            oid: oid.to_string(),
            short_id: oid.to_string()[..7].to_string(),
            author_name: commit.author().name().unwrap_or_default().to_string(),
            author_time: commit.author().when().seconds(),
            subject: commit.summary().unwrap_or_default().to_string(),
            refs: refs.get(&oid).cloned().unwrap_or_default(),
            parents: parents.iter().map(|p| p.to_string()).collect(),
            lane,
            parent_lanes,
            merged_lanes,
            active_lanes,
        });
        count += 1;
        if batch.len() >= BATCH_SIZE {
            ge_log!("emit batch size={} done=false", batch.len());
            emit(LogBatch {
                request_id,
                revisions: std::mem::take(&mut batch),
                done: false,
                error: None,
            });
        }
    }
    if !cancelled() {
        ge_log!(
            "emit final batch size={} done=true total={}",
            batch.len(),
            count
        );
        emit(LogBatch {
            request_id,
            revisions: std::mem::take(&mut batch),
            done: true,
            error: None,
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::GraphLayout;
    use git2::Oid;

    fn oid(n: u8) -> Oid {
        Oid::from_str(&format!("{:040x}", n)).unwrap()
    }

    #[test]
    fn linear_history_stays_on_one_lane() {
        let mut g = GraphLayout::new();
        let (lane, parents, merged, active) = g.place(oid(1), &[oid(2)]);
        assert_eq!(lane, 0);
        assert_eq!(parents, vec![0]);
        assert!(merged.is_empty());
        assert_eq!(active, vec![true]);
        let (lane, parents, _, _) = g.place(oid(2), &[oid(3)]);
        assert_eq!(lane, 0);
        assert_eq!(parents, vec![0]);
    }

    #[test]
    fn root_commit_closes_its_lane() {
        let mut g = GraphLayout::new();
        g.place(oid(1), &[oid(2)]);
        let (_, parents, _, active) = g.place(oid(2), &[]);
        assert!(parents.is_empty());
        assert_eq!(active, vec![false]);
    }

    #[test]
    fn merge_commit_forks_second_parent_to_new_lane() {
        let mut g = GraphLayout::new();
        let (_, parents, _, active) = g.place(oid(1), &[oid(2), oid(3)]);
        assert_eq!(parents, vec![0, 1]);
        assert_eq!(active, vec![true, true]);
        // 第二 parent 在自己的 lane 上出现
        let (lane, _, _, _) = g.place(oid(3), &[oid(4)]);
        assert_eq!(lane, 1);
    }

    #[test]
    fn converging_lanes_merge_back() {
        let mut g = GraphLayout::new();
        g.place(oid(1), &[oid(2), oid(3)]);
        g.place(oid(2), &[oid(4)]);
        // oid(3) 的 parent 也是 oid(4)：两条 lane 应汇合
        g.place(oid(3), &[oid(4)]);
        let (_, _, merged, _) = g.place(oid(4), &[]);
        assert_eq!(merged, vec![1]);
    }

    #[test]
    fn unrelated_tips_use_separate_lanes() {
        let mut g = GraphLayout::new();
        g.place(oid(1), &[oid(2)]);
        let (lane, _, _, _) = g.place(oid(3), &[oid(4)]);
        assert_eq!(lane, 1);
    }
}
