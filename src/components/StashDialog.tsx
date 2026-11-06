import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { useRepoBusy } from "../useRepoBusy";
import type { StashInfo } from "../types";
import Dialog from "../ui/Dialog";
import InlineError from "../ui/InlineError";
import { moveListFocus } from "../ui/listNav";
import { useDirtyClose } from "../ui/useDirtyClose";
import { useConfirm } from "../ui/Confirm";

interface Props { repoPath: string; onClose: () => void; onChanged: () => void; setMessage: (msg: string) => void }

export default function StashDialog({ repoPath, onClose, onChanged, setMessage }: Props) {
  const [stashes, setStashes] = useState<StashInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setStashMessage] = useState("");
  const [includeUntracked, setIncludeUntracked] = useState(false);
  const [error, setError] = useState("");
  const [localBusy, setBusy] = useState(false);
  const repoBusy = useRepoBusy(repoPath);
  const busy = localBusy || repoBusy;
  const confirm = useConfirm();
  const close = useDirtyClose(message.trim().length > 0, busy, onClose);
  const reload = useCallback(() => { api.stashList(repoPath).then(setStashes).catch((e) => { setError(String(e)); setMessage(String(e)); }); }, [repoPath, setMessage]);
  useEffect(reload, [reload]);
  const run = async (action: () => Promise<unknown>, success: string) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await action(); setMessage(success); reload(); onChanged(); }
    catch (e) { setError(String(e)); setMessage(String(e)); }
    finally { setBusy(false); }
  };
  return <Dialog title="Stash 管理" onClose={close} busy={busy} footer={<button disabled={busy} onClick={close}>关闭</button>}>
    {error && <InlineError message={error} />}
    <div className="branch-list" role="listbox" aria-label="Stash 列表">{stashes.map((stash) => <div key={stash.name} className={`branch-item${selected === stash.name ? " selected" : ""}`} role="option" aria-selected={selected === stash.name} tabIndex={0} onFocus={() => setSelected(stash.name)} onClick={() => setSelected(stash.name)} onKeyDown={(e) => { if (moveListFocus(e, ".branch-item")) return; if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(stash.name); } }} title={stash.oid}><span>{stash.message || stash.name}</span><span className="branch-oid">{stash.name}</span></div>)}{stashes.length === 0 && <div className="panel-hint">（无 stash）</div>}</div>
    <div className="branch-actions">
      <button disabled={busy || !selected} onClick={() => void run(() => api.stashApply(repoPath, selected!, false, stashes.find((s) => s.name === selected)?.oid), "已应用 stash")}>应用</button>
      <button disabled={busy || !selected} onClick={() => void run(() => api.stashApply(repoPath, selected!, true, stashes.find((s) => s.name === selected)?.oid), "已弹出 stash")}>弹出</button>
      <button className="danger-button" disabled={busy || !selected} onClick={async () => { if (await confirm({ title: `删除 ${selected}？`, body: "删除后无法通过 Stash 列表恢复。", danger: true, confirmLabel: "删除 Stash" })) void run(() => api.stashDrop(repoPath, selected!, stashes.find((s) => s.name === selected)?.oid), "已删除 stash"); }}>删除…</button>
    </div>
    <div className="branch-create"><input placeholder="stash 说明（可空）" value={message} onChange={(e) => setStashMessage(e.target.value)} /><label className="force-label"><input type="checkbox" checked={includeUntracked} onChange={(e) => setIncludeUntracked(e.target.checked)} />含未跟踪</label><button className="primary" disabled={busy} onClick={() => void run(() => api.stashPush(repoPath, message, includeUntracked), "已保存 stash")}>保存 stash</button></div>
  </Dialog>;
}
