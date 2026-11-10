import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useRepoBusy } from "../useRepoBusy";
import type { StatusEntry, StatusSnapshot } from "../types";
import Dialog from "../ui/Dialog";
import InlineError from "../ui/InlineError";

interface Props {
  repoPath: string;
  initialPath: string | null;
  onClose: () => void;
  onChanged: () => void;
  setMessage: (message: string) => void;
}

function matches(entry: StatusEntry, root: string | null): boolean {
  if (!root) return true;
  if (entry.path === root || entry.path.startsWith(`${root}/`)) return true;
  return !!entry.oldPath && (entry.oldPath === root || entry.oldPath.startsWith(`${root}/`));
}

/** 对应 Git Extensions 的 FormResetChanges：确认后重置选中范围的变更，
 * 可同时删除新增文件；区别于 ResetDialog（重置到某个提交）。 */
export default function ResetChangesDialog({ repoPath, initialPath, onClose, onChanged, setMessage }: Props) {
  const [status, setStatus] = useState<StatusSnapshot | null>(null);
  const [deleteNew, setDeleteNew] = useState(false);
  const [error, setError] = useState("");
  const [localBusy, setBusy] = useState(false);
  const repoBusy = useRepoBusy(repoPath);
  const busy = localBusy || repoBusy;
  const scopePath = initialPath && initialPath !== "." ? initialPath : null;

  useEffect(() => {
    let alive = true;
    api.getStatus(repoPath).then((next) => { if (alive) setStatus(next); })
      .catch((reason) => { if (alive) setError(String(reason)); });
    return () => { alive = false; };
  }, [repoPath]);

  const entries = useMemo(() => {
    if (!status) return [];
    const byPath = new Map<string, StatusEntry>();
    for (const entry of [...status.staged, ...status.unstaged]) {
      if (!matches(entry, scopePath)) continue;
      byPath.set(entry.path, entry);
      if (entry.oldPath) byPath.set(entry.oldPath, { ...entry, path: entry.oldPath });
    }
    return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  }, [status, scopePath]);

  const hasExisting = entries.some((entry) => entry.status !== "new");
  const hasNew = entries.some((entry) => entry.status === "new");
  const canDeleteNew = hasExisting && hasNew;

  useEffect(() => {
    if (!status) return;
    // 与 FormResetChanges 一致：只有新增文件时强制删除；没有新增文件时禁用。
    setDeleteNew(!hasExisting && hasNew);
  }, [status, hasExisting, hasNew]);

  const reset = async () => {
    if (busy || entries.length === 0) return;
    setBusy(true); setError("");
    try {
      await api.resetChanges(repoPath, entries.map((entry) => entry.path), deleteNew);
      setMessage(hasNew && deleteNew ? "已重置变更并删除新增文件" : "已重置变更");
      onChanged();
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return <Dialog title="重置更改" onClose={onClose} busy={busy} footer={<>
    <button disabled={busy} onClick={onClose}>取消</button>
    <button className="danger-button" disabled={busy || entries.length === 0} onClick={() => void reset()}>重置</button>
  </>}>
    <div className="dialog-form">
      <div className="settings-note">确定要重置{scopePath ? ` ${scopePath} 的` : "当前仓库的"}未提交更改吗？此操作无法通过 Git 恢复。</div>
      {!status && !error && <div className="panel-hint"><span className="spinner" /> 正在读取工作区…</div>}
      {status && entries.length === 0 && !error && <div className="panel-hint">没有可重置的变更。</div>}
      {entries.length > 0 && <div className="reset-change-list" role="list">
        {entries.map((entry) => <div key={`${entry.path}:${entry.status}`} className="reset-change-row">
          <span className={`file-status status-${entry.status}`}>{entry.status === "conflicted" ? "!" : entry.status[0].toUpperCase()}</span>
          <span className="file-path">{entry.path}</span>
        </div>)}
      </div>}
      <label className={canDeleteNew ? "checkbox-row" : "checkbox-row muted"}>
        <input type="checkbox" disabled={busy || !canDeleteNew} checked={deleteNew} onChange={(e) => setDeleteNew(e.target.checked)} />
        <span>同时删除新增文件 / 目录{!hasNew ? "（没有新增文件）" : !hasExisting ? "（只有新增文件）" : ""}</span>
      </label>
      {error && <InlineError message={error} />}
    </div>
  </Dialog>;
}
