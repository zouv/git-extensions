import { useEffect, useState } from "react";
import { api } from "../api";
import { useRepoBusy } from "../useRepoBusy";
import Dialog from "../ui/Dialog";

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
  const clone = async () => {
    if (busy || !url.trim() || !destination.trim()) return;
    setBusy(true); setError(null);
    try {
      const target = await api.cloneRepository(destination.trim(), url.trim());
      await onOpen(target || destination.trim());
      onClose();
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };
  return <Dialog title="克隆仓库" onClose={onClose} busy={busy} footer={<><button disabled={busy} onClick={onClose}>取消</button><button className="primary" disabled={busy || !url.trim() || !destination.trim()} onClick={() => void clone()}>克隆并打开</button></>}>
    <div className="dialog-form">
      <label><span>远程仓库 URL</span><input data-autofocus disabled={busy} value={url} onChange={(e) => updateUrl(e.target.value)} placeholder="https://example.com/owner/repository.git" /></label>
      <label><span>目标目录（将克隆到这里）</span><input disabled={busy} value={destination} onChange={(e) => { setDestination(e.target.value); setDestinationEdited(true); }} /></label>
      <div className="settings-note">资源管理器所选目录仅作为默认父目录。凭证由本机 Git credential helper 处理，应用不会保存凭证。</div>
      {error && <div className="inline-error" role="alert">{error}</div>}
    </div>
  </Dialog>;
}
