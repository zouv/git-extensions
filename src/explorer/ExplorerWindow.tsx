import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { useRepoBusy } from "../useRepoBusy";
import type { BranchInfo, ExplorerAction, ExplorerTarget, LaunchRequest, StatusSnapshot } from "../types";
import { EXPLORER_MENU_ACTIONS } from "../explorerMenu";
import ApplyPatchDialog from "../components/ApplyPatchDialog";
import BranchDialog from "../components/BranchDialog";
import CheckoutRevisionDialog from "../components/CheckoutRevisionDialog";
import CloneDialog from "../components/CloneDialog";
import CreateRepositoryDialog from "../components/CreateRepositoryDialog";
import DiffToolDialog from "../components/DiffToolDialog";
import PushDialog from "../components/PushDialog";
import StashDialog from "../components/StashDialog";
import CommitWindow from "./CommitWindow";
import HistoryWindow from "./HistoryWindow";
import PullWindow from "./PullWindow";
import { closeCurrentWindow, usePortableCloseGuard } from "./portableWindow";

const PORTABLE_ACTIONS: ExplorerAction[] = [
  "clone", "create-repository", "commit", "pull", "push", "view-stash", "view-changes",
  "checkout-branch", "checkout-revision", "create-branch", "open-with-difftool",
  "file-history", "reset-file-changes", "add-files", "apply-patch",
];

function actionLabel(action: ExplorerAction) {
  return EXPLORER_MENU_ACTIONS.find((item) => item.action === action)?.label ?? action;
}

function Frame({ action, target, message, children }: {
  action: ExplorerAction;
  target: ExplorerTarget | null;
  message: string;
  children: React.ReactNode;
}) {
  return <div className="portable-window">
    <header className="portable-header">
      <div>
        <strong>{actionLabel(action)}</strong>
        {target && <span title={target.repo.path}>
          {target.repo.name}
          {target.relativePath ? ` / ${target.relativePath}` : ""}
          {target.repo.headBranch ? ` · ${target.repo.headBranch}` : ""}
        </span>}
      </div>
      <button onClick={() => void closeCurrentWindow()} aria-label="关闭窗口">关闭</button>
    </header>
    {message && <div className="portable-message" role="status">{message}</div>}
    <div className="portable-content">{children}</div>
  </div>;
}

function BranchWindow({ action, target, message }: { action: "checkout-branch" | "create-branch"; target: ExplorerTarget; message: (value: string) => void }) {
  const [branches, setBranches] = useState<BranchInfo[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    api.getBranches(target.repo.path).then((next) => { if (alive) setBranches(next); })
      .catch((reason) => { if (alive) setError(String(reason)); });
    return () => { alive = false; };
  }, [target.repo.path]);
  if (error) return <div className="empty-state" role="alert">{error}</div>;
  if (!branches) return <div className="empty-state"><span className="spinner" />加载分支…</div>;
  return <BranchDialog
    repoPath={target.repo.path}
    branches={branches}
    initialMode={action === "create-branch" ? "create" : "checkout"}
    onClose={() => void closeCurrentWindow()}
    onChanged={() => undefined}
    setMessage={message}
  />;
}

function DiffToolWindow({ target, initialFile }: { target: ExplorerTarget; initialFile: string | null }) {
  const [status, setStatus] = useState<StatusSnapshot | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    api.getStatus(target.repo.path).then((next) => { if (alive) setStatus(next); })
      .catch((reason) => { if (alive) setError(String(reason)); });
    return () => { alive = false; };
  }, [target.repo.path]);
  if (error) return <div className="empty-state" role="alert">{error}</div>;
  if (!status) return <div className="empty-state"><span className="spinner" />读取工作区…</div>;
  return <DiffToolDialog
    repoPath={target.repo.path}
    status={status}
    initialFile={initialFile}
    onClose={() => void closeCurrentWindow()}
    setMessage={() => undefined}
  />;
}

