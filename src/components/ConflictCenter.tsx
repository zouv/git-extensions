import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { restoreConflictDraft } from "../viewState";
import { useRepoBusy } from "../useRepoBusy";
import type { ConflictFile, ConflictDraft, OperationState } from "../types";
import Icon from "../ui/Icon";
import { useConfirm } from "../ui/Confirm";

interface Props {
  repoPath: string;
  drafts: Map<string, ConflictDraft>;
  onDraftChange: (file: string, draft: ConflictDraft | null) => void;
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
  const [staleDraft, setStaleDraft] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [localBusy, setBusy] = useState(false);
  const repoBusy = useRepoBusy(props.repoPath);
  const busy = localBusy || repoBusy;
  const [error, setError] = useState("");
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const loadSequence = useRef(0);
  const draftSource = useRef<ConflictFile | null>(null);
  const confirm = useConfirm();

  const loadFile = useCallback(async (path: string) => {
    const sequence = ++loadSequence.current;
    setError(""); setContent(null); setResult(""); setResolveAsDeletion(false); setDirty(false);
    try {
      const file = await api.getConflictFile(props.repoPath, path);
      if (sequence !== loadSequence.current) return;
      setContent(file);
      const restored = restoreConflictDraft(file, props.drafts.get(path));
      draftSource.current = restored.source;
      setResult(restored.result); setResolveAsDeletion(restored.resolveAsDeletion); setDirty(restored.dirty); setStaleDraft(restored.stale);
      if (restored.stale) setError("外部文件或冲突阶段已改变；草稿已保留。请核对最新两侧内容后保存，或放弃该文件草稿。");
    } catch (e) {
      if (sequence === loadSequence.current) setError(String(e));
    }
  }, [props.repoPath, props.drafts]);

  const reload = useCallback(async () => {
    try {
      const next = await api.getOperationState(props.repoPath);
      setState(next);
      if (next.conflicts.length > 0) {
        const path = selected && next.conflicts.includes(selected) ? selected : next.conflicts[0];
        setSelected(path); await loadFile(path);
      } else { setSelected(null); setContent(null); }
    } catch (e) { setError(String(e)); }
  }, [loadFile, props.repoPath, selected]);

  useEffect(() => { void reload(); }, []); // 进入任务时读取真实 Git 状态
  useEffect(() => props.onDirtyChange(dirty), [dirty, props.onDirtyChange]);
  useEffect(() => { if (dirty && content) props.onDraftChange(content.path, { file: draftSource.current ?? content, result, resolveAsDeletion }); }, [dirty, content, result, resolveAsDeletion, props.onDraftChange]);
  useEffect(() => () => { loadSequence.current++; }, []);

  const chooseFile = async (path: string) => {
    if (busy || path === selected) return;
    setSelected(path);
    await loadFile(path);
  };

  const adopt = (side: "ours" | "theirs") => {
    if (busy || !content) return;
    const value = content[side];
    setResult(value ?? ""); setResolveAsDeletion(value === null); setDirty(true);
  };

  const saveResolved = async () => {
    if (!selected || busy || !content || content.path !== selected || content.binary || content.truncated) return;
    if (staleDraft && !await confirm({ title: "保存经过外部变化的合并草稿？", body: "请确认已核对最新两侧内容。保存将覆盖当前工作区文件并暂存。", confirmLabel: "已核对，保存草稿", danger: true, requireAck: true })) return;
    setBusy(true); setError("");
    try {
      const next = await api.saveResolvedFile(props.repoPath, selected, result, resolveAsDeletion, content);
      props.onDraftChange(selected, null);
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
      const details = String(e);
      const next = await api.getOperationState(props.repoPath).catch(() => null);
      if (next) setState(next);
      if (next?.conflicts.length) { setSelected(next.conflicts[0]); await loadFile(next.conflicts[0]); }
      setError(details); props.onChanged(); props.onNotify("error", "继续操作未完成，请检查当前 Git 状态", details);
    } finally { setBusy(false); }
  };

  const skip = async () => {
    if (busy || !state || !await confirm({ title: "跳过当前提交？", body: "将丢弃当前步骤的补丁和冲突解决进度，继续下一个提交。这不是暂时忽略某个文件。", confirmLabel: "跳过当前提交", danger: true, requireAck: true, ackLabel: "我确认丢弃当前步骤的修改与解决进度" })) return;
    setBusy(true); setError("");
    try {
      await api.skipOperation(props.repoPath, state);
      for (const path of props.drafts.keys()) props.onDraftChange(path, null);
      setDirty(false); setContent(null); setSelected(null); props.onChanged();
      const next = await api.getOperationState(props.repoPath); setState(next);
      if (next.kind === "none") props.onExit();
      else if (next.conflicts.length) { setSelected(next.conflicts[0]); await loadFile(next.conflicts[0]); }
    } catch (e) { await reload(); setError(String(e)); props.onChanged(); }
    finally { setBusy(false); }
  };

