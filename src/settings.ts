import type { ExplorerMenuPlacements } from "./types";
import { defaultExplorerMenuPlacements, normalizeExplorerMenuPlacements } from "./explorerMenu";

export interface AppSettings {
  autoRefresh: boolean;
  pollIntervalSeconds: number;
  highlightEnabled: boolean;
  showLeftPanel: boolean;
  maxLogCount: number;
  /** 顶部栏分组显示方式：页签内图标（tab，默认）或 Pin 图标栏（pin）。 */
  groupNavMode: GroupNavMode;
  explorerContextMenuEnabled: boolean;
  explorerContextMenuPlacements: ExplorerMenuPlacements;
  explorerAlwaysShowAllCommands: boolean;
}

export type GroupNavMode = "tab" | "pin";

/** View 菜单里可持久化的提交图显示选项；按仓库保存。 */
export interface GridDisplayOptions {
  showRemoteBranches: boolean;
  showTags: boolean;
  showGraphColumn: boolean;
  showAuthorColumn: boolean;
  showDateColumn: boolean;
  showShaColumn: boolean;
  relativeDate: boolean;
}

export interface UILayout extends GridDisplayOptions {
  leftWidth: number;
  inspectorSize: number;
  /** 检查器内提交信息区高度（px）；变更文件列表占余下高度。 */
  inspectorInfoHeight: number;
  showLeft: boolean;
  showInspector: boolean;
  changesWidth: number;
  /** 提交界面未暂存 / 已暂存列表的分割比例（0.15–0.85）。 */
  changesListSplit: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  autoRefresh: true,
  pollIntervalSeconds: 5,
  highlightEnabled: true,
  showLeftPanel: true,
  maxLogCount: 100_000,
  groupNavMode: "tab",
  explorerContextMenuEnabled: false,
  explorerContextMenuPlacements: defaultExplorerMenuPlacements(),
  explorerAlwaysShowAllCommands: false,
};

export const DEFAULT_LAYOUT: UILayout = {
  leftWidth: 224,
  inspectorSize: 400,
  inspectorInfoHeight: 260,
  showLeft: true,
  showInspector: true,
  changesWidth: 420,
  changesListSplit: 0.5,
  showRemoteBranches: true,
  showTags: true,
  showGraphColumn: true,
  showAuthorColumn: true,
  showDateColumn: true,
  showShaColumn: true,
  relativeDate: false,
};

const SETTINGS_KEY = "git-extensions.settings";
const LAYOUT_PREFIX = "git-extensions.layout.v2:";
const POLL_INTERVALS = [3, 5, 10, 30, 60];
const LOG_LIMITS = [10_000, 50_000, 100_000, 200_000];

function numberOption(value: unknown, allowed: number[], fallback: number): number {
  return typeof value === "number" && allowed.includes(value) ? value : fallback;
}

function bounded(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function booleanOption(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** localStorage 可能被手工修改，只接受白名单中的设置值。 */
export function loadSettings(): AppSettings {
  try {
    const raw: Partial<AppSettings> = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}");
    return {
      autoRefresh: typeof raw.autoRefresh === "boolean" ? raw.autoRefresh : DEFAULT_SETTINGS.autoRefresh,
      pollIntervalSeconds: numberOption(raw.pollIntervalSeconds, POLL_INTERVALS, DEFAULT_SETTINGS.pollIntervalSeconds),
      highlightEnabled: typeof raw.highlightEnabled === "boolean" ? raw.highlightEnabled : DEFAULT_SETTINGS.highlightEnabled,
      showLeftPanel: typeof raw.showLeftPanel === "boolean" ? raw.showLeftPanel : DEFAULT_SETTINGS.showLeftPanel,
      maxLogCount: numberOption(raw.maxLogCount, LOG_LIMITS, DEFAULT_SETTINGS.maxLogCount),
      groupNavMode: raw.groupNavMode === "pin" ? "pin" : "tab",
      explorerContextMenuEnabled: typeof raw.explorerContextMenuEnabled === "boolean" ? raw.explorerContextMenuEnabled : DEFAULT_SETTINGS.explorerContextMenuEnabled,
      explorerContextMenuPlacements: normalizeExplorerMenuPlacements(raw.explorerContextMenuPlacements),
      explorerAlwaysShowAllCommands: typeof raw.explorerAlwaysShowAllCommands === "boolean" ? raw.explorerAlwaysShowAllCommands : DEFAULT_SETTINGS.explorerAlwaysShowAllCommands,
    };
  } catch {
    return { ...DEFAULT_SETTINGS, explorerContextMenuPlacements: defaultExplorerMenuPlacements() };
  }
}

export function saveSettings(settings: AppSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function loadLayout(repoPath: string, settings: AppSettings): UILayout {
  try {
    const raw: Partial<UILayout> = JSON.parse(localStorage.getItem(LAYOUT_PREFIX + repoPath) ?? "{}");
    return {
      // 左侧导航宽度不设上限（用户可自由拖拽）；仅挡住手工改坏的非法值。
      leftWidth: bounded(raw.leftWidth, 0, 100_000, DEFAULT_LAYOUT.leftWidth),
      inspectorSize: bounded(raw.inspectorSize, 0, 100_000, DEFAULT_LAYOUT.inspectorSize),
      inspectorInfoHeight: bounded(raw.inspectorInfoHeight, 60, 100_000, DEFAULT_LAYOUT.inspectorInfoHeight),
      showLeft: typeof raw.showLeft === "boolean" ? raw.showLeft : settings.showLeftPanel,
      showInspector: typeof raw.showInspector === "boolean" ? raw.showInspector : true,
      // 变更文件列表宽度不设上限（用户可自由拖拽）；仅挡住手工改坏的非法值。
      changesWidth: bounded(raw.changesWidth, 0, 100_000, DEFAULT_LAYOUT.changesWidth),
      changesListSplit: bounded(raw.changesListSplit, 0.15, 0.85, DEFAULT_LAYOUT.changesListSplit),
      showRemoteBranches: booleanOption(raw.showRemoteBranches, true),
      showTags: booleanOption(raw.showTags, true),
      showGraphColumn: booleanOption(raw.showGraphColumn, true),
      showAuthorColumn: booleanOption(raw.showAuthorColumn, true),
      showDateColumn: booleanOption(raw.showDateColumn, true),
      showShaColumn: booleanOption(raw.showShaColumn, true),
      relativeDate: booleanOption(raw.relativeDate, false),
    };
  } catch {
    return { ...DEFAULT_LAYOUT, showLeft: settings.showLeftPanel };
  }
}

export function saveLayout(repoPath: string, layout: UILayout) {
  try {
    localStorage.setItem(LAYOUT_PREFIX + repoPath, JSON.stringify(layout));
  } catch {
    // 隐私模式或存储已满不影响当前会话中的布局调整。
  }
}

export function resetLayout(repoPath: string, settings: AppSettings): UILayout {
  try { localStorage.removeItem(LAYOUT_PREFIX + repoPath); } catch { /* 当前会话仍可重置 */ }
  return { ...DEFAULT_LAYOUT, showLeft: settings.showLeftPanel };
}
