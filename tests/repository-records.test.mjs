import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const transpile = (source) => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const dataUrl = (source) => "data:text/javascript;base64," + Buffer.from(source).toString("base64");
const groupsUrl = dataUrl(transpile(await readFile(new URL("../src/repoGroups.ts", import.meta.url), "utf8")));
const recordsSource = transpile(await readFile(new URL("../src/repositoryRecords.ts", import.meta.url), "utf8"));
const {
  sanitizeRepositoryRecords, loadRepositoryRecords, saveRepositoryRecords, recordRepository,
  removeRepositoryRecords, relocateRepositoryRecord, repositoryName, filterRepositoryRecords,
} = await import(dataUrl(recordsSource.replaceAll('"./repoGroups"', JSON.stringify(groupsUrl))));
const { emptyConfig, sanitizeConfig, setRepoAlias, setRepoGroup, deleteGroup, relocateRepoConfig } = await import(groupsUrl);

const record = (path, name, lastOpenedAt = 0) => ({ path, name, lastOpenedAt });
const c = () => sanitizeConfig({
  groups: [{ id: "work", name: "Client Work" }, { id: "home", name: "Personal" }],
  assignments: { "/repos/a": "work", "/repos/b": "home" }, aliases: { "/repos/a": "前端 Frontend" },
});

function withStorage(values, action) {
  const original = globalThis.localStorage;
  const map = new Map(Object.entries(values));
  let writes = 0;
  globalThis.localStorage = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { writes++; map.set(key, value); },
  };
  try { action(map, () => writes); } finally {
    if (original === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = original;
  }
}

test("记录白名单：路径 trim 精确去重，末段名称回落，只存三个字段", () => {
  const input = [null, "bad", [], {}, { path: " " },
    { path: " /repos/a ", name: " A ", lastOpenedAt: 10, status: "dirty", alias: "not stored", groupId: "work" },
    { path: "/repos/a", name: "Old", lastOpenedAt: 5 },
    { path: "/repos/A", name: " ", lastOpenedAt: -1 },
    { path: "C:\\path\\to\\project\\", lastOpenedAt: Infinity },
    { path: "/repos/b", name: 42, lastOpenedAt: "today" },
  ];
  assert.deepEqual(sanitizeRepositoryRecords(input), [
    record("/repos/a", "A", 10), record("/repos/A", "A"),
    record("C:\\path\\to\\project\\", "project"), record("/repos/b", "b"),
  ]);
  assert.deepEqual(sanitizeRepositoryRecords({ records: input }), []);
  assert.deepEqual(sanitizeRepositoryRecords(null), []);
});

test("持久记录不受打开32/最近12上限影响", () => {
  const records = Array.from({ length: 150 }, (_, i) => record(`/repos/repo-${i}`, `Repo ${i}`, i));
  assert.equal(sanitizeRepositoryRecords(records).length, 150);
  withStorage({}, () => { saveRepositoryRecords(records); assert.deepEqual(loadRepositoryRecords(), records); });
});

