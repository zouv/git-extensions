use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

use git_extensions_lib::git;

static NEXT_REPO: AtomicUsize = AtomicUsize::new(0);

struct TempRepo {
    root: PathBuf,
}

impl TempRepo {
    fn new(tag: &str) -> Self {
        let id = NEXT_REPO.fetch_add(1, Ordering::Relaxed);
        let root =
            std::env::temp_dir().join(format!("ge-workflows-{tag}-{}-{id}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let repo = git2::Repository::init(&root).unwrap();
        let mut config = repo.config().unwrap();
        config.set_str("user.name", "Workflow Test").unwrap();
        config
            .set_str("user.email", "workflow@example.com")
            .unwrap();
        Self { root }
    }

    fn path(&self) -> String {
        self.root.to_string_lossy().into_owned()
    }

    fn write(&self, name: &str, content: &str) {
        let path = self.root.join(name);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, content).unwrap();
    }

    fn read(&self, name: &str) -> String {
        fs::read_to_string(self.root.join(name)).unwrap()
    }

    fn add_commit(&self, name: &str, content: &str, message: &str) -> String {
        self.write(name, content);
        git::cli::stage_files(self.path(), vec![name.into()]).unwrap();
        git::cli::commit(self.path(), message.into()).unwrap();
        self.head()
    }

    fn head(&self) -> String {
        git2::Repository::open(&self.root)
            .unwrap()
            .head()
            .unwrap()
            .peel_to_commit()
            .unwrap()
            .id()
            .to_string()
    }

    fn main_branch(&self) -> String {
        git::repo::open_repo(self.path())
            .unwrap()
            .head_branch
            .unwrap()
    }

    fn subjects(&self) -> Vec<String> {
        let repo = git2::Repository::open(&self.root).unwrap();
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        let mut result = Vec::new();
        let mut current = Some(head);
        while let Some(commit) = current {
            result.push(commit.summary().unwrap_or_default().to_string());
            current = (commit.parent_count() > 0).then(|| commit.parent(0).unwrap());
        }
        result
    }
}

impl Drop for TempRepo {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn editor_exe() -> &'static Path {
    Path::new(env!("CARGO_BIN_EXE_git-extensions"))
}

#[test]
fn compare_diff_and_discard_preserve_staged_content() {
    let t = TempRepo::new("compare-discard");
    let path = t.path();
    let base = t.add_commit("a.txt", "base\n", "base");
    t.write("a.txt", "target\n");
    git::cli::stage_files(path.clone(), vec!["a.txt".into()]).unwrap();
    t.add_commit("b.txt", "new\n", "target");
    let target = t.head();

    let compared = git::diff::get_compare_diff(path.clone(), base.clone(), target.clone()).unwrap();
    assert_eq!(compared.base_oid, base);
    assert_eq!(compared.target_oid, target);
    assert_eq!(compared.files.len(), 2);
    let a = compared
        .files
        .iter()
        .find(|file| file.path == "a.txt")
        .unwrap();
    assert!(a.patch.contains("-base") && a.patch.contains("+target"));

    t.write("a.txt", "staged\n");
    git::cli::stage_files(path.clone(), vec!["a.txt".into()]).unwrap();
    t.write("a.txt", "worktree\n");
    git::cli::discard_files(path.clone(), vec!["a.txt".into()]).unwrap();
    assert_eq!(t.read("a.txt").replace("\r\n", "\n"), "staged\n");
    let status = git::status::get_status(path.clone()).unwrap();
    assert!(status.staged.iter().any(|entry| entry.path == "a.txt"));
    assert!(!status.unstaged.iter().any(|entry| entry.path == "a.txt"));
}

#[test]
fn untracked_deletion_rejects_tracked_ignored_directories_and_escape() {
    let t = TempRepo::new("untracked-safety");
    let path = t.path();
    t.add_commit(".gitignore", "ignored.txt\n", "ignore rules");
    t.add_commit("tracked.txt", "tracked\n", "tracked");
    t.write("tracked.txt", "modified\n");
    t.write("ignored.txt", "ignored\n");
    t.write("untracked.txt", "delete me\n");
    t.write("dir/nested.txt", "nested\n");
    t.write("../ge-outside-file.txt", "outside\n");

    assert!(git::cli::delete_untracked_files(path.clone(), vec!["tracked.txt".into()]).is_err());
    assert!(git::cli::delete_untracked_files(path.clone(), vec!["ignored.txt".into()]).is_err());
    assert!(git::cli::delete_untracked_files(path.clone(), vec!["dir".into()]).is_err());
    assert!(
        git::cli::delete_untracked_files(path.clone(), vec!["../ge-outside-file.txt".into()])
            .is_err()
    );
    assert!(t.root.join("tracked.txt").exists());
    assert!(t.root.join("ignored.txt").exists());
    assert!(t.root.join("dir/nested.txt").exists());

    git::cli::delete_untracked_files(path.clone(), vec!["untracked.txt".into()]).unwrap();
    assert!(!t.root.join("untracked.txt").exists());
    let _ = fs::remove_file(t.root.parent().unwrap().join("ge-outside-file.txt"));
}

#[test]
fn literal_pathspecs_never_expand_globs_for_file_writes() {
    let t = TempRepo::new("literal-pathspecs");
    let path = t.path();
    t.write("[a].txt", "literal\n");
    t.write("a.txt", "other\n");

    git::cli::stage_files(path.clone(), vec!["[a].txt".into()]).unwrap();
    let status = git::status::get_status(path.clone()).unwrap();
    assert!(status.staged.iter().any(|entry| entry.path == "[a].txt"));
    assert!(!status.staged.iter().any(|entry| entry.path == "a.txt"));
    git::cli::stage_files(path.clone(), vec!["a.txt".into()]).unwrap();
    git::cli::unstage_files(path.clone(), vec!["[a].txt".into()]).unwrap();
    let status = git::status::get_status(path.clone()).unwrap();
    assert!(!status.staged.iter().any(|entry| entry.path == "[a].txt"));
    assert!(status.staged.iter().any(|entry| entry.path == "a.txt"));

    git::cli::stage_files(path.clone(), vec!["[a].txt".into()]).unwrap();
    git::cli::commit(path.clone(), "literal files".into()).unwrap();
    t.write("[a].txt", "literal dirty\n");
    t.write("a.txt", "other dirty\n");
    git::cli::discard_files(path.clone(), vec!["[a].txt".into()]).unwrap();
    assert_eq!(t.read("[a].txt").replace("\r\n", "\n"), "literal\n");
    assert_eq!(t.read("a.txt"), "other dirty\n");

    t.write("[b].txt", "delete literal\n");
    t.write("b.txt", "keep other\n");
    git::cli::delete_untracked_files(path.clone(), vec!["[b].txt".into()]).unwrap();
    assert!(!t.root.join("[b].txt").exists());
    assert!(t.root.join("b.txt").exists());
}

#[test]
fn rename_stage_and_unstage_include_both_old_and_new_paths() {
    let t = TempRepo::new("rename-paths");
    let path = t.path();
    t.add_commit("old.txt", "same content\n", "base");
    fs::rename(t.root.join("old.txt"), t.root.join("new.txt")).unwrap();
    let status = git::status::get_status(path.clone()).unwrap();
    let renamed = status
        .unstaged
        .iter()
        .find(|entry| entry.path == "new.txt")
        .unwrap();
    assert_eq!(renamed.status, "renamed");
    assert_eq!(renamed.old_path.as_deref(), Some("old.txt"));

    git::cli::stage_files(path.clone(), vec!["new.txt".into()]).unwrap();
    let status = git::status::get_status(path.clone()).unwrap();
    assert!(status.unstaged.is_empty());
    let renamed = status
        .staged
        .iter()
        .find(|entry| entry.path == "new.txt")
        .unwrap();
    assert_eq!(renamed.old_path.as_deref(), Some("old.txt"));

    // 从旧路径发起取消暂存，也必须同时还原 new.txt 的一侧。
    git::cli::unstage_files(path.clone(), vec!["old.txt".into()]).unwrap();
    let status = git::status::get_status(path.clone()).unwrap();
    assert!(status.staged.is_empty());
    assert!(status
        .unstaged
        .iter()
        .any(|entry| { entry.path == "new.txt" && entry.old_path.as_deref() == Some("old.txt") }));
}

#[test]
fn non_utf8_diff_uses_replacement_characters_instead_of_empty_patch() {
    let t = TempRepo::new("non-utf8-diff");
    let path = t.path();
    t.add_commit("a.txt", "valid\n", "base");
    fs::write(t.root.join("a.txt"), b"valid\n\xffinvalid\n").unwrap();
    git::cli::stage_files(path.clone(), vec!["a.txt".into()]).unwrap();
    git::cli::commit(path.clone(), "non utf8".into()).unwrap();
    let diff = git::diff::get_commit_diff(path, t.head()).unwrap();
    let file = diff.iter().find(|file| file.path == "a.txt").unwrap();
    assert!(!file.is_binary);
    assert!(file.patch.contains('\u{fffd}'));
    assert!(!file.patch.is_empty());
}

#[test]
fn cherry_pick_conflict_can_be_read_resolved_and_continued() {
    let t = TempRepo::new("cherry-conflict");
    let path = t.path();
    t.add_commit("a.txt", "base\n", "base");
    let main = t.main_branch();
    git::cli::create_branch(path.clone(), "feature".into(), None).unwrap();
    git::cli::checkout_branch(path.clone(), "feature".into()).unwrap();
    let picked = t.add_commit("a.txt", "theirs\n", "incoming change");
    git::cli::checkout_branch(path.clone(), main).unwrap();
    t.add_commit("a.txt", "ours\n", "current change");

    let error = git::cli::cherry_pick(path.clone(), picked).unwrap_err();
    assert!(error.to_string().contains("CONFLICT"));
    let state = git::status::get_operation_state(path.clone()).unwrap();
    assert_eq!(state.kind, "cherryPick");
    assert_eq!(state.conflicts, vec!["a.txt"]);
    assert!(state.head_name.is_some() && state.source.is_some());
    assert!(git::cli::continue_operation(path.clone()).is_err());

    let conflict = git::status::get_conflict_file(path.clone(), "a.txt".into()).unwrap();
    assert_eq!(conflict.base.unwrap(), "base\n");
    assert_eq!(conflict.ours.unwrap(), "ours\n");
    assert_eq!(conflict.theirs.unwrap(), "theirs\n");
    assert!(conflict.worktree.unwrap().contains("<<<<<<<"));

    assert!(git::cli::save_resolved_file(
        path.clone(),
        "a.txt".into(),
        "<<<<<<< ours\nresolved\n>>>>>>> theirs\n".into(),
        None
    )
    .is_err());
    let state =
        git::cli::save_resolved_file(path.clone(), "a.txt".into(), "resolved\n".into(), None)
            .unwrap();
    assert!(state.conflicts.is_empty());
    assert_eq!(state.kind, "cherryPick");

    git::cli::continue_operation(path.clone()).unwrap();
    let state = git::status::get_operation_state(path.clone()).unwrap();
    assert_eq!(state.kind, "none");
    assert_eq!(t.read("a.txt"), "resolved\n");
    assert_eq!(t.subjects()[0], "incoming change");
}

#[test]
fn modify_delete_conflict_exposes_missing_side_as_none() {
    let t = TempRepo::new("modify-delete");
    let path = t.path();
    t.add_commit("a.txt", "base\n", "base");
    let main = t.main_branch();
    git::cli::create_branch(path.clone(), "delete-file".into(), None).unwrap();
    git::cli::checkout_branch(path.clone(), "delete-file".into()).unwrap();
    fs::remove_file(t.root.join("a.txt")).unwrap();
    git::cli::stage_files(path.clone(), vec!["a.txt".into()]).unwrap();
    git::cli::commit(path.clone(), "delete file".into()).unwrap();
    let deletion = t.head();
    git::cli::checkout_branch(path.clone(), main).unwrap();
    t.add_commit("a.txt", "modified\n", "modify file");
    assert!(git::cli::cherry_pick(path.clone(), deletion).is_err());

    let conflict = git::status::get_conflict_file(path.clone(), "a.txt".into()).unwrap();
    assert_eq!(conflict.base.unwrap(), "base\n");
    assert_eq!(conflict.ours.unwrap(), "modified\n");
    assert!(conflict.theirs.is_none());
    assert!(conflict.worktree.is_some());
    let state =
        git::cli::save_resolved_file(path.clone(), "a.txt".into(), String::new(), Some(true))
            .unwrap();
    assert!(state.conflicts.is_empty());
    assert!(!t.root.join("a.txt").exists());
    let status = git::status::get_status(path.clone()).unwrap();
    assert!(status
        .staged
        .iter()
        .any(|entry| entry.path == "a.txt" && entry.status == "deleted"));
    git::cli::continue_operation(path.clone()).unwrap();
    assert!(!t.root.join("a.txt").exists());
}

#[test]
fn binary_invalid_utf8_and_truncated_conflicts_cannot_be_saved() {
    let t = TempRepo::new("unsafe-conflict-content");
    let path = t.path();
    t.write("binary.txt", "base\n");
    t.write("large.txt", "base\n");
    git::cli::stage_files(path.clone(), vec!["binary.txt".into(), "large.txt".into()]).unwrap();
    git::cli::commit(path.clone(), "base".into()).unwrap();
    let main = t.main_branch();
    git::cli::create_branch(path.clone(), "incoming".into(), None).unwrap();
    git::cli::checkout_branch(path.clone(), "incoming".into()).unwrap();
    t.write("binary.txt", "theirs\n");
    t.write("large.txt", "theirs\n");
    git::cli::stage_files(path.clone(), vec!["binary.txt".into(), "large.txt".into()]).unwrap();
    git::cli::commit(path.clone(), "incoming".into()).unwrap();
    let incoming = t.head();
    git::cli::checkout_branch(path.clone(), main).unwrap();
    fs::write(t.root.join("binary.txt"), b"\xff\xfeinvalid\n").unwrap();
    fs::write(t.root.join("large.txt"), vec![b'x'; 600 * 1024]).unwrap();
    git::cli::stage_files(path.clone(), vec!["binary.txt".into(), "large.txt".into()]).unwrap();
    git::cli::commit(path.clone(), "unsafe ours".into()).unwrap();
    assert!(git::cli::cherry_pick(path.clone(), incoming).is_err());

    let binary = git::status::get_conflict_file(path.clone(), "binary.txt".into()).unwrap();
    assert!(binary.binary);
    assert!(git::cli::save_resolved_file(
        path.clone(),
        "binary.txt".into(),
        "must not write".into(),
        None,
    )
    .is_err());
    let large = git::status::get_conflict_file(path.clone(), "large.txt".into()).unwrap();
    assert!(large.truncated);
    assert!(git::cli::save_resolved_file(
        path.clone(),
        "large.txt".into(),
        "must not write".into(),
        None,
    )
    .is_err());
    assert_eq!(
        git::status::get_operation_state(path)
            .unwrap()
            .conflicts
            .len(),
        2
    );
}

#[cfg(unix)]
#[test]
fn resolved_save_rejects_dangling_symlink_escaping_worktree() {
    use std::os::unix::fs::symlink;

    let t = TempRepo::new("dangling-symlink");
    let path = t.path();
    t.add_commit("a.txt", "base\n", "base");
    let main = t.main_branch();
    git::cli::create_branch(path.clone(), "feature".into(), None).unwrap();
    git::cli::checkout_branch(path.clone(), "feature".into()).unwrap();
    let incoming = t.add_commit("a.txt", "theirs\n", "incoming");
    git::cli::checkout_branch(path.clone(), main).unwrap();
    t.add_commit("a.txt", "ours\n", "ours");
    assert!(git::cli::cherry_pick(path.clone(), incoming).is_err());

    let outside = t
        .root
        .parent()
        .unwrap()
        .join(format!("ge-dangling-target-{}", std::process::id()));
    let _ = fs::remove_file(&outside);
    fs::remove_file(t.root.join("a.txt")).unwrap();
    symlink(&outside, t.root.join("a.txt")).unwrap();
    assert!(
        git::cli::save_resolved_file(path, "a.txt".into(), "must not escape".into(), None,)
            .is_err()
    );
    assert!(!outside.exists());
}

fn reordered_conflicting_plan(t: &TempRepo) -> git::rebase::RebasePlan {
    t.add_commit("a.txt", "one\n", "c1");
    let c2 = t.add_commit("a.txt", "two\n", "c2");
    t.add_commit("a.txt", "three\n", "c3");
    let mut plan = git::rebase::prepare_interactive_rebase(t.path(), c2).unwrap();
    plan.entries.reverse();
    plan
}

#[test]
fn externally_started_rebase_continues_without_private_plan() {
    let t = TempRepo::new("external-rebase");
    let path = t.path();
    t.add_commit("a.txt", "base\n", "base");
    let main = t.main_branch();
    git::cli::create_branch(path.clone(), "feature".into(), None).unwrap();
    git::cli::checkout_branch(path.clone(), "feature".into()).unwrap();
    t.add_commit("a.txt", "feature\n", "feature change");
    git::cli::checkout_branch(path.clone(), main.clone()).unwrap();
    t.add_commit("a.txt", "main\n", "main change");
    git::cli::checkout_branch(path.clone(), "feature".into()).unwrap();
    assert!(git::cli::rebase(path.clone(), main).is_err());
    let repo = git2::Repository::open(&t.root).unwrap();
    assert!(!repo.path().join("git-extensions-rebase").exists());
    drop(repo);

    git::cli::save_resolved_file(
        path.clone(),
        "a.txt".into(),
        "resolved external\n".into(),
        None,
    )
    .unwrap();
    git::cli::continue_operation(path.clone()).unwrap();
    let state = git::status::get_operation_state(path.clone()).unwrap();
    assert_eq!(state.kind, "none");
    assert_eq!(t.subjects()[0], "feature change");
    assert_eq!(t.read("a.txt"), "resolved external\n");
}

#[test]
fn interactive_rebase_abort_restores_original_head_and_cleans_files() {
    let t = TempRepo::new("rebase-abort");
    let path = t.path();
    let plan = reordered_conflicting_plan(&t);
    let original = plan.original_head.clone();
    let result =
        git::rebase::start_interactive_rebase_with_editor(path.clone(), plan, editor_exe());
    assert!(result.is_err(), "reordered edits should produce a conflict");
    let state = git::status::get_operation_state(path.clone()).unwrap();
    assert_eq!(state.kind, "rebase");
    assert!(state.interactive);
    assert_eq!(state.current, Some(1));
    assert_eq!(state.total, Some(2));
    assert!(!state.conflicts.is_empty());

    git::cli::abort_operation(path.clone()).unwrap();
    let state = git::status::get_operation_state(path.clone()).unwrap();
    assert_eq!(state.kind, "none");
    assert_eq!(t.head(), original);
    let repo = git2::Repository::open(&t.root).unwrap();
    assert!(!repo.path().join("git-extensions-rebase").exists());
}

#[test]
fn interactive_rebase_reorders_rewords_squashes_and_drops() {
    let t = TempRepo::new("rebase-actions");
    let path = t.path();
    t.add_commit("a.txt", "a\n", "c1");
    let c2 = t.add_commit("b.txt", "b\n", "second");
    let c3 = t.add_commit("c.txt", "c\n", "third");
    let c4 = t.add_commit("d.txt", "d\n", "fourth");
    let c5 = t.add_commit("e.txt", "e\n", "fifth");
    let plan = git::rebase::prepare_interactive_rebase(path.clone(), c2.clone()).unwrap();
    assert_eq!(
        plan.entries
            .iter()
            .map(|entry| entry.oid.clone())
            .collect::<Vec<_>>(),
        vec![c2.clone(), c3.clone(), c4.clone(), c5.clone()]
    );

    let mut entries = plan.entries.clone();
    let third = entries[1].clone();
    let second = entries[0].clone();
    let fourth = entries[2].clone();
    let fifth = entries[3].clone();
    let mut second = second;
    second.action = "reword".into();
    second.message = "rewritten second".into();
    let mut fourth = fourth;
    fourth.action = "squash".into();
    fourth.message = "combined second and fourth\n\ncombined body".into();
    let mut fifth = fifth;
    fifth.action = "drop".into();
    entries = vec![third, second, fourth, fifth];
    let mut edited = plan;
    edited.entries = entries;

    git::rebase::start_interactive_rebase_with_editor(path.clone(), edited, editor_exe()).unwrap();
    assert_eq!(
        t.subjects(),
        vec!["combined second and fourth", "third", "c1"]
    );
    assert!(t.root.join("b.txt").exists());
    assert!(t.root.join("c.txt").exists());
    assert!(t.root.join("d.txt").exists());
    assert!(!t.root.join("e.txt").exists());
    let repo = git2::Repository::open(&t.root).unwrap();
    assert!(!repo.path().join("git-extensions-rebase").exists());
}

#[test]
fn interactive_rebase_rejects_root_dirty_and_incomplete_or_unsafe_plans() {
    let t = TempRepo::new("rebase-validation");
    let path = t.path();
    let root = t.add_commit("a.txt", "a\n", "root");
    let c2 = t.add_commit("b.txt", "b\n", "second");
    t.add_commit("c.txt", "c\n", "third");
    assert!(git::rebase::prepare_interactive_rebase(path.clone(), root).is_err());

    let plan = git::rebase::prepare_interactive_rebase(path.clone(), c2).unwrap();
    let mut first_squash = plan.clone();
    first_squash.entries[0].action = "squash".into();
    assert!(git::rebase::start_interactive_rebase_with_editor(
        path.clone(),
        first_squash,
        editor_exe()
    )
    .is_err());

    let mut drop_then_squash = plan.clone();
    drop_then_squash.entries[0].action = "drop".into();
    drop_then_squash.entries[1].action = "squash".into();
    assert!(git::rebase::start_interactive_rebase_with_editor(
        path.clone(),
        drop_then_squash,
        editor_exe()
    )
    .is_err());

    let mut duplicate = plan.clone();
    duplicate.entries[1] = duplicate.entries[0].clone();
    assert!(git::rebase::start_interactive_rebase_with_editor(
        path.clone(),
        duplicate,
        editor_exe()
    )
    .is_err());

    t.write("a.txt", "dirty\n");
    assert!(
        git::rebase::start_interactive_rebase_with_editor(path.clone(), plan, editor_exe())
            .is_err()
    );
    assert_eq!(git::status::get_operation_state(path).unwrap().kind, "none");
}

#[test]
fn interactive_rebase_rejects_a_range_containing_merge_commit() {
    let t = TempRepo::new("rebase-merge-range");
    let path = t.path();
    t.add_commit("a.txt", "a\n", "root");
    let main = t.main_branch();
    git::cli::create_branch(path.clone(), "feature".into(), None).unwrap();
    git::cli::checkout_branch(path.clone(), "feature".into()).unwrap();
    let feature = t.add_commit("feature.txt", "f\n", "feature");
    git::cli::checkout_branch(path.clone(), main).unwrap();
    t.add_commit("main.txt", "m\n", "main");
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(&t.root)
        .args(["merge", "--no-edit", "feature"])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "merge setup: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(git::rebase::prepare_interactive_rebase(path, feature).is_err());
}

#[test]
fn system_commands_reject_paths_outside_repository_before_launching() {
    let t = TempRepo::new("system-safety");
    t.add_commit("a.txt", "a\n", "c1");
    assert!(git_extensions_lib::system::open_path(t.path(), "../outside".into()).is_err());
    assert!(git_extensions_lib::system::reveal_path(t.path(), Some("../outside".into())).is_err());
}

#[test]
fn worktree_list_reports_linked_worktrees() {
    let t = TempRepo::new("worktrees");
    t.add_commit("a.txt", "a\n", "root");
    let linked = t.root.join("linked-wt");
    git2::Repository::open(&t.root)
        .unwrap()
        .worktree("linked-wt", &linked, None)
        .unwrap();
    assert!(linked.exists());

    let worktrees = git::repo::worktree_list(t.path()).unwrap();
    assert_eq!(worktrees.len(), 1);
    assert_eq!(worktrees[0].name, "linked-wt");
    assert!(!worktrees[0].locked);
    assert!(Path::new(&worktrees[0].path).exists());
}
