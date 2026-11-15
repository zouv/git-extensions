import { useSyncExternalStore } from "react";

export interface Command {
  id: string;
  title: string;
  group: string;
  shortcut?: string;
  keywords?: string[];
  enabled?: boolean;
  run: () => void;
}

const owners = new Map<string, Command[]>();
const listeners = new Set<() => void>();
let version = 0;
let cached: Command[] = [];
let cachedVersion = -1;

function emit() {
  version += 1;
  cachedVersion = -1;
  for (const listener of listeners) listener();
}

export function registerCommands(owner: string, commands: Command[]) {
  owners.set(owner, commands);
  emit();
}

export function unregisterCommands(owner: string) {
  if (owners.delete(owner)) emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function snapshot(): Command[] {
  if (cachedVersion !== version) {
    cached = [...owners.values()].flat();
    cachedVersion = version;
  }
  return cached;
}

export function useCommands(): Command[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** 设置页使用的分组快捷键说明；新增 / 修改快捷键时同步这里。 */
export interface ShortcutHelpGroup {
  title: string;
  items: { keys: string; text: string }[];
}

export const SHORTCUT_HELP: ShortcutHelpGroup[] = [
  { title: "应用与页签", items: [
    { keys: "Ctrl+K", text: "命令面板" },
    { keys: "Ctrl+,", text: "设置" },
    { keys: "Ctrl+O", text: "打开仓库" },
    { keys: "Ctrl+W", text: "关闭当前仓库页签" },
    { keys: "Ctrl+Tab / Ctrl+Shift+Tab", text: "在当前范围内向后 / 向前切换仓库页签" },
    { keys: "Ctrl+1 … 9", text: "切换到当前范围第 N 个仓库页签" },
    { keys: "Alt+1 … 9 / Alt+0", text: "独占查看固定组 / 未分组" },
    { keys: "Alt+← / Alt+→（固定组图标上）", text: "调整固定组顺序" },
  ] },
  { title: "视图与导航", items: [
    { keys: "Ctrl+B", text: "显示 / 隐藏导航" },
    { keys: "Ctrl+F", text: "聚焦提交过滤" },
    { keys: "Ctrl+G / Ctrl+Shift+H", text: "高级搜索（提交历史 / 代码全文）" },
    { keys: "F5", text: "刷新当前仓库" },
    { keys: "F6 / Shift+F6", text: "在面板间循环焦点" },
    { keys: "Alt+← / Alt+→", text: "向后 / 向前导航" },
    { keys: "Alt+↑ / Alt+↓", text: "上一处 / 下一处差异（或 n / p）" },
    { keys: "↑ / ↓ / PgUp / PgDn / Home / End", text: "选择提交" },
    { keys: "Enter", text: "查看选中提交差异" },
  ] },
  { title: "Git 操作", items: [
    { keys: "Ctrl+Enter", text: "打开提交面板；在标题 / 正文输入框中提交" },
    { keys: "Ctrl+Shift+B", text: "分支管理" },
    { keys: "Ctrl+Shift+S", text: "Stash" },
    { keys: "Ctrl+Shift+T", text: "标签" },
    { keys: "Ctrl+Shift+M", text: "子模块" },
    { keys: "Ctrl+Alt+W", text: "工作树管理" },
    { keys: "Ctrl+Shift+F / L / P", text: "Fetch / Pull / Push" },
    { keys: "Ctrl+Shift+O", text: "文件资源管理器" },
    { keys: "Ctrl+Shift+G", text: "Git 命令执行日志" },
    { keys: "Ctrl+Shift+C", text: "复制选中提交 SHA" },
    { keys: "Ctrl+S", text: "保存冲突解决结果" },
  ] },
  { title: "通用", items: [
    { keys: "Shift+F10", text: "打开当前项右键菜单" },
    { keys: "Esc", text: "关闭弹窗 / 退出最大化" },
    { keys: "Alt+F4", text: "关闭窗口" },
  ] },
];
