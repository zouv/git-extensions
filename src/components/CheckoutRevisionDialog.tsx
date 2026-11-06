import { useState } from "react";
import { api } from "../api";
import { useRepoBusy } from "../useRepoBusy";
import Dialog from "../ui/Dialog";
import { useDirtyClose } from "../ui/useDirtyClose";

interface Props {
  repoPath: string;
  onClose: () => void;
  onChanged: () => void;
  setMessage: (message: string) => void;
}

export default function CheckoutRevisionDialog({ repoPath, onClose, onChanged, setMessage }: Props) {
  const [revision, setRevision] = useState("");
  const [oid, setOid] = useState<string | null>(null);
  const [localBusy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const repoBusy = useRepoBusy(repoPath);
  const busy = localBusy || repoBusy;
  const close = useDirtyClose(revision.trim().length > 0, busy, onClose);
  const resolve = async () => {
    if (busy || !revision.trim()) return;
    setBusy(true); setError(null);
    try { setOid(await api.resolveRevision(repoPath, revision.trim())); }
    catch (e) { setOid(null); setError(String(e)); }
    finally { setBusy(false); }
  };
  const checkout = async () => {
    if (busy || !oid) return;
    setBusy(true); setError(null);
    try {
      await api.checkoutRevision(repoPath, oid);
      setMessage(`已切换到 ${oid.slice(0, 12)}（detached HEAD）`);
      onChanged(); onClose();
    } catch (e) { setError(String(e)); setMessage(String(e)); }
    finally { setBusy(false); }
  };
  return <Dialog title="切换到指定提交" onClose={close} busy={busy} footer={<><button disabled={busy} onClick={close}>取消</button>{oid ? <button className="primary" disabled={busy} onClick={() => void checkout()}>切换到 {oid.slice(0, 7)}</button> : <button className="primary" disabled={busy || !revision.trim()} onClick={() => void resolve()}>解析提交</button>}</>}>
    <div className="dialog-form">
      <label><span>提交、分支、标签或 revision 表达式</span><input data-autofocus disabled={busy} value={revision} onChange={(e) => { setRevision(e.target.value); setOid(null); setError(null); }} placeholder="HEAD~1、完整 OID、标签…" /></label>
      {oid && <div className="settings-note"><strong>目标：{oid}</strong><br />切换后将进入 detached HEAD。Git 会阻止覆盖与当前本地修改冲突的文件；请确认目标无误后再继续。</div>}
      {error && <div className="inline-error" role="alert">{error}</div>}
    </div>
  </Dialog>;
}