test("首次迁移 raw v1 未知组与别名路径、打开/最近/last 与 sources，并且不预写", () => {
  withStorage({
    "git-extensions.repoGroups.v1": JSON.stringify({
      assignments: { " /repos/a ": "work", "/repos/closed": "ghost", "/repos/default": "default" },
      aliases: { "/repos/alias-only": "Known alias" },
    }),
    "git-extensions.openRepos.v1": JSON.stringify(["/repos/a", "/repos/open", " ", 42]),
    "git-extensions.recentRepos.v2": JSON.stringify(["/repos/recent", "/repos/closed"]),
    "git-extensions.lastRepo": "/repos/last",
  }, (map, writes) => {
    const migrated = loadRepositoryRecords({ openPaths: ["/repos/new-open"], recentPaths: ["/repos/new-recent"], groupConfig: c() });
    assert.deepEqual(migrated.map((r) => r.path), [
      "/repos/a", "/repos/closed", "/repos/default", "/repos/alias-only", "/repos/b",
      "/repos/open", "/repos/recent", "/repos/new-open", "/repos/new-recent", "/repos/last",
    ]);
    assert.equal(migrated.find((r) => r.path === "/repos/alias-only").name, "alias-only", "不复制别名到原名");
    assert.ok(migrated.every((r) => r.lastOpenedAt === 0));
    assert.equal(writes(), 0);
    assert.equal(map.has("git-extensions.repositoryRecords.v1"), false);
    saveRepositoryRecords(migrated);
    assert.equal(writes(), 1);
    assert.ok(map.has("git-extensions.repoGroups.v1"), "不删旧键");
    const remaining = removeRepositoryRecords(migrated, ["/repos/closed"]);
    saveRepositoryRecords(remaining);
    assert.deepEqual(loadRepositoryRecords({ openPaths: ["/repos/closed"], groupConfig: c() }), remaining, "新键后不重复迁移");
  });
});

test("新记录键存在含 [] 或损坏时都不复活旧映射", () => {
  for (const stored of ["[]", "bad json", "null", "{}"] ) {
    withStorage({ "git-extensions.repositoryRecords.v1": stored,
      "git-extensions.repoGroups.v1": JSON.stringify({ aliases: { "/repos/removed": "Removed" } }),
    }, (_, writes) => {
      assert.deepEqual(loadRepositoryRecords({ openPaths: ["/repos/open"], recentPaths: ["/repos/recent"], groupConfig: c() }), []);
      assert.equal(writes(), 0);
    });
  }
});

test("迁移脏输入和 localStorage 不可用不抛异常，sources 仍可初始化", () => {
  withStorage({ "git-extensions.repoGroups.v1": "bad", "git-extensions.openRepos.v1": "{}", "git-extensions.recentRepos.v2": "null" }, () => {
    assert.deepEqual(loadRepositoryRecords(), []);
  });
  const original = globalThis.localStorage;
  globalThis.localStorage = { getItem() { throw Error("blocked"); }, setItem() { throw Error("full"); } };
  try {
    assert.deepEqual(loadRepositoryRecords({ openPaths: ["/repos/a"] }), [record("/repos/a", "a")]);
    assert.doesNotThrow(() => saveRepositoryRecords([record("/repos/a", "a")]));
  } finally { if (original === undefined) delete globalThis.localStorage; else globalThis.localStorage = original; }
});

test("登记与打开更新时间，关闭页签后记录保留，重开不重复", () => {
  const originalNow = Date.now;
  Date.now = () => 1000;
  try {
    let records = recordRepository([], { path: " /repos/a ", name: " Name " }, false);
    assert.deepEqual(records, [record("/repos/a", "Name")]);
    records = recordRepository(records, { path: "/repos/a", name: "New Name" });
    assert.deepEqual(records, [record("/repos/a", "New Name", 1000)]);
    assert.deepEqual(filterRepositoryRecords(records, c(), "", { openPaths: [] }), [], "关闭仅改变 openPaths");
    withStorage({}, () => { saveRepositoryRecords(records); assert.deepEqual(loadRepositoryRecords(), records); });
    Date.now = () => 2000;
    records = recordRepository(records, { path: "/repos/a", name: "Again" });
    assert.deepEqual(records, [record("/repos/a", "Again", 2000)]);
    Date.now = () => 1;
    assert.equal(recordRepository(records, { path: "/repos/a", name: "Again" })[0].lastOpenedAt, 2000, "时钟回拨不降时间");
    assert.equal(recordRepository(records, { path: " ", name: "bad" }), records);
    assert.deepEqual(recordRepository(records, { path: "/repos/a", name: "" }, false), [record("/repos/a", "a", 2000)]);
    assert.deepEqual(records, [record("/repos/a", "Again", 2000)], "输入不变");
  } finally { Date.now = originalNow; }
});

