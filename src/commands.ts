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

/** 设置页与命令面板共用的快捷键说明，避免两处手写文本漂移。 */
export const SHORTCUT_HELP: { keys: string; text: string }[] = [
  { keys: "Ctrl+K", text: "命令面板" },
  { keys: "Ctrl+O", text: "打开仓库" },
  { keys: "Ctrl+W", text: "关闭当前仓库页签" },
  { keys: "Ctrl+Tab", text: "切换仓库页签" },
  { keys: "Ctrl+1 / 2 / 3", text: "历史 / 变更 / 对比" },
  { keys: "Ctrl+F", text: "聚焦提交过滤" },
  { keys: "Ctrl+B", text: "显示 / 隐藏导航" },
  { keys: "F5", text: "刷新当前仓库" },
  { keys: "F6 / Shift+F6", text: "在面板间循环焦点" },
  { keys: "↑ / ↓ / PgUp / PgDn", text: "选择提交" },
  { keys: "Enter", text: "查看选中提交差异" },
  { keys: "Alt+↑ / Alt+↓", text: "上一处 / 下一处差异（或 n / p）" },
  { keys: "Ctrl+Shift+B / S / T / M", text: "分支 / Stash / 标签 / 子模块" },
  { keys: "Ctrl+Shift+F / L / P", text: "Fetch / Pull / Push" },
  { keys: "Ctrl+Enter", text: "提交变更" },
  { keys: "Ctrl+S", text: "保存冲突解决结果" },
  { keys: "Shift+F10", text: "打开当前项右键菜单" },
  { keys: "Esc", text: "关闭弹窗 / 退出最大化" },
];
