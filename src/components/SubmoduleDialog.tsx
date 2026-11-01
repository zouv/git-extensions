import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { useRepoBusy } from "../useRepoBusy";
import type { SubmoduleInfo } from "../types";
import Dialog from "../ui/Dialog";

interface Props { repoPath: string; onClose: () => void; onChanged: () => void; setMessage: (msg: string) => void }

export default function SubmoduleDialog({ repoPath, onClose, onChanged, setMessage }: Props) {
  const [modules, setModules] = useState<SubmoduleInfo[]>([]);
  const [localBusy, setBusy] = useState(false);
  const repoBusy = useRepoBusy(repoPath);
  const busy = localBusy || repoBusy;
  const reload = useCallback(() => { api.submoduleList(repoPath).then(setModules).catch((e) => setMessage(String(e))); }, [repoPath, setMessage]);
  useEffect(reload, [reload]);
  const update = async () => {
    if (busy) return;
    setBusy(true);
    try { await api.submoduleUpdate(repoPath); setMessage("子模块更新完成"); reload(); onChanged(); }
    catch (e) { setMessage(String(e)); }
    finally { setBusy(false); }
  };
  return <Dialog title="子模块" onClose={onClose} busy={busy} footer={<button disabled={busy} onClick={onClose}>关闭</button>}>
    <div className="branch-list">{modules.map((module) => <div key={module.path} className="branch-item" title={module.oid}><span>{module.path}{module.status !== "clean" && <span className="submodule-status">（{module.status}）</span>}</span><span className="branch-oid">{module.oid.slice(0, 7)}</span></div>)}{modules.length === 0 && <div className="panel-hint">（无子模块）</div>}</div>
    <div className="branch-actions"><button className="primary" disabled={busy || modules.length === 0} onClick={() => void update()}>初始化并更新（--init --recursive）</button></div>
  </Dialog>;
}
