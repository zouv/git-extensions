import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * 关闭当前轻量窗口。close() 会发 closeRequested，用户主动关闭时由下面的
 * busy / dirty 守卫拦截；操作成功后应用主动关窗则传 force=true，改用
 * destroy() 直接销毁，避免守卫因 busy 拦截而让等待方永远卡住。
 * 关闭是尽力而为：窗口可能已被关掉（例如 onOpen 与弹窗 onClose 连续触发）。
 */
export async function closeCurrentWindow(force = false) {
  try {
    const window = getCurrentWindow();
    if (force) await window.destroy();
    else await window.close();
  } catch {
    // 窗口已不存在时无需处理。
  }
}

/** Native title-bar close still needs the same busy/draft protection as dialogs. */
export function usePortableCloseGuard(busy: boolean, dirty: boolean, dirtyMessage: string) {
  const state = useRef({ busy, dirty, dirtyMessage });
  state.current = { busy, dirty, dirtyMessage };
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let disposed = false;
    void getCurrentWindow().onCloseRequested((event) => {
      const current = state.current;
      if (current.busy) {
        event.preventDefault();
        return;
      }
      if (current.dirty && !window.confirm(current.dirtyMessage)) {
        event.preventDefault();
      }
    }).then((dispose) => {
      if (disposed) dispose(); else unlisten = dispose;
    });
    return () => { disposed = true; unlisten?.(); };
  }, []);
}
