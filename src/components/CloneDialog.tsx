import { useEffect, useState } from "react";
import { api } from "../api";
import { useRepoBusy } from "../useRepoBusy";
import Dialog from "../ui/Dialog";
import { useDirtyClose } from "../ui/useDirtyClose";
import { pickDirectory } from "../nativeDialog";

interface Props {
  initialParent: string;
  onOpen: (path: string) => Promise<unknown>;
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
}

function inferredName(url: string) {
  const trimmed = url.trim().replace(/[\\/]+$/, "");
  const name = trimmed.split(/[\\/:/]/).filter(Boolean).pop()?.replace(/\.git$/i, "") ?? "";
  return name && !name.startsWith("-") ? name : "repository";
}

export default function CloneDialog({ initialParent, onOpen, onClose, onBusyChange }: Props) {
  const [url, setUrl] = useState("");
  const [destination, setDestination] = useState(initialParent);
  const [destinationEdited, setDestinationEdited] = useState(false);
  const [localBusy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const repoBusy = useRepoBusy(destination);
  const busy = localBusy || repoBusy;
  const dirty = url.trim().length > 0 || destination !== initialParent;
  const close = useDirtyClose(dirty, busy, onClose);
  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);
  const updateUrl = (value: string) => {
    setUrl(value);
    if (!destinationEdited) {
      const separator = initialParent.includes("\\") ? "\\" : "/";
      setDestination(`${initialParent.replace(/[\\/]+$/, "")}${separator}${inferredName(value)}`);
    }
  };
  const browse = async () => {
    try {
      const path = await pickDirectory("选择克隆目标目录");
      if (path) { setDestination(path); setDestinationEdited(true); }
    } catch (e) { setError(String(e)); }
  };
  const clone = async () => {    if (busy || !url.trim() || !destination.trim()) return;
    setBusy(true); setError(null);
    try {
      const target = await api.cloneRepository(destination.trim(), url.trim());
      await onOpen(target || destination.trim());
      onClose();
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };
  return <Dialog title="克隆仓库" onClose={close} busy={busy} footer={<><button disabled={busy} onClick={close}>取消</button><button className="primary" disabled={busy || !url.trim() || !destination.trim()} onClick={() => void clone()}>克隆并打开</button></>}>
    <div className="dialog-form">
      <label><span>远程仓库 URL</span><input data-autofocus disabled={busy} value={url} onChange={(e) => updateUrl(e.target.value)} placeholder="https://example.com/owner/repository.git" /></label>
      <label><span>目标目录（将克隆到这里）</span><div className="path-input-row"><input disabled={busy} value={destination} onChange={(e) => { setDestination(e.target.value); setDestinationEdited(true); }} /><button type="button" disabled={busy} onClick={() => void browse()}>浏览…</button></div></label>
      <div className="settings-note">资源管理器所选目录仅作为默认父目录。凭证由本机 Git credential helper 处理，应用不会保存凭证。</div>
      {error && <div className="inline-error" role="alert">{error}</div>}
    </div>
  </Dialog>;
}
