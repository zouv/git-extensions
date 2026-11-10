import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

// 用已有 TypeScript 编译器加载正式源码，无需新增测试框架或复制调度算法。
const moduleUrl = (source) => "data:text/javascript;base64," + Buffer.from(ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText).toString("base64");
const storeUrl = moduleUrl(await readFile(new URL("../src/repoOperations.ts", import.meta.url), "utf8"));
const { runRepoWrite, getRepoOperation, subscribeRepoOperation } = await import(storeUrl);
const mockUrl = moduleUrl(
  "let handler; export const setInvoke = (next) => { handler = next; }; export const invoke = (...args) => handler(...args); export const listen = () => Promise.resolve(() => {});"
);
const { setInvoke } = await import(mockUrl);
const apiSource = (await readFile(new URL("../src/api.ts", import.meta.url), "utf8"))
  .replaceAll('"@tauri-apps/api/core"', JSON.stringify(mockUrl))
  .replaceAll('"@tauri-apps/api/event"', JSON.stringify(mockUrl))
  .replaceAll('"./repoOperations"', JSON.stringify(storeUrl));
const { api } = await import(moduleUrl(apiSource));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
};

test("状态同步发布，并在完成后恢复", async () => {
  const gate = deferred(); const snapshots = [];
  const unsubscribe = subscribeRepoOperation("repo-a", () => snapshots.push(getRepoOperation("repo-a")));
  const writing = runRepoWrite("repo-a", "commit", () => gate.promise);
  assert.equal(getRepoOperation("repo-a"), "commit");
  assert.deepEqual(snapshots, ["commit"]);
  gate.resolve("done"); assert.equal(await writing, "done");
  assert.deepEqual(snapshots, ["commit", null]); unsubscribe();
});

test("同一仓库重复操作立即拒绝，不会排队执行", async () => {
  const gate = deferred(); let secondRan = false;
  const writing = runRepoWrite("repo-b", "commit", () => gate.promise);
  await assert.rejects(runRepoWrite("repo-b", "checkout", async () => { secondRan = true; }), /正在执行/);
  assert.equal(secondRan, false); assert.equal(getRepoOperation("repo-b"), "commit");
  gate.resolve(); await writing;
  await runRepoWrite("repo-b", "checkout", async () => { secondRan = true; });
  assert.equal(secondRan, true);
});

test("不同仓库可以独立运行", async () => {
  const a = deferred(), b = deferred();
  const first = runRepoWrite("repo-c", "commit", () => a.promise);
  const second = runRepoWrite("repo-d", "push", () => b.promise);
  assert.equal(getRepoOperation("repo-c"), "commit"); assert.equal(getRepoOperation("repo-d"), "push");
  a.resolve(); await first;
  assert.equal(getRepoOperation("repo-c"), null); assert.equal(getRepoOperation("repo-d"), "push");
  b.resolve(); await second;
});

test("同步异常和异步失败均释放状态，保留原错误", async () => {
  const error = new Error("original Git failure");
  await assert.rejects(runRepoWrite("repo-e", "commit", () => { throw error; }), (e) => e === error);
  assert.equal(getRepoOperation("repo-e"), null);
  await assert.rejects(runRepoWrite("repo-e", "push", () => Promise.reject(error)), (e) => e === error);
  assert.equal(getRepoOperation("repo-e"), null);
});

test("取消订阅幂等，不能移除后续组件的订阅", async () => {
  let calls = 0;
  const old = subscribeRepoOperation("repo-f", () => {}); old();
  const current = subscribeRepoOperation("repo-f", () => calls++); old();
  await runRepoWrite("repo-f", "commit", async () => {});
  assert.equal(calls, 2); current();
  await runRepoWrite("repo-f", "commit", async () => {});
  assert.equal(calls, 2);
});

