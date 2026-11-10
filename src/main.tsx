import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import ExplorerWindow from "./explorer/ExplorerWindow";
import { ConfirmProvider } from "./ui/Confirm";
import { api } from "./api";
import { restoreExplorerWindowSize } from "./explorerWindowState";
import "./styles.css";

/** WebView2 默认把 F5 / Ctrl+R 当作刷新；刷新会重建 React 并丢失窗口启动上下文。 */
function blockReloadShortcuts() {
  window.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    if (event.key === "F5" || ((event.ctrlKey || event.metaKey) && key === "r")) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
}

async function start() {
  const root = ReactDOM.createRoot(document.getElementById("root")!);
  try {
    const bootstrap = await api.getWindowBootstrap();
    if (bootstrap.kind === "main") {
      root.render(<React.StrictMode><App initialLaunches={bootstrap.requests} /></React.StrictMode>);
      return;
    }
    const launch = bootstrap.requests[0];
    if (!launch) throw new Error("资源管理器窗口缺少启动动作");
    // 窗口创建时隐藏；先应用上次保存的尺寸，再渲染并显示，避免先闪默认尺寸。
    await restoreExplorerWindowSize(launch.action);
    root.render(<React.StrictMode><ConfirmProvider><ExplorerWindow launch={launch} /></ConfirmProvider></React.StrictMode>);
    await api.showCurrentWindow();
  } catch (error) {
    root.render(<div className="fatal-error">
      <strong>无法启动窗口</strong>
      <pre>{String(error)}</pre>
      <button type="button" onClick={() => { void getCurrentWindow().close(); }}>关闭窗口</button>
    </div>);
    await api.showCurrentWindow().catch(() => undefined);
  }
}

blockReloadShortcuts();
void start();
