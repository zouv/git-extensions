import { useEffect, useState } from "react";
import { api } from "../api";
import { useRepoBusy } from "../useRepoBusy";
import Dialog from "../ui/Dialog";
import { useDirtyClose } from "../ui/useDirtyClose";
import { pickDirectory } from "../nativeDialog";

interface Props {
  initialPath: string;
  onOpen: (path: string) => Promise<unknown>;
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
  onMessage?: (message: string) => void;
}

export default function CreateRepositoryDialog({ initialPath, onOpen, onClose, onBusyChange, onMessage }: Props) {
  const [path, setPath] = useState(initialPath);
  const [bare, setBare] = useState(false);
  const [localBusy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const repoBusy = useRepoBusy(path);
  const busy = localBusy || repoBusy;
  const dirty = bare || (path.trim().length > 0 && path !== initialPath);
  const close = useDirtyClose(dirty, busy, onClose);
  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);
  const browse = async () => {
    try {
      const selected = await pickDirectory("选择新仓库目录");
      if (selected) setPath(selected);
    } catch (e) { setError(String(e)); }
  };
  const create = async () => {
    if (busy || !path.trim()) return;
    setBusy(true); setError(null);
    try {
      const target = await api.createRepository(path.trim(), bare);
      if (bare) {
        onMessage?.(`已创建中心仓库：${target || path.trim()}`);
        onClose();
        return;
      }
      await onOpen(target || path.trim());
      onClose();
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };
  return <Dialog title="创建新仓库" onClose={close} busy={busy} footer={<><button disabled={busy} onClick={close}>取消</button><button className="primary" disabled={busy || !path.trim()} onClick={() => void create()}>{bare ? "创建" : "创建并打开"}</button></>}>
    <div className="dialog-form">
      <label><span>仓库目录</span><div className="path-input-row"><input data-autofocus disabled={busy} value={path} onChange={(e) => setPath(e.target.value)} /><button type="button" disabled={busy} onClick={() => void browse()}>浏览…</button></div></label>
      <fieldset className="repository-type" disabled={busy}>
        <legend>仓库类型</legend>
        <label className="radio-row"><input type="radio" name="repository-type" checked={!bare} onChange={() => setBare(false)} /><span>个人仓库（普通工作区）</span></label>
        <label className="radio-row"><input type="radio" name="repository-type" checked={bare} onChange={() => setBare(true)} /><span>中心仓库（无工作区，<code>--bare --shared=all</code>）</span></label>
      </fieldset>
      <div className="settings-note">{bare ? "中心仓库创建后不会在当前应用打开；请在其他位置克隆它来使用。" : "将在上述目录创建普通非 bare 仓库并打开。为避免意外嵌套，目标已经位于其它 Git 仓库内时会拒绝创建。"}</div>
      {error && <div className="inline-error" role="alert">{error}</div>}
    </div>
  </Dialog>;
}
