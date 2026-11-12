import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/repoGroups.ts", import.meta.url), "utf8");
const url = "data:text/javascript;base64," + Buffer.from(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText).toString("base64");
const {
  DEFAULT_GROUP_ID, DEFAULT_GROUP_NAME, DEFAULT_GROUP_COLOR, GROUP_COLOR_PRESETS, emptyConfig, sanitizeConfig,
  loadRepoGroups, saveRepoGroups, selectGroup, selectAllOpen, selectCombinedGroups,
  rememberGroupActive, pickVisibleActive, relocateRepoConfig,
  groupForRepo, groupById, visibleRepos, reposInGroup, isGroupSelected,
  toggleActiveGroup, setActiveGroups, ensureGroupActive, primaryGroupId, setRepoGroup,
  createGroup, renameGroup, deleteGroup, togglePin, pinnedGroups, reorderPinned,
  groupForPinShortcut, displayRepoName, setRepoAlias, fallbackGroupColor, setGroupColor,
} = await import(url);

const repo = (name) => ({ path: `/repos/${name}`, name });
const repos = [repo("a"), repo("b"), repo("c"), repo("d")];

test("默认全部打开，未分配仓库归入未分组", () => {
  const c = emptyConfig();
  assert.equal(c.groups.length, 1);
  assert.equal(c.groups[0].id, DEFAULT_GROUP_ID);
  assert.deepEqual(c.activeGroupIds, []);
  assert.deepEqual(c.view, { kind: "all-open" });
  assert.equal(c.groups[0].name, DEFAULT_GROUP_NAME);
  assert.deepEqual(c.aliases, {});
  assert.equal(groupForRepo(c, "/repos/a"), DEFAULT_GROUP_ID);
  assert.deepEqual(visibleRepos(c, repos).map((r) => r.name), ["a", "b", "c", "d"]);
});

test("Pin 与组菜单多选：全部视图点击进入单选，取消最后一组回落全部打开", () => {
  let c = createGroup(createGroup(emptyConfig(), "Work"), "Home");
  const work = c.groups[1].id;
  const home = c.groups[2].id;
  c = setRepoGroup(c, "/repos/a", work);
  c = setRepoGroup(c, "/repos/b", home);
  assert.equal(isGroupSelected(c, work), false, "全部打开不把组标成已选");
  c = toggleActiveGroup(c, work);
  assert.deepEqual(c.view, { kind: "group", groupId: work });
  assert.deepEqual(visibleRepos(c, repos).map((r) => r.name), ["a"]);
  c = toggleActiveGroup(c, home);
  assert.deepEqual(c.activeGroupIds, [work, home]);
  assert.deepEqual(visibleRepos(c, repos).map((r) => r.name), ["a", "b"]);
  assert.equal(isGroupSelected(c, work), true);
  c = toggleActiveGroup(c, work);
  assert.deepEqual(c.activeGroupIds, [home]);
  c = toggleActiveGroup(c, home);
  assert.deepEqual(c.view, { kind: "all-open" });
  assert.equal(isGroupSelected(c, home), false);
  c = toggleActiveGroup(c, DEFAULT_GROUP_ID);
  assert.deepEqual(c.view, { kind: "group", groupId: DEFAULT_GROUP_ID });
  c = toggleActiveGroup(c, DEFAULT_GROUP_ID);
  assert.deepEqual(c.view, { kind: "all-open" }, "未分组可取消勾选");
  assert.deepEqual(toggleActiveGroup(c, "ghost"), c);
  assert.deepEqual(selectAllOpen(c).view, { kind: "all-open" });
});

test("固定组快捷键：Alt+0 未分组，Alt+1…9 跳过未分组的固定顺序", () => {
  let c = createGroup(createGroup(emptyConfig(), "Work"), "Home");
  const work = c.groups[1].id;
  const home = c.groups[2].id;
  c = togglePin(c, DEFAULT_GROUP_ID);
  c = togglePin(c, work);
  c = togglePin(c, home);
  assert.equal(groupForPinShortcut(c, 0), DEFAULT_GROUP_ID);
  assert.equal(groupForPinShortcut(c, 1), work);
  assert.equal(groupForPinShortcut(c, 2), home);
  assert.equal(groupForPinShortcut(c, 3), null);
  assert.equal(groupForPinShortcut(c, 9), null);
  assert.equal(groupForPinShortcut(c, -1), null);
  assert.equal(groupForPinShortcut(c, 1.5), null);
});

