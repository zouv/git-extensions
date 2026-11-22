/**
 * Diff 行内 / 并排与换行偏好：按仓库键持久化，并在同窗口多个 DiffView
 * 实例与其它窗口（资源管理器轻量窗口）之间同步，避免常驻挂载的视图
 * 用旧状态覆盖新偏好。
 */
export type DiffMode = "inline" | "split";

export interface DiffPrefs {
  mode: DiffMode;
  wrap: boolean;
}

export const DIFF_MODE_KEY = "git-extensions.diffMode";
export const DIFF_WRAP_KEY = "git-extensions.diffWrap";

const listeners = new Map<string, Set<(prefs: DiffPrefs) => void>>();

export function loadDiffPrefs(key: string): DiffPrefs {
  try {
    return {
      mode: localStorage.getItem(`${DIFF_MODE_KEY}:${key}`) === "split" ? "split" : "inline",
      wrap: localStorage.getItem(`${DIFF_WRAP_KEY}:${key}`) === "1",
    };
  } catch {
    return { mode: "inline", wrap: false };
  }
}

export function saveDiffPrefs(key: string, prefs: DiffPrefs): void {
  try {
    localStorage.setItem(`${DIFF_MODE_KEY}:${key}`, prefs.mode);
    localStorage.setItem(`${DIFF_WRAP_KEY}:${key}`, prefs.wrap ? "1" : "0");
  } catch { /* 偏好保存失败不影响当前视图 */ }
  listeners.get(key)?.forEach((listener) => listener(prefs));
}

/** 订阅指定键的偏好变化：同窗口其它实例的写入通知 + 其它窗口的 storage 事件。 */
export function subscribeDiffPrefs(key: string, listener: (prefs: DiffPrefs) => void): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== `${DIFF_MODE_KEY}:${key}` && event.key !== `${DIFF_WRAP_KEY}:${key}`) return;
    listener(loadDiffPrefs(key));
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(key);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}