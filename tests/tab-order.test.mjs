import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/tabOrder.ts", import.meta.url), "utf8");
const url = "data:text/javascript;base64," + Buffer.from(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText).toString("base64");
const { insertionIndex, movePath } = await import(url);

const tab = (left, width = 160) => ({ left, width });

test("插入位置只统计其他页签的中心点", () => {
  const others = [tab(0), tab(160), tab(320)];
  assert.equal(insertionIndex(others, 10), 0);
  assert.equal(insertionIndex(others, 80), 0);
  assert.equal(insertionIndex(others, 90), 1);
  assert.equal(insertionIndex(others, 240), 1);
  assert.equal(insertionIndex(others, 250), 2);
  assert.equal(insertionIndex(others, 500), 3);
  assert.equal(insertionIndex([], 100), 0);
});

test("按插入下标重排：开头 / 中间 / 末尾", () => {
  const paths = ["/a", "/b", "/c", "/d"];
  assert.deepEqual(movePath(paths, "/a", 0), ["/a", "/b", "/c", "/d"]);
  assert.deepEqual(movePath(paths, "/a", 2), ["/b", "/c", "/a", "/d"]);
  assert.deepEqual(movePath(paths, "/a", 3), ["/b", "/c", "/d", "/a"]);
  assert.deepEqual(movePath(paths, "/d", 0), ["/d", "/a", "/b", "/c"]);
  assert.deepEqual(movePath(paths, "/c", 1), ["/a", "/c", "/b", "/d"]);
});

test("越界下标夹紧，未知路径保持原顺序", () => {
  assert.deepEqual(movePath(["/a", "/b"], "/a", -5), ["/a", "/b"]);
  assert.deepEqual(movePath(["/a", "/b"], "/a", 99), ["/b", "/a"]);
  assert.deepEqual(movePath(["/a", "/b"], "/x", 1), ["/a", "/b"]);
  assert.deepEqual(movePath([], "/a", 0), []);
});