test("新建 / 重命名组：空名与重名被拒绝，Default 不可改名", () => {
  let c = emptyConfig();
  c = createGroup(c, "Work");
  assert.equal(c.groups.length, 2);
  const id = c.groups[1].id;
  assert.equal(createGroup(c, "work"), c, "重名（大小写不敏感）拒绝");
  assert.equal(createGroup(c, "   "), c, "空名拒绝");
  c = renameGroup(c, id, "Client");
  assert.equal(c.groups[1].name, "Client");
  assert.equal(renameGroup(c, DEFAULT_GROUP_ID, "X"), c, "Default 不可改名");
  assert.equal(renameGroup(c, id, "default"), c, "不能改成 Default 重名");
});

test("仓库页签分配与按组过滤", () => {
  let c = createGroup(emptyConfig(), "Work");
  const id = c.groups[1].id;
  c = setRepoGroup(c, "/repos/a", id);
  c = setRepoGroup(c, "/repos/b", id);
  c = setRepoGroup(c, "/repos/c", DEFAULT_GROUP_ID);
  assert.equal(groupForRepo(c, "/repos/a"), id);
  assert.equal(groupForRepo(c, "/repos/c"), DEFAULT_GROUP_ID);
  assert.deepEqual(reposInGroup(c, repos, id).map((r) => r.name), ["a", "b"]);
  assert.deepEqual(reposInGroup(c, repos, DEFAULT_GROUP_ID).map((r) => r.name), ["c", "d"]);
  c = setActiveGroups(c, [id]);
  assert.deepEqual(visibleRepos(c, repos).map((r) => r.name), ["a", "b"]);
  // 移回 Default 即清除记录
  c = setRepoGroup(c, "/repos/a", DEFAULT_GROUP_ID);
  assert.equal(c.assignments["/repos/a"], undefined);
});

test("显式组合多选与独占切组：打开目标已可见保持，否则独占", () => {
  let c = createGroup(emptyConfig(), "Work");
  const id = c.groups[1].id;
  c = setRepoGroup(c, "/repos/a", id);
  assert.equal(ensureGroupActive(c, id), c, "全部打开中目标已可见");
  c = selectGroup(c, DEFAULT_GROUP_ID);
  c = toggleActiveGroup(c, id);
  assert.deepEqual(c.view, { kind: "combined", groupIds: [DEFAULT_GROUP_ID, id] });
  assert.deepEqual(c.activeGroupIds, [DEFAULT_GROUP_ID, id]);
  assert.deepEqual(visibleRepos(c, repos).map((r) => r.name), ["a", "b", "c", "d"]);
  assert.equal(primaryGroupId(c), id);
  assert.equal(ensureGroupActive(c, id), c);
  c = toggleActiveGroup(c, DEFAULT_GROUP_ID);
  assert.deepEqual(c.view, { kind: "combined", groupIds: [id] });
  assert.deepEqual(visibleRepos(c, repos).map((r) => r.name), ["a"]);
  c = toggleActiveGroup(c, id);
  assert.deepEqual(c.view, { kind: "all-open" }, "取消最后一组回落全部打开");
  assert.equal(primaryGroupId(c), DEFAULT_GROUP_ID);
  assert.equal(toggleActiveGroup(c, "ghost"), c);
  const ensured = ensureGroupActive(selectGroup(c, DEFAULT_GROUP_ID), id);
  assert.deepEqual(ensured.view, { kind: "group", groupId: id });
  assert.deepEqual(ensured.activeGroupIds, [id]);
  assert.equal(ensureGroupActive(ensured, "ghost"), ensured);
});

test("删除组：仓库页签回落 Default，活动组移除该组，不删除仓库", () => {
  let c = createGroup(emptyConfig(), "Work");
  const id = c.groups[1].id;
  c = setRepoGroup(c, "/repos/a", id);
  c = setActiveGroups(c, [DEFAULT_GROUP_ID, id]);
  c = deleteGroup(c, id);
  assert.equal(c.groups.length, 1);
  assert.deepEqual(c.activeGroupIds, [DEFAULT_GROUP_ID]);
  assert.deepEqual(c.view, { kind: "combined", groupIds: [DEFAULT_GROUP_ID] });
  assert.equal(groupForRepo(c, "/repos/a"), DEFAULT_GROUP_ID);
  assert.equal(deleteGroup(c, DEFAULT_GROUP_ID), c, "Default 不可删除");
});

