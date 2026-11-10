import { useState } from "react";
import { api } from "../api";
import { useRepoBusy } from "../useRepoBusy";
import type { CommandOutput } from "../types";
import Dialog from "../ui/Dialog";
import InlineError from "../ui/InlineError";
import { useDirtyClose } from "../ui/useDirtyClose";

interface Props {
  repoPath: string;
  initialFilter: string;
  onClose: () => void;
  onChanged: () => void;
  setMessage: (message: string) => void;
}

/** 对应 Git Extensions 的 FormAddFiles：Filter 是 Git pathspec，Show files
 * 执行 `git add --dry-run`，Add files 执行 `git add`；Force 对应 `-f`。 */
export default function AddFilesDialog({ repoPath, initialFilter, onClose, onChanged, setMessage }: Props) {
  const [filter, setFilter] = useState(initialFilter || ".");
  const [force, setForce] = useState(false);
  const [output, setOutput] = useState<CommandOutput | null>(null);
  const [error, setError] = useState("");
  const [localBusy, setBusy] = useState(false);
  const repoBusy = useRepoBusy(repoPath);
  const busy = localBusy || repoBusy;
  const dirty = filter !== (initialFilter || ".") || force;
  const close = useDirtyClose(dirty, busy, onClose);

  const showFiles = async () => {
    if (busy || !filter.trim()) return;
    setBusy(true); setError(""); setOutput(null);
    try {
      const result = await api.previewAddFiles(repoPath, filter.trim(), force);
      setOutput(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const addFiles = async () => {
    if (busy || !filter.trim()) return;
    setBusy(true); setError(""); setOutput(null);
    try {
      const result = await api.addFiles(repoPath, filter.trim(), force);
      setOutput(result);
      if (result.exitCode === 0) {
        setMessage("Add files 完成");
        onChanged();
        onClose();
        return;
      }
      setError(result.stderr.trim() || result.stdout.trim() || `git add 退出码 ${result.exitCode ?? "未知"}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const outputText = output
    ? [output.stdout.trim(), output.stderr.trim()].filter(Boolean).join("\n") || (output.exitCode === 0 ? "（没有匹配的文件或已全部添加）" : "")
    : "";

  return <Dialog title="添加文件" onClose={close} busy={busy} footer={<>
    <button disabled={busy} onClick={close}>取消</button>
    <button disabled={busy || !filter.trim()} onClick={() => void showFiles()}>显示文件</button>
    <button className="primary" disabled={busy || !filter.trim()} onClick={() => void addFiles()}>添加文件</button>
  </>}>
    <div className="dialog-form">
      <label><span>过滤 / 路径（Git pathspec，可填文件、目录或通配符）</span><input data-autofocus disabled={busy} value={filter} onChange={(e) => { setFilter(e.target.value); setOutput(null); setError(""); }} placeholder="例如 . 或 src/*.ts" /></label>
      <label className="checkbox-row"><input type="checkbox" disabled={busy} checked={force} onChange={(e) => { setForce(e.target.checked); setOutput(null); }} /><span>强制添加被忽略的文件 (<code>-f</code>)</span></label>
      <div className="settings-note">「显示文件」只执行 <code>git add --dry-run</code>，不会修改暂存区；「添加文件」会真正执行 <code>git add</code>。</div>
      {output && <div className={`command-output${output.exitCode === 0 ? "" : " command-output-error"}`}>
        <div className="panel-hint">退出码：{output.exitCode ?? "未知"}</div>
        <pre>{outputText || "（无输出）"}</pre>
      </div>}
      {error && <InlineError message={error} />}
    </div>
  </Dialog>;
}