test("全部正式写 API 都经过共享调度", async () => {
  const path = "repo-api";
  const writes = [
    ["stageFiles", [path, ["a"]]], ["unstageFiles", [path, ["a"]]], ["commit", [path, "message"]],
    ["createBranch", [path, "feature"]], ["checkoutBranch", [path, "feature"]], ["deleteBranch", [path, "feature", false]],
    ["fetch", [path]], ["pull", [path]], ["push", [path]], ["stashPush", [path, "message", false]],
    ["stashApply", [path, "stash@{0}", false]], ["stashDrop", [path, "stash@{0}"]],
    ["reset", [path, { mode: "mixed", targetOid: "abc" }]], ["skipOperation", [path, { kind: "rebase", conflicts: [] }]],
    ["cherryPick", [path, "abc"]], ["revert", [path, "abc"]], ["rebase", [path, "abc"]],
    ["createTag", [path, "v1"]], ["deleteTag", [path, "v1"]], ["submoduleUpdate", [path]],
    ["saveResolvedFile", [path, "a", "resolved"]], ["continueOperation", [path]], ["abortOperation", [path]],
    ["discardFiles", [path, ["a"]]], ["deleteUntrackedFiles", [path, ["a"]]], ["startInteractiveRebase", [path, { branch: "refs/heads/main", entries: [] }]],
    ["cloneRepository", [path, "https://example.com/repo.git"]], ["createRepository", [path]],
    ["cloneRepositoryWithProgress", [path, "https://example.com/repo.git", "clone-op"]],
    ["addFiles", [path, "*.txt", false]], ["resetChanges", [path, ["a"], false]],
    ["checkoutRevision", [path, "abc"]], ["applyPatch", [path, "change.patch", "patch-oid"]],
    ["applyPatchFile", [path, "C:\\change.patch", false, false]],
    ["applyPatchDirectory", [path, "C:\\patches", false, false]],
    ["continuePatch", [path]], ["skipPatch", [path]], ["abortPatch", [path]],
    ["commitFixup", [path, "abc", false]], ["applyDiffPatch", [path, "diff", true, false]],
    ["checkoutRemoteBranch", [path, "origin/main", "main"]], ["renameBranch", [path, "old", "new"]],
    ["deleteBranches", [path, ["a", "b"], false]], ["deleteRemoteBranch", [path, "origin/feat"]],
    ["mergeBranch", [path, "feat", "no-ff"]], ["remoteAdd", [path, "origin", "https://example.com/repo.git"]],
    ["remoteSetUrl", [path, "origin", "https://example.com/repo.git", false]], ["remoteRename", [path, "origin", "upstream"]],
    ["remoteRemove", [path, "upstream"]], ["worktreeAdd", [path, "C:\\wt", "feat", true]],
    ["worktreeRemove", [path, "wt", false]], ["worktreeLock", [path, "wt", true]],
    ["worktreePrune", [path]], ["ignoreFile", [path, "*.log"]],
    ["bisectStart", [path, "HEAD", "abc"]], ["bisectMark", [path, "good"]], ["bisectReset", [path]],
  ];
  for (const [name, args] of writes) {
    const gate = deferred(); let invocations = 0;
    setInvoke(() => { invocations++; return gate.promise; });
    const pending = api[name](...args);
    assert.notEqual(getRepoOperation(path), null, name);
    await assert.rejects(api.commit(path, "duplicate"), /正在执行/);
    assert.equal(invocations, 1, name);
    gate.resolve(); await pending; assert.equal(getRepoOperation(path), null, name);
  }
});

