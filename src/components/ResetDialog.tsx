import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useRepoBusy } from "../useRepoBusy";
import type { ResetMode, ResetPreview } from "../types";
import Dialog from "../ui/Dialog";
import { useConfirm } from "../ui/Confirm";
interface Props { repoPath: string; target: string; onClose: () => void; onChanged: () => void; onNotify: (kind: "success" | "error" | "info", message: string, details?: string) => void }
export default function ResetDialog(props: Props) {
  const [mode, setMode] = useState<ResetMode>("mixed");
  const [preview, setPreview] = useState<ResetPreview | null>(null);
  const [error, setError] = useState(""); const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0); const [localBusy, setBusy] = useState(false);
  const busy = useRepoBusy(props.repoPath) || localBusy; const sequence = useRef(0); const confirm = useConfirm();
  useEffect(() => {
    const id = ++sequence.current; setLoading(true); setPreview(null); setError("");
    api.getResetPreview(props.repoPath, props.target, mode).then((next) => { if (id === sequence.current) setPreview(next); })
      .catch((e) => { if (id === sequence.current) setError(String(e)); }).finally(() => { if (id === sequence.current) setLoading(false); });
    return () => { sequence.current++; };
  }, [props.repoPath, props.target, mode, reload]);
  const blocked = mode === "hard" && !!preview && (preview.staged + preview.unstaged + preview.untracked > 0 || preview.blockedPaths.length > 0);
  const execute = async () => {
    if (!preview || loading || busy || blocked) return;
    const snapshot = preview;
    if (!await confirm({ title: mode === "hard" ? "确认 Hard Reset？" : "确认 Reset？", body: <><p>{snapshot.branch}：<code>{snapshot.headOid.slice(0, 10)}</code> → <code>{snapshot.targetOid.slice(0, 10)}</code>。</p><p>{mode === "soft" ? "只移动 HEAD，保留暂存区和工作区。" : mode === "mixed" ? "移动 HEAD 并替换暂存区；工作区文件保留，原暂存分组会丢失。" : "移动 HEAD、替换暂存区并覆盖工作区的已跟踪文件。"}</p><p>会先备份原 HEAD。备份不包含未提交文件，也不会自动撤销远程历史。</p></>, confirmLabel: "执行 Reset", danger: true, requireAck: true, ackLabel: "我已理解当前模式的影响与备份边界" })) return;
    setBusy(true); setError("");
    try { const result = await api.reset(props.repoPath, snapshot); props.onNotify("success", "Reset 完成，原 HEAD 已备份", result.backupRef); props.onChanged(); props.onClose(); }
    catch (e) { setError(String(e)); setPreview(null); }
    finally { setBusy(false); }
  };
  return <Dialog title="Reset 当前 HEAD 到选中提交" onClose={props.onClose} busy={busy} wide footer={<><button disabled={busy || loading} onClick={() => setReload((n) => n + 1)}>重新预览</button><button disabled={busy} onClick={props.onClose}>取消</button><button className="danger-button" disabled={busy || loading || !preview || blocked} onClick={() => void execute()}>确认 Reset…</button></>}>
    <div className="reset-modes">{(["soft", "mixed", "hard"] as ResetMode[]).map((value) => <label key={value}><input type="radio" name="reset-mode" disabled={busy} checked={mode === value} onChange={() => setMode(value)} />{value}</label>)}</div>
    <p>{mode === "soft" ? "Soft：保留 index 与工作区，只移动 HEAD。" : mode === "mixed" ? "Mixed：保留工作区，重建 index，所有原暂存变更将重新分类。" : "Hard：覆盖已跟踪文件；必须先提交或 Stash 全部本地变更（含未跟踪）。不递归重置子模块。"}</p>
    {loading && <p role="status">正在计算影响…</p>}{error && <p className="inline-error" role="alert">{error}</p>}
    {preview && <><p><strong>{preview.branch}</strong> · <code>{preview.headOid.slice(0,10)}</code> → <code>{preview.targetOid.slice(0,10)}</code> {preview.targetSubject}</p>
      <p>离开当前分支可达历史：{preview.commitsToLeave}{preview.countLimited ? "+" : ""} 个提交；影响 {preview.affectedFiles.length} 个路径。已暂存 {preview.staged} / 未暂存 {preview.unstaged} / 未跟踪 {preview.untracked}。</p>
      {blocked && <p className="inline-warning" role="alert">Hard Reset 已阻止：先保存全部本地修改，或移走目标路径的 ignored / 未跟踪阻挡文件。{preview.blockedPaths.slice(0,10).join("、")}</p>}
      <div className="reset-paths">{preview.affectedFiles.map((file) => <div key={file} className="mono">{file}</div>)}</div>
      <p className="panel-hint">执行前会再次检查原分支、HEAD、index 和 dirty 文件内容；过期预览不会执行。原 HEAD 的备份和 reflog 可从“恢复历史…”查看；工作区未提交内容不在 HEAD 备份中。</p></>}
  </Dialog>;
}
