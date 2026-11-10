import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/explorerMenu.ts", import.meta.url), "utf8");
const url = "data:text/javascript;base64," + Buffer.from(ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText).toString("base64");
const {
  EXPLORER_MENU_ACTIONS, MAX_MENU_LEVEL_ITEMS, defaultExplorerMenuPlacements, explorerMenuItems,
  explorerMenuLevelCounts, explorerMenuPreview, normalizeExplorerMenuPlacements,
} = await import(url);

const placementsWith = (placement) => Object.fromEntries(EXPLORER_MENU_ACTIONS.map((item) => [item.action, placement]));
const setPlacements = (actions, placement) => {
  const placements = placementsWith("hidden");
  for (const action of actions) placements[action] = placement;
  return placements;
};

test("默认菜单保持四个顶级项和其余级联项", () => {
  const placements = defaultExplorerMenuPlacements();
  const preview = explorerMenuPreview(placements, false);
  assert.equal(EXPLORER_MENU_ACTIONS.length, 20);
  assert.deepEqual(preview.topLevel.map((item) => item.action), ["clone", "commit", "create-repository", "open-repository"]);
  assert.equal(preview.cascade.length, 16);
  assert.equal(preview.others.length, 0);
  assert.equal(explorerMenuItems(placements).length, 20);
});

test("级联项按使用场景分组且顶级项不重复出现", () => {
  const preview = explorerMenuPreview(defaultExplorerMenuPlacements(), false);
  assert.deepEqual(preview.groups.map((group) => group.id), [
    "repository", "branches", "files", "settings",
  ]);
  assert.deepEqual(preview.groups.find((group) => group.id === "repository").items.map((item) => item.action), [
    "pull", "push", "view-stash", "view-changes",
  ]);
  assert.deepEqual(preview.groups.find((group) => group.id === "branches").items.map((item) => item.action), [
    "checkout-branch", "checkout-revision", "create-branch",
  ]);
  // 设置页分组把仓库创建 / 打开与分支动作放在同一组。
  assert.deepEqual(EXPLORER_MENU_ACTIONS.filter((item) => item.group === "branches").map((item) => item.action), [
    "create-repository", "open-repository", "checkout-branch", "checkout-revision", "create-branch",
  ]);
  const grouped = preview.groups.flatMap((group) => group.items.map((item) => item.action));
  assert.equal(grouped.length, preview.cascade.length);
  assert.equal(grouped.some((action) => preview.topLevel.some((item) => item.action === action)), false);
});

test("级别计数按上下文校验整个级联树的 16 项上限，且不自动移动命令", () => {
  const actions = EXPLORER_MENU_ACTIONS.map((item) => item.action);
  const allCascade = setPlacements(actions, "cascade");
  // 目录上下文可用 17 项、文件上下文 10 项；全部直排时目录上下文超限。
  assert.equal(explorerMenuLevelCounts(allCascade, false).directoryTotal, 17);
  assert.equal(explorerMenuLevelCounts(allCascade, false).fileTotal, 10);
  assert.equal(explorerMenuLevelCounts(allCascade, false).issues.length, 1);

  // 用户场景：13 个目录直排 + Others（自身 1 项）+ 3 个目录子项 = 17。
  const directoryActions = [
    "clone", "create-repository", "open-repository", "commit", "pull", "push", "view-stash",
    "view-changes", "checkout-branch", "checkout-revision", "create-branch", "view-files",
    "reset-file-changes", "add-files", "repository-settings", "settings", "rename",
  ];
  const user = placementsWith("hidden");
  for (const action of directoryActions.slice(0, 13)) user[action] = "cascade";
  for (const action of directoryActions.slice(13, 16)) user[action] = "others";
  const over = explorerMenuLevelCounts(user, false);
  assert.equal(over.directoryTotal, 17);
  assert.equal(over.issues.length, 1);
  assert.match(over.issues[0], /目录上下文级联菜单共 17 项/);
  // 校验不会改配置。
  assert.equal(user[directoryActions[13]], "others");

  // 少一个直排项即可容纳 Others 及其全部子项。
  user[directoryActions[0]] = "hidden";
  assert.equal(explorerMenuLevelCounts(user, false).directoryTotal, 16);
  assert.equal(explorerMenuLevelCounts(user, false).issues.length, 0);

  // 文件专用命令只计入文件上下文；全部放 Others 也不会超过 16。
  const fileOnly = ["open-with-difftool", "file-history", "apply-patch"];
  const fileOthers = setPlacements([...fileOnly, "add-files", "reset-file-changes", "rename", "settings", "view-files", "open-repository", "repository-settings"], "others");
  assert.equal(explorerMenuLevelCounts(fileOthers, false).issues.length, 0);
});

test("预览区分一级、二级与 Others 三级", () => {
  const placements = defaultExplorerMenuPlacements();
  placements["view-files"] = "others";
  placements.settings = "top";
  const preview = explorerMenuPreview(placements, false);
  assert.equal(preview.topLevel.some((item) => item.action === "settings"), true);
  assert.equal(preview.cascade.some((item) => item.action === "view-files"), false);
  assert.deepEqual(preview.otherGroups.find((group) => group.id === "files").items.map((item) => item.action), ["view-files"]);
  const normalized = normalizeExplorerMenuPlacements({ ...placements, settings: "others" });
  assert.equal(normalized.settings, "others");
  assert.equal(normalized["view-files"], "others");
});

test("全部展开只处理未隐藏命令且不创建级联节点", () => {
  const placements = { ...defaultExplorerMenuPlacements(), pull: "hidden", push: "cascade", "view-files": "others" };
  const preview = explorerMenuPreview(placements, true);
  assert.equal(preview.cascade.length, 0);
  assert.equal(preview.others.length, 0);
  assert.equal(preview.otherGroups.length, 0);
  assert.equal(preview.topLevel.length, 19);
  assert.equal(preview.topLevel.some((item) => item.action === "pull"), false);
  assert.equal(preview.topLevel.some((item) => item.action === "push"), true);
  const counts = explorerMenuLevelCounts(placements, true);
  assert.equal(counts.level1, 19);
  assert.equal(counts.issues.length, 0);
});

test("全部隐藏时各级预览均为空", () => {
  const placements = placementsWith("hidden");
  const preview = explorerMenuPreview(placements, false);
  assert.deepEqual(preview, { topLevel: [], cascade: [], others: [], groups: [], otherGroups: [] });
});
