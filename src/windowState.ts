export interface WindowState {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
}

export interface WindowWorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

const WINDOW_STATE_KEY = "git-extensions.window.v1";

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function loadWindowState(): WindowState | null {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(WINDOW_STATE_KEY) ?? "null");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const state = raw as Partial<WindowState>;
    if (!finite(state.x) || !finite(state.y) || !finite(state.width) || !finite(state.height)
      || state.width <= 0 || state.height <= 0 || typeof state.maximized !== "boolean") return null;
    return { x: state.x, y: state.y, width: state.width, height: state.height, maximized: state.maximized };
  } catch {
    return null;
  }
}

export function saveWindowState(state: WindowState) {
  try { localStorage.setItem(WINDOW_STATE_KEY, JSON.stringify(state)); } catch { /* 存储不可用不影响窗口使用 */ }
}

function intersection(state: WindowState, area: WindowWorkArea): number {
  const width = Math.max(0, Math.min(state.x + state.width, area.x + area.width) - Math.max(state.x, area.x));
  const height = Math.max(0, Math.min(state.y + state.height, area.y + area.height) - Math.max(state.y, area.y));
  return width * height;
}

/** 使用物理像素修正到当前显示器工作区，保留合法的负坐标。 */
export function fitWindowState(state: WindowState, areas: WindowWorkArea[]): WindowState {
  if (areas.length === 0) return state;
  const target = areas.reduce((best, area) =>
    intersection(state, area) > intersection(state, best) ? area : best, areas[0]);
  const visible = areas.some((area) => intersection(state, area) > 0);
  const width = Math.max(1, Math.min(state.width, target.width));
  const height = Math.max(1, Math.min(state.height, target.height));
  return {
    ...state,
    width,
    height,
    x: visible ? Math.min(Math.max(state.x, target.x), target.x + target.width - width)
      : target.x + Math.max(0, Math.round((target.width - width) / 2)),
    y: visible ? Math.min(Math.max(state.y, target.y), target.y + target.height - height)
      : target.y + Math.max(0, Math.round((target.height - height) / 2)),
  };
}
