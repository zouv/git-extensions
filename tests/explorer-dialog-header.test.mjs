import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
const explorer = await readFile(new URL("../src/explorer/ExplorerWindow.tsx", import.meta.url), "utf8");

test("轻量窗口全局隐藏界面内 Dialog 标题栏与 X 按钮", () => {
  assert.match(styles, /body\.portable-window \.modal-header \{ display: none; \}/);
  assert.match(styles, /body\.portable-window \.modal-header \+ \.modal-body \{ flex: 1; min-height: 0; \}/);
  assert.match(explorer, /document\.body\.classList\.add\("portable-window"\)/);
  assert.match(explorer, /return \(\) => document\.body\.classList\.remove\("portable-window"\)/);
});
