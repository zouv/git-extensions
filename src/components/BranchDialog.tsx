import { useState } from "react";
import { api } from "../api";
import type { BranchInfo } from "../types";

interface Props {
  repoPath: string;
  branches: BranchInfo[];
  onClose: () => void;
  onChanged: () => void;
  setMessage: (msg: string) => void;
}

export default function BranchDialog({ repoPath, branches, onClose, onChanged, setMessage }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);

  const selectedBranch = branches.find((b) => b.name === selected && !b.isRemote) ?? null;

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await action();
      setMessage(success);
      onChanged();
      onClose();
    } catch (e) {
      setMessage(String(e));
      setBusy(false);
    }
  };

  const checkout = () => {
    if (!selectedBranch) return;
    void run(() => api.checkoutBranch(repoPath, selectedBranch.name), `已切换到 ${selectedBranch.name}`);
  };
  const remove = () => {
    if (!selectedBranch) return;
    if (!window.confirm(`确定删除分支 ${selectedBranch.name} 吗？${force ? "（强制，未合并的提交可能丢失）" : ""}`))
      return;
    void run(() => api.deleteBranch(repoPath, selectedBranch.name, force), `已删除 ${selectedBranch.name}`);
  };
  const create = () => {
    if (!newName.trim()) return setMessage("分支名不能为空");
    void run(() => api.createBranch(repoPath, newName.trim()), `已创建分支 ${newName.trim()}`);
  };

  const local = branches.filter((b) => !b.isRemote);
  const remote = branches.filter((b) => b.isRemote);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>分支管理</h3>
        <div className="branch-list">
          {local.map((b) => (
            <div
              key={b.name}
              className={`branch-item${selected === b.name ? " selected" : ""}`}
              onClick={() => setSelected(b.name)}
              onDoubleClick={() => {
                if (!b.isHead) void run(() => api.checkoutBranch(repoPath, b.name), `已切换到 ${b.name}`);
              }}
            >
              <span className={b.isHead ? "branch-head" : ""}>{b.isHead ? "● " : ""}{b.name}</span>
              <span className="branch-oid">{b.oid.slice(0, 7)}</span>
            </div>
          ))}
          <div className="branch-group">远程分支（只读）</div>
          {remote.map((b) => (
            <div key={b.name} className="branch-item remote" title={b.oid}>
              <span>{b.name}</span>
              <span className="branch-oid">{b.oid.slice(0, 7)}</span>
            </div>
          ))}
        </div>
        <div className="branch-actions">
          <button disabled={busy || !selectedBranch || selectedBranch.isHead} onClick={checkout}>
            切换
          </button>
          <button disabled={busy || !selectedBranch || selectedBranch.isHead} onClick={remove}>
            删除
          </button>
          <label className="force-label">
            <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
            强制删除
          </label>
        </div>
        <div className="branch-create">
          <input
            placeholder="新分支名（基于 HEAD）"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button className="primary" disabled={busy} onClick={create}>新建分支</button>
        </div>
        <div className="modal-footer">
          <button onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}
