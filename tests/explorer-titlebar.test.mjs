import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const component = await readFile(new URL("../src/explorer/PortableTitleBar.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

test("轻量标题栏空白区域可拖动，窗口控制按钮不参与拖动", () => {
  assert.match(component, /<header[^>]*className="title-bar portable-title-bar"[^>]*data-tauri-drag-region="deep"/);
  for (const element of ["portable-title-icon", "portable-title-label", "portable-title-detail"]) {
    assert.match(component, new RegExp(`className="${element}"[^>]*data-tauri-drag-region`));
  }
  assert.match(component, /<div className="title-window-controls" data-tauri-drag-region="false">/);
  assert.equal((component.match(/data-tauri-drag-region="false"/g) ?? []).length, 4);
});

test("标题栏图标直接复用 Explorer 菜单图标，不再使用近似字形", () => {
  assert.match(component, /api\.getExplorerActionIcon\(action\)/);
  assert.match(component, /<img src=\{icon\} width=\{16\} height=\{16\}/);
  assert.doesNotMatch(component, /ACTION_ICONS|from "\.\.\/ui\/Icon"/);
});

test("图标与文字统一 16px 高度和居中对齐", () => {
  assert.match(styles, /\.portable-title-bar \{[^}]*align-items: center/);
  assert.match(styles, /\.portable-title-icon \{[^}]*width: 16px;[^}]*height: 16px/);
  assert.match(styles, /\.portable-title-label \{[^}]*display: flex;[^}]*align-items: center;[^}]*height: 100%/);
  assert.match(styles, /\.portable-title-detail \{[^}]*display: flex;[^}]*align-items: center;[^}]*height: 100%/);
});
