export interface DialogSize {
  width: number;
  height: number;
}

const KEY_PREFIX = "git-extensions.dialog-size.v1.";
const MIN_SIZE = 320;
const MAX_SIZE = 20_000;

function validSize(value: unknown): value is DialogSize {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const size = value as Partial<DialogSize>;
  return typeof size.width === "number" && Number.isFinite(size.width)
    && typeof size.height === "number" && Number.isFinite(size.height)
    && size.width >= MIN_SIZE && size.height >= MIN_SIZE
    && size.width <= MAX_SIZE && size.height <= MAX_SIZE;
}

export function clampDialogSize(
  size: DialogSize,
  minWidth: number,
  minHeight: number,
): DialogSize {
  const maxWidth = Math.max(minWidth, window.innerWidth - 24);
  const maxHeight = Math.max(minHeight, window.innerHeight - 24);
  return {
    width: Math.round(Math.min(maxWidth, Math.max(minWidth, size.width))),
    height: Math.round(Math.min(maxHeight, Math.max(minHeight, size.height))),
  };
}

export function loadDialogSize(key: string): DialogSize | null {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY_PREFIX + key) ?? "null");
    return validSize(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function saveDialogSize(key: string, size: DialogSize) {
  if (!validSize(size)) return;
  try { localStorage.setItem(KEY_PREFIX + key, JSON.stringify(size)); } catch { /* 存储不可用不影响弹窗 */ }
}