test("Pin 与拖拽重排：Default 可 Pin / 取消，pinned 顺序写回", () => {
  let c = emptyConfig();
  c = createGroup(c, "A");
  c = createGroup(c, "B");
  c = createGroup(c, "C");
  const [a, b, d] = [c.groups[1].id, c.groups[2].id, c.groups[3].id];
  c = togglePin(c, a);
  c = togglePin(c, b);
  c = togglePin(c, d);
  assert.deepEqual(pinnedGroups(c).map((g) => g.id), [a, b, d]);
  c = togglePin(c, DEFAULT_GROUP_ID);
  assert.deepEqual(pinnedGroups(c).map((g) => g.id), [a, b, d, DEFAULT_GROUP_ID]);
  assert.equal(c.groups[0].pinned, true, "未分组可 Pin");
  c = togglePin(c, DEFAULT_GROUP_ID);
  assert.deepEqual(pinnedGroups(c).map((g) => g.id), [a, b, d]);
  assert.equal(c.groups[0].pinned, false, "未分组可取消 Pin");
  const groupOrder = c.groups.map((g) => g.id);
  c = reorderPinned(c, [d, a, b]);
  assert.deepEqual(c.groups.map((g) => g.id), groupOrder, "固定顺序不改管理器顺序");
  assert.deepEqual(pinnedGroups(c).map((g) => g.id), [d, a, b]);
  assert.equal(c.groups[0].id, DEFAULT_GROUP_ID, "Default 仍在首位");
  assert.equal(reorderPinned(c, [a, b]), c, "数量不匹配拒绝");
  assert.equal(reorderPinned(c, [d, a, a]), c, "重复 id 拒绝");
  assert.equal(reorderPinned(c, [d, a, "nope"]), c, "未知 id 拒绝");
});

test("仓库页签别名：设置 / 覆盖 / 清空恢复仓库名", () => {
  let c = emptyConfig();
  assert.equal(displayRepoName(c, repo("a")), "a");
  c = setRepoAlias(c, "/repos/a", "  前端仓库  ");
  assert.equal(c.aliases["/repos/a"], "前端仓库");
  assert.equal(displayRepoName(c, repo("a")), "前端仓库");
  c = setRepoAlias(c, "/repos/a", "Client App");
  assert.equal(displayRepoName(c, repo("a")), "Client App");
  c = setRepoAlias(c, "/repos/a", "");
  assert.equal(displayRepoName(c, repo("a")), "a", "清空恢复仓库名");
});

test("组颜色：新组优先使用未占预设色，修改与既有操作保持颜色", () => {
  let c = emptyConfig();
  assert.equal(c.groups[0].color, DEFAULT_GROUP_COLOR);
  c = createGroup(c, "Work");
  c = createGroup(c, "Personal");
  const [work, personal] = [c.groups[1], c.groups[2]];
  assert.equal(work.color, GROUP_COLOR_PRESETS[0].value);
  assert.equal(personal.color, GROUP_COLOR_PRESETS[1].value);
  const nextColor = GROUP_COLOR_PRESETS[4].value;
  c = setGroupColor(c, work.id, nextColor);
  assert.equal(groupById(c, work.id).color, nextColor);
  assert.equal(setGroupColor(c, work.id, "red; background: url(x)"), c, "非法颜色拒绝");
  assert.equal(setGroupColor(c, "ghost", nextColor), c, "未知组忽略");
  c = renameGroup(c, work.id, "Client");
  c = togglePin(c, work.id);
  c = reorderPinned(c, [work.id]);
  assert.equal(groupById(c, work.id).color, nextColor, "重命名 / Pin / 排序不改色");
  c = setGroupColor(c, DEFAULT_GROUP_ID, GROUP_COLOR_PRESETS[8].value);
  assert.equal(c.groups[0].color, GROUP_COLOR_PRESETS[8].value, "Default 也可自定义颜色");
  assert.equal(c.groups[0].pinned, false);
});

