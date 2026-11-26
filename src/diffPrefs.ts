/**
 * Diff 面板的共享状态：显示模式、换行、折叠、完整内容与底部面板高度。
 * 所有仓库、所有 DiffView 实例共用一份，避免切换仓库时面板跳动；
 * 同窗口通过订阅通知，其它窗口通过 storage 事件同步。
 */
export type DiffMode = "inline" | "split";

export interface DiffPrefs {
  mode: DiffMode;
  wrap: boolean;
  /** 折叠未修改片段。 */
  collapse: boolean;
  /** 显示完整文件内容（后端按完整上下文重新生成 patch）。 */
  fullContext: boolean;
  /** 主窗口历史视图底部 Diff 面板高度（px）；所有仓库共用。 */
  height: number;
}

export const DIFF_PANEL_KEY = "git-extensions.diffPanel.v1";

export const DEFAULT_DIFF_PREFS: DiffPrefs = {
  mode: "inline",
  wrap: false,
  collapse: false,
  fullContext: false,
  height: 320,
};

function validHeight(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(100_000, value))
    : DEFAULT_DIFF_PREFS.height;
}

function read(): DiffPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(DIFF_PANEL_KEY) ?? "{}") as Partial<DiffPrefs>;
    return {
      mode: raw.mode === "split" ? "split" : "inline",
      wrap: raw.wrap === true,
      collapse: raw.collapse === true,
      fullContext: raw.fullContext === true,
      height: validHeight(raw.height),
    };
  } catch {
    return { ...DEFAULT_DIFF_PREFS };
  }
}

function same(left: DiffPrefs, right: DiffPrefs): boolean {
  return left.mode === right.mode
    && left.wrap === right.wrap
    && left.collapse === right.collapse
    && left.fullContext === right.fullContext
    && left.height === right.height;
}

let state: DiffPrefs | null = null;
const listeners = new Set<() => void>();

/** 当前共享状态；首次调用时从 localStorage 读取。 */
export function getDiffPrefs(): DiffPrefs {
  if (!state) state = read();
  return state;
}

/** 底部 Diff 面板高度（用于 useSyncExternalStore 的稳定快照）。 */
export function getDiffPanelHeight(): number {
  return getDiffPrefs().height;
}

/** 重新读取存储；storage 事件与测试使用。 */
export function reloadDiffPrefs(): DiffPrefs {
  state = read();
  return state;
}

export function setDiffPrefs(patch: Partial<DiffPrefs>): void {
  const current = getDiffPrefs();
  const next = { ...current, ...patch };
  if (same(current, next)) return;
  state = next;
  try {
    localStorage.setItem(DIFF_PANEL_KEY, JSON.stringify(next));
  } catch { /* 偏好保存失败不影响当前视图 */ }
  listeners.forEach((listener) => listener());
}

/** 基于最新共享状态做增量更新；拖拽等连续事件不会因闭包里的旧值丢步。 */
export function updateDiffPrefs(updater: (current: DiffPrefs) => Partial<DiffPrefs>): void {
  setDiffPrefs(updater(getDiffPrefs()));
}

/** 订阅共享状态变化；同窗口写入与其它窗口 storage 事件都会触发。 */
export function subscribeDiffPrefs(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== DIFF_PANEL_KEY) return;
    const current = getDiffPrefs();
    const next = read();
    if (same(current, next)) return;
    state = next;
    listeners.forEach((entry) => entry());
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}
