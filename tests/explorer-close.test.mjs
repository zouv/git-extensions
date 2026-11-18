import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

// 用正式源码的转译结果 + Tauri 窗口桩验证轻量窗口关闭路径。
const calls = [];
globalThis.__portableCloseCalls = calls;

async function loadWith(stubSource) {
  const stubUrl = "data:text/javascript;base64," + Buffer.from(`
    const calls = globalThis.__portableCloseCalls;
    ${stubSource}
  `).toString("base64");
  const reactUrl = "data:text/javascript;base64," + Buffer.from(`
    export const useEffect = () => {};
    export const useRef = (value) => ({ current: value });
  `).toString("base64");
  const source = (await readFile(new URL("../src/explorer/portableWindow.ts", import.meta.url), "utf8"))
    .replaceAll('"@tauri-apps/api/window"', JSON.stringify(stubUrl))
    .replaceAll('"react"', JSON.stringify(reactUrl));
  return import("data:text/javascript;base64," + Buffer.from(ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText).toString("base64"));
}

const { closeCurrentWindow } = await loadWith(`
  export function getCurrentWindow() {
    return {
      close: async () => { calls.push("close"); },
      destroy: async () => { calls.push("destroy"); },
      onCloseRequested: async () => { calls.push("listen"); return () => {}; },
    };
  }
`);

test("正常关闭走 close()，保留 busy / dirty 守卫", async () => {
  calls.length = 0;
  await closeCurrentWindow();
  assert.deepEqual(calls, ["close"]);
});

test("程序性强制关闭走 destroy()，绕过会阻止关闭的守卫", async () => {
  calls.length = 0;
  await closeCurrentWindow(true);
  assert.deepEqual(calls, ["destroy"]);
});

test("重复关闭或窗口已销毁时不抛出异常", async () => {
  const { closeCurrentWindow: failingClose } = await loadWith(`
    export function getCurrentWindow() {
      return {
        close: async () => { throw new Error("closed"); },
        destroy: async () => { throw new Error("closed"); },
      };
    }
  `);
  await assert.doesNotReject(failingClose());
  await assert.doesNotReject(failingClose(true));
});
