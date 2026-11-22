import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const changesPanel = await read("../src/components/ChangesPanel.tsx");
const pushDialog = await read("../src/components/PushDialog.tsx");
const commitContent = await read("../src/components/CommitContentDialog.tsx");
const diffView = await read("../src/components/DiffView.tsx");
const ignoreDialog = await read("../src/explorer/IgnorePathDialog.tsx");
const styles = await read("../src/styles.css");
const cli = await read("../src-tauri/src/git/cli.rs");
const commands = await read("../src-tauri/src/git/commands.rs");
const lib = await read("../src-tauri/src/lib.rs");

test("变更面板右键接入 ignore 弹窗（文件与目录树节点）并支持还原更改", () => {
  assert.match(changesPanel, /import IgnorePathDialog from "\.\.\/explorer\/IgnorePathDialog"/);
  assert.match(changesPanel, /setIgnoreTarget\(\{ relativePath: menu\.entry\.path, scope: "file" \}\)/);
  assert.match(changesPanel, /setIgnoreTarget\(\{ relativePath: menu\.dir, scope: "directory" \}\)/);
  assert.match(changesPanel, /initialPattern: `\*\.\$\{menu\.entry\.path\.split\("\."\)\.pop\(\)\}`/);
  assert.match(changesPanel, /api\.resetChanges\(repoPath, paths, deleteNew\)/);
  assert.match(changesPanel, /label: "还原更改…", danger: true/);
  assert.match(changesPanel, /onChanged=\{\(\) => props\.onRefresh\(\)\}/);
  assert.match(ignoreDialog, /onChanged\?\.\(\);/);
});

test("变更面板目录树复用公共树构建并保留键盘导航", () => {
  assert.match(changesPanel, /buildFileTreeRows\(visible\.map/);
  assert.match(changesPanel, /listMode === "tree"/);
  assert.match(changesPanel, /kind: "dir"; dir: string/);
  assert.match(changesPanel, /onKeyDown=\{\(event\) => listKeyDown\(event, side, visible\)\}/);
});

test("变更文件列表宽度不再夹取上限", () => {
  assert.match(changesPanel, /props\.onWidth\(Math\.max\(0, props\.width \+ delta\)\)/);
  assert.doesNotMatch(changesPanel, /Math\.min\(720/);
  assert.doesNotMatch(styles, /\.changes-panel > \.changes-left \{ max-width/);
  assert.match(styles, /\.changes-left \{ min-width: 0;/);
});

test("Diff 偏好经共享存储保存并订阅同步，不在组件内直写 localStorage", () => {
  assert.match(diffView, /import \{ loadDiffPrefs, saveDiffPrefs, subscribeDiffPrefs \} from "\.\.\/diffPrefs"/);
  assert.match(diffView, /saveDiffPrefs\(prefKey, \{ mode, wrap \}\)/);
  assert.match(diffView, /return subscribeDiffPrefs\(prefKey/);
  assert.doesNotMatch(diffView, /localStorage\.setItem/);
});

test("Push 界面列出待推送提交并可查看提交内容", () => {
  assert.match(pushDialog, /api\.getUnpushedCommits\(props\.repoPath, explicit \? remote : null, explicit \? target\.trim\(\) : null\)/);
  assert.match(pushDialog, /className="push-commit-list"/);
  assert.match(pushDialog, /onClick=\{\(\) => setViewOid\(commit\.oid\)\}/);
  assert.match(pushDialog, /\{viewOid && <CommitContentDialog repoPath=\{props\.repoPath\} oid=\{viewOid\}/);
  assert.match(commitContent, /api\.getCommitFiles\(repoPath, oid\)/);
  assert.match(commitContent, /api\.getCommitFileDiff\(repoPath, oid, file\.path, file\.oldPath\)/);
  assert.match(commitContent, /prefKey=\{repoPath\}/);
});

test("get_unpushed_commits 是只读命令并完整注册", () => {
  assert.match(cli, /pub fn get_unpushed_commits\(/);
  assert.match(cli, /walk\.hide\(base_oid\)\?;/);
  assert.match(commands, /pub async fn get_unpushed_commits\(/);
  assert.match(commands, /run_read\(move \|\| cli::get_unpushed_commits\(path, remote, branch\)\)/);
  assert.match(lib, /git::commands::get_unpushed_commits,/);
});