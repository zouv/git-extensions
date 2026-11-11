//! 后端核心命令的集成冒烟测试：在临时目录建真实仓库，
//! 走「提交 → 读详情/diff → 改工作区 → 暂存 → 分支操作」全流程。
//! 写操作经 git CLI，要求本机 git 可用。

use std::fs;
use std::path::PathBuf;

use git_extensions_lib::git;

struct TempRepo {
    root: PathBuf,
}

impl TempRepo {
    fn new(tag: &str) -> Self {
        let root = std::env::temp_dir().join(format!("ge-smoke-{}-{}", tag, std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let repo = git2::Repository::init(&root).unwrap();
        let mut config = repo.config().unwrap();
        config.set_str("user.name", "Smoke Test").unwrap();
        config.set_str("user.email", "smoke@example.com").unwrap();
        Self { root }
    }

    fn path(&self) -> String {
        self.root.to_string_lossy().into_owned()
    }

    fn write(&self, name: &str, content: &str) {
        fs::write(self.root.join(name), content).unwrap();
    }
}

impl Drop for TempRepo {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[test]
fn full_read_write_workflow() {
    let t = TempRepo::new("workflow");
    let path = t.path();
    t.write("a.txt", "hello\n");

    // 初始提交（走 CLI 写路径）
    git::cli::stage_files(path.clone(), vec!["a.txt".into()]).unwrap();
    git::cli::commit(path.clone(), "initial commit".into()).unwrap();

    let info = git::repo::open_repo(path.clone()).unwrap();
    assert!(!info.is_empty);

    let branches = git::repo::get_branches(path.clone()).unwrap();
    let head = branches.iter().find(|b| b.is_head).expect("head branch");
    assert!(!head.oid.is_empty());

    // 提交详情与 diff
    let detail = git::diff::get_commit(path.clone(), head.oid.clone()).unwrap();
    assert_eq!(detail.message.trim(), "initial commit");
    let diff = git::diff::get_commit_diff(path.clone(), head.oid.clone()).unwrap();
    assert_eq!(diff.len(), 1);
    assert_eq!(diff[0].path, "a.txt");
    assert_eq!(diff[0].status, "added");
    assert!(diff[0].patch.contains("+hello"));

    // 工作区改动：修改 a.txt + 新增 b.txt
    t.write("a.txt", "hello\nworld\n");
    t.write("b.txt", "new file\n");
    let status = git::status::get_status(path.clone()).unwrap();
    assert!(status
        .unstaged
        .iter()
        .any(|e| e.path == "a.txt" && e.status == "modified"));
    assert!(status
        .unstaged
        .iter()
        .any(|e| e.path == "b.txt" && e.status == "new"));

    // 暂存 b.txt 后：staged 有 b.txt，unstaged 剩 a.txt
    git::cli::stage_files(path.clone(), vec!["b.txt".into()]).unwrap();
    let status = git::status::get_status(path.clone()).unwrap();
    assert!(status.staged.iter().any(|e| e.path == "b.txt"));
    assert!(!status.unstaged.iter().any(|e| e.path == "b.txt"));

    // 工作区 diff 两侧都能取到
    let staged_diff = git::diff::get_worktree_diff(path.clone(), true).unwrap();
    assert!(staged_diff.iter().any(|f| f.path == "b.txt"));
    let unstaged_diff = git::diff::get_worktree_diff(path.clone(), false).unwrap();
    let a = unstaged_diff.iter().find(|f| f.path == "a.txt").unwrap();
    assert!(a.patch.contains("+world"));

    // 取消暂存
    git::cli::unstage_files(path.clone(), vec!["b.txt".into()]).unwrap();
    let status = git::status::get_status(path.clone()).unwrap();
    assert!(status.staged.is_empty());

    // 分支：新建 → 切换 → 切回 → 删除
    let main = git::repo::open_repo(path.clone())
        .unwrap()
        .head_branch
        .unwrap();
    git::cli::create_branch(path.clone(), "feature-x".into(), None).unwrap();
    git::cli::checkout_branch(path.clone(), "feature-x".into()).unwrap();
    let now = git::repo::open_repo(path.clone())
        .unwrap()
        .head_branch
        .unwrap();
    assert_eq!(now, "feature-x");
    git::cli::checkout_branch(path.clone(), main).unwrap();
    git::cli::delete_branch(path.clone(), "feature-x".into(), false).unwrap();
    let names: Vec<String> = git::repo::get_branches(path.clone())
        .unwrap()
        .into_iter()
        .map(|b| b.name)
        .collect();
    assert!(!names.iter().any(|n| n == "feature-x"));
}

#[test]
fn empty_repo_and_bad_input() {
    let t = TempRepo::new("empty");
    let path = t.path();
    let info = git::repo::open_repo(path.clone()).unwrap();
    assert!(info.is_empty);
    assert_eq!(git::repo::get_branches(path.clone()).unwrap().len(), 0);
    assert!(git::status::get_status(path).is_ok());
    assert!(git::repo::open_repo("".into()).is_err());
    assert!(git::cli::commit("".into(), "  ".into()).is_err());
}

#[test]
fn stash_and_commit_ops() {
    let t = TempRepo::new("ops");
    let path = t.path();
    t.write("a.txt", "one\n");
    git::cli::stage_files(path.clone(), vec!["a.txt".into()]).unwrap();
    git::cli::commit(path.clone(), "c1".into()).unwrap();
    let main = git::repo::open_repo(path.clone())
        .unwrap()
        .head_branch
        .unwrap();

    // stash push → 工作区干净；pop → 改动回来
    t.write("a.txt", "one\ntwo\n");
    git::cli::stash_push(path.clone(), "wip".into(), false).unwrap();
    assert!(git::status::get_status(path.clone())
        .unwrap()
        .unstaged
        .is_empty());
    let stashes = git::cli::stash_list(path.clone()).unwrap();
    assert_eq!(stashes.len(), 1);
    assert!(stashes[0].message.contains("wip"));
    git::cli::stash_apply(path.clone(), stashes[0].name.clone(), true).unwrap();
    assert!(
        git::status::get_status(path.clone())
            .unwrap()
            .unstaged
            .len()
            == 1
    );
    assert!(git::cli::stash_list(path.clone()).unwrap().is_empty());
    t.write("a.txt", "one\n");

    // feature 分支提交 c2，切回主干 cherry-pick
    git::cli::create_branch(path.clone(), "feature".into(), None).unwrap();
    git::cli::checkout_branch(path.clone(), "feature".into()).unwrap();
    t.write("b.txt", "b\n");
    git::cli::stage_files(path.clone(), vec!["b.txt".into()]).unwrap();
    git::cli::commit(path.clone(), "c2".into()).unwrap();
    let c2 = git::repo::get_branches(path.clone())
        .unwrap()
        .into_iter()
        .find(|b| b.is_head)
        .unwrap()
        .oid;
    git::cli::checkout_branch(path.clone(), main.clone()).unwrap();
    git::cli::cherry_pick(path.clone(), c2).unwrap();
    assert!(t.root.join("b.txt").exists());

    // revert 刚刚 cherry-pick 过来的提交 → b.txt 消失
    let head = git::repo::get_branches(path.clone())
        .unwrap()
        .into_iter()
        .find(|b| b.is_head)
        .unwrap()
        .oid;
    git::cli::revert(path.clone(), head.clone()).unwrap();
    assert!(!t.root.join("b.txt").exists());

    // contained_in：HEAD 应被主干分支包含
    let head = git::repo::get_branches(path.clone())
        .unwrap()
        .into_iter()
        .find(|b| b.is_head)
        .unwrap()
        .oid;
    let info = git::cli::get_contained_in(path.clone(), head).unwrap();
    assert!(info.branches.iter().any(|b| b == &main));
}

#[test]
fn rebase_moves_branch_onto_target() {
    let t = TempRepo::new("rebase");
    let path = t.path();
    t.write("a.txt", "one\n");
    git::cli::stage_files(path.clone(), vec!["a.txt".into()]).unwrap();
    git::cli::commit(path.clone(), "c1".into()).unwrap();
    let main = git::repo::open_repo(path.clone())
        .unwrap()
        .head_branch
        .unwrap();

    // feature 从 c1 分出并提交 c2；主干再提交 c3
    git::cli::create_branch(path.clone(), "feature".into(), None).unwrap();
    git::cli::checkout_branch(path.clone(), "feature".into()).unwrap();
    t.write("b.txt", "b\n");
    git::cli::stage_files(path.clone(), vec!["b.txt".into()]).unwrap();
    git::cli::commit(path.clone(), "c2".into()).unwrap();
    git::cli::checkout_branch(path.clone(), main.clone()).unwrap();
    t.write("c.txt", "c\n");
    git::cli::stage_files(path.clone(), vec!["c.txt".into()]).unwrap();
    git::cli::commit(path.clone(), "c3".into()).unwrap();
    let c3 = git::repo::get_branches(path.clone())
        .unwrap()
        .into_iter()
        .find(|b| b.is_head)
        .unwrap()
        .oid;

    // feature rebase 到 c3：feature 的 HEAD 应以 c3 为父
    git::cli::checkout_branch(path.clone(), "feature".into()).unwrap();
    git::cli::rebase(path.clone(), c3.clone()).unwrap();
    let head = git::repo::get_branches(path.clone())
        .unwrap()
        .into_iter()
        .find(|b| b.is_head)
        .unwrap()
        .oid;
    let detail = git::diff::get_commit(path.clone(), head).unwrap();
    assert_eq!(detail.parents, vec![c3]);
    assert!(t.root.join("b.txt").exists() && t.root.join("c.txt").exists());
}

#[test]
fn push_fetch_pull_against_local_bare_remote() {
    let bare_root = std::env::temp_dir().join(format!("ge-smoke-bare-{}", std::process::id()));
    let _ = fs::remove_dir_all(&bare_root);
    fs::create_dir_all(&bare_root).unwrap();
    git2::Repository::init_bare(&bare_root).unwrap();

    let t = TempRepo::new("remote");
    let path = t.path();
    t.write("a.txt", "one\n");
    git::cli::stage_files(path.clone(), vec!["a.txt".into()]).unwrap();
    git::cli::commit(path.clone(), "c1".into()).unwrap();
    let repo = git2::Repository::open(&t.root).unwrap();
    repo.remote("origin", bare_root.to_str().unwrap()).unwrap();

    // 首次 push 无 upstream，必须显式选择远程/分支，并绑定预览时的 HEAD
    let preview = git::cli::get_push_info(path.clone()).unwrap();
    git::cli::push(
        path.clone(),
        Some("origin".into()),
        Some(preview.branch.clone()),
        Some(preview.head_oid),
        Some(preview.branch_ref),
    )
    .unwrap();
    let bare = git2::Repository::open_bare(&bare_root).unwrap();
    assert!(
        bare.find_reference("refs/heads/master").is_ok()
            || bare.find_reference("refs/heads/main").is_ok()
    );

    // upstream 已由 push -u 建立，ahead/behind 应可读；fetch / pull 应成功
    let ab = git::repo::get_ahead_behind(path.clone()).unwrap();
    assert_eq!(ab.map(|v| (v.ahead, v.behind)), Some((0, 0)));
    git::cli::fetch(path.clone(), None).unwrap();
    git::cli::pull(path.clone()).unwrap();

    let _ = fs::remove_dir_all(&bare_root);
}

#[test]
fn tags_create_list_delete() {
    let t = TempRepo::new("tags");
    let path = t.path();
    t.write("a.txt", "one\n");
    git::cli::stage_files(path.clone(), vec!["a.txt".into()]).unwrap();
    git::cli::commit(path.clone(), "c1".into()).unwrap();

    git::cli::create_tag(path.clone(), "v1.0".into(), None, Some("release".into())).unwrap();
    git::cli::create_tag(path.clone(), "light".into(), None, None).unwrap();
    let tags = git::cli::tag_list(path.clone()).unwrap();
    assert_eq!(tags.len(), 2);
    let annotated = tags.iter().find(|t| t.name == "v1.0").unwrap();
    assert_eq!(annotated.subject, "release");

    git::cli::delete_tag(path.clone(), "light".into()).unwrap();
    let tags = git::cli::tag_list(path.clone()).unwrap();
    assert_eq!(tags.len(), 1);
}

#[test]
fn submodule_list_and_update() {
    // 先建一个作为子模块来源的仓库
    let sub = TempRepo::new("sub");
    sub.write("s.txt", "s\n");
    git::cli::stage_files(sub.path(), vec!["s.txt".into()]).unwrap();
    git::cli::commit(sub.path(), "sub c1".into()).unwrap();

    let t = TempRepo::new("super");
    let path = t.path();
    t.write("a.txt", "one\n");
    git::cli::stage_files(path.clone(), vec!["a.txt".into()]).unwrap();
    git::cli::commit(path.clone(), "c1".into()).unwrap();

    // file 协议的 submodule add 需要显式允许（git 安全限制）
    let sub_url = sub.path().replace('\\', "/");
    let out = std::process::Command::new("git")
        .arg("-C")
        .arg(&t.root)
        .args([
            "-c",
            "protocol.file.allow=always",
            "submodule",
            "add",
            &sub_url,
            "modules/sub",
        ])
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "submodule add: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    git::cli::commit(path.clone(), "add submodule".into()).unwrap();

    let modules = git::cli::submodule_list(path.clone()).unwrap();
    assert_eq!(modules.len(), 1);
    assert_eq!(modules[0].path, "modules/sub");
    git::cli::submodule_update(path.clone()).unwrap();
}

#[test]
fn blame_and_file_history() {
    let t = TempRepo::new("history");
    let path = t.path();
    t.write("a.txt", "one\n");
    git::cli::stage_files(path.clone(), vec!["a.txt".into()]).unwrap();
    git::cli::commit(path.clone(), "c1".into()).unwrap();
    let c1 = git::repo::get_branches(path.clone())
        .unwrap()
        .into_iter()
        .find(|b| b.is_head)
        .unwrap()
        .oid;

    t.write("a.txt", "one\ntwo\n");
    git::cli::stage_files(path.clone(), vec!["a.txt".into()]).unwrap();
    git::cli::commit(path.clone(), "c2".into()).unwrap();
    let c2 = git::repo::get_branches(path.clone())
        .unwrap()
        .into_iter()
        .find(|b| b.is_head)
        .unwrap()
        .oid;

    let blame = git::history::blame_file(path.clone(), "a.txt".into(), None).unwrap();
    assert_eq!(blame.len(), 2);
    assert_eq!(blame[0].oid, c1);
    assert_eq!(blame[1].oid, c2);
    assert_eq!(blame[1].content, "two");

    let old_blame = git::history::blame_file(path.clone(), "a.txt".into(), Some(c1)).unwrap();
    assert_eq!(old_blame.len(), 1);
    assert_eq!(old_blame[0].content, "one");

    let history = git::history::file_log(path.clone(), "a.txt".into(), None).unwrap();
    assert_eq!(history.len(), 2);
    assert_eq!(history[0].subject, "c2");
    assert_eq!(history[1].subject, "c1");
}

#[test]
fn run_log_collects_all_commits() {
    let t = TempRepo::new("run-log");
    let path = t.path();
    t.write("a.txt", "one\n");
    git::cli::stage_files(path.clone(), vec!["a.txt".into()]).unwrap();
    git::cli::commit(path.clone(), "c1".into()).unwrap();
    t.write("a.txt", "two\n");
    git::cli::stage_files(path.clone(), vec!["a.txt".into()]).unwrap();
    git::cli::commit(path.clone(), "c2".into()).unwrap();

    let batches = std::cell::RefCell::new(Vec::new());
    git::log::run_log(&path, 1, 1000, None, &|| false, &|b| {
        batches.borrow_mut().push(b)
    })
    .unwrap();
    let batches = batches.into_inner();

    assert_eq!(batches.len(), 1);
    assert!(batches[0].done);
    assert!(batches[0].error.is_none());
    assert_eq!(batches[0].revisions.len(), 2);
    assert_eq!(batches[0].revisions[0].subject, "c2");
    assert_eq!(batches[0].revisions[1].subject, "c1");
}

#[test]
fn run_log_ignores_filter_branch_backup_refs() {
    let t = TempRepo::new("run-log-original-refs");
    let path = t.path();
    t.write("a.txt", "one\n");
    git::cli::stage_files(path.clone(), vec!["a.txt".into()]).unwrap();
    git::cli::commit(path.clone(), "c1".into()).unwrap();
    let main = git::repo::open_repo(path.clone())
        .unwrap()
        .head_branch
        .unwrap();

    git::cli::create_branch(path.clone(), "old-history".into(), None).unwrap();
    git::cli::checkout_branch(path.clone(), "old-history".into()).unwrap();
    t.write("old.txt", "old\n");
    git::cli::stage_files(path.clone(), vec!["old.txt".into()]).unwrap();
    git::cli::commit(path.clone(), "rewritten".into()).unwrap();
    let old_oid = git::repo::open_repo(path.clone())
        .unwrap()
        .head_oid
        .unwrap();
    git::cli::checkout_branch(path.clone(), main).unwrap();
    git::cli::delete_branch(path.clone(), "old-history".into(), true).unwrap();

    git2::Repository::open(&t.root)
        .unwrap()
        .reference(
            "refs/original/refs/heads/old-history",
            old_oid.parse().unwrap(),
            false,
            "filter-branch backup",
        )
        .unwrap();

    let batches = std::cell::RefCell::new(Vec::new());
    git::log::run_log(&path, 1, 1000, None, &|| false, &|b| {
        batches.borrow_mut().push(b)
    })
    .unwrap();
    let subjects: Vec<String> = batches
        .into_inner()
        .into_iter()
        .flat_map(|b| b.revisions)
        .map(|r| r.subject)
        .collect();
    assert_eq!(subjects, vec!["c1"]);
    assert!(!subjects.iter().any(|subject| subject == "rewritten"));
}

#[test]
fn symbolic_remote_head_is_hidden_from_branches_and_ref_labels() {
    let t = TempRepo::new("remote-head");
    let path = t.path();
    t.write("a.txt", "one\n");
    git::cli::stage_files(path.clone(), vec!["a.txt".into()]).unwrap();
    git::cli::commit(path.clone(), "c1".into()).unwrap();
    let head = git::repo::open_repo(path.clone())
        .unwrap()
        .head_oid
        .unwrap();

    let repo = git2::Repository::open(&t.root).unwrap();
    repo.reference(
        "refs/remotes/origin/main",
        head.parse().unwrap(),
        false,
        "test remote main",
    )
    .unwrap();
    repo.reference_symbolic(
        "refs/remotes/origin/HEAD",
        "refs/remotes/origin/main",
        false,
        "test remote head",
    )
    .unwrap();
    drop(repo);

    let branches = git::repo::get_branches(path.clone()).unwrap();
    assert!(branches.iter().any(|branch| branch.name == "origin/main"));
    assert!(!branches.iter().any(|branch| branch.name == "origin/HEAD"));

    let batches = std::cell::RefCell::new(Vec::new());
    git::log::run_log(&path, 1, 1000, None, &|| false, &|b| {
        batches.borrow_mut().push(b)
    })
    .unwrap();
    let labels: Vec<String> = batches
        .into_inner()
        .into_iter()
        .flat_map(|b| b.revisions)
        .flat_map(|revision| revision.refs)
        .map(|label| label.name)
        .collect();
    assert!(labels.iter().any(|name| name == "origin/main"));
    assert!(!labels.iter().any(|name| name == "origin/HEAD"));
}

#[test]
fn run_log_empty_repo_emits_done() {
    let t = TempRepo::new("run-log-empty");
    let path = t.path();
    let batches = std::cell::RefCell::new(Vec::new());
    git::log::run_log(&path, 1, 1000, None, &|| false, &|b| {
        batches.borrow_mut().push(b)
    })
    .unwrap();
    let batches = batches.into_inner();
    assert_eq!(batches.len(), 1);
    assert!(batches[0].done);
    assert!(batches[0].revisions.is_empty());
}

#[test]
fn run_log_respects_max_count() {
    let t = TempRepo::new("run-log-limit");
    let path = t.path();
    for i in 0..5 {
        t.write("a.txt", &format!("{}\n", i));
        git::cli::stage_files(path.clone(), vec!["a.txt".into()]).unwrap();
        git::cli::commit(path.clone(), format!("c{}", i)).unwrap();
    }
    let batches = std::cell::RefCell::new(Vec::new());
    git::log::run_log(&path, 1, 2, None, &|| false, &|b| {
        batches.borrow_mut().push(b)
    })
    .unwrap();
    let batches = batches.into_inner();
    let total: usize = batches.iter().map(|b| b.revisions.len()).sum();
    assert_eq!(total, 2);
    assert!(batches.last().unwrap().done);
}

#[test]
fn run_log_revspec_filters_history() {
    let t = TempRepo::new("run-log-revspec");
    let path = t.path();
    t.write("a.txt", "one\n");
    git::cli::stage_files(path.clone(), vec!["a.txt".into()]).unwrap();
    git::cli::commit(path.clone(), "c1".into()).unwrap();
    let main = git::repo::open_repo(path.clone())
        .unwrap()
        .head_branch
        .unwrap();
    git::cli::create_branch(path.clone(), "feature".into(), None).unwrap();
    git::cli::checkout_branch(path.clone(), "feature".into()).unwrap();
    t.write("b.txt", "b\n");
    git::cli::stage_files(path.clone(), vec!["b.txt".into()]).unwrap();
    git::cli::commit(path.clone(), "c2".into()).unwrap();
    git::cli::checkout_branch(path.clone(), main.clone()).unwrap();

    let batches = std::cell::RefCell::new(Vec::new());
    git::log::run_log(&path, 1, 1000, Some("feature"), &|| false, &|b| {
        batches.borrow_mut().push(b)
    })
    .unwrap();
    let revisions: Vec<_> = batches
        .into_inner()
        .into_iter()
        .flat_map(|b| b.revisions)
        .collect();
    assert_eq!(revisions.len(), 2);
    assert!(revisions.iter().any(|r| r.subject == "c2"));
    assert!(revisions.iter().any(|r| r.subject == "c1"));
}

#[test]
fn run_log_cancel_stops_without_final_batch() {
    let t = TempRepo::new("run-log-cancel");
    let path = t.path();
    t.write("a.txt", "one\n");
    git::cli::stage_files(path.clone(), vec!["a.txt".into()]).unwrap();
    git::cli::commit(path.clone(), "c1".into()).unwrap();

    let batches = std::cell::RefCell::new(Vec::new());
    git::log::run_log(&path, 1, 1000, None, &|| true, &|b| {
        batches.borrow_mut().push(b)
    })
    .unwrap();
    assert!(batches.into_inner().is_empty());
}

#[test]
fn run_log_invalid_revspec_returns_error() {
    let t = TempRepo::new("run-log-bad-ref");
    let path = t.path();
    t.write("a.txt", "one\n");
    git::cli::stage_files(path.clone(), vec!["a.txt".into()]).unwrap();
    git::cli::commit(path.clone(), "c1".into()).unwrap();

    let result = git::log::run_log(&path, 1, 1000, Some("no-such-ref"), &|| false, &|_| {});
    assert!(result.is_err());
}