test("新增资源管理器能力完整传递 IPC 命令与参数", async () => {
  const received = [];
  setInvoke((command, args) => { received.push([command, args]); return Promise.resolve(null); });
  const cases = [
    [() => api.getWindowBootstrap(), "get_window_bootstrap", {}],
    [() => api.takePendingLaunches(), "take_pending_launches", {}],
    [() => api.showCurrentWindow(), "show_current_window", {}],
    [() => api.focusMainWindow(), "focus_main_window", {}],
    [() => api.openRepositoryInMain("C:\\repo"), "open_repository_in_main", { path: "C:\\repo" }],
    [() => api.resolveExplorerTarget("C:\\repo\\dir\\file.txt"), "resolve_explorer_target", { path: "C:\\repo\\dir\\file.txt" }],
    [() => api.scopedHistory("C:\\repo", "dir", false), "scoped_history", { path: "C:\\repo", file: "dir", follow: false, maxCount: 500 }],
    [() => api.pullWithOutput("C:\\repo"), "pull_with_output", { path: "C:\\repo" }],
    [() => api.getExplorerIntegrationInfo(), "get_explorer_integration_info", {}],
    [() => api.setExplorerContextMenuEnabled(true, [{ action: "pull", placement: "top" }], true), "set_explorer_context_menu_enabled", { enabled: true, items: [{ action: "pull", placement: "top" }], alwaysShowAllCommands: true }],
    [() => api.cloneRepository("C:\\parent\\repo", "https://example.com/repo.git"), "clone_repository", { path: "C:\\parent\\repo", url: "https://example.com/repo.git" }],
    [() => api.cloneRepositoryWithProgress("C:\\parent\\repo", "https://example.com/repo.git", "clone-op"), "clone_repository_with_progress", { path: "C:\\parent\\repo", url: "https://example.com/repo.git", operationId: "clone-op" }],
    [() => api.createRepository("C:\\repo"), "create_repository", { path: "C:\\repo", bare: false }],
    [() => api.previewAddFiles("C:\\repo", "*.txt", true), "preview_add_files", { path: "C:\\repo", filter: "*.txt", force: true }],
    [() => api.addFiles("C:\\repo", "*.txt", true), "add_files", { path: "C:\\repo", filter: "*.txt", force: true }],
    [() => api.resetChanges("C:\\repo", ["a"], true), "reset_changes", { path: "C:\\repo", paths: ["a"], deleteNew: true }],
    [() => api.resolveRevision("C:\\repo", "HEAD~1"), "resolve_revision", { path: "C:\\repo", revision: "HEAD~1" }],
    [() => api.checkoutRevision("C:\\repo", "abc", true), "checkout_revision", { path: "C:\\repo", oid: "abc", force: true }],
    [() => api.openDifftool("C:\\repo", "dir/a.txt", true), "open_difftool", { path: "C:\\repo", file: "dir/a.txt", staged: true }],
    [() => api.listTrackedFiles("C:\\repo"), "list_tracked_files", { path: "C:\\repo" }],
    [() => api.listHeadFiles("C:\\repo"), "list_head_files", { path: "C:\\repo" }],
    [() => api.previewPatch("C:\\repo", "C:\\change.patch"), "preview_patch", { path: "C:\\repo", patchPath: "C:\\change.patch" }],
    [() => api.applyPatch("C:\\repo", "C:\\change.patch", "patch-oid"), "apply_patch", { path: "C:\\repo", patchPath: "C:\\change.patch", expectedPatchOid: "patch-oid" }],
    [() => api.listPatchDirectory("C:\\repo", "C:\\patches"), "list_patch_directory", { path: "C:\\repo", directory: "C:\\patches" }],
    [() => api.applyPatchFile("C:\\repo", "C:\\change.patch", true, false), "apply_patch_file", { path: "C:\\repo", patchPath: "C:\\change.patch", ignoreWhitespace: true, signOff: false }],
    [() => api.applyPatchDirectory("C:\\repo", "C:\\patches", false, true), "apply_patch_directory", { path: "C:\\repo", directory: "C:\\patches", ignoreWhitespace: false, signOff: true }],
    [() => api.getPatchApplyState("C:\\repo"), "get_patch_apply_state", { path: "C:\\repo" }],
    [() => api.getFileContent("C:\\repo", "a.txt", "abc"), "get_file_content", { path: "C:\\repo", file: "a.txt", oid: "abc" }],
    [() => api.continuePatch("C:\\repo"), "continue_patch", { path: "C:\\repo" }],
    [() => api.skipPatch("C:\\repo"), "skip_patch", { path: "C:\\repo" }],
    [() => api.abortPatch("C:\\repo"), "abort_patch", { path: "C:\\repo" }],
  ];
  for (const [invokeApi, command, args] of cases) {
    const before = received.length;
    await invokeApi();
    assert.deepEqual(received[before], [command, args]);
  }
});