test("移除仅删除精确匹配的持久记录，不删磁盘、不自动更改归组别名", () => {
  const config = c();
  const records = [record("/repos/a", "A"), record("/repos/A", "Case"), record("/repos/b", "B")];
  assert.deepEqual(removeRepositoryRecords(records, [" /repos/a ", "/repos/a", "ghost"]), records.slice(1));
  assert.equal(config.aliases["/repos/a"], "前端 Frontend");
  assert.equal(config.assignments["/repos/a"], "work");
  assert.equal(records.length, 3);
});

test("别名事实源与搜索：别名/原名/path/组名、归组/open交集、本地大小写不敏感", () => {
  const records = [record("/repos/a", "Original Alpha"), record("/repos/b", "Beta"), record("/repos/closed", "Closed")];
  const config = c();
  assert.equal(repositoryName(records[0], config), "前端 Frontend");
  assert.equal(repositoryName(records[2], config), "Closed");
  const paths = (query, options) => filterRepositoryRecords(records, config, query, options).map((r) => r.path);
  for (const query of ["前端", " frontend ", "ALPHA", "/REPOS/A", "Client Work"]) assert.deepEqual(paths(query), ["/repos/a"]);
  assert.deepEqual(paths("personal"), ["/repos/b"]);
  assert.deepEqual(paths("未分组"), ["/repos/closed"]);
  assert.deepEqual(paths("", { groupId: "work" }), ["/repos/a"]);
  assert.deepEqual(paths("", { groupId: "ghost" }), []);
  assert.deepEqual(paths("", { openPaths: [" /repos/a ", "/repos/b"] }), ["/repos/a", "/repos/b"]);
  assert.deepEqual(paths("", { groupId: "work", openPaths: ["/repos/b"] }), []);
  assert.deepEqual(paths("not found"), []);
  assert.deepEqual(filterRepositoryRecords(records, setRepoGroup(config, "/repos/closed", "work"), "client").map((r) => r.path), ["/repos/a", "/repos/closed"]);
  assert.equal(repositoryName(records[0], setRepoAlias(config, "/repos/a", "")), "Original Alpha");
  assert.equal(records[0].name, "Original Alpha", "改别名与组都不复制进记录");
  assert.deepEqual(filterRepositoryRecords(records, deleteGroup(config, "work"), "未分组").map((r) => r.path), ["/repos/a", "/repos/closed"]);
});

test("重新定位保留时间/顺序，目标冲突合并为一条，新原名优先", () => {
  const records = [record("/repos/b", "B", 20), record("/repos/a", "A", 50), record("/repos/new", "Old target", 70)];
  assert.deepEqual(relocateRepositoryRecord(records, "/repos/a", { path: " /repos/A ", name: " Relocated " }),
    [records[0], record("/repos/A", "Relocated", 50), records[2]]);
  assert.deepEqual(relocateRepositoryRecord(records, "/repos/a", { path: "/repos/new", name: "New target" }),
    [records[0], record("/repos/new", "New target", 70)]);
  assert.deepEqual(relocateRepositoryRecord(records, "/repos/new", { path: "/repos/a", name: "Merged" }),
    [records[0], record("/repos/a", "Merged", 70)]);
  assert.deepEqual(relocateRepositoryRecord(records, "/repos/missing", { path: "/repos/added", name: "" }).at(-1), record("/repos/added", "added"));
  assert.equal(relocateRepositoryRecord(records, "", { path: "/repos/new", name: "Bad" }), records);
  assert.equal(relocateRepositoryRecord(records, "/repos/a", { path: " ", name: "Bad" }), records);
  const config = relocateRepoConfig(c(), "/repos/a", "/repos/new");
  const relocated = relocateRepositoryRecord(records, "/repos/a", { path: "/repos/new", name: "Actual name" });
  assert.equal(repositoryName(relocated[1], config), "前端 Frontend");
  assert.equal(relocated[1].name, "Actual name");
  assert.equal(records.length, 3);
  assert.equal(records[1].path, "/repos/a");
});
