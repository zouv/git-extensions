import { useEffect, useState } from "react";
import { api } from "../api";
import { useRepoBusy } from "../useRepoBusy";
import type { CommandOutput, PatchApplyState, PatchFileInfo } from "../types";
import Dialog from "../ui/Dialog";
import InlineError from "../ui/InlineError";
import { useDirtyClose } from "../ui/useDirtyClose";
import { useConfirm } from "../ui/Confirm";
import { pickDirectory, pickFile } from "../nativeDialog";
import AddFilesDialog from "./AddFilesDialog";

interface Props {
  repoPath: string;
  onClose: () => void;
  onChanged: () => void;
  setMessage: (message: string) => void;
  initialPatchPath?: string;
}

function outputText(output: CommandOutput | null): string {
  if (!output) return "";
  return [output.stdout.trim(), output.stderr.trim()].filter(Boolean).join("\n");
}

/** 对应 Git Extensions 的 FormApplyPatch：补丁文件 / 补丁目录、忽略空白、
 * Sign-off、补丁列表，以及 git am 冲突时的 Continue/Skip/Abort 流程。 */
export default function ApplyPatchDialog({ repoPath, onClose, onChanged, setMessage, initialPatchPath = "" }: Props) {
  const [mode, setMode] = useState<"file" | "dir">("file");
  const [patchFile, setPatchFile] = useState(initialPatchPath);
  const [patchDir, setPatchDir] = useState("");
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false);
  const [signOff, setSignOff] = useState(false);
  const [patchFiles, setPatchFiles] = useState<PatchFileInfo[]>([]);
  const [patchState, setPatchState] = useState<PatchApplyState>({ inProgress: false, conflicts: [] });
  const [output, setOutput] = useState<CommandOutput | null>(null);
  const [error, setError] = useState("");
  const [showAddFiles, setShowAddFiles] = useState(false);
  const [localBusy, setBusy] = useState(false);
  const repoBusy = useRepoBusy(repoPath);
  const busy = localBusy || repoBusy;
  const confirm = useConfirm();
  const dirty = patchState.inProgress || patchFile !== initialPatchPath || patchDir.length > 0 || ignoreWhitespace || signOff;
  const close = useDirtyClose(dirty, busy, onClose);

  const refreshState = async () => {
    try { setPatchState(await api.getPatchApplyState(repoPath)); }
    catch { /* 状态读取失败不阻塞主流程 */ }
  };

  useEffect(() => { void refreshState(); }, [repoPath]);
  useEffect(() => {
    if (mode !== "dir" || !patchDir.trim()) { setPatchFiles([]); return; }
    let alive = true;
    api.listPatchDirectory(repoPath, patchDir.trim()).then((next) => { if (alive) setPatchFiles(next); })
      .catch((reason) => { if (alive) { setError(String(reason)); setPatchFiles([]); } });
    return () => { alive = false; };
  }, [mode, patchDir, repoPath]);

  const browseFile = async () => {
    try {
      const selected = await pickFile("选择补丁文件");
      if (selected) { setPatchFile(selected); setOutput(null); setError(""); }
    } catch (e) { setError(String(e)); }
  };

  const browseDir = async () => {
    try {
      const selected = await pickDirectory("选择补丁目录");
      if (selected) { setPatchDir(selected); setOutput(null); setError(""); }
    } catch (e) { setError(String(e)); }
  };

  const runOutput = async (action: () => Promise<CommandOutput>, success: string) => {
    if (busy) return;
    setBusy(true); setError(""); setOutput(null);
    try {
      const result = await action();
      setOutput(result);
      await refreshState();
      if (result.exitCode === 0) {
        setMessage(success);
        onChanged();
        const state = await api.getPatchApplyState(repoPath).catch(() => null);
        if (!state?.inProgress) onClose();
      } else {
        const detail = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n");
        setError(detail || `git 退出码 ${result.exitCode ?? "未知"}`);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    if (mode === "file") {
      if (!patchFile.trim()) return;
      void runOutput(() => api.applyPatchFile(repoPath, patchFile.trim(), ignoreWhitespace, signOff), "补丁已应用");
    } else {
      if (!patchDir.trim()) return;
      void runOutput(() => api.applyPatchDirectory(repoPath, patchDir.trim(), ignoreWhitespace, signOff), "补丁目录已应用");
    }
  };

  const continuePatch = () => void runOutput(() => api.continuePatch(repoPath), "补丁冲突已解决并继续");
  const skipPatch = async () => {
    if (!await confirm({ title: "跳过当前补丁？", body: "将跳过当前无法应用的补丁并继续后续补丁。", danger: true, confirmLabel: "跳过补丁" })) return;
    void runOutput(() => api.skipPatch(repoPath), "已跳过当前补丁");
  };
  const abortPatch = async () => {
    if (!await confirm({ title: "中止补丁应用？", body: "将中止 git am 并恢复到应用补丁前的状态。", danger: true, confirmLabel: "中止补丁" })) return;
    void runOutput(() => api.abortPatch(repoPath), "已中止补丁应用");
  };

  const canApply = !busy && !patchState.inProgress && (mode === "file" ? !!patchFile.trim() : !!patchDir.trim());

  return <>
    <Dialog title="应用补丁" onClose={close} busy={busy} wide footer={<>
      <button disabled={busy} onClick={close}>关闭</button>
      <button className="primary" disabled={!canApply} onClick={apply}>应用补丁</button>
    </>}>
      <div className="dialog-form">
        <div className="patch-mode-row">
          <label className="radio-row"><input type="radio" name="patch-mode" disabled={busy || patchState.inProgress} checked={mode === "file"} onChange={() => setMode("file")} />补丁文件</label>
          <label className="radio-row"><input type="radio" name="patch-mode" disabled={busy || patchState.inProgress} checked={mode === "dir"} onChange={() => setMode("dir")} />补丁目录</label>
        </div>
        {mode === "file"
          ? <label><span>补丁文件路径</span><div className="path-input-row"><input data-autofocus disabled={busy || patchState.inProgress} value={patchFile} onChange={(e) => { setPatchFile(e.target.value); setOutput(null); setError(""); }} placeholder="C:\path\to\change.patch" /><button type="button" disabled={busy || patchState.inProgress} onClick={() => void browseFile()}>浏览…</button></div></label>
          : <label><span>补丁目录</span><div className="path-input-row"><input data-autofocus disabled={busy || patchState.inProgress} value={patchDir} onChange={(e) => { setPatchDir(e.target.value); setOutput(null); setError(""); }} placeholder="包含 .patch / .diff / .mbox 的目录" /><button type="button" disabled={busy || patchState.inProgress} onClick={() => void browseDir()}>浏览…</button></div></label>}
        <div className="patch-options">
          <label className="checkbox-row"><input type="checkbox" disabled={busy || patchState.inProgress} checked={ignoreWhitespace} onChange={(e) => setIgnoreWhitespace(e.target.checked)} />忽略空白差异 (<code>--ignore-whitespace</code>)</label>
          <label className="checkbox-row"><input type="checkbox" disabled={busy || patchState.inProgress} checked={signOff} onChange={(e) => setSignOff(e.target.checked)} />追加 Signed-off-by (<code>--signoff</code>，mailbox 补丁)</label>
        </div>
        {mode === "dir" && patchFiles.length > 0 && <div className="patch-list" role="list" aria-label="补丁列表">
          <div className="patch-list-header"><span>状态</span><span>文件</span><span>主题</span><span>作者</span><span>日期</span></div>
          {patchFiles.map((file) => <div className="patch-list-row" key={file.path} role="listitem">
            <span className="muted">{file.mailbox ? "mailbox" : "diff"}</span>
            <span className="mono" title={file.path}>{file.name}</span>
            <span title={file.subject}>{file.subject}</span>
            <span title={file.author}>{file.author || "—"}</span>
            <span title={file.date}>{file.date || "—"}</span>
          </div>)}
        </div>}
        <div className="settings-note">补丁文件会按内容自动选择 <code>git apply</code>（纯 diff）或 <code>git am</code>（mailbox/format-patch）；目录模式按文件名顺序逐个应用，遇到冲突会停在当前补丁。</div>
        {patchState.inProgress && <section className="patch-conflicts">
          <h4>补丁冲突</h4>
          <p>{patchState.conflicts.length > 0 ? `${patchState.conflicts.length} 个冲突文件：` : "当前补丁正在应用中。"}</p>
          {patchState.conflicts.length > 0 && <pre className="patch-conflict-list">{patchState.conflicts.join("\n")}</pre>}
          <div className="patch-conflict-actions">
            <button disabled={busy} onClick={() => setShowAddFiles(true)}>Add files…</button>
            <button disabled={busy} onClick={continuePatch}>Conflicts resolved</button>
            <button disabled={busy} onClick={() => void skipPatch()}>Skip patch</button>
            <button className="danger-button" disabled={busy} onClick={() => void abortPatch()}>Abort patch</button>
          </div>
        </section>}
        {output && <div className={`command-output${output.exitCode === 0 ? "" : " command-output-error"}`}>
          <div className="panel-hint">退出码：{output.exitCode ?? "未知"}</div>
          <pre>{outputText(output) || "（无输出）"}</pre>
        </div>}
        {error && <InlineError message={error} />}
      </div>
    </Dialog>
    {showAddFiles && <AddFilesDialog
      repoPath={repoPath}
      initialFilter="."
      onClose={() => { setShowAddFiles(false); void refreshState(); }}
      onChanged={() => { void refreshState(); onChanged(); }}
      setMessage={setMessage}
    />}
  </>;
}
