use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use super::open;
use crate::error::{GitError, GitResult};

// 只保存正在写入的 Git 元数据目录，不缓存 Repository 或命令结果。
static WRITES: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();

fn writes() -> &'static Mutex<HashSet<PathBuf>> {
    WRITES.get_or_init(|| Mutex::new(HashSet::new()))
}

#[derive(Debug)]
pub(crate) struct WriteLease {
    key: PathBuf,
}

impl Drop for WriteLease {
    fn drop(&mut self) {
        writes()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&self.key);
    }
}

fn acquire_write_key(key: PathBuf) -> GitResult<WriteLease> {
    let mut active = writes().lock().unwrap_or_else(|e| e.into_inner());
    if !active.insert(key.clone()) {
        return Err(GitError::InvalidInput(
            "another write operation is already running for this repository; retry after it finishes".into(),
        ));
    }
    Ok(WriteLease { key })
}

/// 覆盖整个校验和执行阶段；路径别名与 linked worktree 按 common Git dir 互斥。
/// 拒绝而不是排队：不能在分支/HEAD 改变后悄悄执行旧的用户意图。
pub(crate) fn acquire_write(path: &str) -> GitResult<WriteLease> {
    let repo = open(path)?;
    let key = repo.commondir().canonicalize()?;
    acquire_write_key(key)
}

/// clone/init 尚不能打开目标仓库，以规范化目标工作区未来的 .git 路径互斥。
pub(crate) fn acquire_target_write(path: &str) -> GitResult<WriteLease> {
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
    let target = match std::fs::symlink_metadata(target) {
        Ok(_) => target.canonicalize()?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => parent.join(name),
        Err(error) => return Err(error.into()),
    };
    acquire_write_key(target.join(".git"))
}

/// Tauri IPC 只做调度；Git/文件 I/O 和 hooks 在 blocking pool 中执行。
/// 本阶段不强杀写进程，避免中断 hooks 或留下不明确的 Git 状态。
pub(crate) async fn run_blocking<T, F>(action: F) -> GitResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> GitResult<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(action)
        .await
        .map_err(|error| GitError::Cli(format!("repository task failed: {error}")))?
}

// 四个共享读取令牌：FIFO 异步等待，不让长日志独占某个固定队列。
struct ReadPool {
    sender: tauri::async_runtime::Sender<()>,
    receiver: tauri::async_runtime::Mutex<tauri::async_runtime::Receiver<()>>,
}
static READ_POOL: OnceLock<ReadPool> = OnceLock::new();
struct ReadPermit {
    sender: tauri::async_runtime::Sender<()>,
}
impl Drop for ReadPermit {
    fn drop(&mut self) {
        let _ = self.sender.try_send(());
    }
}
pub(crate) async fn run_read<T, F>(action: F) -> GitResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> GitResult<T> + Send + 'static,
{
    let pool = READ_POOL.get_or_init(|| {
        let (sender, receiver) = tauri::async_runtime::channel(4);
        for _ in 0..4 {
            sender.try_send(()).expect("initial read permit");
        }
        ReadPool {
            sender,
            receiver: tauri::async_runtime::Mutex::new(receiver),
        }
    });
    pool.receiver
        .lock()
        .await
        .recv()
        .await
        .ok_or_else(|| GitError::Cli("read scheduler unavailable".into()))?;
    let permit = ReadPermit {
        sender: pool.sender.clone(),
    };
    // 令牌由实际 blocking 工作持有，调用方取消 future 也不会提前释放。
    run_blocking(move || {
        let _permit = permit;
        action()
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };
    #[test]
    fn target_write_lease_is_nonblocking_and_releases_for_path_aliases() {
        let root = std::env::temp_dir().join(format!("ge-target-lease-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir(&root).unwrap();
        let target = root.join("future-repository");
        let first = acquire_target_write(target.to_str().unwrap()).unwrap();
        let alias = root.join(".").join("future-repository");
        let blocked = acquire_target_write(alias.to_str().unwrap());
        assert!(blocked.unwrap_err().to_string().contains("already running"));
        drop(first);
        let second = acquire_target_write(target.to_str().unwrap()).unwrap();
        std::fs::create_dir(&target).unwrap();
        let existing_alias = acquire_target_write(target.to_str().unwrap());
        assert!(existing_alias
            .unwrap_err()
            .to_string()
            .contains("already running"));
        drop(second);
        drop(acquire_target_write(target.to_str().unwrap()).unwrap());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reads_are_bounded_and_errors_or_panics_release_permits() {
        let active = Arc::new(AtomicUsize::new(0));
        let maximum = Arc::new(AtomicUsize::new(0));
        tauri::async_runtime::block_on(async {
            let mut tasks = Vec::new();
            for _ in 0..16 {
                let active = active.clone();
                let maximum = maximum.clone();
                tasks.push(tauri::async_runtime::spawn(run_read(move || {
                    let count = active.fetch_add(1, Ordering::SeqCst) + 1;
                    maximum.fetch_max(count, Ordering::SeqCst);
                    std::thread::sleep(std::time::Duration::from_millis(10));
                    active.fetch_sub(1, Ordering::SeqCst);
                    Ok(())
                })));
            }
            for task in tasks {
                task.await.unwrap().unwrap();
            }
            assert!(maximum.load(Ordering::SeqCst) <= 4);
            assert_eq!(active.load(Ordering::SeqCst), 0);
            assert!(
                run_read::<(), _>(|| Err(GitError::Cli("expected error".into())))
                    .await
                    .is_err()
            );
            assert!(run_read::<(), _>(|| panic!("expected blocking panic"))
                .await
                .is_err());
            run_read(|| Ok(())).await.unwrap();
        });
    }
}
