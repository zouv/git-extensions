import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/explorerMenu.ts", import.meta.url), "utf8");
const url = "data:text/javascript;base64," + Buffer.from(ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText).toString("base64");
const {
  EXPLORER_MENU_ACTIONS, defaultExplorerMenuPlacements, explorerMenuItems,
  explorerMenuPreview, nextExplorerMenuPlacement,
} = await import(url);

test("默认菜单保持三个顶级项和其余级联项", () => {
  const placements = defaultExplorerMenuPlacements();
  const preview = explorerMenuPreview(placements, false);
  assert.equal(EXPLORER_MENU_ACTIONS.length, 17);
  assert.deepEqual(preview.topLevel.map((item) => item.action), ["clone", "create-repository", "commit"]);
  assert.equal(preview.cascade.length, 14);
  assert.equal(explorerMenuItems(placements).length, 17);
});

test("三态按级联、顶级、隐藏循环", () => {
  assert.equal(nextExplorerMenuPlacement("cascade"), "top");
  assert.equal(nextExplorerMenuPlacement("top"), "hidden");
  assert.equal(nextExplorerMenuPlacement("hidden"), "cascade");
});

test("全部展开只处理未隐藏命令且不创建级联节点", () => {
  const placements = { ...defaultExplorerMenuPlacements(), pull: "hidden", push: "cascade" };
  const preview = explorerMenuPreview(placements, true);
  assert.equal(preview.cascade.length, 0);
  assert.equal(preview.topLevel.length, 16);
  assert.equal(preview.topLevel.some((item) => item.action === "pull"), false);
  assert.equal(preview.topLevel.some((item) => item.action === "push"), true);
});

test("全部隐藏和固定顶级项取消选择都有明确预览", () => {
  const placements = Object.fromEntries(EXPLORER_MENU_ACTIONS.map((item) => [item.action, "hidden"]));
  const preview = explorerMenuPreview(placements, false);
  assert.deepEqual(preview, { topLevel: [], cascade: [] });
});
