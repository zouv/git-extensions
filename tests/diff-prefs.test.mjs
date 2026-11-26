import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/diffPrefs.ts", import.meta.url), "utf8");
const url = "data:text/javascript;base64," + Buffer.from(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText).toString("base64");
const { DIFF_PANEL_KEY, DEFAULT_DIFF_PREFS, getDiffPrefs, reloadDiffPrefs, setDiffPrefs, subscribeDiffPrefs } = await import(url);

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
  reloadDiffPrefs();
  try {
    run(globalThis.localStorage);
  } finally {
    if (original === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = original;
  }
};

test("diff 面板状态全局共享，缺省为行内 + 不换行 + 不折叠 + 320px", () => {
  withStorage((storage) => {
    assert.deepEqual(getDiffPrefs(), DEFAULT_DIFF_PREFS);
    setDiffPrefs({ mode: "split", wrap: true, collapse: true, fullContext: true, height: 280 });
    assert.notEqual(storage.getItem(DIFF_PANEL_KEY), null);
    assert.deepEqual(getDiffPrefs(), { mode: "split", wrap: true, collapse: true, fullContext: true, height: 280 });
    reloadDiffPrefs();
    assert.deepEqual(getDiffPrefs(), { mode: "split", wrap: true, collapse: true, fullContext: true, height: 280 });
  });
});

test("订阅者收到共享状态变化，退订后不再收到；无变化不通知", () => {
  withStorage(() => {
    const seen = [];
    const stop = subscribeDiffPrefs(() => seen.push(getDiffPrefs()));
    setDiffPrefs({ mode: "split" });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].mode, "split");
    setDiffPrefs({ mode: "split" });
    assert.equal(seen.length, 1);
    stop();
    setDiffPrefs({ wrap: true });
    assert.equal(seen.length, 1);
  });
});

test("其它窗口的 storage 事件刷新共享状态", () => {
  withStorage((storage) => {
    const handlers = new Set();
    const originalWindow = globalThis.window;
    globalThis.window = {
      addEventListener: (type, handler) => { if (type === "storage") handlers.add(handler); },
      removeEventListener: (type, handler) => { if (type === "storage") handlers.delete(handler); },
    };
    try {
      const seen = [];
      const stop = subscribeDiffPrefs(() => seen.push(getDiffPrefs()));
      assert.equal(handlers.size, 1);
      storage.setItem(DIFF_PANEL_KEY, JSON.stringify({ mode: "split", wrap: true, collapse: true, fullContext: false, height: 260 }));
      for (const handler of handlers) handler({ key: DIFF_PANEL_KEY });
      assert.equal(seen.length, 1);
      assert.equal(seen[0].mode, "split");
      assert.equal(seen[0].collapse, true);
      assert.equal(seen[0].height, 260);
      stop();
      assert.equal(handlers.size, 0);
    } finally {
      if (originalWindow === undefined) delete globalThis.window;
      else globalThis.window = originalWindow;
    }
  });
});
