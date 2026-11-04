import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useRepoBusy } from "../useRepoBusy";
import type { ExplorerAction, ExplorerTarget, OperationState, StatusSnapshot } from "../types";
import ChangesPanel from "../components/ChangesPanel";
import { loadSettings } from "../settings";
import { useConfirm } from "../ui/Confirm";

interface Props {
  action: Extract<ExplorerAction, "commit" | "view-changes" | "add-files" | "reset-file-changes">;
  target: ExplorerTarget;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
  setMessage: (message: string) => void;
}

/** A focused working-tree window. It intentionally does not mount the main
 * repository graph, tabs, polling loop or persisted workspace layout. */
export default function CommitWindow({ action, target, onDirtyChange, onBusyChange, setMessage }: Props) {
  const [status, setStatus] = useState<StatusSnapshot | null>(null);
  const [operation, setOperation] = useState<OperationState | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [width, setWidth] = useState(360);
  const [highlightEnabled, setHighlightEnabled] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const request = useRef(0);
  const confirm = useConfirm();
  const repoBusy = useRepoBusy(target.repo.path);

  const reload = useCallback(async () => {
    const current = ++request.current;
    try {
      const [nextStatus, nextOperation] = await Promise.all([
        api.getStatus(target.repo.path),
        api.getOperationState(target.repo.path),
      ]);
      if (current !== request.current) return;
      setStatus(nextStatus);
      setOperation(nextOperation);
      setError("");
      setVersion((value) => value + 1);
    } catch (reason) {
      if (current === request.current) { setError(String(reason)); setMessage(String(reason)); }
    }
  }, [target.repo.path, setMessage]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { setHighlightEnabled(loadSettings().highlightEnabled); }, []);
  useEffect(() => { onBusyChange(repoBusy); }, [repoBusy, onBusyChange]);
  useEffect(() => () => onBusyChange(false), [onBusyChange]);

  const discard = async (paths: string[], untracked: boolean) => {
    if (confirming) return;
    setConfirming(true);
    try {
      const ok = await confirm({
        title: untracked ? "删除未跟踪文件？" : "丢弃未暂存变更？",
        body: untracked
          ? `将永久删除 ${paths.length} 个未跟踪文件；此操作无法通过 Git 恢复。`
          : `将把 ${paths.length} 个文件的未暂存内容恢复到暂存区版本。已暂存内容保留。`,
        confirmLabel: untracked ? "删除文件" : "丢弃变更",
        danger: true,
        requireAck: untracked,
        ackLabel: "我确认这些未跟踪文件会被永久删除",
      });
      if (!ok) return;
      if (untracked) await api.deleteUntrackedFiles(target.repo.path, paths);
      else await api.discardFiles(target.repo.path, paths);
      setMessage(untracked ? "已删除未跟踪文件" : "已丢弃未暂存变更");
      await reload();
    } catch (reason) {
      setError(String(reason)); setMessage(String(reason));
    } finally {
      setConfirming(false);
    }
  };

  const pathAction = async (kind: "open" | "reveal" | "copy-path", path: string) => {
    try {
      if (kind === "open") await api.openPath(target.repo.path, path);
      else if (kind === "reveal") await api.revealPath(target.repo.path, path);
      else await navigator.clipboard?.writeText(path);
    } catch (reason) { setError(String(reason)); setMessage(String(reason)); }
  };

  if (!status) {
    return <div className="empty-state">{error ? <span role="alert">{error}</span> : <><span className="spinner" /><span>读取工作区…</span></>}</div>;
  }

  const conflictCount = status.staged.concat(status.unstaged).filter((entry) => entry.status === "conflicted").length
    + (operation?.conflicts.length ?? 0);

  return <div className="portable-changes">
    {error && <div className="inline-error" role="alert">{error}</div>}
    <ChangesPanel
      repoPath={target.repo.path}
      status={status}
      width={width}
      conflictCount={conflictCount}
      onWidth={setWidth}
      onRefresh={() => void reload()}
      refreshVersion={version}
      setMessage={setMessage}
      highlightEnabled={highlightEnabled}
      onPathAction={(kind, path) => void pathAction(kind, path)}
      onDiscard={(paths, untracked) => void discard(paths, untracked)}
      onOpenConflict={() => { void api.openRepositoryInMain(target.repo.path); setMessage("已转到主窗口；请在冲突中心解决冲突"); }}
      onDirtyChange={onDirtyChange}
      focusCommitSignal={action === "commit" ? 1 : 0}
      initialPath={target.relativePath}
    />
  </div>;
}
