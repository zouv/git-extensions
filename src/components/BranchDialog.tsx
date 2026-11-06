import { useState } from "react";
import { api } from "../api";
import { useRepoBusy } from "../useRepoBusy";
import type { BranchInfo } from "../types";
import Dialog from "../ui/Dialog";
import InlineError from "../ui/InlineError";
import { moveListFocus } from "../ui/listNav";
import { useDirtyClose } from "../ui/useDirtyClose";
import { useConfirm } from "../ui/Confirm";

interface Props {
  repoPath: string;
  branches: BranchInfo[];
  initialStartPoint?: string;
  initialMode?: "checkout" | "create";
  onClose: () => void;
  onChanged: () => void;
  setMessage: (msg: string) => void;
}

export default function BranchDialog({ repoPath, branches, initialStartPoint, initialMode = "checkout", onClose, onChanged, setMessage }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [force, setForce] = useState(false);
  const [error, setError] = useState("");
  const [localBusy, setBusy] = useState(false);
  const repoBusy = useRepoBusy(repoPath);
  const busy = localBusy || repoBusy;
  const confirm = useConfirm();
  const selectedBranch = branches.find((b) => b.name === selected && !b.isRemote) ?? null;
  const close = useDirtyClose(newName.trim().length > 0, busy, onClose);

  const run = async (action: () => Promise<unknown>, success: string) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await action(); setMessage(success); onChanged(); onClose(); }
    catch (e) { setError(String(e)); setMessage(String(e)); setBusy(false); }
  };
  const remove = async () => {
    if (!selectedBranch) return;
    const ok = await confirm({ title: `删除分支 ${selectedBranch.name}？`, body: force ? "强制删除不会检查分支是否已合并，未合并提交可能难以找回。" : "Git 会检查该分支是否已合并。删除分支不会删除远程分支。", confirmLabel: force ? "强制删除" : "删除分支", danger: true, requireAck: force, ackLabel: "我确认强制删除未合并分支" });
    if (ok) void run(() => api.deleteBranch(repoPath, selectedBranch.name, force), `已删除 ${selectedBranch.name}`);
  };

  return (
    <Dialog title="分支管理" onClose={close} busy={busy} footer={<button onClick={close} disabled={busy}>关闭</button>}>
      {error && <InlineError message={error} />}
      <div className="branch-list" tabIndex={-1} role="listbox" aria-label="分支">
        {branches.map((branch) => <div key={branch.name} className={`branch-item${selected === branch.name ? " selected" : ""}${branch.isRemote ? " remote" : ""}`} role="option" aria-selected={selected === branch.name} tabIndex={0} onFocus={() => setSelected(branch.name)} onClick={() => setSelected(branch.name)} onKeyDown={(e) => { if (moveListFocus(e, ".branch-item")) return; if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(branch.name); } }} onDoubleClick={() => { if (!branch.isRemote && !branch.isHead) void run(() => api.checkoutBranch(repoPath, branch.name), `已切换到 ${branch.name}`); }}>
          <span className={branch.isHead ? "branch-head" : ""}>{branch.isHead ? "● " : ""}{branch.name}</span><span className="branch-oid">{branch.oid.slice(0, 7)}</span>
        </div>)}
      </div>
      <div className="branch-actions">
        <button disabled={busy || !selectedBranch || selectedBranch.isHead} onClick={() => selectedBranch && void run(() => api.checkoutBranch(repoPath, selectedBranch.name), `已切换到 ${selectedBranch.name}`)}>切换</button>
        <button className="danger-button" disabled={busy || !selectedBranch || selectedBranch.isHead} onClick={() => void remove()}>删除…</button>
        <label className="force-label"><input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />强制删除</label>
      </div>
      <div className="branch-create">
        <input data-autofocus={initialMode === "create" ? "" : undefined} placeholder="新分支名" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <span className="muted">基于 {initialStartPoint ?? "HEAD"}</span>
        <button className="primary" disabled={busy || !newName.trim()} onClick={() => void run(() => api.createBranch(repoPath, newName.trim(), initialStartPoint), `已创建 ${newName.trim()}`)}>新建分支</button>
      </div>
    </Dialog>
  );
}