test("旧配置稳定补色，Default 只继承合法颜色且固定名称与可 Pin", () => {
  const legacy = {
    groups: [
      { id: "g-stable", name: "Work", pinned: true },
      { id: "g-invalid", name: "Bad", color: "var(--attack)" },
    ],
  };
  const first = sanitizeConfig(legacy);
  const second = sanitizeConfig(legacy);
  assert.deepEqual(first, second);
  assert.equal(groupById(first, "g-stable").color, fallbackGroupColor("g-stable"));
  assert.equal(groupById(first, "g-invalid").color, fallbackGroupColor("g-invalid"));
  const custom = sanitizeConfig({
    groups: [{ id: DEFAULT_GROUP_ID, name: "Hacked", pinned: true, color: GROUP_COLOR_PRESETS[0].value }],
  });
  assert.equal(custom.groups[0].name, DEFAULT_GROUP_NAME);
  assert.equal(custom.groups[0].pinned, true, "旧 Default 固定状态保留");
  assert.equal(custom.groups[0].color, GROUP_COLOR_PRESETS[0].value);
});

test("多选切换只改变可见性，不改变仓库所属组及其颜色", () => {
  let c = createGroup(emptyConfig(), "Work");
  const id = c.groups[1].id;
  const color = c.groups[1].color;
  c = setRepoGroup(c, "/repos/a", id);
  c = setActiveGroups(c, [DEFAULT_GROUP_ID, id]);
  assert.deepEqual(visibleRepos(c, repos).map((r) => r.name), ["a", "b", "c", "d"]);
  assert.equal(groupForRepo(c, "/repos/a"), id);
  assert.equal(groupById(c, groupForRepo(c, "/repos/a")).color, color);
  c = setActiveGroups(c, [id]);
  assert.deepEqual(visibleRepos(c, repos).map((r) => r.name), ["a"]);
  assert.equal(groupById(c, groupForRepo(c, "/repos/a")).color, color);
});


test("localStorage 脏数据白名单校验", () => {
  const dirty = {
    groups: [
      { id: DEFAULT_GROUP_ID, name: "Hacked", pinned: true },
      { id: "g1", name: "Work", pinned: true },
      { id: "g1", name: "Dup" },
      { id: "", name: "NoId" },
      { id: "g2", name: "  " },
      "garbage",
      { id: "g3", name: "Valid" },
    ],
    assignments: { "/repos/a": "g1", "/repos/b": "ghost", "/repos/c": DEFAULT_GROUP_ID, "/repos/d": 42, "": "g1" },
    activeGroupIds: ["g1", "ghost", "g1"],
    aliases: { "/repos/a": "  Repo A ", "/repos/b": 42, "/repos/c": "   " },
  };
  const c = sanitizeConfig(dirty);
  assert.equal(c.groups[0].name, DEFAULT_GROUP_NAME, "Default 迁移为未分组");
  assert.equal(c.groups[0].pinned, true, "未分组同样可固定");
  assert.deepEqual(c.groups.map((g) => g.id), [DEFAULT_GROUP_ID, "g1", "g3"], "去重 / 去非法");
  assert.deepEqual(c.assignments, { "/repos/a": "g1" }, "只保留指向存在非 Default 组的记录");
  assert.deepEqual(c.activeGroupIds, ["g1"], "过滤未知组并去重");
  assert.deepEqual(c.aliases, { "/repos/a": "Repo A" }, "只保留非空别名");
  assert.deepEqual(sanitizeConfig({ activeGroupIds: ["ghost"] }).view, { kind: "all-open" }, "无合法范围回落全部打开");
  assert.deepEqual(sanitizeConfig(null), emptyConfig());
  assert.deepEqual(sanitizeConfig([]), emptyConfig());
});

const groupFixture = () => sanitizeConfig({
  groups: [{ id: "work", name: "Work", pinned: true }, { id: "home", name: "Home", pinned: true }],
  assignments: { "/repos/a": "work", "/repos/b": "work", "/repos/c": "home" },
});

function withStorage(values, action) {
  const original = globalThis.localStorage;
  const map = new Map(Object.entries(values));
  globalThis.localStorage = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value),
  };
  try { action(map); } finally {
    if (original === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = original;
  }
}

