import type { RevisionColumnWidths } from "./components/RevisionGrid";

/** View history 轻量窗口的分栏 / 列宽布局；按窗口类型共享一份并持久化。 */
export interface HistoryLayout {
  /** 上半部分左侧提交列表宽度（px）。 */
  listWidth: number;
  /** 上半部分高度（px）；对比面板占据剩余高度。 */
  topHeight: number;
  /** 详情面板中提交信息区高度（px）；文件列表占据剩余高度。 */
  infoHeight: number;
  columns: RevisionColumnWidths;
}

export const HISTORY_LAYOUT_KEY = "git-extensions.history-layout.v1";

export const DEFAULT_HISTORY_COLUMNS: RevisionColumnWidths = {
  refs: 64, subject: 190, author: 96, date: 116, sha: 58,
};

const COLUMN_LIMITS: Record<keyof RevisionColumnWidths, [number, number]> = {
  refs: [48, 600],
  subject: [64, 1200],
  author: [56, 600],
  date: [80, 600],
  sha: [48, 200],
};

const LAYOUT_LIMITS = {
  listWidth: [280, 4000] as const,
  topHeight: [200, 4000] as const,
  infoHeight: [100, 4000] as const,
};

export const DEFAULT_HISTORY_LAYOUT: HistoryLayout = {
  listWidth: 520,
  topHeight: 400,
  infoHeight: 220,
  columns: { ...DEFAULT_HISTORY_COLUMNS },
};

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;
}

/** 首次打开按窗口宽度给列表一个合适宽度；其余分栏用固定默认值。 */
function defaultListWidth(): number {
  const width = typeof window !== "undefined" && Number.isFinite(window.innerWidth) ? window.innerWidth : 1100;
  return Math.round(Math.min(Math.max(width * 0.58, 360), Math.max(360, width - 300)));
}

function normalize(raw: unknown): HistoryLayout {
  const layout = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Partial<HistoryLayout> : {};
  const columns = layout.columns && typeof layout.columns === "object" && !Array.isArray(layout.columns)
    ? layout.columns as Partial<RevisionColumnWidths>
    : {};
  const normalizedColumns = { ...DEFAULT_HISTORY_COLUMNS };
  for (const key of Object.keys(DEFAULT_HISTORY_COLUMNS) as (keyof RevisionColumnWidths)[]) {
    const [min, max] = COLUMN_LIMITS[key];
    normalizedColumns[key] = clamp(columns[key], min, max, DEFAULT_HISTORY_COLUMNS[key]);
  }
  return {
    listWidth: clamp(layout.listWidth, LAYOUT_LIMITS.listWidth[0], LAYOUT_LIMITS.listWidth[1], defaultListWidth()),
    topHeight: clamp(layout.topHeight, LAYOUT_LIMITS.topHeight[0], LAYOUT_LIMITS.topHeight[1], DEFAULT_HISTORY_LAYOUT.topHeight),
    infoHeight: clamp(layout.infoHeight, LAYOUT_LIMITS.infoHeight[0], LAYOUT_LIMITS.infoHeight[1], DEFAULT_HISTORY_LAYOUT.infoHeight),
    columns: normalizedColumns,
  };
}

export function loadHistoryLayout(): HistoryLayout {
  try {
    return normalize(JSON.parse(localStorage.getItem(HISTORY_LAYOUT_KEY) ?? "null"));
  } catch {
    return normalize(null);
  }
}

export function saveHistoryLayout(layout: HistoryLayout): void {
  try {
    localStorage.setItem(HISTORY_LAYOUT_KEY, JSON.stringify(normalize(layout)));
  } catch { /* 存储不可用不影响当前布局 */ }
}