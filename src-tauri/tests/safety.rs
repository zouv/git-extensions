//! 审查发现的安全边界：只在临时仓库和本地 bare remote 上运行。
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use git_extensions_lib::git;

static SEQUENCE: AtomicUsize = AtomicUsize::new(0);

struct Fixture {
    root: PathBuf,
}
impl Fixture {
    fn new(bare: bool) -> Self {
        let root = std::env::temp_dir().join(format!(
            "ge-safety-{}-{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&root).unwrap();
        let mut options = git2::RepositoryInitOptions::new();
        options.bare(bare).initial_head("main");
        let repo = git2::Repository::init_opts(&root, &options).unwrap();
        let mut config = repo.config().unwrap();
        config.set_bool("core.autocrlf", false).unwrap();
        config.set_str("core.eol", "lf").unwrap();
        config.set_str("user.name", "Safety Test").unwrap();
        config.set_str("user.email", "safety@example.com").unwrap();
        // 不读取本机自定义 hooks；并发用例会显式改写此目录。
        config
            .set_str("core.hooksPath", root.join("test-hooks").to_str().unwrap())
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
        fs::write(self.root.join(name), content).unwrap();
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
    fn remote(&self, name: &str, remote: &Fixture) {
        self.repo().remote(name, &remote.path()).unwrap();
    }
    fn push_to(&self, remote: &str, branch: &str) {
        let preview = git::cli::get_push_info(self.path()).unwrap();
        git::cli::push(
            self.path(),
            Some(remote.into()),
            Some(branch.into()),
            Some(preview.head_oid),
            Some(preview.branch_ref),
        )
        .unwrap();
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn git_command(path: &Path, args: &[&str]) {
    let output = Command::new("git")
        .arg("-C")
        .arg(path)
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn branch_names_cannot_be_options_or_delete_existing_branches() {
    let t = Fixture::new(false);
    let head = t.commit("base.txt", "base\n");
    git::cli::create_branch(t.path(), "victim".into(), None).unwrap();
    for name in [
        "-D",
        "--delete",
        "HEAD",
        "bad..name",
        "",
        "bad name",
        " leading",
        "trailing ",
        "bad\0name",
    ] {
        assert!(
            git::cli::create_branch(t.path(), name.into(), Some("victim".into())).is_err(),
            "accepted {name:?}"
        );
        assert_eq!(
            t.repo()
                .find_branch("victim", git2::BranchType::Local)
                .unwrap()
                .get()
                .target()
                .unwrap()
                .to_string(),
            head
        );
    }
    assert!(git::cli::create_branch(t.path(), "safe".into(), Some("--delete".into())).is_err());
    assert!(t
        .repo()
        .find_branch("safe", git2::BranchType::Local)
        .is_err());
    git::cli::create_branch(t.path(), "feature/nested".into(), Some("main".into())).unwrap();
    git::cli::checkout_branch(t.path(), "feature/nested".into()).unwrap();
    git::cli::checkout_branch(t.path(), "main".into()).unwrap();
    git::cli::delete_branch(t.path(), "feature/nested".into(), false).unwrap();
}

#[test]
fn checkout_requires_a_local_branch_and_never_restores_a_file() {
    let t = Fixture::new(false);
    let head = t.commit("base.txt", "base\n");
    t.write("base.txt", "important uncommitted content\n");
    for name in ["base.txt", "missing", "--", "--detach", &head] {
        assert!(git::cli::checkout_branch(t.path(), name.into()).is_err());
        assert_eq!(
            fs::read_to_string(t.root.join("base.txt")).unwrap(),
            "important uncommitted content\n"
        );
        assert_eq!(t.head(), head);
    }
    assert_eq!(t.repo().head().unwrap().name(), Some("refs/heads/main"));
}

#[test]
fn first_push_requires_an_explicit_target_and_preserves_config_on_failure() {
    let t = Fixture::new(false);
    let origin = Fixture::new(true);
    let expected = Fixture::new(true);
    t.commit("base.txt", "base\n");
    t.remote("origin", &origin);
    t.remote("expected", &expected);
    let info = git::cli::get_push_info(t.path()).unwrap();
    assert!(!info.has_upstream);
    assert!(git::cli::push(t.path(), None, None, None, None).is_err());
    assert!(origin.repo().find_reference("refs/heads/main").is_err());
    assert!(expected.repo().find_reference("refs/heads/main").is_err());
    assert!(t
        .repo()
        .config()
        .unwrap()
        .get_string("branch.main.remote")
        .is_err());
    t.push_to("expected", "published");
    let info = git::cli::get_push_info(t.path()).unwrap();
    assert_eq!(info.upstream.as_deref(), Some("expected/published"));
    assert!(origin
        .repo()
        .find_reference("refs/heads/published")
        .is_err());
    // 默认 simple 拒绝异名 upstream，必须保留这个错误，不能改推 origin。
    assert!(git::cli::push(
        t.path(),
        None,
        None,
        Some(info.head_oid.clone()),
        Some(info.branch_ref.clone())
    )
    .is_err());
    t.repo()
        .config()
        .unwrap()
        .set_str("push.default", "upstream")
        .unwrap();
    git::cli::push(
        t.path(),
        None,
        None,
        Some(info.head_oid),
        Some(info.branch_ref),
    )
    .unwrap();
}

#[test]
fn rejected_push_never_falls_back_to_origin_or_changes_upstream() {
    let t = Fixture::new(false);
    let origin = Fixture::new(true);
    let expected = Fixture::new(true);
    let peer = Fixture::new(false);
    let base = t.commit("base.txt", "base\n");
    t.remote("origin", &origin);
    t.remote("expected", &expected);
    t.push_to("origin", "main");
    t.push_to("expected", "main");
    // 另一个客户端推进 expected，origin 留在基线；原实现会错误改推 origin。
    peer.remote("expected", &expected);
    git_command(&peer.root, &["fetch", "expected"]);
    git_command(&peer.root, &["switch", "-C", "main", "expected/main"]);
    let remote_head = peer.commit("remote.txt", "remote change\n");
    peer.push_to("expected", "main");
    t.commit("local.txt", "local change\n");
    let error = git::cli::push(t.path(), None, None, None, None)
        .unwrap_err()
        .to_string();
    assert!(error.contains("rejected"), "{error}");
    assert_eq!(
        origin
            .repo()
            .find_reference("refs/heads/main")
            .unwrap()
            .target()
            .unwrap()
            .to_string(),
        base
    );
    assert_eq!(
        expected
            .repo()
            .find_reference("refs/heads/main")
            .unwrap()
            .target()
            .unwrap()
            .to_string(),
        remote_head
    );
    assert_eq!(
        t.repo()
            .config()
            .unwrap()
            .get_string("branch.main.remote")
            .unwrap(),
        "expected"
    );
    assert_eq!(
        t.repo()
            .config()
            .unwrap()
            .get_string("branch.main.merge")
            .unwrap(),
        "refs/heads/main"
    );
}

#[test]
fn push_rejects_options_unknown_remotes_and_stale_previews() {
    let t = Fixture::new(false);
    let remote = Fixture::new(true);
    t.commit("base.txt", "base\n");
    t.remote("chosen", &remote);
    let old = git::cli::get_push_info(t.path()).unwrap();
    for (remote_name, target) in [
        ("--all", "main"),
        ("unknown", "main"),
        ("chosen", "--delete"),
        ("chosen", "bad..name"),
    ] {
        assert!(git::cli::push(
            t.path(),
            Some(remote_name.into()),
            Some(target.into()),
            Some(old.head_oid.clone()),
            Some(old.branch_ref.clone())
        )
        .is_err());
    }
    assert!(git::cli::push(t.path(), Some("chosen".into()), None, None, None).is_err());
    assert!(git::cli::push(
        t.path(),
        Some("chosen".into()),
        Some("main".into()),
        None,
        None
    )
    .is_err());
    git::cli::create_branch(t.path(), "other".into(), None).unwrap();
    git::cli::checkout_branch(t.path(), "other".into()).unwrap();
    assert!(git::cli::push(
        t.path(),
        Some("chosen".into()),
        Some("main".into()),
        Some(old.head_oid.clone()),
        Some(old.branch_ref.clone())
    )
    .is_err());
    git::cli::checkout_branch(t.path(), "main".into()).unwrap();
    t.commit("new.txt", "new\n");
    assert!(git::cli::push(
        t.path(),
        Some("chosen".into()),
        Some("main".into()),
        Some(old.head_oid),
        Some(old.branch_ref)
    )
    .is_err());
    assert!(remote.repo().find_reference("refs/heads/main").is_err());
}

#[test]
fn rebase_plan_keeps_original_full_branch_ref_across_ipc() {
    let t = Fixture::new(false);
    t.commit("base.txt", "base\n");
    let start = t.commit("a.txt", "a\n");
    let old_head = t.commit("b.txt", "b\n");
    let mut plan = git::rebase::prepare_interactive_rebase(t.path(), start).unwrap();
    assert_eq!(plan.branch.as_deref(), Some("refs/heads/main"));
    plan.entries[0].action = "reword".into();
    plan.entries[0].message = "reworded a".into();
    git::cli::create_branch(t.path(), "other".into(), None).unwrap();
    git::cli::checkout_branch(t.path(), "other".into()).unwrap();
    let serialized = serde_json::to_string(&plan).unwrap();
    let received = serde_json::from_str(&serialized).unwrap();
    // 直接调用生产 IPC 适配层；原实现会在这里重建 current_branch。
    let error =
        tauri::async_runtime::block_on(git::commands::start_interactive_rebase(t.path(), received))
            .unwrap_err();
    assert!(error.to_string().contains("different branch"));
    assert_eq!(t.head(), old_head);
    assert_eq!(
        t.repo()
            .find_reference("refs/heads/main")
            .unwrap()
            .target()
            .unwrap()
            .to_string(),
        old_head
    );
    assert!(!t.repo().path().join("git-extensions-rebase").exists());
    git::cli::checkout_branch(t.path(), "main".into()).unwrap();
    git::rebase::start_interactive_rebase_with_editor(
        t.path(),
        plan,
        Path::new(env!("CARGO_BIN_EXE_git-extensions")),
    )
    .unwrap();
    assert_ne!(t.head(), old_head);
    assert_eq!(
        t.repo()
            .find_reference("refs/heads/other")
            .unwrap()
            .target()
            .unwrap()
            .to_string(),
        old_head
    );
}

#[test]
fn write_lease_covers_hooks_alias_paths_and_linked_worktrees() {
    let t = Fixture::new(false);
    let other = Fixture::new(false);
    t.commit("base.txt", "base\n");
    other.commit("other.txt", "other\n");
    let linked_path = t.root.join("linked");
    git_command(
        &t.root,
        &[
            "worktree",
            "add",
            "-b",
            "linked-branch",
            linked_path.to_str().unwrap(),
        ],
    );
    let hooks = t.root.join("test-hooks");
    fs::create_dir(&hooks).unwrap();
    let hook = hooks.join("pre-commit");
    fs::write(&hook, "#!/bin/sh\ntouch .git/ge-ready\ni=0\nwhile [ ! -f .git/ge-release ]; do\n  i=$((i+1))\n  [ $i -lt 150 ] || exit 1\n  sleep 0.1\ndone\n").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();
    }
    t.write("base.txt", "next\n");
    git::cli::stage_files(t.path(), vec!["base.txt".into()]).unwrap();
    let path = t.path();
    let writer = std::thread::spawn(move || {
        tauri::async_runtime::block_on(git::commands::commit(path, "with hook".into(), None))
    });
    let deadline = Instant::now() + Duration::from_secs(10);
    while !t.root.join(".git/ge-ready").exists() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(20));
    }
    // 在断言前释放 hook，避免测试失败留下等待中的进程。
    let ready = t.root.join(".git/ge-ready").exists();
    let alias = t.root.join(".").to_string_lossy().into_owned();
    let blocked = git::cli::create_branch(alias, "must-not-run".into(), None);
    let linked = tauri::async_runtime::block_on(git::commands::stage_files(
        linked_path.to_string_lossy().into_owned(),
        vec!["base.txt".into()],
    ));
    other.write("other.txt", "parallel\n");
    let independent = tauri::async_runtime::block_on(git::commands::stage_files(
        other.path(),
        vec!["other.txt".into()],
    ));
    fs::write(t.root.join(".git/ge-release"), "release").unwrap();
    let completed = writer.join().unwrap();
    assert!(ready, "hook did not start");
    assert!(blocked.unwrap_err().to_string().contains("already running"));
    assert!(linked.unwrap_err().to_string().contains("already running"));
    independent.unwrap();
    completed.unwrap();
    assert!(t
        .repo()
        .find_branch("must-not-run", git2::BranchType::Local)
        .is_err());
    fs::remove_file(&hook).unwrap();
    git::cli::create_branch(t.path(), "after-hook".into(), None).unwrap();
}

#[test]
fn failed_write_releases_lease_and_revision_options_are_rejected() {
    let t = Fixture::new(false);
    let head = t.commit("base.txt", "base\n");
    assert!(git::cli::commit(t.path(), String::new()).is_err());
    assert!(git::cli::cherry_pick(t.path(), "--abort".into()).is_err());
    assert!(git::cli::revert(t.path(), "--abort".into()).is_err());
    assert!(git::cli::rebase(t.path(), "--abort".into()).is_err());
    assert!(git::cli::create_tag(t.path(), "--delete".into(), Some("main".into()), None).is_err());
    assert!(git::cli::create_tag(t.path(), "safe".into(), Some("--delete".into()), None).is_err());
    assert_eq!(t.head(), head);
    assert_eq!(t.repo().state(), git2::RepositoryState::Clean);
    git::cli::create_branch(t.path(), "after-error".into(), None).unwrap();
}

#[test]
fn untracked_text_binary_and_literal_single_file_diff() {
    let t = Fixture::new(false);
    t.commit("base.txt", "base\n");
    t.write("[literal].txt", "hello untracked\n");
    t.write("other.txt", "unrelated\n");
    fs::write(t.root.join("binary.dat"), [0, 1, 2, 3, 0, 255]).unwrap();
    let files = git::diff::get_worktree_diff(t.path(), false).unwrap();
    let text = files.iter().find(|f| f.path == "[literal].txt").unwrap();
    assert!(text.patch.contains("+hello untracked"));
    assert!(!text.is_binary);
    let binary = files.iter().find(|f| f.path == "binary.dat").unwrap();
    assert!(binary.is_binary);
    assert!(binary.patch.is_empty());
    let one = git::diff::get_worktree_file_diff(t.path(), false, "[literal].txt".into()).unwrap();
    assert_eq!(one.len(), 1);
    assert!(one[0].patch.contains("+hello untracked"));
    assert!(git::diff::get_worktree_file_diff(t.path(), false, "../outside".into()).is_err());
}
#[test]
fn manifest_does_not_build_patches_and_large_text_is_not_binary() {
    let t = Fixture::new(false);
    let head = t.commit("base.txt", "base\n");
    let list = git::diff::get_commit_files(t.path(), head.clone()).unwrap();
    assert_eq!(list.len(), 1);
    assert!(list[0].patch.is_empty());
    let one = git::diff::get_commit_file_diff(t.path(), head, "base.txt".into()).unwrap();
    assert!(one[0].patch.contains("+base"));
    let large = "a\n".repeat(300_000);
    t.write("large.txt", &large);
    let files = git::diff::get_worktree_file_diff(t.path(), false, "large.txt".into()).unwrap();
    assert!(files[0].truncated);
    assert!(!files[0].is_binary);
    assert!(files[0].patch.len() <= 512 * 1024);
}
#[test]
fn detached_commit_is_visible_without_branch_or_tag() {
    let t = Fixture::new(false);
    let original = t.commit("base.txt", "base\n");
    git_command(&t.root, &["switch", "--detach", &original]);
    let detached = t.commit("only-detached.txt", "detached\n");
    let batches = std::cell::RefCell::new(Vec::new());
    git::log::run_log(&t.path(), 1, 100, None, &|| false, &|batch| {
        batches.borrow_mut().extend(batch.revisions)
    })
    .unwrap();
    assert!(batches.borrow().iter().any(|rev| rev.oid == detached));
}
#[test]
fn worktree_blame_tracks_insertions_deletions_and_untracked_lines() {
    let t = Fixture::new(false);
    let first = t.commit("lines.txt", "one\ntwo\nthree\n");
    t.write("lines.txt", "new\none\nthree\n");
    let lines = git::history::blame_file(t.path(), "lines.txt".into(), None).unwrap();
    assert_eq!(lines.len(), 3);
    assert!(lines[0].oid.is_empty());
    assert_eq!(lines[1].oid, first);
    assert_eq!(lines[1].content, "one");
    assert_eq!(lines[2].oid, first);
    assert_eq!(lines[2].content, "three");
    let old = git::history::blame_file(t.path(), "lines.txt".into(), Some(first)).unwrap();
    assert_eq!(old[1].content, "two");
    t.write("new.txt", "brand new\n");
    let new = git::history::blame_file(t.path(), "new.txt".into(), None).unwrap();
    assert_eq!(new[0].content, "brand new");
    assert!(new[0].oid.is_empty());
    assert!(git::history::blame_file(t.path(), "../escape".into(), None).is_err());
}
#[test]
fn reset_modes_backup_head_and_preserve_documented_state() {
    for mode in [
        git::reset::ResetMode::Soft,
        git::reset::ResetMode::Mixed,
        git::reset::ResetMode::Hard,
    ] {
        let t = Fixture::new(false);
        let base = t.commit("base.txt", "before\n");
        let previous = t.commit("base.txt", "after\n");
        let preview = git::reset::get_reset_preview(t.path(), base.clone(), mode).unwrap();
        assert_eq!(preview.commits_to_leave, 1);
        let result = git::reset::reset(t.path(), preview).unwrap();
        assert_eq!(t.head(), base);
        let repo = t.repo();
        assert_eq!(
            repo.find_reference(&result.backup_ref)
                .unwrap()
                .target()
                .unwrap()
                .to_string(),
            previous
        );
        let text = fs::read_to_string(t.root.join("base.txt")).unwrap();
        let status = git::status::get_status(t.path()).unwrap();
        match mode {
            git::reset::ResetMode::Soft => {
                assert_eq!(text, "after\n");
                assert_eq!(status.staged.len(), 1);
            }
            git::reset::ResetMode::Mixed => {
                assert_eq!(text, "after\n");
                assert_eq!(status.unstaged.len(), 1);
            }
            git::reset::ResetMode::Hard => {
                assert_eq!(text, "before\n");
                assert!(status.staged.is_empty() && status.unstaged.is_empty());
            }
        }
        assert!(git::reset::get_recovery_entries(t.path())
            .unwrap()
            .iter()
            .any(|entry| entry.oid == previous && entry.backup_ref.is_some()));
    }
}
#[test]
fn reset_rejects_dirty_hard_and_stale_branch_index_or_same_status_content() {
    let t = Fixture::new(false);
    let base = t.commit("base.txt", "before\n");
    t.commit("base.txt", "after\n");
    t.write("base.txt", "dirty-one\n");
    let preview =
        git::reset::get_reset_preview(t.path(), base.clone(), git::reset::ResetMode::Mixed)
            .unwrap();
    t.write("base.txt", "dirty-two\n");
    let head = t.head();
    assert!(git::reset::reset(t.path(), preview)
        .unwrap_err()
        .to_string()
        .contains("stale"));
    assert_eq!(t.head(), head);
    let hard =
        git::reset::get_reset_preview(t.path(), base.clone(), git::reset::ResetMode::Hard).unwrap();
    assert!(git::reset::reset(t.path(), hard).is_err());
    assert_eq!(
        fs::read_to_string(t.root.join("base.txt")).unwrap(),
        "dirty-two\n"
    );
    let preview =
        git::reset::get_reset_preview(t.path(), base.clone(), git::reset::ResetMode::Soft).unwrap();
    git::cli::stage_files(t.path(), vec!["base.txt".into()]).unwrap();
    assert!(git::reset::reset(t.path(), preview).is_err());
    let preview =
        git::reset::get_reset_preview(t.path(), base, git::reset::ResetMode::Soft).unwrap();
    git::cli::create_branch(t.path(), "another".into(), None).unwrap();
    git::cli::checkout_branch(t.path(), "another".into()).unwrap();
    assert!(git::reset::reset(t.path(), preview).is_err());
}
#[test]
fn hard_reset_protects_ignored_obstructions_and_refuses_in_progress_operation() {
    let t = Fixture::new(false);
    t.commit("base.txt", "base\n");
    let target = t.commit("ignored.txt", "tracked then removed\n");
    git_command(&t.root, &["rm", "ignored.txt"]);
    git_command(&t.root, &["commit", "-m", "remove file"]);
    fs::write(t.repo().path().join("info/exclude"), "ignored.txt\n").unwrap();
    t.write("ignored.txt", "private ignored content\n");
    let preview =
        git::reset::get_reset_preview(t.path(), target.clone(), git::reset::ResetMode::Hard)
            .unwrap();
    assert!(preview.blocked_paths.contains(&"ignored.txt".to_string()));
    assert!(git::reset::reset(t.path(), preview).is_err());
    assert_eq!(
        fs::read_to_string(t.root.join("ignored.txt")).unwrap(),
        "private ignored content\n"
    );
    fs::write(t.repo().path().join("MERGE_HEAD"), format!("{target}\n")).unwrap();
    assert!(git::reset::get_reset_preview(t.path(), target, git::reset::ResetMode::Soft).is_err());
}
#[test]
fn stash_inputs_and_stale_selection_cannot_apply_or_drop_other_entries() {
    let t = Fixture::new(false);
    t.commit("base.txt", "base\n");
    t.write("base.txt", "one\n");
    git::cli::stash_push(t.path(), "one".into(), false).unwrap();
    let old = git::cli::stash_list(t.path()).unwrap()[0].oid.clone();
    for name in ["--all", "-q", "HEAD", "stash@{0} --all", "stash@{-1}"] {
        assert!(git::cli::stash_apply(t.path(), name.into(), false).is_err());
        assert!(git::cli::stash_drop(t.path(), name.into()).is_err());
    }
    t.write("base.txt", "two\n");
    git::cli::stash_push(t.path(), "two".into(), false).unwrap();
    assert!(git::cli::stash_drop_checked(t.path(), "stash@{0}".into(), Some(old.clone())).is_err());
    assert!(git::cli::stash_apply_checked(t.path(), "stash@{0}".into(), true, Some(old)).is_err());
    let current = git::cli::stash_list(t.path()).unwrap()[0].oid.clone();
    git::cli::stash_apply_checked(t.path(), "stash@{0}".into(), true, Some(current)).unwrap();
    assert_eq!(
        fs::read_to_string(t.root.join("base.txt")).unwrap(),
        "two\n"
    );
}

#[test]
fn file_history_follows_renames_and_single_file_compare_keeps_both_paths() {
    let t = Fixture::new(false);
    let old = "old [名].txt";
    let new = "new 名.txt";
    let first = t.commit(old, "first\nsecond\nthird\n");
    fs::rename(t.root.join(old), t.root.join(new)).unwrap();
    git::cli::stage_files(t.path(), vec![old.into(), new.into()]).unwrap();
    git::cli::commit(t.path(), "rename with record separator \u{1e}".into()).unwrap();
    let renamed = t.head();
    t.commit(new, "first\nsecond changed\nthird\n");
    let history = git::history::file_log(t.path(), new.into(), Some(100)).unwrap();
    assert_eq!(history.len(), 3);
    assert_eq!(history[0].file_path, new);
    assert_eq!(history[1].file_path, new);
    assert_eq!(history[2].file_path, old);
    let commit_files = git::diff::get_commit_files(t.path(), renamed.clone()).unwrap();
    assert_eq!(commit_files.len(), 1);
    assert_eq!(commit_files[0].old_path.as_deref(), Some(old));
    let renamed_patch = git::diff::get_commit_file_diff_with_old(
        t.path(),
        renamed.clone(),
        new.into(),
        Some(old.into()),
    )
    .unwrap();
    assert_eq!(renamed_patch.len(), 1);
    assert_eq!(renamed_patch[0].status, "renamed");
    assert!(renamed_patch[0].patch.contains("rename from"));
    let manifest = git::diff::get_compare_files(t.path(), first.clone(), renamed.clone()).unwrap();
    assert_eq!(manifest.files.len(), 1);
    assert_eq!(manifest.files[0].old_path.as_deref(), Some(old));
    let single =
        git::diff::get_compare_file_diff(t.path(), first, renamed, new.into(), Some(old.into()))
            .unwrap();
    assert_eq!(single.len(), 1);
    assert_eq!(single[0].status, "renamed");
    assert_eq!(single[0].old_path.as_deref(), Some(old));
    assert!(single[0].patch.contains("rename from"));
    let earlier = git::diff::get_commit_file_diff(
        t.path(),
        history[2].oid.clone(),
        history[2].file_path.clone(),
    )
    .unwrap();
    assert!(earlier[0].patch.contains("+first"));
}

#[test]
fn oversized_worktree_and_blob_skip_patch_without_claiming_binary() {
    let t = Fixture::new(false);
    t.commit("base", "base\n");
    let large = "plain text line\n".repeat(600_000);
    t.write("large.txt", &large);
    let worktree = git::diff::get_worktree_file_diff(t.path(), false, "large.txt".into()).unwrap();
    assert!(worktree[0].truncated);
    assert!(!worktree[0].is_binary);
    assert!(worktree[0].patch.is_empty());
    git::cli::stage_files(t.path(), vec!["large.txt".into()]).unwrap();
    let staged = git::diff::get_worktree_file_diff(t.path(), true, "large.txt".into()).unwrap();
    assert!(staged[0].truncated);
    assert!(staged[0].patch.is_empty());
    git::cli::commit(t.path(), "large text".into()).unwrap();
    let committed =
        git::diff::get_commit_file_diff(t.path(), t.head(), "large.txt".into()).unwrap();
    assert!(committed[0].truncated);
    assert!(!committed[0].is_binary);
    assert!(committed[0].patch.is_empty());
}

fn conflicting_cherry_pick(t: &Fixture) {
    let base = t.commit("conflict.txt", "base\n");
    git::cli::create_branch(t.path(), "incoming".into(), Some(base)).unwrap();
    git::cli::checkout_branch(t.path(), "incoming".into()).unwrap();
    let incoming = t.commit("conflict.txt", "incoming\n");
    git::cli::checkout_branch(t.path(), "main".into()).unwrap();
    t.commit("conflict.txt", "ours\n");
    assert!(git::cli::cherry_pick(t.path(), incoming).is_err());
}

#[test]
fn conflict_save_rejects_external_edits_then_accepts_refreshed_snapshot() {
    let t = Fixture::new(false);
    conflicting_cherry_pick(&t);
    let before = git::status::get_conflict_file(t.path(), "conflict.txt".into()).unwrap();
    t.write("conflict.txt", "external edit\n");
    assert!(git::cli::save_resolved_file_checked(
        t.path(),
        "conflict.txt".into(),
        "resolved\n".into(),
        Some(false),
        Some(before)
    )
    .is_err());
    assert_eq!(
        fs::read_to_string(t.root.join("conflict.txt")).unwrap(),
        "external edit\n"
    );
    let current = git::status::get_conflict_file(t.path(), "conflict.txt".into()).unwrap();
    let next = git::cli::save_resolved_file_checked(
        t.path(),
        "conflict.txt".into(),
        "resolved\n".into(),
        Some(false),
        Some(current),
    )
    .unwrap();
    assert!(next.conflicts.is_empty());
    git::cli::continue_operation(t.path()).unwrap();
    assert_eq!(
        git::status::get_operation_state(t.path()).unwrap().kind,
        "none"
    );
}

#[test]
fn skip_cherry_pick_validates_operation_and_restores_the_current_branch() {
    let t = Fixture::new(false);
    conflicting_cherry_pick(&t);
    let head = t.head();
    let mut stale = git::status::get_operation_state(t.path()).unwrap();
    stale.source = Some("other commit".into());
    assert!(git::cli::skip_operation(t.path(), stale).is_err());
    let current = git::status::get_operation_state(t.path()).unwrap();
    git::cli::skip_operation(t.path(), current).unwrap();
    assert_eq!(t.head(), head);
    assert_eq!(
        git::status::get_operation_state(t.path()).unwrap().kind,
        "none"
    );
    assert_eq!(
        fs::read_to_string(t.root.join("conflict.txt")).unwrap(),
        "ours\n"
    );
}

#[test]
fn ordinary_rebase_backs_up_original_head_and_skip_completes_conflicting_step() {
    let t = Fixture::new(false);
    let base = t.commit("conflict.txt", "base\n");
    git::cli::create_branch(t.path(), "onto".into(), Some(base)).unwrap();
    git::cli::checkout_branch(t.path(), "onto".into()).unwrap();
    let onto = t.commit("conflict.txt", "onto\n");
    git::cli::checkout_branch(t.path(), "main".into()).unwrap();
    let original = t.commit("conflict.txt", "ours\n");
    let error = git::cli::rebase(t.path(), onto.clone())
        .unwrap_err()
        .to_string();
    assert!(error.contains("refs/git-extensions/backups/rebase-"));
    assert!(git::reset::get_recovery_entries(t.path())
        .unwrap()
        .iter()
        .any(|entry| entry.oid == original && entry.backup_ref.is_some()));
    let current = git::status::get_operation_state(t.path()).unwrap();
    assert_eq!(current.kind, "rebase");
    git::cli::skip_operation(t.path(), current).unwrap();
    assert_eq!(t.head(), onto);
    assert_eq!(
        git::status::get_operation_state(t.path()).unwrap().kind,
        "none"
    );
    let seen = std::cell::RefCell::new(Vec::new());
    git::log::run_log(&t.path(), 1, 100, None, &|| false, &|batch| {
        seen.borrow_mut()
            .extend(batch.revisions.into_iter().map(|rev| rev.oid))
    })
    .unwrap();
    assert!(
        !seen.borrow().contains(&original),
        "backup-only commits must not reappear in normal history"
    );
}
