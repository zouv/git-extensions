//! 新增仓库、revision、difftool、tracked files 与 patch 能力；只操作临时目录。
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use git_extensions_lib::git;

static SEQUENCE: AtomicUsize = AtomicUsize::new(0);

struct Workspace {
    root: PathBuf,
}

impl Workspace {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "ge-repository-capabilities-{}-{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&root).unwrap();
        Self { root }
    }

    fn path(&self, name: &str) -> String {
        self.root.join(name).to_string_lossy().into_owned()
    }

    fn repo(&self, name: &str) -> TestRepo {
        TestRepo::new(self.root.join(name))
    }
}

impl Drop for Workspace {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

struct TestRepo {
    root: PathBuf,
}

impl TestRepo {
    fn new(root: PathBuf) -> Self {
        fs::create_dir(&root).unwrap();
        let mut options = git2::RepositoryInitOptions::new();
        options.initial_head("main");
        let repo = git2::Repository::init_opts(&root, &options).unwrap();
        let mut config = repo.config().unwrap();
        config.set_bool("core.autocrlf", false).unwrap();
        config.set_str("core.eol", "lf").unwrap();
        config.set_str("user.name", "Capability Test").unwrap();
        config
            .set_str("user.email", "capability@example.com")
            .unwrap();
        config
            .set_str(
                "core.hooksPath",
                root.join("test-hooks").to_string_lossy().as_ref(),
            )
            .unwrap();
        Self { root }
    }

    fn path(&self) -> String {
        self.root.to_string_lossy().into_owned()
    }

    fn repo(&self) -> git2::Repository {
        git2::Repository::open(&self.root).unwrap()
    }

    fn write(&self, name: &str, content: &str) {
        let path = self.root.join(name);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, content).unwrap();
    }

    fn commit(&self, name: &str, content: &str) -> String {
        self.write(name, content);
        git::cli::stage_files(self.path(), vec![name.into()]).unwrap();
        git::cli::commit(self.path(), format!("change {name}")).unwrap();
        self.head()
    }

    fn head(&self) -> String {
        self.repo()
            .head()
            .unwrap()
            .peel_to_commit()
            .unwrap()
            .id()
            .to_string()
    }
}

fn wait_for(path: &Path) {
    let deadline = Instant::now() + Duration::from_secs(15);
    while !path.exists() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(20));
    }
    assert!(path.exists(), "timed out waiting for {}", path.display());
}

#[test]
fn clone_and_create_validate_targets_and_release_failed_target_leases() {
    let workspace = Workspace::new();
    let source = workspace.repo("source");
    let head = source.commit("tracked.txt", "from source\n");

    let clone_path = workspace.path("clone-target");
    let opened = tauri::async_runtime::block_on(git::commands::clone_repository(
        clone_path.clone(),
        source.path(),
    ))
    .unwrap();
    assert_eq!(opened, clone_path);
    let cloned = git2::Repository::open(&clone_path).unwrap();
    assert!(!cloned.is_bare());
    assert_eq!(
        cloned
            .head()
            .unwrap()
            .peel_to_commit()
            .unwrap()
            .id()
            .to_string(),
        head
    );
    assert_eq!(
        fs::read_to_string(Path::new(&clone_path).join("tracked.txt"))
            .unwrap()
            .trim_end(),
        "from source"
    );

    let injected = workspace.path("option-target");
    let error = git::cli::clone_repository(injected.clone(), "--upload-pack=unexpected".into())
        .unwrap_err()
        .to_string();
    assert!(error.contains("invalid clone URL"));
    assert!(!Path::new(&injected).exists());
    assert!(
        git::cli::clone_repository(workspace.path("missing-parent/child"), source.path()).is_err()
    );

    // 第一次 clone 失败后在同一目标重试，证明 RAII 已释放目标 lease。
    let retry = workspace.path("retry-target");
    assert!(git::cli::clone_repository(retry.clone(), workspace.path("missing-source")).is_err());
    git::cli::clone_repository(retry, source.path()).unwrap();

    let created = workspace.path("created-target");
    let actual =
        tauri::async_runtime::block_on(git::commands::create_repository(created.clone())).unwrap();
    assert_eq!(actual, created);
    assert!(!git2::Repository::open(&created).unwrap().is_bare());
    assert!(git::cli::create_repository(workspace.path("created-target/nested")).is_err());

    let occupied = workspace.root.join("occupied");
    fs::create_dir(&occupied).unwrap();
    fs::write(occupied.join("keep.txt"), "keep").unwrap();
    assert!(
        git::cli::clone_repository(occupied.to_string_lossy().into_owned(), source.path()).is_err()
    );
    git::cli::create_repository(occupied.to_string_lossy().into_owned()).unwrap();
    assert!(!git2::Repository::open(&occupied).unwrap().is_bare());
    assert!(git::cli::create_repository(occupied.to_string_lossy().into_owned()).is_err());
    assert_eq!(
        fs::read_to_string(occupied.join("keep.txt")).unwrap(),
        "keep"
    );
    assert!(git::cli::create_repository("relative-target".into()).is_err());
}