  const abort = async () => {
    if (busy || !state || !await confirm({ title: `中止 ${operationNames[state.kind]}？`, body: "中止将放弃本次操作及冲突解决进度，Git 会尝试恢复操作前状态；已有本地修改时可能拒绝。HEAD 备份不包含未提交内容。", confirmLabel: "中止操作", danger: true, requireAck: true, ackLabel: "我确认放弃本次操作与解决进度" })) return;
    setBusy(true);
    try { await api.abortOperation(props.repoPath); for (const path of props.drafts.keys()) props.onDraftChange(path, null); setDirty(false); setContent(null); props.onNotify("success", "操作已中止"); props.onChanged(); props.onExit(); }
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
        <button className="icon-button" title="返回变更（保留会话草稿）" disabled={busy} onClick={props.onExit}>←</button>
        <Icon name="conflict" />
        <strong>{name}{state?.interactive ? "（交互式）" : ""}</strong>
        {state?.current && state.total && <span className="task-progress">第 {state.current}/{state.total} 步</span>}
        <span className={state?.conflicts.length ? "warning-text" : "success-text"}>{state?.conflicts.length ? `还有 ${state.conflicts.length} 个文件未解决` : "所有冲突已解决"}</span>
        <div className="toolbar-spacer" />
        <button onClick={() => void reload()} disabled={busy} title="重新读取操作状态与来源，保留当前会话草稿"><Icon name="refresh" />刷新状态</button>
        <button className="primary" disabled={busy || !state || state.kind === "none" || state.conflicts.length > 0 || dirty} title={dirty ? "先保存当前文件" : state?.conflicts.length ? "仍有未解决冲突" : `继续 ${name}`} onClick={() => void continueOperation()}>继续 {name}</button>
        {state && ["rebase", "cherryPick", "revert"].includes(state.kind) && <button disabled={busy} onClick={() => void skip()}>跳过当前提交…</button>}
        <button className="danger-button" disabled={busy || !state || state.kind === "none"} onClick={() => void abort()}>中止…</button>
      </div>
      {error && <div className="inline-error"><Icon name="warning" /><span>{error}</span><button onClick={() => { void navigator.clipboard?.writeText(error); }}>复制</button></div>}
      <div className="conflict-layout">
        <div className="conflict-files">
          <div className="panel-header">冲突文件<span className="count-badge">{state?.conflicts.length ?? 0}</span></div>
          {state?.conflicts.map((path) => <button className={path === selected ? "selected" : ""} key={path} onClick={() => void chooseFile(path)}><Icon name="conflict" size={14} /><span title={path}>{path}</span>{(props.drafts.has(path) || (path === selected && dirty)) && <span className="dirty-dot" />}</button>)}
          {state && state.conflicts.length === 0 && <div className="empty-state compact"><Icon name="check" /><span>没有未解决文件</span><span>现在可以继续{name}。</span></div>}
        </div>
        <div className="conflict-editor">
          {content ? <>
            <div className="conflict-file-title"><span className="mono">{content.path}</span>{dirty && <span className="warning-text">未保存</span>}</div>
            <div className="conflict-sides">
              <label>当前：{content.oursLabel}<textarea readOnly value={content.ours ?? "（该侧不存在此文件）"} /></label>
              <label>传入：{content.theirsLabel}<textarea readOnly value={content.theirs ?? "（该侧不存在此文件）"} /></label>
            </div>
            <div className="merge-result-header"><strong>合并结果</strong><button disabled={busy} onClick={() => adopt("ours")}>采用当前{content.ours === null ? "（删除）" : ""}</button><button disabled={busy} onClick={() => adopt("theirs")}>采用传入{content.theirs === null ? "（删除）" : ""}</button><button disabled={busy} onClick={() => jumpConflict(-1)}>上一个冲突块</button><button disabled={busy} onClick={() => jumpConflict(1)}>下一个冲突块</button></div>
            <textarea disabled={busy} ref={editorRef} className="merge-editor" aria-label="合并结果" spellCheck={false} value={result} onChange={(e) => { setResult(e.target.value); setResolveAsDeletion(false); setDirty(true); }} onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void saveResolved(); }
            }} />
            <div className="merge-actions"><button disabled={busy || !dirty} onClick={async () => { if (!selected || !await confirm({ title: "放弃当前文件草稿？", body: "将重新读取文件内容，不影响其他文件草稿。", danger: true, confirmLabel: "放弃并重新读取" })) return; props.onDraftChange(selected, null); await loadFile(selected); }}>放弃当前草稿…</button><span>{resolveAsDeletion ? "将删除此文件并暂存删除结果。" : `保存会写入文件并暂存；不会自动继续${name}。`}</span><button className="primary" disabled={busy || content.binary || content.truncated} onClick={() => void saveResolved()}><Icon name="check" />{resolveAsDeletion ? "删除并标记为已解决" : "保存并标记为已解决"}</button></div>
          </> : <div className="empty-state"><Icon name="conflict" size={30} /><strong>{state?.kind === "none" ? "当前没有进行中的操作" : "选择冲突文件"}</strong></div>}
        </div>
      </div>
    </div>
  );
}
