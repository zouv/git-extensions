import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/viewState.ts", import.meta.url), "utf8");
const url = "data:text/javascript;base64," + Buffer.from(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText).toString("base64");
const { parsePatch, buildInlineRows, buildSplitRows, isHunkRow } = await import(url);

const PATCH = [
  "diff --git a/a.txt b/a.txt",
  "index 111..222 100644",
  "--- a/a.txt",
  "+++ b/a.txt",
  "@@ -1,6 +1,6 @@",
  " a",
  " b",
  "-c",
  "+C",
  " d",
  " e",
  " f",
].join("\n");

test("解析 patch：行号、hunk 归属与去前缀内容", () => {
  const parsed = parsePatch(`${PATCH}\n`);
  assert.equal(parsed.hunks.length, 1);
  assert.equal(parsed.hunks[0].oldStart, 1);
  assert.equal(parsed.hunks[0].newStart, 1);
  assert.equal(parsed.hunks[0].row, 4);
  assert.deepEqual(parsed.lines.map((line) => line.kind), ["meta", "meta", "meta", "meta", "hunk", "ctx", "ctx", "del", "add", "ctx", "ctx", "ctx"]);
  const del = parsed.lines[7];
  assert.equal(del.oldLine, 3);
  assert.equal(del.newLine, null);
  assert.equal(del.content, "c");
  assert.equal(del.hunkIndex, 0);
  const add = parsed.lines[8];
  assert.equal(add.oldLine, null);
  assert.equal(add.newLine, 3);
  assert.equal(add.content, "C");
  const last = parsed.lines[11];
  assert.equal(last.oldLine, 6);
  assert.equal(last.newLine, 6);
  assert.equal(last.content, "f");
});

test("inline 折叠：连续未修改行合并，可指定 run 展开", () => {
  const parsed = parsePatch(PATCH);
  const expanded = new Set();
  const folded = buildInlineRows(parsed.lines, true, expanded);
  assert.deepEqual(folded.map((row) => row.kind), ["line", "line", "line", "line", "line", "fold", "line", "line", "fold"]);
  assert.equal(folded[5].count, 2);
  assert.equal(folded[8].count, 3);
  const open = buildInlineRows(parsed.lines, true, new Set([folded[5].runId]));
  assert.deepEqual(open.map((row) => row.kind), ["line", "line", "line", "line", "line", "line", "line", "line", "line", "fold"]);
  const plain = buildInlineRows(parsed.lines, false, expanded);
  assert.equal(plain.filter((row) => row.kind === "fold").length, 0);
});

test("split 视图：删除与新增按行配对，上下文左右同时显示", () => {
  const parsed = parsePatch(PATCH);
  const rows = buildSplitRows(parsed.lines, false, new Set());
  const pair = rows.find((row) => row.kind === "pair" && row.left?.kind === "del");
  assert.ok(pair);
  assert.equal(pair.left.content, "c");
  assert.equal(pair.right.content, "C");
  const context = rows.find((row) => row.kind === "pair" && row.left?.content === "a");
  assert.ok(context);
  assert.equal(context.right.content, "a");
});

test("split 折叠与 hunk 行识别", () => {
  const parsed = parsePatch(PATCH);
  const folded = buildSplitRows(parsed.lines, true, new Set());
  assert.equal(folded.filter((row) => row.kind === "fold").length, 2);
  assert.ok(isHunkRow(parsed.lines.length ? { kind: "whole", line: parsed.lines[4] } : null));
  assert.equal(isHunkRow({ kind: "pair", left: parsed.lines[5], right: parsed.lines[5] }), false);
});
