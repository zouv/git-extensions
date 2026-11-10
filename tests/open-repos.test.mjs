import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/openRepos.ts", import.meta.url), "utf8");
const url = "data:text/javascript;base64," + Buffer.from(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText).toString("base64");
const {
  OPEN_REPOS_KEY, MAX_OPEN_REPOS, MAX_RECENT_REPOS, sanitizeRecentRepos, sanitizeOpenRepos, parseOpenRepos,
  loadOpenRepos, saveOpenRepos, restoreCandidates, pickActivePath,
} = await import(url);

const memoryStorage = () => {
  const store = new Map();
  return {
    getItem: (key) => store.has(key) ? store.get(key) : null,
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: (key) => { store.delete(key); },
  };
};

test("清洗上次打开列表：去空白、去重、保序、过滤非字符串", () => {
  assert.deepEqual(sanitizeOpenRepos([" b ", "a", "b", "", 1, null, "a"]), ["b", "a"]);
  assert.deepEqual(sanitizeOpenRepos("not array"), []);
  assert.deepEqual(sanitizeOpenRepos(undefined), []);
});

test("打开列表超过上限时截断", () => {
  const paths = Array.from({ length: 40 }, (_, index) => `/repos/${index}`);
  const result = sanitizeOpenRepos(paths);
  assert.equal(result.length, MAX_OPEN_REPOS);
  assert.deepEqual(result, paths.slice(0, MAX_OPEN_REPOS));
});

test("最近打开列表过滤空路径 / 重复项并截断", () => {
  assert.deepEqual(sanitizeRecentRepos([" /a ", "", "   ", "/a", 1, null, "/b"]), ["/a", "/b"]);
  const paths = Array.from({ length: 20 }, (_, index) => `/repos/${index}`);
  assert.equal(sanitizeRecentRepos(paths).length, MAX_RECENT_REPOS);
  assert.deepEqual(sanitizeRecentRepos("not array"), []);
});

test("键缺失与显式空列表语义不同", () => {
  assert.equal(parseOpenRepos(null), null);
  assert.deepEqual(parseOpenRepos("[]"), []);
  assert.deepEqual(parseOpenRepos('["a",1,"a",""]'), ["a"]);
  assert.equal(parseOpenRepos("not json"), null);
  assert.equal(parseOpenRepos('{"a":1}'), null);
});

test("恢复候选：新键存在时优先，键缺失才回退上次活动仓库", () => {
  assert.deepEqual(restoreCandidates([], "/repos/last"), []);
  assert.deepEqual(restoreCandidates(["/repos/a"], "/repos/last"), ["/repos/a"]);
  assert.deepEqual(restoreCandidates(null, "/repos/last"), ["/repos/last"]);
  assert.deepEqual(restoreCandidates(null, "  "), []);
  assert.deepEqual(restoreCandidates(null, null), []);
});

test("活动页签：上次活动仍在恢复结果中则沿用，否则取第一个", () => {
  assert.equal(pickActivePath(["/a", "/b"], "/b"), "/b");
  assert.equal(pickActivePath(["/a", "/b"], "/c"), "/a");
  assert.equal(pickActivePath(["/a"], null), "/a");
  assert.equal(pickActivePath([], "/a"), null);
});

test("保存与读取往返一致，损坏内容按缺失回退", () => {
  const hadStorage = "localStorage" in globalThis;
  const original = globalThis.localStorage;
  globalThis.localStorage = memoryStorage();
  try {
    assert.equal(loadOpenRepos(), null);
    saveOpenRepos(["/a", " /b ", "/a"]);
    assert.deepEqual(JSON.parse(globalThis.localStorage.getItem(OPEN_REPOS_KEY)), ["/a", "/b"]);
    assert.deepEqual(loadOpenRepos(), ["/a", "/b"]);
    saveOpenRepos([]);
    assert.deepEqual(loadOpenRepos(), []);
    globalThis.localStorage.setItem(OPEN_REPOS_KEY, "broken");
    assert.equal(loadOpenRepos(), null);
  } finally {
    if (hadStorage) globalThis.localStorage = original;
    else delete globalThis.localStorage;
  }
});