test("旧单选/多选迁移，新 view 优先且校验固定列表/组内活动记忆", () => {
  const c = groupFixture();
  assert.deepEqual(sanitizeConfig({ ...c, view: undefined, activeGroupIds: ["work"] }).view, { kind: "all-open" }, "新字段存在时不回退旧镜像");
  const legacy = { ...c };
  delete legacy.view;
  delete legacy.pinnedGroupIds;
  assert.deepEqual(sanitizeConfig({ ...legacy, activeGroupIds: ["work"] }).view, { kind: "group", groupId: "work" });
  assert.deepEqual(sanitizeConfig({ ...legacy, activeGroupIds: ["home", "work", "home", "ghost"] }).view,
    { kind: "combined", groupIds: ["home", "work"] });
  assert.deepEqual(sanitizeConfig(legacy).pinnedGroupIds, ["work", "home"]);
  const next = sanitizeConfig({ ...c, view: { kind: "combined", groupIds: [" home ", "home", "ghost"] },
    pinnedGroupIds: ["home", DEFAULT_GROUP_ID, "home", "ghost", "work"],
    lastActivePathByGroup: { work: " /repos/b ", home: "/repos/a", ghost: "/repos/a", default: "/repos/d" },
  });
  assert.deepEqual(next.view, { kind: "combined", groupIds: ["home"] });
  assert.deepEqual(next.activeGroupIds, ["home"]);
  assert.deepEqual(next.pinnedGroupIds, ["home", DEFAULT_GROUP_ID, "work"]);
  assert.deepEqual(next.lastActivePathByGroup, { work: "/repos/b", default: "/repos/d" });
  assert.deepEqual(sanitizeConfig({ ...c, pinnedGroupIds: [] }).groups.map((g) => g.pinned), [false, false, false]);
  for (const view of [null, { kind: "group", groupId: "ghost" }, { kind: "combined", groupIds: [] }, { kind: "bad" }]) {
    assert.deepEqual(sanitizeConfig({ ...c, view }).view, { kind: "all-open" });
  }
});

test("v2 分组键优先，保存只写新键，加载不预写且存储异常安全", () => {
  const old = JSON.stringify({ ...groupFixture(), view: { kind: "group", groupId: "work" } });
  withStorage({ "git-extensions.repoGroups.v1": old }, (map) => {
    const c = loadRepoGroups();
    assert.equal(c.view.groupId, "work");
    assert.equal(map.has("git-extensions.repoGroups.v2"), false);
    saveRepoGroups(selectAllOpen(c));
    assert.equal(map.get("git-extensions.repoGroups.v1"), old);
    assert.deepEqual(loadRepoGroups().view, { kind: "all-open" });
    map.set("git-extensions.repoGroups.v2", "invalid");
    assert.deepEqual(loadRepoGroups(), emptyConfig(), "新键损坏也不复活旧选择");
  });
  const original = globalThis.localStorage;
  globalThis.localStorage = { getItem() { throw Error("blocked"); }, setItem() { throw Error("full"); } };
  try { assert.deepEqual(loadRepoGroups(), emptyConfig()); assert.doesNotThrow(() => saveRepoGroups(emptyConfig())); }
  finally { if (original === undefined) delete globalThis.localStorage; else globalThis.localStorage = original; }
});

test("选择 helper 的兼容镜像、全部打开与组合独立于归组", () => {
  const c = groupFixture();
  const selected = selectGroup(c, "work");
  assert.deepEqual(selected.activeGroupIds, ["work"]);
  assert.deepEqual(visibleRepos({ ...selected, activeGroupIds: ["home"] }, repos).map((r) => r.name), ["a", "b"], "只读 view");
  assert.equal(selectGroup(c, "ghost"), c);
  assert.deepEqual(setActiveGroups(c, []).view, { kind: "all-open" });
  assert.deepEqual(setActiveGroups(c, ["work", "work"]).view, { kind: "group", groupId: "work" });
  assert.deepEqual(selectCombinedGroups(c, ["work"]).view, { kind: "combined", groupIds: ["work"] });
  assert.deepEqual(visibleRepos(selectCombinedGroups(c, ["work", "home"]), repos).map((r) => r.name), ["a", "b", "c"]);
  assert.deepEqual(selectAllOpen(selected).activeGroupIds, []);
  assert.deepEqual(selectAllOpen(selected).assignments, c.assignments);
});

