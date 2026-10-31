import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { StashInfo } from "../types";

interface Props {
  repoPath: string;
  onClose: () => void;
  onChanged: () => void;
  setMessage: (msg: string) => void;
}

export default function StashDialog({ repoPath, onClose, onChanged, setMessage }: Props) {
  const [stashes, setStashes] = useState<StashInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setStashMessage] = useState("");
  const [includeUntracked, setIncludeUntracked] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    api.stashList(repoPath).then(setStashes).catch((e) => setMessage(String(e)));
  }, [repoPath, setMessage]);

  useEffect(reload, [reload]);

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await action();
      setMessage(success);
      reload();
      onChanged();
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Stash 管理</h3>
        <div className="branch-list">
          {stashes.map((s) => (
            <div
              key={s.name}
              className={`branch-item${selected === s.name ? " selected" : ""}`}
              onClick={() => setSelected(s.name)}
              title={s.oid}
            >
              <span>{s.message || s.name}</span>
              <span className="branch-oid">{s.name}</span>
            </div>
          ))}
          {stashes.length === 0 && <div className="panel-hint">（无 stash）</div>}
        </div>
        <div className="branch-actions">
          <button disabled={busy || !selected} onClick={() => void run(() => api.stashApply(repoPath, selected!, false), "已应用 stash")}>
            应用
          </button>
          <button disabled={busy || !selected} onClick={() => void run(() => api.stashApply(repoPath, selected!, true), "已弹出 stash")}>
            弹出
          </button>
          <button
            disabled={busy || !selected}
            onClick={() => {
              if (window.confirm(`确定删除 ${selected} 吗？`))
                void run(() => api.stashDrop(repoPath, selected!), "已删除 stash");
            }}
          >
            删除
          </button>
        </div>
        <div className="branch-create">
          <input
            placeholder="stash 说明（可空）"
            value={message}
            onChange={(e) => setStashMessage(e.target.value)}
          />
          <label className="force-label">
            <input type="checkbox" checked={includeUntracked} onChange={(e) => setIncludeUntracked(e.target.checked)} />
            含未跟踪
          </label>
          <button className="primary" disabled={busy} onClick={() => void run(() => api.stashPush(repoPath, message, includeUntracked), "已保存 stash")}>
            保存 stash
          </button>
        </div>
        <div className="modal-footer">
          <button onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}
