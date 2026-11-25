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

test("变更文件列表宽度不设上限，仅挡住非法值", () => {
  withStorage((storage) => {
    storage.setItem("git-extensions.layout.v2:/wide", JSON.stringify({ changesWidth: 1600 }));
    assert.equal(loadLayout("/wide", DEFAULT_SETTINGS).changesWidth, 1600);
    storage.setItem("git-extensions.layout.v2:/narrow", JSON.stringify({ changesWidth: 120 }));
    assert.equal(loadLayout("/narrow", DEFAULT_SETTINGS).changesWidth, 120);
    storage.setItem("git-extensions.layout.v2:/zero", JSON.stringify({ changesWidth: 0 }));
    assert.equal(loadLayout("/zero", DEFAULT_SETTINGS).changesWidth, 0);
    storage.setItem("git-extensions.layout.v2:/bad", JSON.stringify({ changesWidth: "wide" }));
    assert.equal(loadLayout("/bad", DEFAULT_SETTINGS).changesWidth, DEFAULT_LAYOUT.changesWidth);
    storage.setItem("git-extensions.layout.v2:/neg", JSON.stringify({ changesWidth: -5 }));
    assert.equal(loadLayout("/neg", DEFAULT_SETTINGS).changesWidth, 0);
  });
});

test("左侧导航宽度不设上限，仅挡住非法值", () => {
  withStorage((storage) => {
    storage.setItem("git-extensions.layout.v2:/wide", JSON.stringify({ leftWidth: 900 }));
    assert.equal(loadLayout("/wide", DEFAULT_SETTINGS).leftWidth, 900);
    storage.setItem("git-extensions.layout.v2:/zero", JSON.stringify({ leftWidth: 0 }));
    assert.equal(loadLayout("/zero", DEFAULT_SETTINGS).leftWidth, 0);
    storage.setItem("git-extensions.layout.v2:/bad", JSON.stringify({ leftWidth: "wide" }));
    assert.equal(loadLayout("/bad", DEFAULT_SETTINGS).leftWidth, DEFAULT_LAYOUT.leftWidth);
    storage.setItem("git-extensions.layout.v2:/neg", JSON.stringify({ leftWidth: -5 }));
    assert.equal(loadLayout("/neg", DEFAULT_SETTINGS).leftWidth, 0);
  });
});

test("右侧检查器宽度不设上限，仅挡住非法值", () => {
  withStorage((storage) => {
    storage.setItem("git-extensions.layout.v2:/wide-inspector", JSON.stringify({ inspectorSize: 1400 }));
    assert.equal(loadLayout("/wide-inspector", DEFAULT_SETTINGS).inspectorSize, 1400);
    storage.setItem("git-extensions.layout.v2:/zero-inspector", JSON.stringify({ inspectorSize: 0 }));
    assert.equal(loadLayout("/zero-inspector", DEFAULT_SETTINGS).inspectorSize, 0);
    storage.setItem("git-extensions.layout.v2:/bad-inspector", JSON.stringify({ inspectorSize: "wide" }));
    assert.equal(loadLayout("/bad-inspector", DEFAULT_SETTINGS).inspectorSize, DEFAULT_LAYOUT.inspectorSize);
    storage.setItem("git-extensions.layout.v2:/neg-inspector", JSON.stringify({ inspectorSize: -20 }));
    assert.equal(loadLayout("/neg-inspector", DEFAULT_SETTINGS).inspectorSize, 0);
  });
});

test("分组显示方式默认页签内图标，只接受 tab / pin", () => {
  assert.equal(DEFAULT_SETTINGS.groupNavMode, "tab");
  withStorage((storage) => {
    storage.setItem(SETTINGS_KEY, JSON.stringify({ groupNavMode: "pin" }));
    assert.equal(loadSettings().groupNavMode, "pin");
    storage.setItem(SETTINGS_KEY, JSON.stringify({ groupNavMode: "tab" }));
    assert.equal(loadSettings().groupNavMode, "tab");
    storage.setItem(SETTINGS_KEY, JSON.stringify({ groupNavMode: "bogus" }));
    assert.equal(loadSettings().groupNavMode, "tab");
    storage.setItem(SETTINGS_KEY, "{}");
    assert.equal(loadSettings().groupNavMode, "tab");
  });
});

test("检查器详情高度与底部 Diff 高度持久化", () => {
  withStorage((storage) => {
    storage.setItem("git-extensions.layout.v2:/panes", JSON.stringify({ inspectorInfoHeight: 340, historyDiffHeight: 280 }));
    const loaded = loadLayout("/panes", DEFAULT_SETTINGS);
    assert.equal(loaded.inspectorInfoHeight, 340);
    assert.equal(loaded.historyDiffHeight, 280);
    storage.setItem("git-extensions.layout.v2:/pane-bad", JSON.stringify({ inspectorInfoHeight: "tall", historyDiffHeight: "low" }));
    const fallback = loadLayout("/pane-bad", DEFAULT_SETTINGS);
    assert.equal(fallback.inspectorInfoHeight, DEFAULT_LAYOUT.inspectorInfoHeight);
    assert.equal(fallback.historyDiffHeight, DEFAULT_LAYOUT.historyDiffHeight);
  });
});

test("未暂存 / 已暂存列表分割比例持久化并夹取到 0.15–0.85", () => {
  withStorage((storage) => {
    storage.setItem("git-extensions.layout.v2:/split", JSON.stringify({ changesListSplit: 0.7 }));
    assert.equal(loadLayout("/split", DEFAULT_SETTINGS).changesListSplit, 0.7);
    storage.setItem("git-extensions.layout.v2:/split-max", JSON.stringify({ changesListSplit: 9 }));
    assert.equal(loadLayout("/split-max", DEFAULT_SETTINGS).changesListSplit, 0.85);
    storage.setItem("git-extensions.layout.v2:/split-min", JSON.stringify({ changesListSplit: 0 }));
    assert.equal(loadLayout("/split-min", DEFAULT_SETTINGS).changesListSplit, 0.15);
    storage.setItem("git-extensions.layout.v2:/split-bad", JSON.stringify({ changesListSplit: "half" }));
    assert.equal(loadLayout("/split-bad", DEFAULT_SETTINGS).changesListSplit, DEFAULT_LAYOUT.changesListSplit);
    saveLayout("/split", { ...loadLayout("/split", DEFAULT_SETTINGS), changesListSplit: 0.62 });
    assert.equal(loadLayout("/split", DEFAULT_SETTINGS).changesListSplit, 0.62);
  });
});
