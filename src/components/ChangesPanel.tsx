import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { api } from "../api";
import { extractHunkPatch } from "../viewState";
import { useRepoBusy } from "../useRepoBusy";
import type { FileDiff, StatusEntry, StatusSnapshot } from "../types";
import DiffView from "./DiffView";
import type { FileAction } from "./DiffView";
import ContextMenu from "../ui/ContextMenu";
import SplitHandle from "../ui/SplitHandle";
import Icon from "../ui/Icon";
import InlineError from "../ui/InlineError";
import { useConfirm } from "../ui/Confirm";

interface Props {
  repoPath: string;
  status: StatusSnapshot;
  width: number;
  conflictCount: number;
  onWidth: (width: number) => void;
  onRefresh: (historyChanged?: boolean) => void;
  refreshVersion: number;
  setMessage: (msg: string) => void;
  highlightEnabled?: boolean;
  onFileAction?: (action: FileAction, file: FileDiff) => void;
  onPathAction: (action: "open" | "reveal" | "copy-path", path: string) => void;
  onDiscard: (paths: string[], untracked: boolean) => void;
  onOpenConflict: () => void;
  onDirtyChange: (dirty: boolean) => void;
  focusCommitSignal?: number;
  /** 工作区读取失败时保留旧列表并在顶部显示错误，不伪装成空仓库。 */
  error?: string;
  /** Explorer 文件入口：只预选并预览该文件，不自动暂存或还原。 */
  initialPath?: string | null;
  /** Explorer 目录入口：只展示并提交该目录下的变更（仓库根为 null）。 */
  scopePath?: string | null;
}

type Side = "staged" | "unstaged";
type MenuTarget = { x: number; y: number; side: Side; entry: StatusEntry };

function sameDiff(a: FileDiff, b: FileDiff): boolean {
  return a.path === b.path && a.oldPath === b.oldPath && a.status === b.status
    && a.isBinary === b.isBinary && a.truncated === b.truncated && a.patch === b.patch;
}

