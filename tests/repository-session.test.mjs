import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/repositorySession.ts", import.meta.url), "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { closeBlockedPaths, canonicalActivePath, newRepositoryGroup } = await import(
  "data:text/javascript;base64," + Buffer.from(transpiled).toString("base64")
);

// 确认取消时是否调用转换由 App 控制；这里只验证正式纯函数，不模拟取消流程。
test("关闭复核：混合 dirty 集合仅授权原先确认的路径，新 dirty 仍被拒绝", () => {
  const paths = ["/repos/approved", "/repos/new-dirty", "/repos/clean", "/repos/other-dirty"];
  const meta = {
    "/repos/approved": { dirty: true },
    "/repos/new-dirty": { dirty: true },
    "/repos/clean": { dirty: false },
    "/repos/other-dirty": { dirty: true },
  };
  assert.deepEqual(closeBlockedPaths(paths, meta, () => false, new Set(["/repos/approved"])), [
    "/repos/new-dirty", "/repos/other-dirty",
  ]);
  assert.deepEqual(closeBlockedPaths(paths, meta, () => false, new Set()), [
    "/repos/approved", "/repos/new-dirty", "/repos/other-dirty",
  ]);
});

test("关闭复核：meta busy 和同步写操作 provider 都阻止关闭，即使 dirty 已授权", () => {
  const paths = ["/repos/meta-busy", "/repos/provider-busy", "/repos/no-meta", "/repos/approved"];
  const meta = {
    "/repos/meta-busy": { busy: true, dirty: true },
    "/repos/provider-busy": { busy: false, dirty: true },
    "/repos/approved": { dirty: true },
  };
  const writing = new Set(["/repos/provider-busy", "/repos/no-meta"]);
  assert.deepEqual(closeBlockedPaths(paths, meta, (path) => writing.has(path), new Set(paths)), [
    "/repos/meta-busy", "/repos/provider-busy", "/repos/no-meta",
  ]);
  writing.clear();
  assert.deepEqual(closeBlockedPaths(paths, meta, (path) => writing.has(path), new Set(paths)), [
    "/repos/meta-busy",
  ], "每次查询 provider 的同步状态，不缓存上次写状态");
});

test("关闭复核：clean、未知 meta 和空列表均可关闭，只检查目标列表", () => {
  const meta = {
    "/repos/clean": { busy: false, dirty: false },
    "/repos/empty": {},
    "/repos/not-targeted": { busy: true, dirty: true },
  };
  assert.deepEqual(closeBlockedPaths(["/repos/clean", "/repos/empty", "/repos/unknown"], meta, () => false, new Set()), []);
  assert.deepEqual(closeBlockedPaths([], meta, () => { throw Error("空列表不查询 provider"); }, new Set()), []);
});

test("关闭复核不修改路径、meta 或授权集合，并保持阻止路径的输入顺序", () => {
  const paths = Object.freeze(["/repos/b", "/repos/a"]);
  const meta = Object.freeze({
    "/repos/b": Object.freeze({ dirty: true }),
    "/repos/a": Object.freeze({ busy: true }),
  });
  const approved = new Set(["/repos/unrelated"]);
  assert.deepEqual(closeBlockedPaths(paths, meta, () => false, approved), ["/repos/b", "/repos/a"]);
  assert.deepEqual([...approved], ["/repos/unrelated"]);
  assert.deepEqual(paths, ["/repos/b", "/repos/a"]);
});

test("活动路径：last 映射后存在则优先，未映射的有效 last 同样保留", () => {
  const paths = Object.freeze(["/repos/first", "/repos/canonical"]);
  const mapping = new Map([["/repos/alias", "/repos/canonical"]]);
  assert.equal(canonicalActivePath(paths, "/repos/alias", mapping), "/repos/canonical");
  assert.equal(canonicalActivePath(paths, "/repos/canonical", mapping), "/repos/canonical");
  assert.deepEqual([...mapping], [["/repos/alias", "/repos/canonical"]]);
});

test("活动路径：映射结果不在列表或 last 缺失时回落首项，空列表返回 null", () => {
  const paths = ["/repos/first", "/repos/old"];
  const mapping = new Map([["/repos/old", "/repos/missing"]]);
  assert.equal(canonicalActivePath(paths, "/repos/old", mapping), "/repos/first", "有映射时不再保留旧路径");
  assert.equal(canonicalActivePath(paths, "/repos/missing", new Map()), "/repos/first");
  assert.equal(canonicalActivePath(paths, null, mapping), "/repos/first");
  assert.equal(canonicalActivePath([], "/repos/old", mapping), null);
  assert.equal(canonicalActivePath([], null, new Map()), null);
});

test("新仓库归组：单组使用当前组，全量和组合使用 default", () => {
  assert.equal(newRepositoryGroup({ view: { kind: "group", groupId: "work" } }), "work");
  assert.equal(newRepositoryGroup({ view: { kind: "group", groupId: "default" } }), "default");
  assert.equal(newRepositoryGroup({ view: { kind: "all-open" } }), "default");
  assert.equal(newRepositoryGroup({ view: { kind: "combined", groupIds: ["work", "home"] } }), "default");
  assert.equal(newRepositoryGroup({ view: { kind: "combined", groupIds: ["work"] } }), "default", "显式组合不自动视为单组");
});

test("新仓库归组：锚点优先于单组、全量或组合，不修改 config", () => {
  for (const view of [
    Object.freeze({ kind: "group", groupId: "work" }),
    Object.freeze({ kind: "all-open" }),
    Object.freeze({ kind: "combined", groupIds: Object.freeze(["work", "home"]) }),
  ]) {
    const config = Object.freeze({ view });
    assert.equal(newRepositoryGroup(config, "anchor"), "anchor");
    assert.equal(newRepositoryGroup(config, "default"), "default");
    assert.equal(config.view, view);
  }
});
