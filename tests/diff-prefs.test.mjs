import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/diffPrefs.ts", import.meta.url), "utf8");
const url = "data:text/javascript;base64," + Buffer.from(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText).toString("base64");
const { DIFF_MODE_KEY, DIFF_WRAP_KEY, loadDiffPrefs, saveDiffPrefs, subscribeDiffPrefs } = await import(url);

const memoryStorage = () => {
  const store = new Map();
  return {
    getItem: (key) => store.has(key) ? store.get(key) : null,
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: (key) => { store.delete(key); },
  };
};

const withStorage = (run) => {
  const original = globalThis.localStorage;
  globalThis.localStorage = memoryStorage();
  try {
    run(globalThis.localStorage);
  } finally {
    if (original === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = original;
  }
};

test("diff 偏好按仓库键读写，缺省为行内 + 不换行", () => {
  withStorage((storage) => {
    assert.deepEqual(loadDiffPrefs("/repo"), { mode: "inline", wrap: false });
    saveDiffPrefs("/repo", { mode: "split", wrap: true });
    assert.equal(storage.getItem(`${DIFF_MODE_KEY}:/repo`), "split");
    assert.equal(storage.getItem(`${DIFF_WRAP_KEY}:/repo`), "1");
    assert.deepEqual(loadDiffPrefs("/repo"), { mode: "split", wrap: true });
    assert.deepEqual(loadDiffPrefs("/other"), { mode: "inline", wrap: false });
  });
});

test("同仓库多个订阅者收到写入通知，退订后不再收到", () => {
  withStorage(() => {
    const seenA = [];
    const seenB = [];
    const stopA = subscribeDiffPrefs("/repo", (prefs) => seenA.push(prefs));
    const stopB = subscribeDiffPrefs("/repo", (prefs) => seenB.push(prefs));
    saveDiffPrefs("/repo", { mode: "split", wrap: false });
    assert.deepEqual(seenA, [{ mode: "split", wrap: false }]);
    assert.deepEqual(seenB, [{ mode: "split", wrap: false }]);
    stopA();
    saveDiffPrefs("/repo", { mode: "inline", wrap: true });
    assert.equal(seenA.length, 1);
    assert.deepEqual(seenB[1], { mode: "inline", wrap: true });
    stopB();
    saveDiffPrefs("/other", { mode: "split", wrap: true });
    assert.equal(seenB.length, 2);
  });
});

test("其它窗口的 storage 事件只刷新匹配键的偏好", () => {
  withStorage((storage) => {
    const events = [];
    const handlers = new Set();
    const originalWindow = globalThis.window;
    globalThis.window = {
      addEventListener: (type, handler) => { if (type === "storage") handlers.add(handler); },
      removeEventListener: (type, handler) => { if (type === "storage") handlers.delete(handler); },
    };
    try {
      const stop = subscribeDiffPrefs("/repo", (prefs) => events.push(prefs));
      assert.equal(handlers.size, 1);
      storage.setItem(`${DIFF_MODE_KEY}:/repo`, "split");
      storage.setItem(`${DIFF_WRAP_KEY}:/repo`, "1");
      for (const handler of handlers) handler({ key: `${DIFF_MODE_KEY}:/repo` });
      assert.deepEqual(events, [{ mode: "split", wrap: true }]);
      for (const handler of handlers) handler({ key: `${DIFF_MODE_KEY}:/other` });
      assert.equal(events.length, 1);
      stop();
      assert.equal(handlers.size, 0);
    } finally {
      if (originalWindow === undefined) delete globalThis.window;
      else globalThis.window = originalWindow;
    }
  });
});