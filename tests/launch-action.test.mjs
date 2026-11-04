import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";

const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../src/launchAction.ts", import.meta.url), "utf8"));
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { workspaceAction, workspaceLaunch } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

test("App 动作不会误投递到工作区", () => {
  for (const action of ["clone", "create-repository", "open-repository", "settings"]) assert.equal(workspaceAction(action), null);
});

test("全部资源管理器仓库动作保持名称并只绑定实际仓库根目录", () => {
  const actions = ["commit", "pull", "push", "view-stash", "view-changes", "checkout-branch", "checkout-revision", "create-branch", "open-with-difftool", "file-history", "reset-file-changes", "add-files", "apply-patch"];
  for (const action of actions) {
    assert.equal(workspaceAction(action), action);
    assert.deepEqual(workspaceLaunch({ action, path: "C:\\selected\\child" }, "C:\\repository", 7), { id: 7, path: "C:\\repository", action });
  }
});

test("缺失路径的请求不会创建工作区动作", () => {
  assert.equal(workspaceLaunch({ action: "pull", path: null }, "C:\\repository", 1), null);
});