test("单组优先组内记忆再首项，全部/组合优先当前可见，关闭记忆成员安全回落", () => {
  let c = rememberGroupActive(groupFixture(), " /repos/b ");
  c = rememberGroupActive(c, "/repos/c");
  assert.deepEqual(c.lastActivePathByGroup, { work: "/repos/b", home: "/repos/c" });
  assert.equal(rememberGroupActive(c, " "), c);
  assert.equal(pickVisibleActive(selectGroup(c, "work"), repos, "/repos/a"), "/repos/b");
  assert.equal(pickVisibleActive(selectGroup(c, "work"), repos.filter((r) => r.name !== "b"), "/repos/c"), "/repos/a");
  assert.equal(pickVisibleActive(selectGroup(c, "home"), [], "/repos/c"), null);
  assert.equal(pickVisibleActive(selectAllOpen(c), repos, "/repos/d"), "/repos/d");
  assert.equal(pickVisibleActive(selectCombinedGroups(c, ["work", "home"]), repos, "/repos/c"), "/repos/c");
  assert.equal(pickVisibleActive(selectCombinedGroups(c, ["work", "home"]), repos, "/repos/d"), "/repos/a");
  c = setRepoGroup(c, "/repos/b", "home");
  assert.equal(c.lastActivePathByGroup.work, undefined, "改组清除跨组记忆");
});

test("删组清理固定列表和记忆，但不影响别名；删单选组安全回落", () => {
  let c = rememberGroupActive(groupFixture(), "/repos/a");
  c = setRepoAlias(c, "/repos/a", "Alias");
  c = deleteGroup(selectGroup(c, "work"), "work");
  assert.deepEqual(c.view, { kind: "all-open" });
  assert.deepEqual(c.pinnedGroupIds, ["home"]);
  assert.deepEqual(c.lastActivePathByGroup, {});
  assert.equal(c.aliases["/repos/a"], "Alias");
});

test("重新定位迁移归组/别名/记忆，冲突目标优先并清理跨组记忆", () => {
  let c = rememberGroupActive(groupFixture(), "/repos/a");
  c = setRepoAlias(c, "/repos/a", "Source");
  const moved = relocateRepoConfig(c, " /repos/a ", " /repos/A ");
  assert.equal(moved.assignments["/repos/A"], "work");
  assert.equal(moved.aliases["/repos/A"], "Source");
  assert.equal(moved.lastActivePathByGroup.work, "/repos/A");
  assert.equal(moved.assignments["/repos/a"], undefined);
  assert.equal(moved.aliases["/repos/a"], undefined);
  const conflict = relocateRepoConfig(setRepoAlias(c, "/repos/c", "Target"), "/repos/a", "/repos/c");
  assert.equal(conflict.assignments["/repos/c"], "home");
  assert.equal(conflict.aliases["/repos/c"], "Target");
  assert.equal(conflict.lastActivePathByGroup.work, undefined);
  assert.equal(relocateRepoConfig(c, "/repos/a", "/repos/a"), c);
  assert.equal(relocateRepoConfig(c, "", "/repos/a"), c);
  assert.deepEqual(c.assignments, groupFixture().assignments, "输入不变");
});

test("定位到已登记的隐式未分组/无别名目标，不继承来源配置", () => {
  let c = rememberGroupActive(groupFixture(), "/repos/a");
  c = rememberGroupActive(c, "/repos/d");
  c = setRepoAlias(c, "/repos/a", "Source Alias");
  const moved = relocateRepoConfig(c, "/repos/a", "/repos/d", true);
  assert.equal(groupForRepo(moved, "/repos/d"), DEFAULT_GROUP_ID);
  assert.equal(Object.hasOwn(moved.assignments, "/repos/d"), false);
  assert.equal(Object.hasOwn(moved.aliases, "/repos/d"), false);
  assert.equal(moved.assignments["/repos/a"], undefined);
  assert.equal(moved.aliases["/repos/a"], undefined);
  assert.equal(moved.lastActivePathByGroup.work, undefined);
  assert.equal(moved.lastActivePathByGroup.default, "/repos/d", "保持目标未分组的既有记忆");
  const inherited = relocateRepoConfig(c, "/repos/a", "/repos/d");
  assert.equal(groupForRepo(inherited, "/repos/d"), "work", "默认仍兼容迁移到新目标");
  assert.equal(inherited.aliases["/repos/d"], "Source Alias");
  const existing = setRepoAlias(c, "/repos/c", "Target Alias");
  const merged = relocateRepoConfig(existing, "/repos/a", "/repos/c", true);
  assert.equal(groupForRepo(merged, "/repos/c"), "home");
  assert.equal(merged.aliases["/repos/c"], "Target Alias");
  assert.equal(c.assignments["/repos/a"], "work");
  assert.equal(c.aliases["/repos/a"], "Source Alias");
});
