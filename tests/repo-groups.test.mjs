import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/repoGroups.ts", import.meta.url), "utf8");
const url = "data:text/javascript;base64," + Buffer.from(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText).toString("base64");
const {
  DEFAULT_GROUP_ID, emptyConfig, sanitizeConfig, groupForRepo, visibleRepos, reposInGroup,
  toggleActiveGroup, setActiveGroups, ensureGroupActive, primaryGroupId, setRepoGroup,
  createGroup, renameGroup, deleteGroup, togglePin, pinnedGroups, reorderPinned,
  displayRepoName, setRepoAlias,
} = await import(url);

const repo = (name) => ({ path: `/repos/${name}`, name });
const repos = [repo("a"), repo("b"), repo("c"), repo("d")];

test("默认配置只有 Default 组，未分配仓库页签归入 Default", () => {
  const c = emptyConfig();
  assert.equal(c.groups.length, 1);
  assert.equal(c.groups[0].id, DEFAULT_GROUP_ID);
  assert.deepEqual(c.activeGroupIds, [DEFAULT_GROUP_ID]);
  assert.deepEqual(c.aliases, {});
  assert.equal(groupForRepo(c, "/repos/a"), DEFAULT_GROUP_ID);
  assert.deepEqual(visibleRepos(c, repos).map((r) => r.name), ["a", "b", "c", "d"]);
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

test("多选分组：并集显示、toggle、空集合回落、打开仓库确保可见", () => {
  let c = createGroup(emptyConfig(), "Work");
  const id = c.groups[1].id;
  c = setRepoGroup(c, "/repos/a", id);
  c = toggleActiveGroup(c, id);
  assert.deepEqual(c.activeGroupIds, [DEFAULT_GROUP_ID, id]);
  assert.deepEqual(visibleRepos(c, repos).map((r) => r.name), ["a", "b", "c", "d"], "Default + Work 并集");
  assert.equal(primaryGroupId(c), id, "新打开仓库优先归入非 Default 选中组");
  c = toggleActiveGroup(c, DEFAULT_GROUP_ID);
  assert.deepEqual(c.activeGroupIds, [id]);
  assert.deepEqual(visibleRepos(c, repos).map((r) => r.name), ["a"]);
  c = toggleActiveGroup(c, id);
  assert.deepEqual(c.activeGroupIds, [DEFAULT_GROUP_ID], "至少保留 Default");
  assert.equal(primaryGroupId(c), DEFAULT_GROUP_ID);
  assert.equal(toggleActiveGroup(c, "ghost"), c, "未知组忽略");
  const ensured = ensureGroupActive(setActiveGroups(c, [DEFAULT_GROUP_ID]), id);
  assert.deepEqual(ensured.activeGroupIds, [DEFAULT_GROUP_ID, id], "打开仓库时补选其所在组");
});

test("删除组：仓库页签回落 Default，活动组移除该组，不删除仓库", () => {
  let c = createGroup(emptyConfig(), "Work");
  const id = c.groups[1].id;
  c = setRepoGroup(c, "/repos/a", id);
  c = setActiveGroups(c, [DEFAULT_GROUP_ID, id]);
  c = deleteGroup(c, id);
  assert.equal(c.groups.length, 1);
  assert.deepEqual(c.activeGroupIds, [DEFAULT_GROUP_ID]);
  assert.equal(groupForRepo(c, "/repos/a"), DEFAULT_GROUP_ID);
  assert.equal(deleteGroup(c, DEFAULT_GROUP_ID), c, "Default 不可删除");
});

test("Pin 与拖拽重排：Default 不可 Pin，pinned 顺序写回", () => {
  let c = emptyConfig();
  c = createGroup(c, "A");
  c = createGroup(c, "B");
  c = createGroup(c, "C");
  const [a, b, d] = [c.groups[1].id, c.groups[2].id, c.groups[3].id];
  c = togglePin(c, a);
  c = togglePin(c, b);
  c = togglePin(c, d);
  assert.deepEqual(pinnedGroups(c).map((g) => g.id), [a, b, d]);
  assert.equal(togglePin(c, DEFAULT_GROUP_ID), c, "Default 不可 Pin");
  c = reorderPinned(c, [d, a, b]);
  assert.deepEqual(pinnedGroups(c).map((g) => g.id), [d, a, b]);
  assert.equal(c.groups[0].id, DEFAULT_GROUP_ID, "Default 仍在首位");
  assert.equal(reorderPinned(c, [a, b]), c, "数量不匹配拒绝");
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
  assert.equal(c.groups[0].name, "Default", "Default 强制还原");
  assert.equal(c.groups[0].pinned, false);
  assert.deepEqual(c.groups.map((g) => g.id), [DEFAULT_GROUP_ID, "g1", "g3"], "去重 / 去非法");
  assert.deepEqual(c.assignments, { "/repos/a": "g1" }, "只保留指向存在非 Default 组的记录");
  assert.deepEqual(c.activeGroupIds, ["g1"], "过滤未知组并去重");
  assert.deepEqual(c.aliases, { "/repos/a": "Repo A" }, "只保留非空别名");
  assert.deepEqual(sanitizeConfig({ activeGroupIds: ["ghost"] }).activeGroupIds, [DEFAULT_GROUP_ID], "非法活动组回落");
  assert.deepEqual(sanitizeConfig(null), emptyConfig());
  assert.deepEqual(sanitizeConfig([]), emptyConfig());
});
