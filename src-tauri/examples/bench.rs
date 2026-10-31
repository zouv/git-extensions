//! 大仓库后端性能测量：cargo run --release --example bench -- <仓库路径> [轮数]
//! 不进入 GUI，不写仓库；结果用于比较首屏数据、完整日志和提交切换的核心耗时。

use std::cell::{Cell, RefCell};
use std::env;
use std::time::{Duration, Instant};

use git_extensions_lib::git;

fn percentile(values: &mut [Duration], ratio: f64) -> f64 {
    values.sort();
    let index = ((values.len() - 1) as f64 * ratio).round() as usize;
    values[index].as_secs_f64() * 1000.0
}

fn average(values: &[Duration]) -> Option<f64> {
    (!values.is_empty())
        .then(|| values.iter().sum::<Duration>().as_secs_f64() * 1000.0 / values.len() as f64)
}

fn main() {
    let path = env::args().nth(1).unwrap_or_else(|| {
        eprintln!("usage: cargo run --release --example bench -- <repository> [rounds]");
        std::process::exit(2);
    });
    let rounds = env::args()
        .nth(2)
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(3);
    let repo_name = std::path::Path::new(&path)
        .file_name()
        .and_then(|v| v.to_str())
        .unwrap_or("repository");

    for round in 1..=rounds {
        let started = Instant::now();
        let first_batch = Cell::new(None::<Duration>);
        let revisions = Cell::new(0usize);
        let sample_oids = RefCell::new(Vec::new());
        git::log::run_log(&path, round as u64, 100_000, None, &|| false, &|batch| {
            if !batch.revisions.is_empty() && first_batch.get().is_none() {
                first_batch.set(Some(started.elapsed()));
            }
            revisions.set(revisions.get() + batch.revisions.len());
            let mut samples = sample_oids.borrow_mut();
            for revision in batch.revisions {
                if samples.len() < 30 {
                    samples.push(revision.oid);
                }
            }
            if let Some(error) = batch.error {
                panic!("log failed: {error}");
            }
        })
        .unwrap();
        let log_elapsed = started.elapsed();

        let oids = sample_oids.into_inner();
        let mut detail_times = Vec::with_capacity(oids.len());
        let mut diff_times = Vec::with_capacity(oids.len());
        let mut selection_times = Vec::with_capacity(oids.len());
        for oid in &oids {
            let selection = Instant::now();
            let detail = Instant::now();
            git::diff::get_commit(path.clone(), oid.clone()).unwrap();
            detail_times.push(detail.elapsed());
            let diff = Instant::now();
            git::diff::get_commit_diff(path.clone(), oid.clone()).unwrap();
            diff_times.push(diff.elapsed());
            selection_times.push(selection.elapsed());
        }

        let result = serde_json::json!({
            "repository": repo_name,
            "round": round,
            "revisions": revisions.get(),
            "firstBatchMs": first_batch.get().map(|v| v.as_secs_f64() * 1000.0),
            "fullLogMs": log_elapsed.as_secs_f64() * 1000.0,
            "selectionSamples": oids.len(),
            "detailAvgMs": average(&detail_times),
            "diffAvgMs": average(&diff_times),
            "selectionP95Ms": (!selection_times.is_empty()).then(|| percentile(&mut selection_times, 0.95)),
        });
        println!("{}", serde_json::to_string(&result).unwrap());
    }
}
