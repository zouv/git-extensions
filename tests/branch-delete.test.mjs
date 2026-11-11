import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/branchDelete.ts", import.meta.url), "utf8");
const url = "data:text/javascript;base64," + Buffer.from(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText).toString("base64");
const { branchFolderNames, planBranchFolderDelete, decideBranchDeletion } = await import(url);

const branch = (name, isHead = false, isRemote = false, oid = name) => ({ name, isHead, isRemote, oid });

test("branchFolderNames 只收集完整列表里指定目录下的分支（含嵌套、区分本地/远程）", () => {
  const branches = [
    branch("feature", false),
    branch("feature/a"),
    branch("feature/sub/b"),
    branch("featurex/c"),
    branch("origin/feature/a", false, true),
    branch("origin/feature/sub/b", false, true),
    branch("origin/featurex/c", false, true),
  ];
  assert.deepEqual(branchFolderNames(branches, "feature", "local"), ["feature/a", "feature/sub/b"]);
  assert.deepEqual(branchFolderNames(branches, "origin/feature", "remote"), ["origin/feature/a", "origin/feature/sub/b"]);
  assert.deepEqual(branchFolderNames(branches, "", "local"), []);
});

test("branchFolderNames 排除远程 HEAD，但不误伤合法的第三段 HEAD 分支", () => {
  const branches = [branch("origin/HEAD", false, true), branch("origin/feature/HEAD", false, true), branch("origin/feature/a", false, true)];
  const names = branchFolderNames(branches, "origin", "remote");
  assert.equal(names.includes("origin/HEAD"), false);
  assert.deepEqual(new Set(names), new Set(["origin/feature/HEAD", "origin/feature/a"]));
});

test("planBranchFolderDelete 识别目录内的当前分支；远程目录不返回 HEAD", () => {
  const branches = [branch("feature/a"), branch("feature/sub/b", true), branch("other/c")];
  const local = planBranchFolderDelete(branches, "feature", "local");
  assert.equal(local.headBranch, "feature/sub/b");
  assert.deepEqual(local.names, ["feature/a", "feature/sub/b"]);
  assert.equal(planBranchFolderDelete(branches, "feature", "remote").headBranch, null);
});

test("decideBranchDeletion 任一存在分支未合并即要求强制删除，缺失分支不触发强制", () => {
  const statuses = [
    { name: "a", exists: true, merged: true },
    { name: "b", exists: true, merged: false },
    { name: "gone", exists: false, merged: false },
  ];
  const decision = decideBranchDeletion(statuses, ["a", "b", "gone", "not-returned"]);
  assert.equal(decision.force, true);
  assert.deepEqual(decision.names, ["a", "b"]);
  assert.deepEqual(decision.unmerged, ["b"]);
  assert.deepEqual(decision.missing, ["gone", "not-returned"]);
});

test("decideBranchDeletion 全部已合并时不强制，空输入安全", () => {
  const decision = decideBranchDeletion([{ name: "a", exists: true, merged: true }], ["a"]);
  assert.equal(decision.force, false);
  assert.deepEqual(decision.names, ["a"]);
  assert.deepEqual(decideBranchDeletion([], []), { force: false, names: [], unmerged: [], missing: [] });
});
