import { useEffect, useState } from "react";
import { api } from "../api";
import { useRepoBusy } from "../useRepoBusy";
import Dialog from "../ui/Dialog";

interface Props {
  initialPath: string;
  onOpen: (path: string) => Promise<unknown>;
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
}

export default function CreateRepositoryDialog({ initialPath, onOpen, onClose, onBusyChange }: Props) {
  const [path, setPath] = useState(initialPath);
  const [localBusy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const repoBusy = useRepoBusy(path);
  const busy = localBusy || repoBusy;
  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);
  const create = async () => {
    if (busy || !path.trim()) return;
    setBusy(true); setError(null);
    try {
      const target = await api.createRepository(path.trim());
      await onOpen(target || path.trim());
      onClose();
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };
  return <Dialog title="创建新仓库" onClose={onClose} busy={busy} footer={<><button disabled={busy} onClick={onClose}>取消</button><button className="primary" disabled={busy || !path.trim()} onClick={() => void create()}>创建并打开</button></>}>
    <div className="dialog-form">
      <label><span>仓库目录</span><input data-autofocus disabled={busy} value={path} onChange={(e) => setPath(e.target.value)} /></label>
      <div className="settings-note">将在上述目录创建普通非 bare 仓库。为避免意外嵌套，目标已经位于其它 Git 仓库内时会拒绝创建。</div>
      {error && <div className="inline-error" role="alert">{error}</div>}
    </div>
  </Dialog>;
}
