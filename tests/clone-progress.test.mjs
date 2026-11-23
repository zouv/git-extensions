import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/cloneProgress.ts", import.meta.url), "utf8");
const url = "data:text/javascript;base64," + Buffer.from(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText).toString("base64");
const { MAX_CLONE_LOG_LINES, parseCloneProgress, appendCloneLogLine } = await import(url);

test("parseCloneProgress 解析带百分比的 git --progress 行并去掉 remote: 前缀", () => {
  assert.deepEqual(parseCloneProgress("Resolving deltas: 25% (3/12)"), { phase: "Resolving deltas", percent: 25 });
  assert.deepEqual(parseCloneProgress("remote: Compressing objects: 100% (8/8), done."), { phase: "Compressing objects", percent: 100 });
  assert.deepEqual(parseCloneProgress("Receiving objects: 120% (12/10)"), { phase: "Receiving objects", percent: 100 });
});

test("parseCloneProgress 忽略非进度行", () => {
  for (const line of [
    "remote: Total 12 (delta 3), reused 8 (delta 2), pack-reused 0",
    "Cloning into 'repo'...",
    "Resolving deltas: done.",
    "",
  ]) assert.equal(parseCloneProgress(line), null, line);
});

test("连续的同阶段进度只保留最新一行", () => {
  let lines = [];
  lines = appendCloneLogLine(lines, "Receiving objects: 25% (3/12)");
  lines = appendCloneLogLine(lines, "Receiving objects: 50% (6/12)");
  lines = appendCloneLogLine(lines, "Receiving objects: 100% (12/12), done.");
  assert.deepEqual(lines, ["Receiving objects: 100% (12/12), done."]);
  lines = appendCloneLogLine(lines, "Resolving deltas: 25% (3/12)");
  lines = appendCloneLogLine(lines, "Resolving deltas: 100% (12/12), done.");
  assert.deepEqual(lines, ["Receiving objects: 100% (12/12), done.", "Resolving deltas: 100% (12/12), done."]);
});

test("非进度行与不同阶段照常追加，非连续的同阶段不合并", () => {
  const lines = ["Receiving objects: 100% (12/12), done.", "remote: Total 12 (delta 3)"];
  const next = appendCloneLogLine(lines, "Resolving deltas: 25% (3/12)");
  assert.deepEqual(next, [...lines, "Resolving deltas: 25% (3/12)"]);
  const resumed = appendCloneLogLine(next, "Receiving objects: 5% (1/12)");
  assert.equal(resumed.at(-1), "Receiving objects: 5% (1/12)");
  assert.equal(resumed.length, 4);
});

test("输出行数按上限截断且不修改原数组", () => {
  const lines = Array.from({ length: MAX_CLONE_LOG_LINES + 50 }, (_, index) => `line ${index}`);
  const frozen = [...lines];
  const next = appendCloneLogLine(lines, "tail");
  assert.equal(next.length, MAX_CLONE_LOG_LINES);
  assert.equal(next.at(-1), "tail");
  assert.deepEqual(lines, frozen);
});