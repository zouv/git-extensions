import { useState } from "react";
import { api } from "../api";
import { useRepoBusy } from "../useRepoBusy";
import type { PatchPreview } from "../types";
import Dialog from "../ui/Dialog";
import { useDirtyClose } from "../ui/useDirtyClose";
import { pickFile } from "../nativeDialog";

interface Props {
  repoPath: string;
  onClose: () => void;
  onChanged: () => void;
  setMessage: (message: string) => void;
  initialPatchPath?: string;
}

export default function ApplyPatchDialog({ repoPath, onClose, onChanged, setMessage, initialPatchPath = "" }: Props) {
  const [patchPath, setPatchPath] = useState(initialPatchPath);
  const [preview, setPreview] = useState<PatchPreview | null>(null);
  const [localBusy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const repoBusy = useRepoBusy(repoPath);
  const busy = localBusy || repoBusy;
  const close = useDirtyClose(patchPath.trim().length > 0 && patchPath !== initialPatchPath, busy, onClose);
  const browse = async () => {
    try {
      const selected = await pickFile("选择补丁文件");
      if (selected) { setPatchPath(selected); setPreview(null); setError(null); }
    } catch (e) { setError(String(e)); }
  };
  const check = async () => {
    if (busy || !patchPath.trim()) return;
    setBusy(true); setError(null); setPreview(null);
    try { setPreview(await api.previewPatch(repoPath, patchPath.trim())); }
    catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };
  const apply = async () => {
    if (busy || !preview) return;
    setBusy(true); setError(null);
    try {
      await api.applyPatch(repoPath, patchPath.trim(), preview.patchOid);
      setMessage("补丁已应用到工作区"); onChanged(); onClose();
    } catch (e) { setError(String(e)); setMessage(String(e)); }
    finally { setBusy(false); }
  };
  return <Dialog title="应用补丁" onClose={close} busy={busy} wide footer={<><button disabled={busy} onClick={close}>取消</button><button disabled={busy || !patchPath.trim()} onClick={() => void check()}>检查补丁</button><button className="primary" disabled={busy || !preview} onClick={() => void apply()}>应用到工作区</button></>}>
    <div className="dialog-form">
      <label><span>补丁文件路径</span><div className="path-input-row"><input data-autofocus disabled={busy} value={patchPath} onChange={(e) => { setPatchPath(e.target.value); setPreview(null); setError(null); }} placeholder="C:\path\to\change.patch" /><button type="button" disabled={busy} onClick={() => void browse()}>浏览…</button></div></label>
      <div className="settings-note">检查通过后仍需点击“应用到工作区”。若补丁文件在检查后被修改，应用会拒绝执行。默认不修改暂存区，也不进行三方合并。</div>
      {preview && <pre className="patch-preview" aria-label="补丁影响预览">{preview.summary || "补丁检查通过。"}</pre>}
      {error && <div className="inline-error" role="alert">{error}</div>}
    </div>
  </Dialog>;
}
