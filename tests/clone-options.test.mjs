import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const dialog = await readFile(new URL("../src/components/CloneDialog.tsx", import.meta.url), "utf8");
const api = await readFile(new URL("../src/api.ts", import.meta.url), "utf8");

test("CloneDialog 默认使用远端 HEAD 且子模块默认勾选，其它选项默认关闭", () => {
  assert.match(dialog, /const DEFAULT_OPTIONS = \{ branch: "", initSubmodules: true, depthOne: false, singleBranch: false \}/);
  assert.match(dialog, /function branchMenuLabel[\s\S]*?branch\.trim\(\) \? branch : "\(default: remote HEAD\)"/);
  assert.match(dialog, /placeholder=\{branchMenuLabel\(""\)\}/);
});

test("分支下拉默认只提供查询项，查询结果按需加载", () => {
  assert.match(dialog, /remoteBranches === null[\s\S]*?"查询远程分支"/);
  assert.match(dialog, /api\.listRemoteBranches\(url\.trim\(\)\)/);
  assert.match(dialog, /remoteBranches\.map\(\(name\) =>/);
  assert.match(api, /listRemoteBranches: \(url: string\) =>\s*invoke<string\[\]>\("list_remote_branches", \{ url \}\)/);
});

test("三个勾选项带说明并映射到 clone options 参数", () => {
  for (const label of ["Initialize all submodules", "depth 1", "single-branch"]) {
    assert.ok(dialog.includes(label), label);
  }
  assert.match(dialog, /git clone --recurse-submodules/);
  assert.match(dialog, /git clone --depth 1/);
  assert.match(dialog, /git clone --single-branch/);
  assert.match(dialog, /const cloneOptions = \(\) => \(\{[\s\S]*?branch: options\.branch\.trim\(\),[\s\S]*?initSubmodules: options\.initSubmodules,[\s\S]*?depthOne: options\.depthOne,[\s\S]*?singleBranch: options\.singleBranch,/);
  assert.equal((dialog.match(/api\.cloneRepositoryWithProgress\(destination\.trim\(\), url\.trim\(\), cloneOptions\(\), operationId\)/g) ?? []).length, 1);
  assert.equal((dialog.match(/api\.cloneRepository\(destination\.trim\(\), url\.trim\(\), cloneOptions\(\)\)/g) ?? []).length, 1);
});
