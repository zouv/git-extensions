import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ExplorerWindow from "./explorer/ExplorerWindow";
import { ConfirmProvider } from "./ui/Confirm";
import { api } from "./api";
import "./styles.css";

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
    root.render(<React.StrictMode><ConfirmProvider><ExplorerWindow launch={launch} /></ConfirmProvider></React.StrictMode>);
    await api.showCurrentWindow();
  } catch (error) {
    root.render(<div className="fatal-error"><strong>无法启动窗口</strong><pre>{String(error)}</pre></div>);
    await api.showCurrentWindow().catch(() => undefined);
  }
}

void start();
