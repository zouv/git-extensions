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

test("Diff 面板状态经共享存储保存并订阅同步，不在组件内直写 localStorage", () => {
  assert.match(diffView, /import \{ getDiffPrefs, setDiffPrefs, subscribeDiffPrefs, updateDiffPrefs \} from "\.\.\/diffPrefs"/);
  assert.match(diffView, /useSyncExternalStore\(subscribeDiffPrefs, getDiffPrefs, getDiffPrefs\)/);
  assert.match(diffView, /setDiffPrefs\(\{ mode \}\)/);
  assert.match(diffView, /updateDiffPrefs\(\(current\) => \(\{ collapse: !current\.collapse \}\)\)/);
  assert.doesNotMatch(diffView, /localStorage\.setItem/);
  assert.doesNotMatch(diffView, /prefKey/);
});

test("Push 界面列出待推送提交并可查看提交内容", () => {
  assert.match(pushDialog, /api\.getUnpushedCommits\(props\.repoPath, explicit \? remote : null, explicit \? target\.trim\(\) : null\)/);
  assert.match(pushDialog, /className="push-commit-list"/);
  assert.match(pushDialog, /onClick=\{\(\) => setViewOid\(commit\.oid\)\}/);
  assert.match(pushDialog, /\{viewOid && <CommitContentDialog repoPath=\{props\.repoPath\} oid=\{viewOid\}/);
  assert.match(commitContent, /api\.getCommitFiles\(repoPath, oid\)/);
  assert.match(commitContent, /api\.getCommitFileDiff\(repoPath, oid, file\.path, file\.oldPath, fullContext\)/);
  assert.match(commitContent, /<DiffView/);
});

test("get_unpushed_commits 是只读命令并完整注册", () => {
  assert.match(cli, /pub fn get_unpushed_commits\(/);
  assert.match(cli, /walk\.hide\(base_oid\)\?;/);
  assert.match(commands, /pub async fn get_unpushed_commits\(/);
  assert.match(commands, /run_read\(move \|\| cli::get_unpushed_commits\(path, remote, branch\)\)/);
  assert.match(lib, /git::commands::get_unpushed_commits,/);
});

test("目录树目录与文件列对齐，文件列表支持常规多选", () => {
  assert.match(styles, /\.changes-directory \{ display: flex; align-items: center; justify-content: flex-start;/);
  assert.match(styles, /\.changes-dir-spacer \{ width: 14px;/);
  assert.match(styles, /\.changes-item input\[type="checkbox"\] \{ width: 13px;/);
  assert.match(changesPanel, /rangeSelection\(visible\.map/);
  assert.match(changesPanel, /event\.key\.toLowerCase\(\) === "a"/);
  assert.match(changesPanel, /setSelected\(\(prev\) => \(\{ \.\.\.prev, \[side\]: new Set\(visible\.map/);
  assert.match(changesPanel, /event\.ctrlKey \|\| event\.metaKey/);
  assert.match(changesPanel, /if \(event\.shiftKey\)/);
  assert.match(changesPanel, /onClick=\{\(event\) => onRowClick\(event, side, row\.value, visible\)\}/);
  // Ctrl+A / Shift+点击只改变行选中，勾选框由复选框单独维护。
  assert.match(changesPanel, /targetPaths\(side\)/);
  assert.match(styles, /\.changes-items \{[^}]*user-select: none/);
  assert.match(styles, /\.changes-item\.preview \{ box-shadow: inset 2px 0 var\(--accent\)/);
});

test("未暂存 / 已暂存列表支持拖拽调整高度", async () => {
  assert.match(changesPanel, /className="changes-lists"/);
  assert.match(changesPanel, /label="调整未暂存 \/ 已暂存列表高度"/);
  assert.match(changesPanel, /props\.onListSplit\(Math\.min\(0\.85, Math\.max\(0\.15/);
  assert.match(styles, /\.changes-list-slot \{ display: flex;/);
  const repoWorkspace = await readFile(new URL("../src/RepoWorkspace.tsx", import.meta.url), "utf8");
  const commitWindow = await readFile(new URL("../src/explorer/CommitWindow.tsx", import.meta.url), "utf8");
  assert.match(repoWorkspace, /listSplit=\{layout\.changesListSplit\}/);
  assert.match(repoWorkspace, /onListSplit=\{\(changesListSplit\) => setLayout\(\(prev\) => \(\{ \.\.\.prev, changesListSplit \}\)\)\}/);
  assert.match(commitWindow, /listSplit=\{listSplit\}/);
  assert.match(commitWindow, /onListSplit=\{setListSplit\}/);
});

test("Amend 复选框位于底部提交按钮行左侧", () => {
  assert.match(changesPanel, /className="commit-actions"[\s\S]{0,600}amend-checkbox[\s\S]{0,900}commit-button/);
  const titleCountBlock = changesPanel.slice(changesPanel.indexOf('className="commit-title-count"'), changesPanel.indexOf('className="commit-actions"'));
  assert.ok(titleCountBlock.length > 0);
  assert.ok(!titleCountBlock.includes("amend-checkbox"));
  assert.match(styles, /\.commit-actions \{ display: flex; align-items: center; justify-content: space-between;/);
  assert.match(styles, /\.commit-title-count \{ display: flex; align-items: center; justify-content: flex-end;/);
});