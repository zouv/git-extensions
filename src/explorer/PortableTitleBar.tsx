import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api } from "../api";
import type { ExplorerAction } from "../types";

const win = getCurrentWindow();

/** 所有资源管理器轻量窗口共用的自绘标题栏：菜单图标 + 标题 + 操作信息 + 窗口控制。 */
export default function PortableTitleBar({ action, title, detail, onClose }: {
  action: ExplorerAction;
  title: string;
  detail?: string;
  onClose: () => void;
}) {
  const [maximized, setMaximized] = useState(false);
  const [icon, setIcon] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    void win.isMaximized().then((value) => { if (!disposed) setMaximized(value); }).catch(() => undefined);
    const unlisten = win.onResized(() => { void win.isMaximized().then((value) => { if (!disposed) setMaximized(value); }).catch(() => undefined); });
    // 与资源管理器菜单共用同一份内嵌图标；IPC 失败时留空，由标题文字保证可读性。
    void api.getExplorerActionIcon(action).then((value) => { if (!disposed) setIcon(value); }).catch(() => undefined);
    return () => {
      disposed = true;
      void unlisten.then((fn) => fn()).catch(() => undefined);
    };
  }, [action]);
  return <header className="title-bar portable-title-bar" data-tauri-drag-region="deep">
    <span className="portable-title-icon" aria-hidden="true" data-tauri-drag-region>
      {icon && <img src={icon} width={16} height={16} alt="" draggable={false} />}
    </span>
    <strong className="portable-title-label" data-tauri-drag-region>{title}</strong>
    {detail && <span className="portable-title-detail" title={detail} data-tauri-drag-region>{detail}</span>}
    <div className="title-window-controls" data-tauri-drag-region="false">
      <button className="title-win-btn" title="最小化" aria-label="最小化" data-tauri-drag-region="false" onClick={() => void win.minimize()}>
        <svg className="icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M5 12h14" /></svg>
      </button>
      <button className="title-win-btn" title={maximized ? "还原" : "最大化"} aria-label={maximized ? "还原" : "最大化"} data-tauri-drag-region="false" onClick={() => void win.toggleMaximize()}>
        {maximized
          ? <svg className="icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="7" y="7" width="12" height="12" rx="1" /><path d="M5 15V5a1 1 0 0 1 1-1h10" /></svg>
          : <svg className="icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="1" /></svg>}
      </button>
      <button className="title-win-btn title-win-close" title="关闭" aria-label="关闭" data-tauri-drag-region="false" onClick={onClose}>
        <svg className="icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
      </button>
    </div>
  </header>;
}
