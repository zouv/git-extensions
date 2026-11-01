import { useEffect, useState } from "react";
import { api, formatDate } from "../api";
import type { RecoveryEntry } from "../types";
import Dialog from "../ui/Dialog";
import { useRepoBusy } from "../useRepoBusy";
interface Props { repoPath: string; onClose: () => void; onRestore: (oid: string) => void }
export default function RecoveryDialog(props: Props) {
  const [entries, setEntries] = useState<RecoveryEntry[]>([]); const [error, setError] = useState(""); const [loading, setLoading] = useState(true);
  const busy = useRepoBusy(props.repoPath);
  useEffect(() => { let alive = true; api.getRecoveryEntries(props.repoPath).then((data) => { if (alive) setEntries(data); }).catch((e) => { if (alive) setError(String(e)); }).finally(() => { if (alive) setLoading(false); }); return () => { alive = false; }; }, [props.repoPath]);
  return <Dialog title="恢复历史 · HEAD 备份与 reflog" onClose={props.onClose} wide busy={busy}>
    <p>选择原提交后进入 Reset 预览，不会立即修改仓库。可用 Soft 保留本地内容；也可复制 SHA 后创建新分支。备份不包含未提交文件，reflog 记录会按 Git 配置过期。</p>
    {loading && <p role="status">正在读取恢复记录…</p>}{error && <p role="alert">{error}</p>}
    <div className="recovery-list">{entries.map((entry,index) => <div className="recovery-entry" key={index}><code title={entry.oid}>{entry.oid.slice(0,10)}</code><span>{entry.label}</span><small>{formatDate(entry.time)}</small><button onClick={() => void navigator.clipboard?.writeText(entry.oid)}>复制 SHA</button><button disabled={busy} onClick={() => props.onRestore(entry.oid)}>预览恢复…</button></div>)}</div>
    {!loading && !entries.length && <p>暂无可用记录。</p>}
  </Dialog>;
}
