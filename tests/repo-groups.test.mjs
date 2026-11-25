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
  createGroup, renameGroup, deleteGroup, togglePin, pinnedGroups, reorderPinned, reorderGroups,
  reorderGroupSlots, visibleGroupIds,
  groupForPinShortcut, groupForShortcut, displayRepoName, setRepoAlias, fallbackGroupColor, setGroupColor, setGroupBadge,
  MAX_GROUP_BADGE,
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

test("Pin 与组菜单多选：全部视图点击进入单选，取消最后一组保持无选择", () => {
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
  assert.deepEqual(c.view, { kind: "none" }, "取消最后一组不再回落全部打开");
  assert.deepEqual(c.activeGroupIds, []);
  assert.deepEqual(visibleRepos(c, repos), []);
  assert.equal(isGroupSelected(c, home), false);
  c = toggleActiveGroup(c, DEFAULT_GROUP_ID);
  assert.deepEqual(c.view, { kind: "group", groupId: DEFAULT_GROUP_ID });
  c = toggleActiveGroup(c, DEFAULT_GROUP_ID);
  assert.deepEqual(c.view, { kind: "none" }, "未分组可取消勾选，且保持无选择");
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
  assert.deepEqual(c.view, { kind: "none" }, "取消最后一组保持无选择");
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

test("Pin 与拖拽重排：Pin 顺序随组顺序，顶部栏重排同步组顺序", () => {
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
  assert.deepEqual(pinnedGroups(c).map((g) => g.id), [DEFAULT_GROUP_ID, a, b, d], "Pin 顺序按组顺序");
  assert.equal(c.groups[0].pinned, true, "未分组可 Pin");
  c = togglePin(c, DEFAULT_GROUP_ID);
  assert.deepEqual(pinnedGroups(c).map((g) => g.id), [a, b, d]);
  assert.equal(c.groups[0].pinned, false, "未分组可取消 Pin");
  c = reorderPinned(c, [d, a, b]);
  assert.deepEqual(c.groups.map((g) => g.id), [DEFAULT_GROUP_ID, d, a, b], "顶部栏重排同步组顺序");
  assert.deepEqual(pinnedGroups(c).map((g) => g.id), [d, a, b]);
  assert.deepEqual(c.pinnedGroupIds, [d, a, b]);
  assert.equal(reorderPinned(c, [a, b]), c, "数量不匹配拒绝");
  assert.equal(reorderPinned(c, [d, a, a]), c, "重复 id 拒绝");
  assert.equal(reorderPinned(c, [d, a, "nope"]), c, "未知 id 拒绝");
});

test("管理器拖拽排序：完整重排组顺序，Pin 顺序与快捷键随之变化", () => {
  let c = createGroup(createGroup(emptyConfig(), "A"), "B");
  const [a, b] = [c.groups[1].id, c.groups[2].id];
  c = togglePin(c, a);
  c = togglePin(c, b);
  const ordered = reorderGroups(c, [b, DEFAULT_GROUP_ID, a]);
  assert.deepEqual(ordered.groups.map((g) => g.id), [b, DEFAULT_GROUP_ID, a]);
  assert.deepEqual(pinnedGroups(ordered).map((g) => g.id), [b, a]);
  assert.equal(groupForPinShortcut(ordered, 1), b);
  assert.equal(groupForPinShortcut(ordered, 2), a);
  assert.equal(reorderGroups(c, [b, a]), c, "数量不匹配拒绝");
  assert.equal(reorderGroups(c, [b, b, a]), c, "重复 id 拒绝");
  assert.equal(reorderGroups(c, [b, a, "nope"]), c, "未知 id 拒绝");
  assert.deepEqual(reorderGroups(c, [DEFAULT_GROUP_ID, a, b]).groups.map((g) => g.id), [DEFAULT_GROUP_ID, a, b]);
});

test("Tab 模式 Alt 快捷键按分组段顺序，Pin 模式仍按固定组", () => {
  let c = createGroup(createGroup(emptyConfig(), "A"), "B");
  const [a, b] = [c.groups[1].id, c.groups[2].id];
  c = togglePin(c, b);
  assert.equal(groupForShortcut(c, 0, "tab"), DEFAULT_GROUP_ID);
  assert.equal(groupForShortcut(c, 1, "tab"), a);
  assert.equal(groupForShortcut(c, 2, "tab"), b);
  assert.equal(groupForShortcut(c, 1, "pin"), b, "Pin 模式只取固定组");
  assert.equal(groupForShortcut(c, 2, "pin"), null);
  assert.equal(groupForShortcut(c, 9, "tab"), null);
  assert.equal(groupForShortcut(c, -1, "tab"), null);
  assert.equal(groupForShortcut(c, 1.5, "tab"), null);
});

test("Tab 模式分组排序：只重排可见组槽位，隐藏组保持原位", () => {
  let c = createGroup(createGroup(createGroup(emptyConfig(), "A"), "B"), "C");
  const [a, b, d] = [c.groups[1].id, c.groups[2].id, c.groups[3].id];
  const ordered = reorderGroupSlots(c, [d, a]);
  assert.deepEqual(ordered.groups.map((group) => group.id), [DEFAULT_GROUP_ID, d, b, a]);
  assert.equal(reorderGroupSlots(c, [a, a]), c, "重复 id 拒绝");
  assert.equal(reorderGroupSlots(c, ["nope"]), c, "未知 id 拒绝");

  const open = [repo("a"), repo("b")];
  c = setRepoGroup(c, "/repos/a", a);
  c = setRepoGroup(c, "/repos/b", b);
  assert.deepEqual(visibleGroupIds(c, open), [a, b], "按 groups 顺序列出有可见仓库的组");
  assert.deepEqual(visibleGroupIds(selectGroup(c, b), open), [b]);
  assert.deepEqual(visibleGroupIds(c, []), []);
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

test("分组图标文字：支持 Default、超长截断、清空恢复自动生成", () => {
  let c = createGroup(emptyConfig(), "Work");
  const id = c.groups[1].id;
  c = setGroupBadge(c, id, " 前端 ");
  assert.equal(groupById(c, id).badge, "前端");
  c = setGroupBadge(c, id, "ABCD");
  assert.equal(groupById(c, id).badge, "AB", "超长截断");
  c = setGroupBadge(c, DEFAULT_GROUP_ID, "未");
  assert.equal(groupById(c, DEFAULT_GROUP_ID).badge, "未", "Default 也可自定义");
  c = setGroupBadge(c, id, "   ");
  assert.equal(groupById(c, id).badge, undefined, "清空后按组名生成");
  c = setGroupBadge(c, DEFAULT_GROUP_ID, "");
  assert.equal(groupById(c, DEFAULT_GROUP_ID).badge, undefined);
  assert.equal(setGroupBadge(c, "ghost", "X"), c, "未知组忽略");
  c = renameGroup(c, id, "Client");
  c = setGroupBadge(c, id, "CL");
  assert.equal(groupById(c, id).badge, "CL", "重命名保留自定义图标");
  assert.ok(MAX_GROUP_BADGE >= 2);
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

test("预设色库：保留旧色值、名称与色值唯一、全部为合法十六进制", () => {
  assert.ok(GROUP_COLOR_PRESETS.length >= 48, "至少 48 种预设色");
  const values = GROUP_COLOR_PRESETS.map((preset) => preset.value);
  const labels = GROUP_COLOR_PRESETS.map((preset) => preset.label);
  assert.equal(new Set(values).size, values.length, "色值不重复");
  assert.equal(new Set(labels).size, labels.length, "名称不重复");
  for (const legacy of ["#3370ff", "#34c759", "#ff8800", "#f54a45", "#7f3bf5", "#14c0ff", "#00d6b9", "#ffc60a", "#ff66a1", "#646a73"]) {
    assert.ok(values.includes(legacy), `保留旧色 ${legacy}`);
  }
  assert.ok(values.includes(DEFAULT_GROUP_COLOR), "默认色仍在色库中");
  assert.ok(values.every((value) => /^#[0-9a-f]{6}$/i.test(value)), "全部为 6 位十六进制");
  assert.ok(labels.every((label) => label.trim().length > 0), "名称非空");
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
  assert.deepEqual(next.pinnedGroupIds, [DEFAULT_GROUP_ID, "work", "home"], "Pin 成员按组顺序归一");
  assert.deepEqual(next.lastActivePathByGroup, { work: "/repos/b", default: "/repos/d" });
  assert.deepEqual(sanitizeConfig({ ...c, pinnedGroupIds: [] }).groups.map((g) => g.pinned), [false, false, false]);
  for (const view of [null, { kind: "group", groupId: "ghost" }, { kind: "combined", groupIds: [] }, { kind: "bad" }]) {
    assert.deepEqual(sanitizeConfig({ ...c, view }).view, { kind: "all-open" });
  }
  const none = sanitizeConfig({ ...c, view: { kind: "none" } });
  assert.deepEqual(none.view, { kind: "none" });
  assert.deepEqual(none.activeGroupIds, []);
  const reordered = sanitizeConfig({
    groups: [{ id: "home", name: "Home" }, { id: DEFAULT_GROUP_ID, name: "x" }, { id: "work", name: "Work" }],
    assignments: c.assignments,
  });
  assert.deepEqual(reordered.groups.map((g) => g.id), ["home", DEFAULT_GROUP_ID, "work"], "组顺序保留，Default 不强制置顶");
  const badged = sanitizeConfig({
    groups: [
      { id: DEFAULT_GROUP_ID, name: "x", badge: "AB" },
      { id: "work", name: "Work", badge: " 工具 " },
      { id: "home", name: "Home", badge: "ABCDEF" },
      { id: "long", name: "Long", badge: 42 },
    ],
  });
  assert.equal(groupById(badged, DEFAULT_GROUP_ID).badge, "AB");
  assert.equal(groupById(badged, "work").badge, "工具");
  assert.equal(groupById(badged, "home").badge, "AB", `最多 ${MAX_GROUP_BADGE} 个字符`);
  assert.equal(groupById(badged, "long").badge, undefined, "非字符串图标忽略");
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
  assert.deepEqual(visibleRepos({ ...c, view: { kind: "none" } }, repos), [], "无选择视图不显示任何仓库");
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
  assert.equal(pickVisibleActive({ ...c, view: { kind: "none" } }, repos, "/repos/a"), null, "无选择时不自动激活仓库");
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
  assert.deepEqual(deleteGroup({ ...c, view: { kind: "none" } }, "work").view, { kind: "none" }, "无选择视图删组后保持无选择");
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
