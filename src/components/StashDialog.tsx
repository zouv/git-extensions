import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { StashInfo } from "../types";
import Dialog from "../ui/Dialog";
import { useConfirm } from "../ui/Confirm";

interface Props { repoPath: string; onClose: () => void; onChanged: () => void; setMessage: (msg: string) => void }

export default function StashDialog({ repoPath, onClose, onChanged, setMessage }: Props) {
  const [stashes, setStashes] = useState<StashInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setStashMessage] = useState("");
  const [includeUntracked, setIncludeUntracked] = useState(false);
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  const reload = useCallback(() => { api.stashList(repoPath).then(setStashes).catch((e) => setMessage(String(e))); }, [repoPath, setMessage]);
  useEffect(reload, [reload]);
  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try { await action(); setMessage(success); reload(); onChanged(); }
    catch (e) { setMessage(String(e)); }
    finally { setBusy(false); }
  };
  return <Dialog title="Stash 管理" onClose={onClose} busy={busy} footer={<button disabled={busy} onClick={onClose}>关闭</button>}>
    <div className="branch-list">{stashes.map((stash) => <div key={stash.name} className={`branch-item${selected === stash.name ? " selected" : ""}`} onClick={() => setSelected(stash.name)} title={stash.oid}><span>{stash.message || stash.name}</span><span className="branch-oid">{stash.name}</span></div>)}{stashes.length === 0 && <div className="panel-hint">（无 stash）</div>}</div>
    <div className="branch-actions">
      <button disabled={busy || !selected} onClick={() => void run(() => api.stashApply(repoPath, selected!, false), "已应用 stash")}>应用</button>
      <button disabled={busy || !selected} onClick={() => void run(() => api.stashApply(repoPath, selected!, true), "已弹出 stash")}>弹出</button>
      <button className="danger-button" disabled={busy || !selected} onClick={async () => { if (await confirm({ title: `删除 ${selected}？`, body: "删除后无法通过 Stash 列表恢复。", danger: true, confirmLabel: "删除 Stash" })) void run(() => api.stashDrop(repoPath, selected!), "已删除 stash"); }}>删除…</button>
    </div>
    <div className="branch-create"><input placeholder="stash 说明（可空）" value={message} onChange={(e) => setStashMessage(e.target.value)} /><label className="force-label"><input type="checkbox" checked={includeUntracked} onChange={(e) => setIncludeUntracked(e.target.checked)} />含未跟踪</label><button className="primary" disabled={busy} onClick={() => void run(() => api.stashPush(repoPath, message, includeUntracked), "已保存 stash")}>保存 stash</button></div>
  </Dialog>;
}
