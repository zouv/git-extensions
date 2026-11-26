import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const panel = await readFile(new URL("../src/components/RemoteActionPanel.tsx", import.meta.url), "utf8");
const toolbar = await readFile(new URL("../src/components/Toolbar.tsx", import.meta.url), "utf8");
const api = await readFile(new URL("../src/api.ts", import.meta.url), "utf8");

test("Fetch / Pull / Push 面板从工具栏按钮锚定打开", () => {
  assert.match(toolbar, /data-remote-action=\{dataAction\}/);
  assert.match(toolbar, /remoteAnchor\(event\)/);
  assert.match(panel, /props\.anchor\.bottom \+ 6/);
  assert.match(panel, /role="dialog"/);
});

test("确认后在同一面板执行并显示进度，按 operationId 过滤事件", () => {
  assert.match(panel, /api\.fetchWithProgress\(/);
  assert.match(panel, /api\.pullWithProgress\(/);
  assert.match(panel, /api\.pushWithProgress\(/);
  assert.match(panel, /onRemoteProgress\(/);
  assert.match(panel, /progress\.operationId !== activeOperation\.current/);
  assert.match(panel, /Running\. Please wait/);
  assert.match(panel, /remote-panel-track/);
});

test("选项覆盖完整上下文：Fetch 覆盖引用 / 标签，Pull 变基，Push tags / hook / force", () => {
  assert.match(panel, /Force override local refs/);
  assert.match(panel, /Fetch without tags/);
  assert.match(panel, /Use rebase instead of merge/);
  assert.match(panel, /Push all tags/);
  assert.match(panel, /Bypass the pre-push hook/);
  assert.match(panel, /Force push/);
  assert.match(api, /"push_with_progress"/);
  assert.match(api, /noVerify/);
});
