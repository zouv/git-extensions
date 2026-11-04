import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useRepoBusy } from "../useRepoBusy";
import type { StatusSnapshot } from "../types";
import Dialog from "../ui/Dialog";

interface Props {
  repoPath: string;
  status: StatusSnapshot;
  onClose: () => void;
  setMessage: (message: string) => void;
  initialFile?: string | null;
}

export default function DiffToolDialog({ repoPath, status, onClose, setMessage, initialFile }: Props) {
  const [staged, setStaged] = useState(false);
  const [file, setFile] = useState(initialFile ?? "");
  const [localBusy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const repoBusy = useRepoBusy(repoPath);
  const busy = localBusy || repoBusy;
  const files = useMemo(() => (staged ? status.staged : status.unstaged).filter((entry) => entry.status !== "conflicted"), [status, staged]);
  useEffect(() => { setFile((current) => files.some((entry) => entry.path === current) ? current : files[0]?.path ?? ""); }, [files]);
  const open = async () => {
    if (busy || !file) return;
    setBusy(true); setError(null);
    try {
      await api.openDifftool(repoPath, file, staged);
      setMessage("外部 difftool 已关闭"); onClose();
    } catch (e) { setError(String(e)); setMessage(String(e)); }
    finally { setBusy(false); }
  };
  return <Dialog title="使用外部 difftool" onClose={onClose} busy={busy} footer={<><button disabled={busy} onClick={onClose}>关闭</button><button className="primary" disabled={busy || !file} onClick={() => void open()}>{busy ? "等待工具退出…" : "启动 difftool"}</button></>}>
    <div className="dialog-form">
      <label><span>比较范围</span><select disabled={busy} value={staged ? "staged" : "unstaged"} onChange={(e) => setStaged(e.target.value === "staged")}><option value="unstaged">未暂存变更</option><option value="staged">已暂存变更</option></select></label>
      <label><span>文件</span><select disabled={busy || files.length === 0} value={file} onChange={(e) => setFile(e.target.value)}>{files.map((entry) => <option key={entry.path} value={entry.path}>{entry.path}</option>)}</select></label>
      {files.length === 0 && <div className="panel-hint">此范围内没有可用文件。</div>}
      <div className="settings-note">使用 Git 已配置的 diff.tool / difftool 工具。工具运行期间此对话框保持等待，关闭外部工具后返回应用。</div>
      {error && <div className="inline-error" role="alert">{error}</div>}
    </div>
  </Dialog>;
}