export default function ExplorerWindow({ launch }: { launch: LaunchRequest }) {
  const [target, setTarget] = useState<ExplorerTarget | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const needsRepo = !["clone", "create-repository", "open-repository", "settings"].includes(launch.action);
  const repoBusy = useRepoBusy(target?.repo.path ?? "");

  useEffect(() => {
    document.body.classList.add("portable-window");
    return () => document.body.classList.remove("portable-window");
  }, []);
  usePortableCloseGuard(busy || repoBusy, dirty, "当前窗口有未提交的编辑内容，关闭会丢弃这些内容。确定关闭？");

  useEffect(() => {
    if (!needsRepo) return;
    if (!launch.path) { setError("启动动作缺少路径"); return; }
    let alive = true;
    setError("");
    api.resolveExplorerTarget(launch.path).then((next) => { if (alive) setTarget(next); })
      .catch((reason) => { if (alive) setError(String(reason)); });
    return () => { alive = false; };
  }, [launch.path, needsRepo]);

  const notify = useCallback((kind: "success" | "error" | "info" | string, text: string) => {
    setMessage(`${kind === "error" ? "失败：" : ""}${text}`);
  }, []);

  const openInMain = async (path: string) => {
    setBusy(true);
    try { await api.openRepositoryInMain(path); await closeCurrentWindow(); }
    catch (reason) { setError(String(reason)); setBusy(false); throw reason; }
  };

  if (!PORTABLE_ACTIONS.includes(launch.action)) {
    return <Frame action={launch.action} target={null} message={message}>
      <div className="empty-state"><strong>此动作在主窗口中进行</strong>
        <button className="primary" onClick={() => { void api.focusMainWindow(); void closeCurrentWindow(); }}>打开主窗口</button>
      </div>
    </Frame>;
  }
  if (launch.action === "clone") {
    return <Frame action={launch.action} target={null} message={message}>
      <CloneDialog initialParent={launch.path ?? ""} onOpen={openInMain} onClose={() => void closeCurrentWindow()} onBusyChange={setBusy} />
    </Frame>;
  }
  if (launch.action === "create-repository") {
    return <Frame action={launch.action} target={null} message={message}>
      <CreateRepositoryDialog initialPath={launch.path ?? ""} onOpen={openInMain} onClose={() => void closeCurrentWindow()} onBusyChange={setBusy} />
    </Frame>;
  }
  if (error) {
    return <Frame action={launch.action} target={null} message={message}>
      <div className="empty-state" role="alert"><strong>无法打开所选位置</strong><span>{error}</span>
        <button onClick={() => void api.focusMainWindow()}>打开主窗口</button>
      </div>
    </Frame>;
  }
  if (!target) {
    return <Frame action={launch.action} target={null} message={message}>
      <div className="empty-state"><span className="spinner" /><span>正在读取仓库…</span></div>
    </Frame>;
  }

  const repoPath = target.repo.path;
  const initialPath = target.relativePath;
  let content: React.ReactNode;
  switch (launch.action) {
    case "commit":
    case "view-changes":
    case "reset-file-changes":
    case "add-files":
      content = <CommitWindow
        action={launch.action}
        target={target}
        onDirtyChange={setDirty}
        onBusyChange={setBusy}
        setMessage={(text) => notify("info", text)}
      />;
      break;
    case "pull":
      content = <PullWindow target={target} onBusyChange={setBusy} />;
      break;
    case "push":
      content = <PushDialog
        repoPath={repoPath}
        onClose={() => void closeCurrentWindow()}
        onChanged={() => undefined}
        onNotify={(kind, text, details) => notify(kind, details ? `${text}\n${details}` : text)}
      />;
      break;
    case "view-stash":
      content = <StashDialog repoPath={repoPath} onClose={() => void closeCurrentWindow()} onChanged={() => undefined} setMessage={(text) => notify("info", text)} />;
      break;
    case "checkout-branch":
    case "create-branch":
      content = <BranchWindow action={launch.action} target={target} message={(text) => notify("info", text)} />;
      break;
    case "checkout-revision":
      content = <CheckoutRevisionDialog repoPath={repoPath} onClose={() => void closeCurrentWindow()} onChanged={() => undefined} setMessage={(text) => notify("info", text)} />;
      break;
    case "open-with-difftool":
      content = <DiffToolWindow target={target} initialFile={initialPath} />;
      break;
    case "file-history":
      content = <HistoryWindow target={target} onBusyChange={setBusy} />;
      break;
    case "apply-patch":
      content = <ApplyPatchDialog
        repoPath={repoPath}
        initialPatchPath={target.scope === "file" && initialPath ? launch.path ?? "" : ""}
        onClose={() => void closeCurrentWindow()}
        onChanged={() => undefined}
        setMessage={(text) => notify("info", text)}
      />;
      break;
    default:
      content = <div className="empty-state">不支持的动作</div>;
  }

  return <Frame action={launch.action} target={target} message={message}>
    {content}
  </Frame>;
}
