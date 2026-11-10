import { useState } from "react";
import { api } from "../api";
import { useRepoBusy } from "../useRepoBusy";
import Dialog from "../ui/Dialog";
import { useDirtyClose } from "../ui/useDirtyClose";
import { useConfirm } from "../ui/Confirm";

interface Props {
  repoPath: string;
  onClose: () => void;
  onChanged: () => void;
  setMessage: (message: string) => void;
}

export default function CheckoutRevisionDialog({ repoPath, onClose, onChanged, setMessage }: Props) {
  const [revision, setRevision] = useState("");
  const [oid, setOid] = useState<string | null>(null);
  const [force, setForce] = useState(false);
  const [localBusy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const repoBusy = useRepoBusy(repoPath);
  const busy = localBusy || repoBusy;
  const confirm = useConfirm();
  const close = useDirtyClose(revision.trim().length > 0 || force, busy, onClose);
  const resolve = async () => {
    if (busy || !revision.trim()) return;
    setBusy(true); setError(null);
    try { setOid(await api.resolveRevision(repoPath, revision.trim())); }
    catch (e) { setOid(null); setError(String(e)); }
    finally { setBusy(false); }
  };
  const checkout = async () => {
    if (busy || !oid) return;
    if (force) {
      const ok = await confirm({
        title: "强制切换并丢弃本地修改？",
        body: "git switch --force 会丢弃与目标提交冲突的本地修改，未跟踪文件不保证保留。",
        confirmLabel: "强制切换",
        danger: true,
        requireAck: true,
        ackLabel: "我确认丢弃当前未提交修改",
      });
      if (!ok) return;
    }
    setBusy(true); setError(null);
    try {
      await api.checkoutRevision(repoPath, oid, force);
      setMessage(`已切换到 ${oid.slice(0, 12)}（detached HEAD）`);
      onChanged(); onClose();
    } catch (e) { setError(String(e)); setMessage(String(e)); }
    finally { setBusy(false); }
  };
  return <Dialog title="切换到指定提交" onClose={close} busy={busy} footer={<><button disabled={busy} onClick={close}>取消</button>{oid ? <button className="primary" disabled={busy} onClick={() => void checkout()}>切换到 {oid.slice(0, 7)}</button> : <button className="primary" disabled={busy || !revision.trim()} onClick={() => void resolve()}>解析提交</button>}</>}>
    <div className="dialog-form">
      <label><span>提交、分支、标签或 revision 表达式</span><input data-autofocus disabled={busy} value={revision} onChange={(e) => { setRevision(e.target.value); setOid(null); setError(null); }} placeholder="HEAD~1、完整 OID、标签…" /></label>
      <label className="checkbox-row"><input type="checkbox" disabled={busy} checked={force} onChange={(e) => setForce(e.target.checked)} /><span>强制切换并重置本地冲突修改 (<code>--force</code>)</span></label>
      {oid && <div className="settings-note"><strong>目标：{oid}</strong><br />切换后将进入 detached HEAD。{force ? "勾选强制后会丢弃冲突的本地修改。" : "Git 会阻止覆盖与当前本地修改冲突的文件；请确认目标无误后再继续。"}</div>}
      {error && <div className="inline-error" role="alert">{error}</div>}
    </div>
  </Dialog>;
}
