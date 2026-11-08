import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const source = await readFile(new URL("../src/viewState.ts", import.meta.url), "utf8");
const url = "data:text/javascript;base64," + Buffer.from(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText).toString("base64");
const {
  classifyDiffLine,
  restoreConflictDraft,
  selectedFileIndex,
  diffWindow,
  hasSessionDrafts,
  extractHunkPatch,
  buildBranchTree,
  applyAutosquashOrder,
} = await import(url);

test("Diff 文件头先于增删行分类", () => {
  for (const line of ["+++ b/a", "--- a/a", "diff --git a/a b/a", "rename from a"]) assert.equal(classifyDiffLine(line), "meta");
  assert.equal(classifyDiffLine("+added"), "add"); assert.equal(classifyDiffLine("-removed"), "del");
  assert.equal(classifyDiffLine("@@ -1 +1 @@"), "hunk"); assert.equal(classifyDiffLine(" context"), "ctx");
});

test("冲突草稿保留删除意图和原始来源，外部变化一直标记陈旧", () => {
  const original = { path: "a", ours: "ours", theirs: "theirs", worktree: "conflict" };
  const draft = { file: original, result: "", resolveAsDeletion: true };
  const changed = { ...original, worktree: "external" };
  const restored = restoreConflictDraft(changed, draft);
  assert.equal(restored.result, ""); assert.equal(restored.resolveAsDeletion, true);
  assert.equal(restored.dirty, true); assert.equal(restored.stale, true); assert.equal(restored.source, original);
  assert.equal(restoreConflictDraft(changed, { ...draft, file: restored.source }).stale, true);
  assert.equal(restoreConflictDraft(original, draft).stale, false);
});

test("没有草稿时按工作区和两侧内容初始化，不产生 dirty", () => {
  const restored = restoreConflictDraft({ path: "a", worktree: null, ours: "ours", theirs: "theirs" });
  assert.equal(restored.result, "ours"); assert.equal(restored.dirty, false); assert.equal(restored.stale, false);
});

test("文件清单刷新后按路径保持选择，消失时回到首项", () => {
  assert.equal(selectedFileIndex([{ path: "b" }, { path: "a" }], "a"), 1);
  assert.equal(selectedFileIndex([{ path: "b" }], "a"), 0);
  assert.equal(selectedFileIndex([], "a"), 0);
});

test("虚拟滚动在 patch 变短、零高度和空文件时仍在有效范围", () => {
  assert.deepEqual(diffWindow(20, 200000, 400), { start: 0, end: 20 });
  assert.deepEqual(diffWindow(0, 200000, 400), { start: 0, end: 0 });
  assert.deepEqual(diffWindow(100, 400, 0), { start: 15, end: 26 });
  const normal = diffWindow(10000, 2000, 400);
  assert.equal(normal.start, 95); assert.equal(normal.end, 125);
});

test("切换任务后，保留在会话内的草稿仍阻止无确认关闭页签", () => {
  assert.equal(hasSessionDrafts(false, 1, 0), true);
  assert.equal(hasSessionDrafts(false, 0, 1), true);
  assert.equal(hasSessionDrafts(true, 0, 0), true);
  assert.equal(hasSessionDrafts(false, 0, 0), false);
});

test("extractHunkPatch 提取指定 hunk 并保留或合成合法 diff 文件头", () => {
  const file = {
    path: "src/app.ts",
    oldPath: null,
    status: "modified",
    isBinary: false,
    truncated: false,
    patch: [
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1,3 +1,3 @@",
      " line1",
      "-old2",
      "+new2",
      "@@ -10,2 +10,3 @@",
      " ctx",
      "+added",
    ].join("\n"),
  };
  const hunk0 = extractHunkPatch(file, 0);
  assert.ok(hunk0.includes("diff --git a/src/app.ts b/src/app.ts"));
  assert.ok(hunk0.includes("@@ -1,3 +1,3 @@"));
  assert.ok(!hunk0.includes("@@ -10,2 +10,3 @@"));
  assert.equal(extractHunkPatch(file, 2), null);
});

test("buildBranchTree 按斜杠分层构建可折叠文件夹树并统计子分支数量", () => {
  const branches = [
    { name: "main", isHead: true, isRemote: false, oid: "1" },
    { name: "feature/auth/login", isHead: false, isRemote: false, oid: "2" },
    { name: "feature/ui", isHead: false, isRemote: false, oid: "3" },
  ];
  const tree = buildBranchTree(branches);
  assert.equal(tree.length, 2);
  assert.equal(tree[0].kind, "folder");
  assert.equal(tree[0].name, "feature");
  assert.equal(tree[0].count, 2);
  assert.equal(tree[1].kind, "branch");
  assert.equal(tree[1].label, "main");
});

test("applyAutosquashOrder 自动将 fixup! 与 squash! 移到目标提交后并设好动作", () => {
  const entries = [
    { oid: "1111111", shortId: "1111111", subject: "feat: login", message: "feat: login", action: "pick" },
    { oid: "2222222", shortId: "2222222", subject: "feat: dashboard", message: "feat: dashboard", action: "pick" },
    { oid: "3333333", shortId: "3333333", subject: "fixup! feat: login", message: "fixup! feat: login", action: "pick" },
    { oid: "4444444", shortId: "4444444", subject: "squash! feat: dashboard", message: "squash! feat: dashboard", action: "pick" },
  ];
  const ordered = applyAutosquashOrder(entries);
  assert.deepEqual(ordered.map((e) => [e.oid, e.action]), [
    ["1111111", "pick"],
    ["3333333", "fixup"],
    ["2222222", "pick"],
    ["4444444", "squash"],
  ]);
});

