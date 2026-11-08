import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { pickDirectory } from "../nativeDialog";
import { useRepoBusy } from "../useRepoBusy";
import type { WorktreeInfo } from "../types";
import Dialog from "../ui/Dialog";
import InlineError from "../ui/InlineError";
import { useConfirm } from "../ui/Confirm";

interface Props {
  repoPath: string;
  onClose: () => void;
  onChanged: () => void;
  onOpenWorktree: (path: string) => void;
  setMessage: (msg: string) => void;
}

export default function WorktreeDialog({ repoPath, onClose, onChanged, onOpenWorktree, setMessage }: Props) {
  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [targetDir, setTargetDir] = useState("");
  const [branch, setBranch] = useState("");
  const [createNewBranch, setCreateNewBranch] = useState(true);
  const [forceRemove, setForceRemove] = useState(false);
  const [error, setError] = useState("");
  const [localBusy, setBusy] = useState(false);
  const repoBusy = useRepoBusy(repoPath);
  const busy = localBusy || repoBusy;
  const confirm = useConfirm();

  const load = useCallback(async () => {
    try {
      const list = await api.worktreeList(repoPath);
      setWorktrees(list);
      if (list.length > 0 && (!selected || !list.some((w) => w.name === selected))) {
        setSelected(list[0].name);
      } else if (list.length === 0) {
        setSelected(null);
      }
    } catch (e) {
      setError(String(e));
    }
  }, [repoPath, selected]);

  useEffect(() => { void load(); }, [load]);

  const current = worktrees.find((w) => w.name === selected) ?? null;

  const run = async (action: () => Promise<unknown>, success: string) => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      await action();
      setMessage(success);
      await load();
      onChanged();
    } catch (e) {
      setError(String(e));
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  };

  const browseDir = async () => {
    const picked = await pickDirectory("选择新 Worktree 目录");
    if (picked) setTargetDir(picked);
  };

  const addWorktree = () => {
    if (!targetDir.trim()) return;
    const dir = targetDir.trim();
    const br = branch.trim() || undefined;
    void run(async () => {
      await api.worktreeAdd(repoPath, dir, br, createNewBranch && !!br);
      setTargetDir(""); setBranch("");
    }, `已创建 Worktree：${dir}`);
  };

  const removeWorktree = async () => {
    if (!current) return;
    const ok = await confirm({
      title: `移除 Worktree ${current.name}？`,
      body: `将移除链接工作树 ${current.path}${forceRemove ? "（强制移除，包含未提交修改）" : ""}。`,
      confirmLabel: forceRemove ? "强制移除" : "移除 Worktree",
      danger: true,
      requireAck: forceRemove,
      ackLabel: "我确认强制移除该 Worktree 及其中未提交的修改",
    });
    if (!ok) return;
    void run(() => api.worktreeRemove(repoPath, current.name, forceRemove), `已移除 Worktree ${current.name}`);
  };

  return (
    <Dialog
      title="Worktree 多工作树管理"
      wide
      busy={busy}
      onClose={onClose}
      footer={<>
        <button disabled={busy} onClick={() => void run(() => api.worktreePrune(repoPath), "已清理失效 Worktree 记录")}>
          清理失效记录 (Prune)
        </button>
        <button onClick={onClose} disabled={busy}>关闭</button>
      </>}
    >
      {error && <InlineError message={error} />}
      <div className="branch-list" role="listbox" aria-label="Worktree 列表">
        {worktrees.map((w) => (
          <div
            key={w.name}
            role="option"
            aria-selected={w.name === selected}
            className={`branch-item${w.name === selected ? " selected" : ""}`}
            tabIndex={0}
            onClick={() => setSelected(w.name)}
            onDoubleClick={() => { onOpenWorktree(w.path); onClose(); }}
          >
            <span><strong>{w.name}</strong> {w.locked && <span className="badge-merged">已锁定</span>}</span>
            <span className="branch-oid">{w.path}</span>
          </div>
        ))}
        {worktrees.length === 0 && <div className="panel-hint">当前仓库没有额外的 linked worktree。</div>}
      </div>
      {current && (
        <div className="branch-actions">
          <button disabled={busy} onClick={() => { onOpenWorktree(current.path); onClose(); }}>在新页签打开</button>
          <button disabled={busy} onClick={() => void run(() => api.worktreeLock(repoPath, current.name, !current.locked), `${current.locked ? "已解锁" : "已锁定"} Worktree ${current.name}`)}>
            {current.locked ? "解锁" : "锁定"}
          </button>
          <button className="danger-button" disabled={busy} onClick={() => void removeWorktree()}>移除…</button>
          <label className="force-label"><input type="checkbox" checked={forceRemove} onChange={(e) => setForceRemove(e.target.checked)} />强制移除</label>
        </div>
      )}
      <div className="dialog-form">
        <div className="branch-create">
          <input placeholder="新 Worktree 目录路径" disabled={busy} value={targetDir} onChange={(e) => setTargetDir(e.target.value)} />
          <button disabled={busy} onClick={() => void browseDir()}>浏览…</button>
        </div>
        <div className="branch-create">
          <input placeholder="分支名称（留空则使用当前 HEAD）" disabled={busy} value={branch} onChange={(e) => setBranch(e.target.value)} />
          <label className="force-label">
            <input type="checkbox" disabled={busy} checked={createNewBranch} onChange={(e) => setCreateNewBranch(e.target.checked)} />
            新建分支 (-b)
          </label>
          <button className="primary" disabled={busy || !targetDir.trim()} onClick={addWorktree}>新建 Worktree</button>
        </div>
      </div>
    </Dialog>
  );
}
