import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { SubmoduleInfo } from "../types";

interface Props {
  repoPath: string;
  onClose: () => void;
  onChanged: () => void;
  setMessage: (msg: string) => void;
}

export default function SubmoduleDialog({ repoPath, onClose, onChanged, setMessage }: Props) {
  const [modules, setModules] = useState<SubmoduleInfo[]>([]);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    api.submoduleList(repoPath).then(setModules).catch((e) => setMessage(String(e)));
  }, [repoPath, setMessage]);

  useEffect(reload, [reload]);

  const update = async () => {
    setBusy(true);
    try {
      await api.submoduleUpdate(repoPath);
      setMessage("子模块更新完成");
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
        <h3>子模块</h3>
        <div className="branch-list">
          {modules.map((m) => (
            <div key={m.path} className="branch-item" title={m.oid}>
              <span>
                {m.path}
                {m.status !== "clean" && <span className="submodule-status">（{m.status}）</span>}
              </span>
              <span className="branch-oid">{m.oid.slice(0, 7)}</span>
            </div>
          ))}
          {modules.length === 0 && <div className="panel-hint">（无子模块）</div>}
        </div>
        <div className="branch-actions">
          <button className="primary" disabled={busy || modules.length === 0} onClick={() => void update()}>
            初始化并更新（--init --recursive）
          </button>
        </div>
        <div className="modal-footer">
          <button onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}