export default function ChangesPanel(props: Props) {
  const { repoPath, status } = props;
  const [checked, setChecked] = useState<Record<Side, Set<string>>>({ staged: new Set(), unstaged: new Set() });
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [amend, setAmend] = useState(false);
  const [localBusy, setBusy] = useState(false);
  const repoBusy = useRepoBusy(props.repoPath);
  const busy = localBusy || repoBusy;
  const confirm = useConfirm();
  const [filter, setFilter] = useState("");
  const [preview, setPreview] = useState<{ side: Side; path: string; file: FileDiff | null } | null>(null);
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [commitError, setCommitError] = useState("");
  const previewRequest = useRef(0);
  const commitTitleRef = useRef<HTMLInputElement>(null);
  const initialPathApplied = useRef(false);
  const scopePath = props.scopePath ?? null;
  const inScope = (path: string) => !scopePath || path === scopePath || path.startsWith(`${scopePath}/`);
  const scoped = (entries: StatusEntry[]) => entries.filter((entry) => inScope(entry.path));
  const scopedStaged = scoped(status.staged);

  useEffect(() => {
    if (props.focusCommitSignal) commitTitleRef.current?.focus();
  }, [props.focusCommitSignal]);

  const showPreview = async (side: Side, path: string, background = false) => {
    const request = ++previewRequest.current;
    setPreviewError("");
    if (!background) setPreview({ side, path, file: null });
    try {
      const oldPath = (side === "staged" ? status.staged : status.unstaged).find((entry) => entry.path === path)?.oldPath;
      const diffs = await api.getWorktreeFileDiff(repoPath, side === "staged", path, oldPath);
      if (request !== previewRequest.current) return;
      const file = diffs.find((d) => d.path === path || d.oldPath === path) ?? null;
      if (!file) {
        if (!background) setPreviewError("文件差异已改变或消失，请刷新后重选。");
        return;
      }
      setPreview((current) => {
        if (!current || current.side !== side || current.path !== path) return current;
        if (current.file && sameDiff(current.file, file)) return current;
        return { ...current, file };
      });
    } catch (e) {
      if (request !== previewRequest.current) return;
      if (background) props.setMessage(`刷新文件差异失败：${String(e)}`);
      else { setPreviewError(String(e)); props.setMessage(String(e)); }
    }
  };

  useEffect(() => {
    previewRequest.current += 1;
    setChecked((prev) => ({
      staged: new Set([...prev.staged].filter((path) => status.staged.some((entry) => entry.path === path))),
      unstaged: new Set([...prev.unstaged].filter((path) => status.unstaged.some((entry) => entry.path === path))),
    }));
    if (!preview) return;
    const entries = preview.side === "staged" ? status.staged : status.unstaged;
    if (!entries.some((entry) => entry.path === preview.path)) {
      setPreview(null);
      setPreviewError("");
      return;
    }
    // 初次读取失败时保留错误并等待用户重新选择，避免每次轮询都闪回加载态。
    if (!preview.file && previewError) return;
    // 后台重取当前文件；保留已有 patch，避免轮询时面板闪成 spinner 并重置 DiffView。
    void showPreview(preview.side, preview.path, preview.file !== null);
  }, [status, props.refreshVersion]);

  useEffect(() => {
    props.onDirtyChange(title.trim().length > 0 || body.trim().length > 0);
  }, [body, title, props.onDirtyChange]);

  useEffect(() => {
    if (initialPathApplied.current || !props.initialPath) return;
    const side: Side = status.staged.some((entry) => entry.path === props.initialPath) ? "staged" : "unstaged";
    const entry = (side === "staged" ? status.staged : status.unstaged).find((item) => item.path === props.initialPath);
    if (!entry) return;
    initialPathApplied.current = true;
    setChecked((prev) => ({ ...prev, [side]: new Set(prev[side]).add(entry.path) }));
    void showPreview(side, entry.path);
    // 仅在初次清单到达时预选；后续刷新不覆盖用户当前选择。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, props.initialPath]);

  const run = async (action: () => Promise<unknown>, success: string, historyChanged = false) => {
    if (busy) return;
    setBusy(true); setCommitError("");
    try {
      await action();
      props.setMessage(success);
      props.onRefresh(historyChanged);
    } catch (e) {
      setCommitError(String(e));
      props.setMessage(String(e));
    } finally { setBusy(false); }
  };
  const toggle = (side: Side, path: string) => setChecked((prev) => {
    const next = new Set(prev[side]);
    if (next.has(path)) next.delete(path); else next.add(path);
    return { ...prev, [side]: next };
  });
  const stagePaths = (side: Side, paths: string[]) => {
    const entries = side === "staged" ? status.staged : status.unstaged;
    const conflicted = paths.filter((path) => entries.some((entry) => entry.path === path && entry.status === "conflicted"));
    const safePaths = paths.filter((path) => !conflicted.includes(path));
    const conflictHint = conflicted.length > 0 ? `${conflicted.length} 个冲突文件未${side === "staged" ? "取消暂存" : "暂存"}，请进入冲突中心解决` : "";
    if (safePaths.length === 0) {
      return props.setMessage(conflictHint || "先选择要操作的文件");
    }
    previewRequest.current += 1;
    setPreview(null);
    void run(
      () => side === "unstaged" ? api.stageFiles(repoPath, safePaths) : api.unstageFiles(repoPath, safePaths),
      `${side === "unstaged" ? "已暂存" : "已取消暂存"} ${safePaths.length} 个文件${conflictHint ? `；${conflictHint}` : ""}`,
    );
  };
  const toggleAmend = async (next: boolean) => {
    setAmend(next);
    setCommitError("");
    if (next && !title.trim() && !body.trim()) {
      try {
        const headCommit = await api.getCommit(repoPath, "HEAD");
        const lines = headCommit.message.split(/\r?\n/);
        const firstLine = (lines[0] ?? "").trim();
        const rest = lines.slice(1).join("\n").trim();
        setTitle((current) => current.trim() ? current : firstLine);
        setBody((current) => current.trim() ? current : rest);
      } catch {
        // 空仓库或无 HEAD 时忽略自动填充
      }
    }
  };

  const applyHunk = (file: FileDiff, hunkIndex: number, mode: "stage" | "unstage" | "discard") => {
    const patch = extractHunkPatch(file, hunkIndex);
    if (!patch) {
      props.setMessage("无法提取当前差异块补丁");
      return;
    }
    if (mode === "discard") {
      void confirm({
        title: `丢弃 ${file.path} 的第 ${hunkIndex + 1} 处差异块？`,
        body: "该差异块的未暂存修改将从工作区移除，无法通过 Git 恢复。",
        confirmLabel: "丢弃差异块",
        danger: true,
      }).then((ok) => {
        if (!ok) return;
        void run(
          () => api.applyDiffPatch(repoPath, patch, false, true),
          `已丢弃 ${file.path} 的差异块 #${hunkIndex + 1}`,
        );
      });
      return;
    }
    const isUnstage = mode === "unstage";
    void run(
      () => api.applyDiffPatch(repoPath, patch, true, isUnstage),
      `${isUnstage ? "已取消暂存" : "已暂存"} ${file.path} 的差异块 #${hunkIndex + 1}`,
    );
  };

  const ignorePattern = (pattern: string) => {
    void run(
      () => api.ignoreFile(repoPath, pattern),
      `已将 ${pattern} 写入 .gitignore`,
    );
  };

  const doCommit = () => {
    if (busy) return;
    if (!amend && scopedStaged.length === 0) { const message = scopePath ? `目录 ${scopePath} 下没有已暂存的变更` : "没有已暂存的变更"; setCommitError(message); return props.setMessage(message); }
    if (!title.trim()) { const message = "提交标题不能为空"; setCommitError(message); return props.setMessage(message); }
    const message = title.trim() + (body.trim() ? `\n\n${body.trim()}` : "");
    void run(async () => {
      const result = await api.commit(repoPath, message, amend, scopePath);
      setTitle(""); setBody(""); setAmend(false);
      return result;
    }, amend ? "修正提交 (Amend) 完成" : "提交完成", true);
  };

  const listKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>, side: Side, visible: StatusEntry[]) => {
    if ((event.target as HTMLElement).closest("input, button, textarea, select")) return;
    if (visible.length === 0) return;
    const index = preview?.side === side ? visible.findIndex((entry) => entry.path === preview.path) : -1;
    const openMenuAt = (target: StatusEntry, element: HTMLElement | null) => {
      const rect = element?.getBoundingClientRect();
      setMenu({ x: rect?.left ?? 40, y: rect?.bottom ?? 80, side, entry: target });
    };
    if ((event.key === "F10" && event.shiftKey) || event.key === "ContextMenu") {
      event.preventDefault();
      const target = visible[index < 0 ? 0 : index];
      const row = [...event.currentTarget.querySelectorAll<HTMLElement>(".changes-item")].find((element) => element.dataset.path === target.path);
      openMenuAt(target, row ?? null);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (index < 0) return;
      if (event.key === " ") toggle(side, visible[index].path);
      else void showPreview(side, visible[index].path);
      return;
    }
    let next = index;
    if (event.key === "ArrowDown") next = Math.min(visible.length - 1, index + 1);
    else if (event.key === "ArrowUp") next = Math.max(0, index < 0 ? 0 : index - 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = visible.length - 1;
    else return;
    event.preventDefault();
    const target = visible[next];
    if (!target) return;
    void showPreview(side, target.path);
    const row = [...event.currentTarget.querySelectorAll<HTMLElement>(".changes-item")].find((element) => element.dataset.path === target.path);
    row?.scrollIntoView({ block: "nearest" });
  };

  const renderList = (side: Side, entries: StatusEntry[]) => {
    const scopedEntries = scoped(entries);
    const visible = scopedEntries.filter((entry) => entry.path.toLowerCase().includes(filter.trim().toLowerCase()));
    const activeIndex = preview?.side === side ? visible.findIndex((entry) => entry.path === preview.path) : -1;
    return <section className="changes-list">
      <div className="changes-list-header">
        <strong>{side === "staged" ? "已暂存" : "未暂存"}<span className="count-badge">{scopedEntries.length}</span></strong>
        <div>
          <button disabled={busy || scopedEntries.length === 0} onClick={() => stagePaths(side, scopedEntries.map((e) => e.path))}>{side === "staged" ? "全部取消" : "全部暂存"}</button>
          <button disabled={busy || checked[side].size === 0} onClick={() => stagePaths(side, [...checked[side]])}>{side === "staged" ? "取消选中" : "暂存选中"}</button>
        </div>
      </div>
      <div
        className="changes-items"
        role="listbox"
        aria-label={side === "staged" ? "已暂存文件" : "未暂存文件"}
        aria-activedescendant={activeIndex >= 0 ? `changes-${side}-${activeIndex}` : undefined}
        tabIndex={0}
        onKeyDown={(event) => listKeyDown(event, side, visible)}
      >
        {visible.map((entry, index) => <div
          key={`${side}-${entry.path}`}
          id={`changes-${side}-${index}`}
          className={`changes-item${preview?.path === entry.path && preview.side === side ? " selected" : ""}${entry.status === "conflicted" ? " conflicted" : ""}`}
          data-path={entry.path}
          role="option"
          aria-selected={preview?.path === entry.path && preview.side === side}
          onClick={(e) => { e.currentTarget.parentElement?.focus({ preventScroll: true }); entry.status === "conflicted" ? props.onOpenConflict() : void showPreview(side, entry.path); }}
          onDoubleClick={() => { if (entry.status !== "conflicted") stagePaths(side, [entry.path]); }}
          onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, side, entry }); }}
          title={entry.path}
        >
          <input type="checkbox" aria-label={`选择 ${entry.path}`} checked={checked[side].has(entry.path)} onChange={() => toggle(side, entry.path)} onClick={(e) => e.stopPropagation()} />
          <span className={`file-status status-${entry.status}`}>{entry.status === "conflicted" ? "!" : entry.status[0].toUpperCase()}</span>
          <span className="file-path">{entry.path}</span>
          {entry.status === "conflicted" && <Icon name="conflict" size={14} />}
        </div>)}
        {visible.length === 0 && <div className="panel-hint">{scopedEntries.length === 0 ? "（空）" : "无匹配文件"}</div>}
      </div>
    </section>;
  };

  return (
    <div className="changes-panel">
      <div className="changes-left" style={{ width: props.width }}>
        {props.error && <InlineError message={props.error} />}
        <div className="changes-filter"><Icon name="search" size={14} /><input aria-label="过滤变更文件" placeholder="过滤文件…" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
        {props.conflictCount > 0 && <button className="conflict-banner" onClick={props.onOpenConflict}><Icon name="conflict" /><span>{props.conflictCount} 个冲突待解决</span><strong>进入解决 →</strong></button>}
        {renderList("unstaged", status.unstaged)}
        {renderList("staged", status.staged)}
        <div className="commit-box">
          {commitError && <InlineError message={commitError} />}
          <input ref={commitTitleRef} aria-label="提交标题" placeholder="提交标题（必填）" disabled={busy} value={title} onChange={(e) => { setTitle(e.target.value); setCommitError(""); }} />
          <div className="commit-title-count">
            <label className="amend-checkbox" title="修正上一次提交（git commit --amend）">
              <input type="checkbox" disabled={busy} checked={amend} onChange={(e) => void toggleAmend(e.target.checked)} />
              <span>修正上次提交 (Amend)</span>
            </label>
            <span>{title.length > 50 ? "标题建议不超过 50 字符 · " : ""}{title.length}/50</span>
          </div>
          <textarea aria-label="提交正文" placeholder="提交正文（可选）" disabled={busy} value={body} onChange={(e) => { setBody(e.target.value); setCommitError(""); }} rows={3} onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); doCommit(); }
          }} />
          <button className="primary commit-button" disabled={busy || (!amend && scopedStaged.length === 0)} onClick={doCommit}>{busy ? <span className="spinner" /> : <Icon name="check" />}{amend ? `修正提交 (${scopedStaged.length})` : `提交 (${scopedStaged.length})`}</button>
        </div>
      </div>
      <SplitHandle direction="vertical" label="调整变更文件列表宽度" onResize={(delta) => props.onWidth(Math.min(720, Math.max(300, props.width + delta)))} onReset={() => props.onWidth(420)} />
      <div className="changes-preview">
        {preview?.file ? <DiffView
          files={[preview.file]}
          highlightEnabled={props.highlightEnabled}
          onFileAction={props.onFileAction}
          showFileHeader={false}
          prefKey={repoPath}
          hunkActions={preview.file.status !== "conflicted" ? {
            staged: preview.side === "staged",
            busy,
            onStageHunk: (f, idx) => applyHunk(f, idx, preview.side === "staged" ? "unstage" : "stage"),
            onDiscardHunk: preview.side === "unstaged" && preview.file.status !== "new" ? (f, idx) => applyHunk(f, idx, "discard") : undefined,
          } : undefined}
        /> : preview ? previewError ? <div className="empty-state" role="alert">{previewError}</div> : <div className="empty-state"><span className="spinner" /><span>diff 加载中…</span></div> : <div className="empty-state"><Icon name="file" size={28} /><strong>选择一个文件</strong><span>查看工作区或暂存区差异</span></div>}
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} ariaLabel={`${menu.entry.path} 操作`} items={[
        ...(menu.entry.status !== "conflicted" ? [{ id: "stage", label: menu.side === "staged" ? "取消暂存" : "暂存", onSelect: () => stagePaths(menu.side, [menu.entry.path]) }] : [{ id: "resolve", label: "解决冲突", icon: "conflict" as const, onSelect: props.onOpenConflict }]),
        { id: "open", label: "打开文件", icon: "external", onSelect: () => props.onPathAction("open", menu.entry.path) },
        { id: "reveal", label: "在文件管理器中显示", icon: "folder", onSelect: () => props.onPathAction("reveal", menu.entry.path) },
        { id: "copy", label: "复制相对路径", icon: "copy", onSelect: () => props.onPathAction("copy-path", menu.entry.path) },
        ...(menu.side === "unstaged" ? [
          { id: "sep-ignore", separator: true },
          { id: "ignore-file", label: "添加到 .gitignore", onSelect: () => ignorePattern(menu.entry.path) },
          ...(menu.entry.path.includes(".") && !menu.entry.path.endsWith(".") ? [{
            id: "ignore-ext",
            label: `忽略同类后缀 (*.${menu.entry.path.split(".").pop()})`,
            onSelect: () => ignorePattern(`*.${menu.entry.path.split(".").pop()}`),
          }] : []),
          { id: "sep", separator: true },
          menu.entry.status === "new"
            ? { id: "delete", label: "删除未跟踪文件…", danger: true, onSelect: () => props.onDiscard([menu.entry.path], true) }
            : { id: "discard", label: "丢弃未暂存变更…", danger: true, onSelect: () => props.onDiscard([menu.entry.path], false) },
        ] : []),
      ]} />}
    </div>
  );
}