#[test]
fn revision_resolution_full_oid_checkout_and_tracked_file_listing() {
    let workspace = Workspace::new();
    let repo = workspace.repo("revisions");
    let first = repo.commit("z.txt", "first\n");
    repo.write("z.txt", "second\n");
    repo.write("a.txt", "second\n");
    git::cli::stage_files(repo.path(), vec!["z.txt".into(), "a.txt".into()]).unwrap();
    git::cli::commit(repo.path(), "second revision".into()).unwrap();
    let second = repo.head();
    git::cli::create_tag(
        repo.path(),
        "v1".into(),
        Some(first.clone()),
        Some("release".into()),
    )
    .unwrap();

    assert_eq!(
        tauri::async_runtime::block_on(git::commands::resolve_revision(repo.path(), "v1".into()))
            .unwrap(),
        first
    );
    assert_eq!(
        git::cli::resolve_revision(repo.path(), "HEAD~1".into()).unwrap(),
        first
    );
    assert!(git::cli::resolve_revision(repo.path(), "--help".into()).is_err());
    assert!(git::cli::resolve_revision(repo.path(), "HEAD:a.txt".into()).is_err());

    repo.write("m.txt", "staged\n");
    git::cli::stage_files(repo.path(), vec!["m.txt".into()]).unwrap();
    repo.write("untracked.txt", "not tracked\n");
    assert_eq!(
        tauri::async_runtime::block_on(git::commands::list_tracked_files(repo.path())).unwrap(),
        vec!["a.txt", "m.txt", "z.txt"]
    );

    for invalid in ["HEAD", &first[..8], "v1", "--detach"] {
        assert!(git::cli::checkout_revision(repo.path(), invalid.into()).is_err());
    }
    tauri::async_runtime::block_on(git::commands::checkout_revision(repo.path(), first.clone()))
        .unwrap();
    assert_eq!(repo.head(), first);
    assert_eq!(repo.repo().head().unwrap().name(), Some("HEAD"));

    repo.write("z.txt", "dirty local content\n");
    assert!(git::cli::checkout_revision(repo.path(), second.clone()).is_err());
    assert_eq!(repo.head(), first);
    assert_eq!(
        fs::read_to_string(repo.root.join("z.txt")).unwrap(),
        "dirty local content\n"
    );
    repo.write("z.txt", "first\n");
    git::cli::checkout_revision(repo.path(), second.clone()).unwrap();
    assert_eq!(repo.head(), second);
}

#[test]
fn difftool_waits_for_controlled_tool_without_holding_the_write_lease() {
    let workspace = Workspace::new();
    let repo = workspace.repo("difftool");
    repo.commit("a.txt", "one\n");
    let script = repo.root.join("fake-tool.sh");
    fs::write(
        &script,
        "#!/bin/sh\necho run >> difftool-runs\n: > difftool-started\ni=0\nwhile [ ! -f difftool-release ]; do\n  i=$((i+1))\n  [ $i -lt 200 ] || exit 1\n  sleep 0.1\ndone\n",
    )
    .unwrap();
    let mut config = repo.repo().config().unwrap();
    config.set_str("diff.tool", "fake").unwrap();
    config
        .set_str("difftool.fake.cmd", "sh fake-tool.sh")
        .unwrap();
    drop(config);
    repo.write("a.txt", "two\n");

    let path = repo.path();
    let tool = std::thread::spawn(move || {
        tauri::async_runtime::block_on(git::commands::open_difftool(path, "a.txt".into(), false))
    });
    wait_for(&repo.root.join("difftool-started"));
    // 外部工具仍运行时，普通读和另一项写操作都可继续。
    tauri::async_runtime::block_on(git::commands::list_tracked_files(repo.path())).unwrap();
    git::cli::create_branch(repo.path(), "parallel-write".into(), None).unwrap();
    fs::write(repo.root.join("difftool-release"), "release").unwrap();
    tool.join().unwrap().unwrap();

    assert!(git::cli::open_difftool(repo.path(), "../outside".into(), false).is_err());
    assert!(git::cli::open_difftool(
        repo.path(),
        repo.root.join("a.txt").to_string_lossy().into_owned(),
        false
    )
    .is_err());
    // 以连字符开头的文件名位于 `--` 之后，不会成为 Git 选项。
    let _ = git::cli::open_difftool(repo.path(), "--cached".into(), false);

    fs::remove_file(repo.root.join("difftool-release")).unwrap();
    fs::write(&script, "#!/bin/sh\necho run >> difftool-runs\n").unwrap();
    git::cli::stage_files(repo.path(), vec!["a.txt".into()]).unwrap();
    git::cli::open_difftool(repo.path(), "a.txt".into(), true).unwrap();
    let runs = fs::read_to_string(repo.root.join("difftool-runs")).unwrap();
    assert_eq!(runs.lines().count(), 2);
}

