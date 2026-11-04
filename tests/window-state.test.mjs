import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/windowState.ts", import.meta.url), "utf8");
const url = "data:text/javascript;base64," + Buffer.from(ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText).toString("base64");
const { fitWindowState, loadWindowState, saveWindowState } = await import(url);
const KEY = "git-extensions.window.v1";

function withStorage(run) {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
  };
  try { run(store); } finally { delete globalThis.localStorage; }
}

const normal = { x: 100, y: 80, width: 1200, height: 760, maximized: false };

test("窗口状态保存读取往返并保留最大化标志", () => {
  withStorage((store) => {
    const expected = { ...normal, x: -300, maximized: true };
    saveWindowState(expected);
    assert.deepEqual(loadWindowState(), expected);
    assert.equal(JSON.parse(store.get(KEY)).width, 1200);
  });
});

test("损坏 JSON、非法尺寸和坐标类型回退为空", () => {
  for (const value of ["broken", "null", "[]", "{}", JSON.stringify({ ...normal, width: 0 }),
    JSON.stringify({ ...normal, height: -1 }), JSON.stringify({ ...normal, x: "100" })]) {
    withStorage((store) => {
      store.set(KEY, value);
      assert.equal(loadWindowState(), null, value);
    });
  }
});

test("存储不可用时不影响当前窗口会话", () => {
  globalThis.localStorage = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } };
  try {
    assert.equal(loadWindowState(), null);
    assert.doesNotThrow(() => saveWindowState(normal));
  } finally { delete globalThis.localStorage; }
});

test("离屏窗口回退到工作区中央并缩小尺寸", () => {
  const fitted = fitWindowState({ x: 5000, y: 5000, width: 1800, height: 1000, maximized: true },
    [{ x: 0, y: 0, width: 1600, height: 860 }]);
  assert.deepEqual(fitted, { x: 0, y: 0, width: 1600, height: 860, maximized: true });
});

test("负坐标显示器有效且选择最大交集工作区", () => {
  const state = { x: -600, y: 100, width: 600, height: 500, maximized: false };
  const fitted = fitWindowState(state, [
    { x: -1920, y: 0, width: 1920, height: 1040 },
    { x: 0, y: 0, width: 1600, height: 900 },
  ]);
  assert.deepEqual(fitted, state);
});

test("部分可见窗口被约束在工作区内", () => {
  const fitted = fitWindowState({ x: 1500, y: -100, width: 500, height: 700, maximized: false },
    [{ x: 0, y: 0, width: 1600, height: 900 }]);
  assert.deepEqual(fitted, { x: 1100, y: 0, width: 500, height: 700, maximized: false });
});
