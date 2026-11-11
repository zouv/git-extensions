import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const menuSource = await readFile(new URL("../src/explorerMenu.ts", import.meta.url), "utf8");
const menuUrl = "data:text/javascript;base64," + Buffer.from(ts.transpileModule(menuSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText).toString("base64");
const source = await readFile(new URL("../src/settings.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  .replace('from "./explorerMenu"', `from "${menuUrl}"`);
const url = "data:text/javascript;base64," + Buffer.from(output).toString("base64");
const { DEFAULT_SETTINGS, loadSettings, saveSettings, DEFAULT_LAYOUT, loadLayout, saveLayout } = await import(url);
const SETTINGS_KEY = "git-extensions.settings";

const memoryStorage = () => {
  const store = new Map();
  return {
    getItem: (key) => store.has(key) ? store.get(key) : null,
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: (key) => { store.delete(key); },
  };
};

const withStorage = (run) => {
  const hadStorage = "localStorage" in globalThis;
  const original = globalThis.localStorage;
  globalThis.localStorage = memoryStorage();
  try {
    run(globalThis.localStorage);
  } finally {
    if (hadStorage) globalThis.localStorage = original;
    else delete globalThis.localStorage;
  }
};

test("资源管理器右键菜单默认关闭", () => {
  assert.equal(DEFAULT_SETTINGS.explorerContextMenuEnabled, false);
  withStorage((storage) => {
    storage.setItem(SETTINGS_KEY, "{}");
    assert.equal(loadSettings().explorerContextMenuEnabled, false);
  });
});

test("旧设置缺少新字段时保留原有合法值并补充默认值", () => {
  withStorage((storage) => {
    storage.setItem(SETTINGS_KEY, JSON.stringify({
      autoRefresh: false,
      pollIntervalSeconds: 30,
      highlightEnabled: false,
      showLeftPanel: false,
      maxLogCount: 50_000,
      unknownSetting: "discard",
    }));
    assert.deepEqual(loadSettings(), {
      ...DEFAULT_SETTINGS,
      autoRefresh: false,
      pollIntervalSeconds: 30,
      highlightEnabled: false,
      showLeftPanel: false,
      maxLogCount: 50_000,
    });
  });
});

test("全部设置字段只接受白名单类型和选项", () => {
  withStorage((storage) => {
    storage.setItem(SETTINGS_KEY, JSON.stringify({
      autoRefresh: "false",
      pollIntervalSeconds: 7,
      highlightEnabled: 1,
      showLeftPanel: null,
      maxLogCount: 123,
      explorerContextMenuEnabled: "true",
    }));
    assert.deepEqual(loadSettings(), DEFAULT_SETTINGS);
  });
});

test("损坏或非对象 JSON 回退到完整默认设置", () => {
  for (const value of ["broken", "null", "[]", "42"]) {
    withStorage((storage) => {
      storage.setItem(SETTINGS_KEY, value);
      assert.deepEqual(loadSettings(), DEFAULT_SETTINGS, value);
    });
  }
});

test("菜单三态配置按固定动作白名单迁移并忽略非法值", () => {
  withStorage((storage) => {
    storage.setItem(SETTINGS_KEY, JSON.stringify({
      explorerContextMenuPlacements: {
        clone: "hidden",
        pull: "top",
        push: "cascade",
        commit: "invalid",
        unknown: "top",
      },
      explorerAlwaysShowAllCommands: "yes",
    }));
    const loaded = loadSettings();
    assert.equal(loaded.explorerContextMenuPlacements.clone, "hidden");
    assert.equal(loaded.explorerContextMenuPlacements.pull, "top");
    assert.equal(loaded.explorerContextMenuPlacements.push, "cascade");
    assert.equal(loaded.explorerContextMenuPlacements.commit, "top");
    assert.equal(loaded.explorerContextMenuPlacements.settings, "cascade");
    assert.equal(loaded.explorerAlwaysShowAllCommands, false);
    assert.equal("unknown" in loaded.explorerContextMenuPlacements, false);
  });
});

test("损坏设置和多次读取不会共享可变的菜单默认对象", () => {
  withStorage((storage) => {
    storage.setItem(SETTINGS_KEY, "null");
    const first = loadSettings();
    first.explorerContextMenuPlacements.clone = "hidden";
    const second = loadSettings();
    assert.equal(second.explorerContextMenuPlacements.clone, "top");
    assert.equal(DEFAULT_SETTINGS.explorerContextMenuPlacements.clone, "top");
  });
});

test("设置保存往返一致，未知字段不会通过读取白名单", () => {
  withStorage((storage) => {
    const expected = {
      ...DEFAULT_SETTINGS,
      autoRefresh: false,
      pollIntervalSeconds: 60,
      highlightEnabled: false,
      showLeftPanel: false,
      maxLogCount: 200_000,
      explorerContextMenuEnabled: true,
      explorerAlwaysShowAllCommands: true,
      explorerContextMenuPlacements: {
        ...DEFAULT_SETTINGS.explorerContextMenuPlacements,
        pull: "top",
        push: "hidden",
      },
    };
    saveSettings({ ...expected, unknownSetting: "discard" });
    assert.deepEqual(loadSettings(), expected);
    assert.equal(JSON.parse(storage.getItem(SETTINGS_KEY)).explorerContextMenuEnabled, true);
  });
});

test("View 显示选项按仓库布局持久化，旧布局缺少字段时补齐默认值", () => {
  withStorage((storage) => {
    storage.setItem("git-extensions.layout.v2:/repo", JSON.stringify({ leftWidth: 300, showInspector: false }));
    const loaded = loadLayout("/repo", DEFAULT_SETTINGS);
    assert.equal(loaded.leftWidth, 300);
    assert.equal(loaded.showInspector, false);
    assert.equal(loaded.showRemoteBranches, true);
    assert.equal(loaded.showTags, true);
    assert.equal(loaded.showGraphColumn, true);
    assert.equal(loaded.showAuthorColumn, true);
    assert.equal(loaded.showDateColumn, true);
    assert.equal(loaded.showShaColumn, true);
    assert.equal(loaded.relativeDate, false);

    saveLayout("/repo", { ...loaded, showRemoteBranches: false, showTags: false, relativeDate: true, showShaColumn: false });
    const saved = loadLayout("/repo", DEFAULT_SETTINGS);
    assert.equal(saved.showRemoteBranches, false);
    assert.equal(saved.showTags, false);
    assert.equal(saved.relativeDate, true);
    assert.equal(saved.showShaColumn, false);
    assert.equal(saved.showGraphColumn, true);
  });
});

test("View 显示选项只接受布尔值，非法类型回退默认值", () => {
  withStorage((storage) => {
    storage.setItem("git-extensions.layout.v2:/bad", JSON.stringify({
      showRemoteBranches: "false",
      showTags: 0,
      relativeDate: "yes",
      showGraphColumn: null,
    }));
    const loaded = loadLayout("/bad", DEFAULT_SETTINGS);
    assert.equal(loaded.showRemoteBranches, DEFAULT_LAYOUT.showRemoteBranches);
    assert.equal(loaded.showTags, DEFAULT_LAYOUT.showTags);
    assert.equal(loaded.relativeDate, DEFAULT_LAYOUT.relativeDate);
    assert.equal(loaded.showGraphColumn, DEFAULT_LAYOUT.showGraphColumn);
  });
});
