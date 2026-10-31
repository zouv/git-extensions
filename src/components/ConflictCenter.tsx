import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { ConflictFile, OperationState } from "../types";
import Icon from "../ui/Icon";
import { useConfirm } from "../ui/Confirm";

interface Props {
  repoPath: string;
  onExit: () => void;
  onChanged: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onNotify: (kind: "success" | "error" | "info", message: string, details?: string) => void;
}

const operationNames: Record<string, string> = { merge: "Merge", cherryPick: "Cherry-pick", revert: "Revert", rebase: "Rebase", none: "操作" };

export default function ConflictCenter(props: Props) {
  const [state, setState] = useState<OperationState | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<ConflictFile | null>(null);
  const [result, setResult] = useState("");
  const [resolveAsDeletion, setResolveAsDeletion] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const loadSequence = useRef(0);
  const confirm = useConfirm();

  const loadFile = useCallback(async (path: string) => {
    const sequence = ++loadSequence.current;
    setError(""); setContent(null); setResult(""); setResolveAsDeletion(false); setDirty(false);
    try {
      const file = await api.getConflictFile(props.repoPath, path);
      if (sequence !== loadSequence.current) return;
      setContent(file);
      setResult(file.worktree ?? file.ours ?? file.theirs ?? "");
    } catch (e) {
      if (sequence === loadSequence.current) setError(String(e));
    }
  }, [props.repoPath]);

  const reload = useCallback(async () => {
    try {
      const next = await api.getOperationState(props.repoPath);
      setState(next);
      if (next.conflicts.length > 0) {
        const path = selected && next.conflicts.includes(selected) ? selected : next.conflicts[0];
        if (path !== selected || !content) { setSelected(path); await loadFile(path); }
      } else { setSelected(null); setContent(null); }
    } catch (e) { setError(String(e)); }
  }, [content, loadFile, props.repoPath, selected]);

  useEffect(() => { void reload(); }, []); // 进入任务时读取真实 Git 状态
  useEffect(() => props.onDirtyChange(dirty), [dirty, props.onDirtyChange]);

  const chooseFile = async (path: string) => {
    if (path === selected) return;
    if (dirty && !await confirm({ title: "放弃未保存的合并编辑？", body: "切换到另一个冲突文件会丢失当前编辑区中尚未保存的内容。", confirmLabel: "放弃编辑", danger: true })) return;
    setSelected(path);
    await loadFile(path);
  };

  const adopt = (side: "ours" | "theirs") => {
    if (!content) return;
    const value = content[side];
    setResult(value ?? ""); setResolveAsDeletion(value === null); setDirty(true);
  };

  const saveResolved = async () => {
    if (!selected || busy || !content || content.path !== selected || content.binary || content.truncated) return;
    setBusy(true); setError("");
    try {
      const next = await api.saveResolvedFile(props.repoPath, selected, result, resolveAsDeletion);
      setState(next); setDirty(false);
      props.onNotify("success", `已解决 ${selected}`);
      props.onChanged();
      const nextPath = next.conflicts[0];
      if (nextPath) { setSelected(nextPath); await loadFile(nextPath); }
      else { setSelected(null); setContent(null); }
    } catch (e) { setError(String(e)); props.onNotify("error", "保存或暂存解决结果失败", String(e)); }
    finally { setBusy(false); }
  };

  const continueOperation = async () => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      await api.continueOperation(props.repoPath);
      props.onNotify("success", `${state ? operationNames[state.kind] : "操作"}已继续`);
      props.onChanged();
      const next = await api.getOperationState(props.repoPath);
      setState(next);
      if (next.kind === "none") { props.onExit(); return; }
      if (next.conflicts.length > 0) { setSelected(next.conflicts[0]); await loadFile(next.conflicts[0]); }
    } catch (e) {
      setError(String(e));
      const next = await api.getOperationState(props.repoPath).catch(() => null);
      if (next) setState(next);
      if (next?.conflicts.length) { setSelected(next.conflicts[0]); await loadFile(next.conflicts[0]); }
    } finally { setBusy(false); }
  };

  const abort = async () => {
    if (!state || !await confirm({ title: `中止 ${operationNames[state.kind]}？`, body: "中止会放弃本次操作和全部冲突解决进度，并恢复到操作前的 HEAD。此行为不能通过界面撤销。", confirmLabel: "中止操作", danger: true, requireAck: true, ackLabel: "我确认放弃本次操作与解决进度" })) return;
    setBusy(true);
    try { await api.abortOperation(props.repoPath); setDirty(false); props.onNotify("success", "操作已中止"); props.onChanged(); props.onExit(); }
    catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };

  const jumpConflict = (direction: 1 | -1) => {
    const editor = editorRef.current;
    if (!editor) return;
    const markers = ["<<<<<<<", "=======", ">>>>>>>"];
    const from = direction > 0 ? editor.selectionEnd : editor.selectionStart - 1;
    let index = -1;
    for (const marker of markers) {
      const found = direction > 0 ? result.indexOf(marker, from) : result.lastIndexOf(marker, from);
      if (found >= 0 && (index < 0 || (direction > 0 ? found < index : found > index))) index = found;
    }
    if (index >= 0) { editor.focus(); editor.setSelectionRange(index, index); }
  };

  const name = state ? operationNames[state.kind] : "操作";
  return (
    <div className="task-view conflict-center">
      <div className="task-header conflict-task-header">
        <button className="icon-button" title="返回变更" onClick={async () => {
          if (!dirty || await confirm({ title: "离开冲突编辑器？", body: "当前文件有未保存编辑。", confirmLabel: "放弃编辑并离开", danger: true })) { setDirty(false); props.onExit(); }
        }}>←</button>
        <Icon name="conflict" />
        <strong>{name}{state?.interactive ? "（交互式）" : ""}</strong>
        {state?.current && state.total && <span className="task-progress">第 {state.current}/{state.total} 步</span>}
        <span className={state?.conflicts.length ? "warning-text" : "success-text"}>{state?.conflicts.length ? `还有 ${state.conflicts.length} 个文件未解决` : "所有冲突已解决"}</span>
        <div className="toolbar-spacer" />
        <button onClick={() => void reload()} disabled={busy || dirty} title={dirty ? "先保存或离开当前编辑" : "重新读取操作状态"}><Icon name="refresh" />刷新状态</button>
        <button className="primary" disabled={busy || !state || state.kind === "none" || state.conflicts.length > 0 || dirty} title={dirty ? "先保存当前文件" : state?.conflicts.length ? "仍有未解决冲突" : `继续 ${name}`} onClick={() => void continueOperation()}>继续 {name}</button>
        <button className="danger-button" disabled={busy || !state || state.kind === "none"} onClick={() => void abort()}>中止…</button>
      </div>
      {error && <div className="inline-error"><Icon name="warning" /><span>{error}</span><button onClick={() => { void navigator.clipboard?.writeText(error); }}>复制</button></div>}
      <div className="conflict-layout">
        <div className="conflict-files">
          <div className="panel-header">冲突文件<span className="count-badge">{state?.conflicts.length ?? 0}</span></div>
          {state?.conflicts.map((path) => <button className={path === selected ? "selected" : ""} key={path} onClick={() => void chooseFile(path)}><Icon name="conflict" size={14} /><span title={path}>{path}</span>{path === selected && dirty && <span className="dirty-dot" />}</button>)}
          {state && state.conflicts.length === 0 && <div className="empty-state compact"><Icon name="check" /><span>没有未解决文件</span><span>现在可以继续{name}。</span></div>}
        </div>
        <div className="conflict-editor">
          {content ? <>
            <div className="conflict-file-title"><span className="mono">{content.path}</span>{dirty && <span className="warning-text">未保存</span>}</div>
            <div className="conflict-sides">
              <label>当前：{content.oursLabel}<textarea readOnly value={content.ours ?? "（该侧不存在此文件）"} /></label>
              <label>传入：{content.theirsLabel}<textarea readOnly value={content.theirs ?? "（该侧不存在此文件）"} /></label>
            </div>
            <div className="merge-result-header"><strong>合并结果</strong><button onClick={() => adopt("ours")}>采用当前{content.ours === null ? "（删除）" : ""}</button><button onClick={() => adopt("theirs")}>采用传入{content.theirs === null ? "（删除）" : ""}</button><button onClick={() => jumpConflict(-1)}>上一个冲突块</button><button onClick={() => jumpConflict(1)}>下一个冲突块</button></div>
            <textarea ref={editorRef} className="merge-editor" aria-label="合并结果" spellCheck={false} value={result} onChange={(e) => { setResult(e.target.value); setResolveAsDeletion(false); setDirty(true); }} onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void saveResolved(); }
            }} />
            <div className="merge-actions"><span>{resolveAsDeletion ? "将删除此文件并暂存删除结果。" : `保存会写入文件并暂存；不会自动继续${name}。`}</span><button className="primary" disabled={busy || content.binary || content.truncated} onClick={() => void saveResolved()}><Icon name="check" />{resolveAsDeletion ? "删除并标记为已解决" : "保存并标记为已解决"}</button></div>
          </> : <div className="empty-state"><Icon name="conflict" size={30} /><strong>{state?.kind === "none" ? "当前没有进行中的操作" : "选择冲突文件"}</strong></div>}
        </div>
      </div>
    </div>
  );
}
