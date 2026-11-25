import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/repoIdentity.ts", import.meta.url), "utf8");
const url = "data:text/javascript;base64," + Buffer.from(ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText).toString("base64");
const { abbreviation, avatarTextColor, repoAvatarColor, disambiguateLabels } = await import(url);

test("仓库缩写：英文取词首 / 驼峰，中文取前 2 字，空值回落 ?", () => {
  assert.equal(abbreviation("git-extensions"), "GE");
  assert.equal(abbreviation("myRepo"), "MR");
  assert.equal(abbreviation("api"), "AP");
  assert.equal(abbreviation("前端仓库"), "前端");
  assert.equal(abbreviation("a"), "A");
  assert.equal(abbreviation(""), "?");
  assert.equal(abbreviation("🚀"), "?");
  assert.equal(abbreviation("  my repo  "), "MR");
});

test("文字对比色按背景亮度选择", () => {
  assert.equal(avatarTextColor("#3f6fbf"), "#fff");
  assert.equal(avatarTextColor("#ffe066"), "#11151b");
  assert.equal(avatarTextColor("not-a-color"), "#fff");
});

test("仓库身份色稳定：大小写、分隔符与末尾斜杠不改变颜色", () => {
  const color = repoAvatarColor("C:\\Work\\Project");
  assert.equal(color, repoAvatarColor("c:/work/project/"));
  assert.equal(color, repoAvatarColor("C:/WORK/PROJECT"));
  assert.match(color, /^#[0-9a-f]{6}$/);
});

test("同名页签追加父目录后缀，仍重复时继续向上一层", () => {
  const repos = [
    { path: "/work/client/frontend" },
    { path: "/work/admin/frontend" },
    { path: "/work/other/unique" },
  ];
  const labels = disambiguateLabels(repos, (repo) => repo.path.split("/").pop());
  assert.equal(labels["/work/client/frontend"], "frontend（client）");
  assert.equal(labels["/work/admin/frontend"], "frontend（admin）");
  assert.equal(labels["/work/other/unique"], "unique");
});

test("父目录也同名时继续扩展路径，直到后缀可区分", () => {
  const repos = [
    { path: "/a/frontend" },
    { path: "/b/frontend" },
  ];
  const labels = disambiguateLabels(repos, (repo) => repo.path.split("/").pop());
  assert.equal(labels["/a/frontend"], "frontend（a）");
  assert.equal(labels["/b/frontend"], "frontend（b）");
});
