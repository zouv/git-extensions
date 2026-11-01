import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/tagGroups.ts", import.meta.url), "utf8");
const url = "data:text/javascript;base64," + Buffer.from(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText).toString("base64");
const {
  DEFAULT_GROUP_ID, emptyConfig, sanitizeConfig, groupForTag, visibleTags, tagsInGroup,
  setActiveGroup, setTagGroup, createGroup, renameGroup, deleteGroup, togglePin,
  pinnedGroups, reorderPinned,
} = await import(url);

const tag = (name) => ({ name, oid: "0".repeat(40), subject: "" });
const tags = [tag("v1"), tag("v2"), tag("v3"), tag("v4")];

test("默认配置只有 Default 组，未分配标签归入 Default", () => {
  const c = emptyConfig();
  assert.equal(c.groups.length, 1);
  assert.equal(c.groups[0].id, DEFAULT_GROUP_ID);
  assert.equal(c.activeGroupId, DEFAULT_GROUP_ID);
  assert.equal(groupForTag(c, "v1"), DEFAULT_GROUP_ID);
  assert.deepEqual(visibleTags(c, tags).map((t) => t.name), ["v1", "v2", "v3", "v4"]);
});

test("新建 / 重命名组：空名与重名被拒绝，Default 不可改名", () => {
  let c = emptyConfig();
  c = createGroup(c, "Release");
  assert.equal(c.groups.length, 2);
  const id = c.groups[1].id;
  assert.equal(createGroup(c, "release"), c, "重名（大小写不敏感）拒绝");
  assert.equal(createGroup(c, "   "), c, "空名拒绝");
  c = renameGroup(c, id, "Stable");
  assert.equal(c.groups[1].name, "Stable");
  assert.equal(renameGroup(c, DEFAULT_GROUP_ID, "X"), c, "Default 不可改名");
  assert.equal(renameGroup(c, id, "default"), c, "不能改成 Default 重名");
});

test("标签分配与按组过滤", () => {
  let c = createGroup(emptyConfig(), "Release");
  const id = c.groups[1].id;
  c = setTagGroup(c, "v1", id);
  c = setTagGroup(c, "v2", id);
  c = setTagGroup(c, "v3", DEFAULT_GROUP_ID);
  assert.equal(groupForTag(c, "v1"), id);
  assert.equal(groupForTag(c, "v3"), DEFAULT_GROUP_ID);
  assert.deepEqual(tagsInGroup(c, tags, id).map((t) => t.name), ["v1", "v2"]);
  assert.deepEqual(tagsInGroup(c, tags, DEFAULT_GROUP_ID).map((t) => t.name), ["v3", "v4"]);
  c = setActiveGroup(c, id);
  assert.deepEqual(visibleTags(c, tags).map((t) => t.name), ["v1", "v2"]);
  // 移回 Default 即清除记录
  c = setTagGroup(c, "v1", DEFAULT_GROUP_ID);
  assert.equal(c.assignments.v1, undefined);
});

test("删除组：组内标签回落 Default，活动组重置", () => {
  let c = createGroup(emptyConfig(), "Release");
  const id = c.groups[1].id;
  c = setTagGroup(c, "v1", id);
  c = setActiveGroup(c, id);
  c = deleteGroup(c, id, true);
  assert.equal(c.groups.length, 1);
  assert.equal(c.activeGroupId, DEFAULT_GROUP_ID);
  assert.equal(groupForTag(c, "v1"), DEFAULT_GROUP_ID);
  assert.equal(deleteGroup(c, DEFAULT_GROUP_ID, true), c, "Default 不可删除");
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
  // 拖拽：把 C 移到最前
  c = reorderPinned(c, [d, a, b]);
  assert.deepEqual(pinnedGroups(c).map((g) => g.id), [d, a, b]);
  // 非 pinned 组保持位置（Default 仍在首位）
  assert.equal(c.groups[0].id, DEFAULT_GROUP_ID);
  assert.equal(reorderPinned(c, [a, b]), c, "数量不匹配拒绝");
  assert.equal(reorderPinned(c, [d, a, "nope"]), c, "未知 id 拒绝");
});

test("localStorage 脏数据白名单校验", () => {
  const dirty = {
    groups: [
      { id: DEFAULT_GROUP_ID, name: "Hacked", pinned: true },
      { id: "g1", name: "Release", pinned: true },
      { id: "g1", name: "Dup" },
      { id: "", name: "NoId" },
      { id: "g2", name: "  " },
      "garbage",
      { id: "g3", name: "Valid" },
    ],
    assignments: { v1: "g1", v2: "ghost", v3: DEFAULT_GROUP_ID, v4: 42 },
    activeGroupId: "ghost",
  };
  const c = sanitizeConfig(dirty);
  assert.equal(c.groups[0].id, DEFAULT_GROUP_ID);
  assert.equal(c.groups[0].name, "Default", "Default 强制还原");
  assert.equal(c.groups[0].pinned, false);
  assert.deepEqual(c.groups.map((g) => g.id), [DEFAULT_GROUP_ID, "g1", "g3"], "去重 / 去非法");
  assert.deepEqual(c.assignments, { v1: "g1" }, "只保留指向存在非 Default 组的记录");
  assert.equal(c.activeGroupId, DEFAULT_GROUP_ID, "非法活动组回落");
  assert.deepEqual(sanitizeConfig(null), emptyConfig());
  assert.deepEqual(sanitizeConfig("x"), emptyConfig());
});
