import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/historyLayout.ts", import.meta.url), "utf8");
const url = "data:text/javascript;base64," + Buffer.from(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText).toString("base64");

const memoryStorage = () => {
  const store = new Map();
  return {
    getItem: (key) => store.has(key) ? store.get(key) : null,
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: (key) => { store.delete(key); },
  };
};

const withGlobals = (run) => {
  const originalStorage = globalThis.localStorage;
  const originalWindow = globalThis.window;
  globalThis.localStorage = memoryStorage();
  globalThis.window = { innerWidth: 1400 };
  try {
    run(globalThis.localStorage);
  } finally {
    if (originalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalStorage;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
};

const modulePromise = (async () => {
  globalThis.window = { innerWidth: 1400 };
  return import(url);
})();

test("首次打开按窗口宽度给出列表宽度与默认分栏", async () => {
  const { HISTORY_LAYOUT_KEY, DEFAULT_HISTORY_LAYOUT, DEFAULT_HISTORY_COLUMNS, loadHistoryLayout } = await modulePromise;
  withGlobals((storage) => {
    assert.equal(storage.getItem(HISTORY_LAYOUT_KEY), null);
    const layout = loadHistoryLayout();
    assert.equal(layout.listWidth, 812);
    assert.equal(layout.topHeight, DEFAULT_HISTORY_LAYOUT.topHeight);
    assert.equal(layout.infoHeight, DEFAULT_HISTORY_LAYOUT.infoHeight);
    assert.deepEqual(layout.columns, DEFAULT_HISTORY_COLUMNS);
  });
});

test("损坏或非对象的存储回退默认布局", async () => {
  const { HISTORY_LAYOUT_KEY, DEFAULT_HISTORY_LAYOUT, loadHistoryLayout } = await modulePromise;
  withGlobals((storage) => {
    storage.setItem(HISTORY_LAYOUT_KEY, "{not json");
    assert.equal(loadHistoryLayout().topHeight, DEFAULT_HISTORY_LAYOUT.topHeight);
    storage.setItem(HISTORY_LAYOUT_KEY, "[]");
    assert.equal(loadHistoryLayout().infoHeight, DEFAULT_HISTORY_LAYOUT.infoHeight);
  });
});

test("列宽与分栏尺寸越界时夹取，缺失字段用默认值", async () => {
  const { HISTORY_LAYOUT_KEY, DEFAULT_HISTORY_COLUMNS, loadHistoryLayout } = await modulePromise;
  withGlobals((storage) => {
    storage.setItem(HISTORY_LAYOUT_KEY, JSON.stringify({
      listWidth: 99999,
      topHeight: 10,
      infoHeight: "tall",
      columns: { refs: 5, subject: 5000, date: 100 },
    }));
    const layout = loadHistoryLayout();
    assert.equal(layout.listWidth, 4000);
    assert.equal(layout.topHeight, 200);
    assert.equal(layout.infoHeight, 220);
    assert.equal(layout.columns.refs, 48);
    assert.equal(layout.columns.subject, 1200);
    assert.equal(layout.columns.date, 100);
    assert.equal(layout.columns.author, DEFAULT_HISTORY_COLUMNS.author);
    assert.equal(layout.columns.sha, DEFAULT_HISTORY_COLUMNS.sha);
  });
});

test("保存后再次读取沿用列宽与分栏尺寸", async () => {
  const { loadHistoryLayout, saveHistoryLayout } = await modulePromise;
  withGlobals(() => {
    saveHistoryLayout({
      listWidth: 640, topHeight: 360, infoHeight: 180,
      columns: { refs: 70, subject: 320, author: 90, date: 110, sha: 58 },
    });
    const loaded = loadHistoryLayout();
    assert.equal(loaded.listWidth, 640);
    assert.equal(loaded.topHeight, 360);
    assert.equal(loaded.infoHeight, 180);
    assert.deepEqual(loaded.columns, { refs: 70, subject: 320, author: 90, date: 110, sha: 58 });
  });
});

test("RevisionGrid 仅在被传入列宽时渲染列头与拖拽分隔线", async () => {
  const grid = await readFile(new URL("../src/components/RevisionGrid.tsx", import.meta.url), "utf8");
  assert.match(grid, /showColumnHeader\?: boolean/);
  assert.match(grid, /columnWidths\?: RevisionColumnWidths/);
  assert.match(grid, /onColumnWidthsChange\?: \(widths: RevisionColumnWidths\) => void/);
  assert.match(grid, /showColumnHeader && columnWidths && \(/);
  assert.match(grid, /className="rev-col-resize"/);
  assert.match(grid, /startColumnResize/);
  assert.match(grid, /clampColumn\(drag\.key, drag\.startWidth \+ event\.clientX - drag\.startX\)/);
  assert.match(grid, /width: rowWidth/);
});

test("HistoryWindow 使用上下布局、三处分隔条与持久化布局", async () => {
  const windowSource = await readFile(new URL("../src/explorer/HistoryWindow.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(windowSource, /loadHistoryLayout\(\)/);
  assert.match(windowSource, /saveHistoryLayout\(layout\)/);
  assert.match(windowSource, /showColumnHeader/);
  assert.match(windowSource, /onColumnWidthsChange=\{\(columns\) => setLayout/);
  assert.equal((windowSource.match(/<SplitHandle/g) ?? []).length, 3);
  assert.match(windowSource, /className="history-files"/);
  assert.match(windowSource, /files=\{selectedFileDiff \? \[selectedFileDiff\] : \[\]\}/);
  assert.match(styles, /\.history-top \{ display: flex/);
  assert.match(styles, /\.history-files \{ flex: 1/);
  assert.match(styles, /\.revision-header \{ position: sticky/);
});