test("只读 API 不占写状态，Rebase 与 Push 预览完整传递", async () => {
  const received = []; setInvoke((command, args) => { received.push([command, args]); return Promise.resolve(null); });
  await api.getStatus("repo-read"); assert.equal(getRepoOperation("repo-read"), null);
  const plan = { branch: "refs/heads/original", originalHead: "old", onto: "base", entries: [] };
  await api.startInteractiveRebase("repo-read", plan);
  assert.deepEqual(received.at(-1), ["start_interactive_rebase", { path: "repo-read", plan }]);
  const preview = { branchRef: "refs/heads/main", headOid: "old" };
  await api.push("repo-read", "chosen", "target", preview);
  assert.deepEqual(received.at(-1), ["push", { path: "repo-read", remote: "chosen", branch: "target", expectedHead: "old", expectedBranch: "refs/heads/main", forceWithLease: false, pushTags: false, force: false, recurseSubmodules: false }]);
});


test("同参数在途读取去重，完成后不缓存结果", async () => {
  const gate = deferred(); let calls = 0;
  setInvoke(() => { calls++; return gate.promise; });
  const first = api.getStatus("read-dedupe"), second = api.getStatus("read-dedupe");
  assert.equal(first, second); assert.equal(calls, 1);
  gate.resolve({ staged: [], unstaged: [] }); await first;
  setInvoke(() => { calls++; return Promise.resolve("new content"); });
  assert.equal(await api.getStatus("read-dedupe"), "new content"); assert.equal(calls, 2);
});

test("读取失败释放去重槽位，路径及单文件参数不会误合并", async () => {
  const gate = deferred(); let calls = 0;
  setInvoke(() => { calls++; return gate.promise; });
  const first = api.getWorktreeFileDiff("read-files", false, "a");
  const duplicate = api.getWorktreeFileDiff("read-files", false, "a");
  const different = api.getWorktreeFileDiff("read-files", true, "a");
  const other = api.getWorktreeFileDiff("other-repo", false, "a");
  assert.equal(first, duplicate); assert.equal(calls, 3);
  const failed = Promise.allSettled([first, different, other]); gate.reject(new Error("read failed")); await failed;
  setInvoke(() => { calls++; return Promise.resolve([]); });
  await api.getWorktreeFileDiff("read-files", false, "a"); assert.equal(calls, 4);
});

test("Reset、跳过、冲突与 Stash 写 API 完整传递预览快照", async () => {
  const received = []; setInvoke((command, args) => { received.push([command, args]); return Promise.resolve(null); });
  const preview = { branch: "refs/heads/main", headOid: "before", targetOid: "after", mode: "mixed", fingerprint: "snapshot" };
  await api.reset("contracts", preview); assert.deepEqual(received.at(-1), ["reset", { path: "contracts", preview }]);
  const expected = { kind: "cherryPick", source: "old", conflicts: ["a"] };
  await api.skipOperation("contracts", expected); assert.deepEqual(received.at(-1), ["skip_operation", { path: "contracts", expected }]);
  const file = { path: "a", worktree: "original" };
  await api.saveResolvedFile("contracts", "a", "result", false, file);
  assert.deepEqual(received.at(-1), ["save_resolved_file", { path: "contracts", file: "a", content: "result", resolveAsDeletion: false, expected: file }]);
  await api.stashApply("contracts", "stash@{1}", true, "oid-1");
  assert.deepEqual(received.at(-1), ["stash_apply", { path: "contracts", name: "stash@{1}", pop: true, expectedOid: "oid-1" }]);
});

test("历史、工作区与对比单文件读取保留改名的两侧路径", async () => {
  const received = []; setInvoke((command, args) => { received.push([command, args]); return Promise.resolve([]); });
  await api.getCommitFileDiff("renames", "oid", "new.txt", "old.txt");
  assert.deepEqual(received.at(-1), ["get_commit_file_diff", { path: "renames", oid: "oid", file: "new.txt", oldFile: "old.txt" }]);
  await api.getWorktreeFileDiff("renames", true, "new.txt", "old.txt");
  assert.equal(received.at(-1)[1].oldFile, "old.txt");
  await api.getCompareFileDiff("renames", "base", "target", "new.txt", "old.txt");
  assert.equal(received.at(-1)[1].oldFile, "old.txt");
});
