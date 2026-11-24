import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/leftPanelState.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const url = "data:text/javascript;base64," + Buffer.from(output).toString("base64");
const { DEFAULT_COLLAPSED_GROUPS, loadLeftPanelCollapsed, saveLeftPanelCollapsed } = await import(url);

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

test("默认只展开本地分支，其余分类折叠", () => {
  withStorage(() => {
    assert.deepEqual(loadLeftPanelCollapsed("/repo"), [...DEFAULT_COLLAPSED_GROUPS]);
    assert.equal(DEFAULT_COLLAPSED_GROUPS.includes("local"), false);
    for (const group of ["remote", "tags", "submodules", "worktrees"]) {
      assert.equal(DEFAULT_COLLAPSED_GROUPS.includes(group), true);
    }
  });
});

test("折叠状态按仓库保存并恢复", () => {
  withStorage(() => {
    saveLeftPanelCollapsed("/a", ["local", "folder-branch-feature"]);
    saveLeftPanelCollapsed("/b", ["tags"]);
    assert.deepEqual(loadLeftPanelCollapsed("/a"), ["local", "folder-branch-feature"]);
    assert.deepEqual(loadLeftPanelCollapsed("/b"), ["tags"]);
  });
});

test("非法或损坏的折叠记录回退默认值，重复项去重", () => {
  withStorage((storage) => {
    storage.setItem("git-extensions.left-panel-collapsed.v1:/broken", "not json");
    assert.deepEqual(loadLeftPanelCollapsed("/broken"), [...DEFAULT_COLLAPSED_GROUPS]);
    storage.setItem("git-extensions.left-panel-collapsed.v1:/object", JSON.stringify({ local: true }));
    assert.deepEqual(loadLeftPanelCollapsed("/object"), [...DEFAULT_COLLAPSED_GROUPS]);
    storage.setItem("git-extensions.left-panel-collapsed.v1:/mixed", JSON.stringify(["tags", 7, null]));
    assert.deepEqual(loadLeftPanelCollapsed("/mixed"), [...DEFAULT_COLLAPSED_GROUPS]);
    storage.setItem("git-extensions.left-panel-collapsed.v1:/dupe", JSON.stringify(["tags", "tags", "local"]));
    assert.deepEqual(loadLeftPanelCollapsed("/dupe"), ["tags", "local"]);
  });
});