fn patch_with(content: &str) -> String {
    format!("diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-one\n+{content}\n")
}

#[test]
fn patch_preview_and_apply_use_identical_bytes_and_reject_stale_or_failing_patches() {
    let workspace = Workspace::new();
    let repo = workspace.repo("patch");
    repo.commit("a.txt", "one\n");
    let patch = workspace.root.join("selected.patch");
    fs::write(&patch, patch_with("two")).unwrap();
    let patch_path = patch.to_string_lossy().into_owned();

    let preview = tauri::async_runtime::block_on(git::commands::preview_patch(
        repo.path(),
        patch_path.clone(),
    ))
    .unwrap();
    assert_eq!(preview.patch_oid.len(), 40);
    assert!(preview.summary.contains("a.txt"));
    assert!(git::cli::apply_patch(repo.path(), patch_path.clone(), "0".repeat(40)).is_err());
    assert_eq!(
        fs::read_to_string(repo.root.join("a.txt")).unwrap(),
        "one\n"
    );

    fs::write(&patch, patch_with("three")).unwrap();
    let stale = git::cli::apply_patch(repo.path(), patch_path.clone(), preview.patch_oid)
        .unwrap_err()
        .to_string();
    assert!(stale.contains("changed"));
    assert_eq!(
        fs::read_to_string(repo.root.join("a.txt")).unwrap(),
        "one\n"
    );

    let preview = git::cli::preview_patch(repo.path(), patch_path.clone()).unwrap();
    repo.write("a.txt", "external edit\n");
    assert!(tauri::async_runtime::block_on(git::commands::apply_patch(
        repo.path(),
        patch_path.clone(),
        preview.patch_oid.clone(),
    ))
    .is_err());
    assert_eq!(
        fs::read_to_string(repo.root.join("a.txt")).unwrap(),
        "external edit\n"
    );

    // apply --check 失败后 lease 已释放，恢复上下文即可用同一预览重试。
    repo.write("a.txt", "one\n");
    git::cli::apply_patch(repo.path(), patch_path.clone(), preview.patch_oid).unwrap();
    assert_eq!(
        fs::read_to_string(repo.root.join("a.txt")).unwrap(),
        "three\n"
    );
    assert!(git::cli::preview_patch(repo.path(), "selected.patch".into()).is_err());

    let oversized = workspace.root.join("oversized.patch");
    fs::write(&oversized, vec![b'x'; 16 * 1024 * 1024 + 1]).unwrap();
    assert!(
        git::cli::preview_patch(repo.path(), oversized.to_string_lossy().into_owned()).is_err()
    );
}

#[test]
fn explorer_targets_keep_file_scope_and_scoped_history_filters_paths() {
    let workspace = Workspace::new();
    let repo = workspace.repo("history");
    repo.commit("dir/文件 one.txt", "first\n");
    repo.commit("other.txt", "second\n");

    let root_target = git::repo::resolve_explorer_target(repo.path()).unwrap();
    assert_eq!(root_target.scope, "repository");
    assert_eq!(root_target.relative_path, None);
    assert_eq!(Path::new(&root_target.repo.path), repo.root.as_path());

    let directory = repo.root.join("dir");
    let directory_target =
        git::repo::resolve_explorer_target(directory.to_string_lossy().into_owned()).unwrap();
    assert_eq!(directory_target.scope, "directory");
    assert_eq!(directory_target.relative_path.as_deref(), Some("dir"));

    let file = repo.root.join("dir").join("文件 one.txt");
    let file_target =
        git::repo::resolve_explorer_target(file.to_string_lossy().into_owned()).unwrap();
    assert_eq!(file_target.scope, "file");
    assert_eq!(
        file_target.relative_path.as_deref(),
        Some("dir/文件 one.txt")
    );

    let root_history = git::history::scoped_history(repo.path(), None, false, Some(20)).unwrap();
    assert_eq!(root_history.len(), 2);
    let directory_history =
        git::history::scoped_history(repo.path(), Some("dir".into()), false, Some(20)).unwrap();
    assert_eq!(directory_history.len(), 1);
    let file_history =
        git::history::scoped_history(repo.path(), Some("dir/文件 one.txt".into()), true, Some(20))
            .unwrap();
    assert_eq!(file_history.len(), 1);
    assert_eq!(file_history[0].subject, "change dir/文件 one.txt");

    assert!(
        git::history::scoped_history(repo.path(), Some("../outside".into()), false, Some(20))
            .is_err()
    );
    let outside = workspace.root.join("outside.txt");
    fs::write(&outside, "outside").unwrap();
    assert!(git::repo::resolve_explorer_target(outside.to_string_lossy().into_owned()).is_err());
}
