import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const dialog = await readFile(new URL("../src/components/StatisticsDialog.tsx", import.meta.url), "utf8");
const toolbar = await readFile(new URL("../src/components/Toolbar.tsx", import.meta.url), "utf8");

test("Statistics 对话框包含总览 / 月 / 周切换与作者筛选", () => {
  assert.match(dialog, /OVERVIEW/);
  assert.match(dialog, /MONTH/);
  assert.match(dialog, /WEEK/);
  assert.match(dialog, /api\.getStatistics\(repoPath/);
  assert.match(dialog, /setAuthor\(entry\.key\)/);
  assert.match(dialog, /AUTHORS:/);
  assert.match(dialog, /COMMITS:/);
  assert.match(dialog, /niceScale\(/);
});

test("Statistics 按钮位于设置按钮左侧", () => {
  const statistics = toolbar.indexOf('icon="statistics"');
  const settings = toolbar.indexOf('icon="settings" title="设置与快捷键');
  assert.ok(statistics > 0);
  assert.ok(settings > statistics);
});

test("工具栏顺序：导航开关 → 菜单 → 分支 + 刷新 → 远程 → 恢复 / Stash / 标签 / 子模块", () => {
  const toggle = toolbar.indexOf('icon="menu" title="显示 / 隐藏导航');
  const menu = toolbar.indexOf('label="仓库"');
  const branch = toolbar.indexOf('className="branch-switch"');
  const refresh = toolbar.indexOf('title="刷新当前仓库');
  const fetch = toolbar.indexOf('dataAction="fetch"');
  const push = toolbar.indexOf('dataAction="push"');
  const recovery = toolbar.indexOf('title="恢复历史');
  const submodule = toolbar.indexOf('title="子模块 (Ctrl+Shift+M)"');
  assert.ok(toggle > 0 && toggle < menu);
  assert.ok(menu < branch && branch < refresh && refresh < fetch && fetch < push);
  assert.ok(push < recovery && recovery < submodule);
  assert.match(toolbar, /icon="submodule"/);
});
