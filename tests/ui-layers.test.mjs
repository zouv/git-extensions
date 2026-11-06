import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

async function loadModule(relative) {
  const source = await readFile(new URL(`../src/${relative}`, import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  return import("data:text/javascript;base64," + Buffer.from(output).toString("base64"));
}

const layers = await loadModule("ui/layerStack.ts");
const dialogs = await loadModule("dialogState.ts");

test("浮层栈只让最后打开的一层处理 Esc / Tab", () => {
  const first = layers.pushLayer();
  const second = layers.pushLayer();
  assert.equal(layers.isTopLayer(first), false);
  assert.equal(layers.isTopLayer(second), true);
  layers.popLayer(second);
  assert.equal(layers.isTopLayer(first), true);
  layers.popLayer(first);
  assert.equal(layers.isTopLayer(first), false);
});

test("重复弹出 / 弹出未知 token 不会破坏栈顺序", () => {
  const first = layers.pushLayer();
  const second = layers.pushLayer();
  layers.popLayer(second);
  layers.popLayer(second);
  assert.equal(layers.isTopLayer(first), true);
  layers.popLayer(first);
});

test("弹窗 dirty 登记只统计仍然挂载的弹窗", () => {
  const token = Symbol("dialog");
  assert.equal(dialogs.hasDirtyDialogs(), false);
  dialogs.addDirtyDialog(token);
  assert.equal(dialogs.hasDirtyDialogs(), true);
  dialogs.removeDirtyDialog(token);
  assert.equal(dialogs.hasDirtyDialogs(), false);
});
