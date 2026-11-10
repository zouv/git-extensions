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
    let deadline = Instant::now() + Duration::from_secs(60);
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

    // 克隆界面依赖 stderr 进度行；本地克隆也必须强制输出。
    let progress_clone = workspace.path("clone-progress-target");
    let mut progress_lines = Vec::new();
    git::cli::clone_repository_with_progress(progress_clone.clone(), source.path(), |line| {
        progress_lines.push(line.to_string())
    })
    .unwrap();
    assert!(
        progress_lines
            .iter()
            .any(|line| line.contains("Cloning into")),
        "expected git clone progress, got {progress_lines:?}"
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
        tauri::async_runtime::block_on(git::commands::create_repository(created.clone(), None))
            .unwrap();
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
    tauri::async_runtime::block_on(git::commands::checkout_revision(
        repo.path(),
        first.clone(),
        None,
    ))
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

#[test]
fn rename_path_moves_tracked_files_and_directories_only() {
    let workspace = Workspace::new();
    let repo = workspace.repo("rename");
    repo.commit("dir/file.txt", "content\n");
    repo.commit("root.txt", "root\n");

    let renamed =
        git::cli::rename_path(repo.path(), "dir/file.txt".into(), "renamed.txt".into()).unwrap();
    assert_eq!(renamed, "dir/renamed.txt");
    assert!(repo.root.join("dir/renamed.txt").exists());
    assert!(!repo.root.join("dir/file.txt").exists());
    let index = repo.repo().index().unwrap();
    assert!(index.get_path(Path::new("dir/renamed.txt"), 0).is_some());
    assert!(index.get_path(Path::new("dir/file.txt"), 0).is_none());

    let renamed_dir = git::cli::rename_path(repo.path(), "dir".into(), "moved".into()).unwrap();
    assert_eq!(renamed_dir, "moved");
    assert!(repo.root.join("moved/renamed.txt").exists());
    assert!(!repo.root.join("dir").exists());

    // 目录已存在、名称含路径分隔符、父目录跳转与 .git 一律拒绝。
    assert!(git::cli::rename_path(repo.path(), "root.txt".into(), "moved".into()).is_err());
    assert!(git::cli::rename_path(repo.path(), "root.txt".into(), "a/b".into()).is_err());
    assert!(git::cli::rename_path(repo.path(), "root.txt".into(), "..".into()).is_err());
    assert!(git::cli::rename_path(repo.path(), "root.txt".into(), ".git".into()).is_err());
    assert!(git::cli::rename_path(repo.path(), "../outside".into(), "x".into()).is_err());
    assert!(git::cli::rename_path(repo.path(), "root.txt".into(), "root.txt".into()).is_err());

    // git mv 只处理已跟踪内容；未跟踪文件先由 Add files 加入索引。
    fs::write(repo.root.join("untracked.txt"), "x").unwrap();
    assert!(
        git::cli::rename_path(repo.path(), "untracked.txt".into(), "untracked2.txt".into())
            .is_err()
    );
}

#[test]
fn merge_amend_hunk_branch_remotes_worktree_search_export_and_bisect_capabilities() {
    let workspace = Workspace::new();
    let repo = workspace.repo("advanced");
    let first_oid = repo.commit("file.txt", "line1\nline2\nline3\n");

    // 1. Amend commit
    repo.write("file.txt", "line1-amended\nline2\nline3\n");
    git::cli::stage_files(repo.path(), vec!["file.txt".into()]).unwrap();
    git::cli::commit_ex(repo.path(), "amended initial commit".into(), true).unwrap();
    let amended_oid = repo.head();
    assert_ne!(first_oid, amended_oid);
    let detail = git::diff::get_commit(repo.path(), amended_oid.clone()).unwrap();
    assert!(detail.message.contains("amended initial commit"));

    // 2. Hunk-level stage & unstage via apply_diff_patch
    let hunk_patch = "\
diff --git a/file.txt b/file.txt
--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,3 @@
-line1-amended
+line1-hunk
 line2
 line3
";
    git::cli::apply_diff_patch(repo.path(), hunk_patch.into(), true, false).unwrap();
    let status = git::status::get_status(repo.path()).unwrap();
    assert_eq!(status.staged.len(), 1);
    git::cli::apply_diff_patch(repo.path(), hunk_patch.into(), true, true).unwrap();
    let status_after = git::status::get_status(repo.path()).unwrap();
    assert_eq!(status_after.staged.len(), 0);

    // 3. Branch rename, merge, get_merged_branches & batch delete_branches
    git::cli::create_branch(repo.path(), "feat-old".into(), None).unwrap();
    git::cli::rename_branch(repo.path(), "feat-old".into(), "feat-new".into()).unwrap();
    git::cli::checkout_branch(repo.path(), "feat-new".into()).unwrap();
    let feat_oid = repo.commit("feature.txt", "feature content\n");
    git::cli::checkout_branch(repo.path(), "main".into()).unwrap();
    git::cli::merge_branch(
        repo.path(),
        "feat-new".into(),
        Some("no-ff".into()),
        Some("merge feat-new".into()),
    )
    .unwrap();
    let merged = git::repo::get_merged_branches(repo.path()).unwrap();
    assert!(merged.contains(&"feat-new".to_string()));
    git::cli::delete_branches(repo.path(), vec!["feat-new".into()], false).unwrap();

    // 4. Fixup commit
    repo.write("feature.txt", "feature content v2\n");
    git::cli::stage_files(repo.path(), vec!["feature.txt".into()]).unwrap();
    git::cli::commit_fixup(repo.path(), feat_oid, false).unwrap();
    let fixup_detail = git::diff::get_commit(repo.path(), repo.head()).unwrap();
    assert!(fixup_detail.message.starts_with("fixup! "));

    // 5. Ignore file (.gitignore)
    git::cli::ignore_file(repo.path(), "*.log".into()).unwrap();
    git::cli::ignore_file(repo.path(), "*.log".into()).unwrap();
    let gitignore = fs::read_to_string(repo.root.join(".gitignore")).unwrap();
    assert_eq!(gitignore.lines().filter(|l| *l == "*.log").count(), 1);

    // 6. Remotes CRUD
    git::cli::remote_add(
        repo.path(),
        "upstream".into(),
        "https://example.com/repo.git".into(),
    )
    .unwrap();
    let remotes = git::repo::remote_list(repo.path()).unwrap();
    assert_eq!(remotes.len(), 1);
    assert_eq!(remotes[0].name, "upstream");
    git::cli::remote_set_url(
        repo.path(),
        "upstream".into(),
        "https://example.com/new.git".into(),
        false,
    )
    .unwrap();
    git::cli::remote_rename(repo.path(), "upstream".into(), "origin".into()).unwrap();
    git::cli::remote_remove(repo.path(), "origin".into()).unwrap();
    assert!(git::repo::remote_list(repo.path()).unwrap().is_empty());

    // 7. Worktree add / lock / unlock / remove
    let wt_dir = workspace.path("wt-linked");
    git::cli::worktree_add(
        repo.path(),
        wt_dir.clone(),
        Some("wt-branch".into()),
        true,
        None,
    )
    .unwrap();
    let wts = git::repo::worktree_list(repo.path()).unwrap();
    assert_eq!(wts.len(), 1);
    let wt_name = wts[0].name.clone();
    git::cli::worktree_lock(repo.path(), wt_name.clone(), true).unwrap();
    assert!(git::repo::worktree_list(repo.path()).unwrap()[0].locked);
    git::cli::worktree_lock(repo.path(), wt_name.clone(), false).unwrap();
    git::cli::worktree_remove(repo.path(), wt_name, true).unwrap();

    // 8. Search commits & git grep
    let found_commits = git::history::search_commits(
        repo.path(),
        Some("merge feat-new".into()),
        None,
        None,
        true,
        Some(50),
    )
    .unwrap();
    assert_eq!(found_commits.len(), 1);
    let grep_matches =
        git::history::git_grep(repo.path(), "feature content".into(), None, true, Some(50))
            .unwrap();
    assert!(!grep_matches.is_empty());
    assert_eq!(grep_matches[0].path, "feature.txt");

    // 9. Export patch & archive
    let patch_out = workspace.path("exported.patch");
    git::cli::format_patch(repo.path(), amended_oid.clone(), patch_out.clone()).unwrap();
    assert!(Path::new(&patch_out).exists());
    let zip_out = workspace.path("exported.zip");
    git::cli::archive_commit(
        repo.path(),
        amended_oid.clone(),
        zip_out.clone(),
        Some("zip".into()),
    )
    .unwrap();
    assert!(Path::new(&zip_out).exists());

    // 10. Bisect start / mark / state / reset & command log
    git::cli::bisect_start(repo.path(), Some("HEAD".into()), Some(amended_oid)).unwrap();
    let op_state = git::status::get_operation_state(repo.path()).unwrap();
    assert_eq!(op_state.kind, "bisect");
    git::cli::bisect_reset(repo.path()).unwrap();
    assert_eq!(
        git::status::get_operation_state(repo.path()).unwrap().kind,
        "none"
    );

    let logs = git::cli::get_command_log(Some(repo.path())).unwrap();
    assert!(!logs.is_empty());
}

#[test]
fn scoped_commit_only_commits_staged_changes_under_the_directory() {
    let workspace = Workspace::new();
    let repo = workspace.repo("scoped-commit");
    repo.commit("dir/in.txt", "one\n");
    repo.commit("other/out.txt", "one\n");

    repo.write("dir/in.txt", "two\n");
    repo.write("other/out.txt", "two\n");
    git::cli::stage_files(repo.path(), vec!["dir/in.txt".into()]).unwrap();
    git::cli::stage_files(repo.path(), vec!["other/out.txt".into()]).unwrap();

    git::cli::commit_ex_scoped(repo.path(), "only dir".into(), false, Some("dir".into())).unwrap();

    let head = repo.head();
    assert_eq!(
        git::cli::get_file_content(repo.path(), "dir/in.txt".into(), Some(head.clone()))
            .unwrap()
            .content,
        "two\n"
    );
    assert_eq!(
        git::cli::get_file_content(repo.path(), "other/out.txt".into(), Some(head.clone()))
            .unwrap()
            .content,
        "one\n"
    );
    let status = git::status::get_status(repo.path()).unwrap();
    assert_eq!(
        status
            .staged
            .iter()
            .map(|entry| entry.path.as_str())
            .collect::<Vec<_>>(),
        vec!["other/out.txt"]
    );
    assert!(status.unstaged.is_empty());

    // Amend 同样只替换作用域内的内容，作用域外的暂存改动继续保留。
    repo.write("dir/in.txt", "three\n");
    git::cli::stage_files(repo.path(), vec!["dir/in.txt".into()]).unwrap();
    git::cli::commit_ex_scoped(repo.path(), "amend dir".into(), true, Some("dir".into())).unwrap();
    let amended = repo.head();
    assert_eq!(
        git::cli::get_file_content(repo.path(), "dir/in.txt".into(), Some(amended.clone()))
            .unwrap()
            .content,
        "three\n"
    );
    assert_eq!(
        git::cli::get_file_content(repo.path(), "other/out.txt".into(), Some(amended))
            .unwrap()
            .content,
        "one\n"
    );
    let status = git::status::get_status(repo.path()).unwrap();
    assert_eq!(
        status
            .staged
            .iter()
            .map(|entry| entry.path.as_str())
            .collect::<Vec<_>>(),
        vec!["other/out.txt"]
    );

    // 作用域内没有暂存内容时，Amend 仍可只修改提交信息。
    git::cli::commit_ex_scoped(
        repo.path(),
        "amend message only".into(),
        true,
        Some("dir".into()),
    )
    .unwrap();
    let message_only = repo.head();
    assert_eq!(
        git::diff::get_commit(repo.path(), message_only.clone())
            .unwrap()
            .message
            .trim(),
        "amend message only"
    );
    assert_eq!(
        git::cli::get_file_content(repo.path(), "dir/in.txt".into(), Some(message_only.clone()))
            .unwrap()
            .content,
        "three\n"
    );
    assert_eq!(
        git::cli::get_file_content(repo.path(), "other/out.txt".into(), Some(message_only))
            .unwrap()
            .content,
        "one\n"
    );
}

#[test]
fn add_reset_stash_and_bare_repository_extensions() {
    let workspace = Workspace::new();
    let repo = workspace.repo("changes");
    repo.commit("tracked.txt", "one\n");
    let content =
        git::cli::get_file_content(repo.path(), "tracked.txt".into(), Some(repo.head())).unwrap();
    assert_eq!(content.content, "one\n");

    repo.write("dir/new.txt", "new\n");
    let preview = git::cli::preview_add_files(repo.path(), "*.txt".into(), false).unwrap();
    assert_eq!(preview.exit_code, Some(0));
    assert!(preview.stdout.contains("dir/new.txt"));
    let added = git::cli::add_files(repo.path(), "*.txt".into(), false).unwrap();
    assert_eq!(added.exit_code, Some(0));
    assert!(repo
        .repo()
        .status_file(Path::new("dir/new.txt"))
        .unwrap()
        .contains(git2::Status::INDEX_NEW));
    let head_files = git::repo::list_head_files(repo.path()).unwrap();
    assert!(head_files.contains(&"tracked.txt".to_string()));
    assert!(
        !head_files.contains(&"dir/new.txt".to_string()),
        "View files must only list HEAD-committed files"
    );

    git::cli::reset_changes(repo.path(), vec!["dir/new.txt".into()], true).unwrap();
    assert!(!repo.root.join("dir/new.txt").exists());

    repo.write("tracked.txt", "two\n");
    git::cli::reset_changes(repo.path(), vec!["tracked.txt".into()], false).unwrap();
    assert_eq!(
        fs::read_to_string(repo.root.join("tracked.txt")).unwrap(),
        "one\n"
    );

    repo.write("tracked.txt", "three\n");
    repo.write("untracked.txt", "u\n");
    git::cli::stash_push_ex(repo.path(), "msg".into(), true, false, Vec::new()).unwrap();
    let stashes = git::cli::stash_list(repo.path()).unwrap();
    assert_eq!(stashes.len(), 1);
    assert!(
        !repo.root.join("untracked.txt").exists(),
        "stash -u should remove the untracked file"
    );
    assert_eq!(
        fs::read_to_string(repo.root.join("tracked.txt")).unwrap(),
        "one\n"
    );
    git::cli::stash_apply_checked(
        repo.path(),
        stashes[0].name.clone(),
        false,
        Some(stashes[0].oid.clone()),
    )
    .unwrap();
    assert_eq!(
        fs::read_to_string(repo.root.join("tracked.txt")).unwrap(),
        "three\n"
    );

    let bare = workspace.path("central.git");
    let created = git::cli::create_repository_ex(bare, true).unwrap();
    assert!(git2::Repository::open(created).unwrap().is_bare());
}

#[test]
fn apply_patch_file_directory_and_mailbox() {
    let workspace = Workspace::new();
    let repo = workspace.repo("patches");
    repo.commit("tracked.txt", "one\n");
    repo.write("tracked.txt", "two\n");
    let diff = std::process::Command::new("git")
        .args(["-C", &repo.path(), "diff"])
        .output()
        .unwrap();
    assert!(diff.status.success());
    let patch = workspace.root.join("change.patch");
    fs::write(&patch, &diff.stdout).unwrap();
    git::cli::discard_files(repo.path(), vec!["tracked.txt".into()]).unwrap();
    assert_eq!(
        fs::read_to_string(repo.root.join("tracked.txt")).unwrap(),
        "one\n"
    );

    let listed =
        git::cli::list_patch_directory(repo.path(), workspace.root.to_string_lossy().into_owned())
            .unwrap();
    assert!(listed
        .iter()
        .any(|item| item.name == "change.patch" && !item.mailbox));
    let output = git::cli::apply_patch_directory_ex(
        repo.path(),
        workspace.root.to_string_lossy().into_owned(),
        false,
        false,
    )
    .unwrap();
    assert_eq!(
        output.exit_code,
        Some(0),
        "stdout={:?} stderr={:?}",
        output.stdout,
        output.stderr
    );
    assert_eq!(
        fs::read_to_string(repo.root.join("tracked.txt")).unwrap(),
        "two\n"
    );

    let source = workspace.repo("mail-source");
    source.commit("mail.txt", "mail\n");
    let mailbox = std::process::Command::new("git")
        .args(["-C", &source.path(), "format-patch", "-1", "--stdout"])
        .output()
        .unwrap();
    assert!(mailbox.status.success());
    let mailbox_path = workspace.root.join("change.mbox");
    fs::write(&mailbox_path, &mailbox.stdout).unwrap();
    let target = workspace.repo("mail-target");
    let applied = git::cli::apply_patch_file_ex(
        target.path(),
        mailbox_path.to_string_lossy().into_owned(),
        false,
        false,
    )
    .unwrap();
    assert_eq!(applied.exit_code, Some(0), "{:?}", applied.stderr);
    assert_eq!(
        fs::read_to_string(target.root.join("mail.txt")).unwrap(),
        "mail\n"
    );
}

#[test]
fn create_branch_checkout_and_orphan_options() {
    let workspace = Workspace::new();
    let repo = workspace.repo("branches");
    repo.commit("tracked.txt", "one\n");
    git::cli::create_branch_ex(repo.path(), "feature".into(), None, true, false).unwrap();
    assert_eq!(repo.repo().head().unwrap().shorthand(), Some("feature"));
    git::cli::create_branch_ex(repo.path(), "orphan".into(), None, false, true).unwrap();
    let git_repo = repo.repo();
    let head = git_repo.find_reference("HEAD").unwrap();
    assert_eq!(head.symbolic_target(), Some("refs/heads/orphan"));
}
