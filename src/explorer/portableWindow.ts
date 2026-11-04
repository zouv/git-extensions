import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

export async function closeCurrentWindow() {
  await getCurrentWindow().close();
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
