import type { ExplorerMenuPlacements } from "./types";
import { defaultExplorerMenuPlacements, normalizeExplorerMenuPlacements } from "./explorerMenu";

export interface AppSettings {
  autoRefresh: boolean;
  pollIntervalSeconds: number;
  highlightEnabled: boolean;
  showLeftPanel: boolean;
  maxLogCount: number;
  explorerContextMenuEnabled: boolean;
  explorerContextMenuPlacements: ExplorerMenuPlacements;
  explorerAlwaysShowAllCommands: boolean;
}

export type InspectorPosition = "right" | "bottom";

export interface UILayout {
  leftWidth: number;
  inspectorSize: number;
  inspectorPosition: InspectorPosition;
  showLeft: boolean;
  showInspector: boolean;
  changesWidth: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  autoRefresh: true,
  pollIntervalSeconds: 5,
  highlightEnabled: true,
  showLeftPanel: true,
  maxLogCount: 100_000,
  explorerContextMenuEnabled: false,
  explorerContextMenuPlacements: defaultExplorerMenuPlacements(),
  explorerAlwaysShowAllCommands: false,
};

export const DEFAULT_LAYOUT: UILayout = {
  leftWidth: 224,
  inspectorSize: 400,
  inspectorPosition: "right",
  showLeft: true,
  showInspector: true,
  changesWidth: 420,
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
      leftWidth: bounded(raw.leftWidth, 160, 360, DEFAULT_LAYOUT.leftWidth),
      inspectorSize: bounded(raw.inspectorSize, 180, 720, DEFAULT_LAYOUT.inspectorSize),
      inspectorPosition: raw.inspectorPosition === "bottom" ? "bottom" : "right",
      showLeft: typeof raw.showLeft === "boolean" ? raw.showLeft : settings.showLeftPanel,
      showInspector: typeof raw.showInspector === "boolean" ? raw.showInspector : true,
      changesWidth: bounded(raw.changesWidth, 300, 720, DEFAULT_LAYOUT.changesWidth),
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
