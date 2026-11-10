import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { PhysicalSize } from "@tauri-apps/api/dpi";
import type { ExplorerAction } from "./types";

interface ExplorerWindowSize {
  width: number;
  height: number;
}

const STORAGE_PREFIX = "git-extensions.explorer-window-size.v1.";
const MIN_SIZE = 360;
const MAX_SIZE = 10_000;

function validSize(value: unknown): value is ExplorerWindowSize {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const size = value as Partial<ExplorerWindowSize>;
  return typeof size.width === "number" && Number.isFinite(size.width)
    && typeof size.height === "number" && Number.isFinite(size.height)
    && size.width >= MIN_SIZE && size.height >= MIN_SIZE
    && size.width <= MAX_SIZE && size.height <= MAX_SIZE;
}

export function loadExplorerWindowSize(action: ExplorerAction): ExplorerWindowSize | null {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_PREFIX + action) ?? "null");
    return validSize(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function saveExplorerWindowSize(action: ExplorerAction, size: ExplorerWindowSize) {
  if (!validSize(size)) return;
  try {
    localStorage.setItem(
      STORAGE_PREFIX + action,
      JSON.stringify({ width: Math.round(size.width), height: Math.round(size.height) }),
    );
  } catch { /* 存储不可用不影响窗口使用 */ }
}

/** 轻量动作窗口创建时先隐藏；在显示前应用上次为该动作保存的尺寸。 */
export async function restoreExplorerWindowSize(action: ExplorerAction) {
  const saved = loadExplorerWindowSize(action);
  if (!saved) return;
  const appWindow = getCurrentWindow();
  try {
    // 显示器变小时把窗口夹到当前工作区，避免恢复出一个超出屏幕的尺寸。
    const monitor = await currentMonitor();
    const width = monitor ? Math.min(saved.width, monitor.workArea.size.width) : saved.width;
    const height = monitor ? Math.min(saved.height, monitor.workArea.size.height) : saved.height;
    await appWindow.setSize(new PhysicalSize(width, height));
  } catch { /* 保持创建时的默认尺寸 */ }
}

/** 监听窗口缩放并防抖保存；返回清理函数。 */
export function watchExplorerWindowSize(action: ExplorerAction): () => void {
  const appWindow = getCurrentWindow();
  let timer: number | null = null;
  let disposed = false;
  let unlisten: (() => void) | null = null;
  const flush = async () => {
    if (disposed) return;
    try {
      const size = await appWindow.innerSize();
      saveExplorerWindowSize(action, size);
    } catch { /* 下次缩放或关闭时重试 */ }
  };
  const schedule = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(() => { timer = null; void flush(); }, 250);
  };
  void appWindow.onResized(schedule).then((release) => {
    if (disposed) release();
    else unlisten = release;
  }).catch(() => undefined);
  const beforeUnload = () => { void flush(); };
  window.addEventListener("beforeunload", beforeUnload);
  return () => {
    disposed = true;
    if (timer !== null) window.clearTimeout(timer);
    unlisten?.();
    window.removeEventListener("beforeunload", beforeUnload);
  };
}
