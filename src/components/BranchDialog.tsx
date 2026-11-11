import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { decideBranchDeletion } from "../branchDelete";
import { singleBranchDeleteConfirm } from "../branchDeleteDialog";
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
  initialSelected?: string;
  onClose: () => void;
  onChanged: () => void;
  setMessage: (msg: string) => void;
  onMergeRef?: (ref: string) => void;
}

export default function BranchDialog({ repoPath, branches, initialStartPoint, initialMode = "checkout", initialSelected, onClose, onChanged, setMessage, onMergeRef }: Props) {
  const [selected, setSelected] = useState<string | null>(initialSelected ?? null);
  const [newName, setNewName] = useState("");
  const [renameTo, setRenameTo] = useState("");
  const [strategy, setStrategy] = useState<"default" | "stash" | "reset">("default");
  const [localName, setLocalName] = useState("");
  const [checkoutAfterCreate, setCheckoutAfterCreate] = useState(true);
  const [orphan, setOrphan] = useState(false);
  const [mergedNames, setMergedNames] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [localBusy, setBusy] = useState(false);
  const repoBusy = useRepoBusy(repoPath);
  const busy = localBusy || repoBusy;
  const branchDeleteFlow = useRef(false);
  const confirm = useConfirm();
  const selectedEntry = branches.find((b) => b.name === selected) ?? null;
  const selectedBranch = selectedEntry && !selectedEntry.isRemote ? selectedEntry : null;
  const selectedRemote = selectedEntry && selectedEntry.isRemote ? selectedEntry : null;
  const close = useDirtyClose(newName.trim().length > 0 || renameTo.trim().length > 0 || localName.trim().length > 0, busy, onClose);

  useEffect(() => {
    let alive = true;
    api.getMergedBranches(repoPath).then((list) => {
      if (alive) setMergedNames(list);
    }).catch(() => { /* ignore */ });
    return () => { alive = false; };
  }, [repoPath, branches]);

  const run = async (action: () => Promise<unknown>, success: string, closeOnDone = true) => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      await action();
      setMessage(success);
      onChanged();
      if (closeOnDone) onClose();
      else setBusy(false);
    } catch (e) { setError(String(e)); setMessage(String(e)); setBusy(false); }
  };

  const remove = async () => {
    if (selectedRemote) {
      const ok = await confirm({
        title: `删除远程分支 ${selectedRemote.name}？`,
        body: "将向远端执行 git push --delete，删除后其他协作者也将失去该远程分支引用。",
        confirmLabel: "删除远程分支",
        danger: true,
        requireAck: true,
        ackLabel: "我确认从远端仓库删除该分支",
      });
      if (ok) void run(() => api.deleteRemoteBranch(repoPath, selectedRemote.name), `已删除远程分支 ${selectedRemote.name}`);
      return;
    }
    if (!selectedBranch) return;
    if (branchDeleteFlow.current) return;
    const target = selectedBranch;
    branchDeleteFlow.current = true;
    setError("");
    try {
      const statuses = await api.getBranchDeleteStatus(repoPath, [target.name]);
      const decision = decideBranchDeletion(statuses, [target.name]);
      if (decision.names.length === 0) {
        setError(`分支 ${target.name} 已不存在，请刷新列表`);
        onChanged();
        return;
      }
      const force = decision.force;
      const ok = await confirm(singleBranchDeleteConfirm(target.name, target.oid, force));
      if (ok) {
        await run(
          () => api.deleteBranch(repoPath, target.name, force),
          force ? `已强制删除 ${target.name}` : `已删除 ${target.name}`,
        );
      }
    } catch (e) {
      setError(String(e));
      setMessage(String(e));
    } finally {
      branchDeleteFlow.current = false;
    }
  };

  const confirmReset = async () => {
    if (strategy !== "reset") return true;
    return confirm({
      title: "丢弃本地修改并切换？",
      body: "当前工作区与暂存区的未提交修改会被丢弃，且无法通过 Git 恢复。",
      confirmLabel: "丢弃并切换",
      danger: true,
      requireAck: true,
      ackLabel: "我确认丢弃当前未提交修改",
    });
  };

  const checkoutSelected = () => {
    void (async () => {
      if (!await confirmReset()) return;
      if (selectedRemote) {
        void run(() => api.checkoutRemoteBranch(repoPath, selectedRemote.name, localName.trim() || undefined, strategy), `已检出并跟踪 ${selectedRemote.name}`);
        return;
      }
      if (selectedBranch && !selectedBranch.isHead) {
        void run(() => api.checkoutBranch(repoPath, selectedBranch.name, strategy), `已切换到 ${selectedBranch.name}`);
      }
    })();
  };

  const renameSelected = () => {
    if (!selectedBranch || !renameTo.trim() || renameTo.trim() === selectedBranch.name) return;
    const target = renameTo.trim();
    void run(async () => {
      await api.renameBranch(repoPath, selectedBranch.name, target);
      setRenameTo("");
    }, `已将 ${selectedBranch.name} 重命名为 ${target}`);
  };

  const cleanMerged = async () => {
    if (mergedNames.length === 0) return;
    const ok = await confirm({
      title: `批量清理 ${mergedNames.length} 个已合并本地分支？`,
      body: <div><p>以下本地分支已合并到当前 HEAD（已自动排除 main/master/develop/trunk 及当前分支）：</p><pre className="confirm-file-list">{mergedNames.join("\n")}</pre></div>,
      confirmLabel: `删除 ${mergedNames.length} 个分支`,
      danger: true,
    });
    if (!ok) return;
    void run(async () => {
      await api.deleteBranches(repoPath, mergedNames, false);
      setMergedNames([]);
    }, `已清理 ${mergedNames.length} 个已合并分支`, false);
  };

  return (
    <Dialog title="分支管理" onClose={close} busy={busy} footer={<>
      {mergedNames.length > 0 && (
        <button className="danger-button" disabled={busy} onClick={() => void cleanMerged()} title={`可清理：${mergedNames.join(", ")}`}>
          清理已合并分支 ({mergedNames.length})…
        </button>
      )}
      <button onClick={close} disabled={busy}>关闭</button>
    </>}>
      {error && <InlineError message={error} />}
      <div className="branch-list" tabIndex={-1} role="listbox" aria-label="分支">
        {branches.map((branch) => <div key={`${branch.isRemote ? "r" : "l"}:${branch.name}`} className={`branch-item${selected === branch.name ? " selected" : ""}${branch.isRemote ? " remote" : ""}`} role="option" aria-selected={selected === branch.name} tabIndex={0} onFocus={() => { setSelected(branch.name); if (!branch.isRemote) setRenameTo(branch.name); }} onClick={() => { setSelected(branch.name); if (!branch.isRemote) setRenameTo(branch.name); }} onKeyDown={(e) => { if (moveListFocus(e, ".branch-item")) return; if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(branch.name); } }} onDoubleClick={() => { if ((!branch.isRemote && !branch.isHead) || branch.isRemote) checkoutSelected(); }}>
          <span className={branch.isHead ? "branch-head" : ""}>{branch.isHead ? "● " : ""}{branch.name}</span>
          <span>{mergedNames.includes(branch.name) && <span className="badge-merged" title="已合并到 HEAD">已合并</span>} <span className="branch-oid">{branch.oid.slice(0, 7)}</span></span>
        </div>)}
      </div>
      <div className="branch-actions">
        {selectedRemote && <input aria-label="本地分支名" placeholder="本地分支名（默认同名）" value={localName} onChange={(e) => setLocalName(e.target.value)} />}
        <label className="branch-strategy">本地修改
          <select aria-label="本地修改处理" disabled={busy} value={strategy} onChange={(e) => setStrategy(e.target.value as "default" | "stash" | "reset")}>
            <option value="default">保持（Git 默认）</option>
            <option value="stash">暂存后切换</option>
            <option value="reset">丢弃后切换</option>
          </select>
        </label>
        <button disabled={busy || (!selectedBranch && !selectedRemote) || !!selectedBranch?.isHead} onClick={checkoutSelected}>
          {selectedRemote ? "检出跟踪分支" : "切换"}
        </button>
        {onMergeRef && (
          <button disabled={busy || !selectedEntry || !!selectedBranch?.isHead} onClick={() => { if (selectedEntry) { onClose(); onMergeRef(selectedEntry.name); } }}>
            合并到当前分支…
          </button>
        )}
        <button className="danger-button" disabled={busy || (!selectedBranch && !selectedRemote) || !!selectedBranch?.isHead} onClick={() => void remove()}>
          {selectedRemote ? "删除远程分支…" : "删除…"}
        </button>
      </div>
      {selectedBranch && (
        <div className="branch-create">
          <input aria-label="重命名分支" placeholder="重命名选中本地分支" value={renameTo} onChange={(e) => setRenameTo(e.target.value)} />
          <span className="muted">原名 {selectedBranch.name}</span>
          <button disabled={busy || !renameTo.trim() || renameTo.trim() === selectedBranch.name} onClick={renameSelected}>重命名</button>
        </div>
      )}
      <div className="branch-create">
        <input data-autofocus={initialMode === "create" ? "" : undefined} placeholder="新分支名" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <span className="muted">{orphan ? "孤儿分支（无父提交）" : `基于 ${initialStartPoint ?? selectedEntry?.name ?? "HEAD"}`}</span>
        <label className="force-label"><input type="checkbox" checked={orphan || checkoutAfterCreate} disabled={busy || orphan} onChange={(e) => setCheckoutAfterCreate(e.target.checked)} />创建后切换</label>
        <label className="force-label"><input type="checkbox" checked={orphan} disabled={busy} onChange={(e) => setOrphan(e.target.checked)} />孤儿分支</label>
        <button className="primary" disabled={busy || !newName.trim()} onClick={() => void run(() => api.createBranch(repoPath, newName.trim(), orphan ? undefined : (initialStartPoint ?? selectedEntry?.name), checkoutAfterCreate, orphan), `已创建 ${newName.trim()}`)}>新建分支</button>
      </div>
    </Dialog>
  );
}
