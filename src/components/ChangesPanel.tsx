import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import { api } from "../api";
import { buildFileTreeRows, extractHunkPatch, rangeSelection } from "../viewState";
import type { FileTreeRow } from "../viewState";
import { useRepoBusy } from "../useRepoBusy";
import type { FileDiff, StatusEntry, StatusSnapshot } from "../types";
import DiffView from "./DiffView";
import type { FileAction } from "./DiffView";
import IgnorePathDialog from "../explorer/IgnorePathDialog";
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
  /** 未暂存 / 已暂存列表的分割比例（0.15–0.85）；不传时固定 50/50。 */
  listSplit?: number;
  onListSplit?: (split: number) => void;
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
type MenuTarget = { x: number; y: number; side: Side }
  & ({ kind: "file"; entry: StatusEntry } | { kind: "dir"; dir: string });
type IgnoreTarget = { relativePath: string; scope: "file" | "directory"; initialPattern?: string };

function sameDiff(a: FileDiff, b: FileDiff): boolean {
  return a.path === b.path && a.oldPath === b.oldPath && a.status === b.status
    && a.isBinary === b.isBinary && a.truncated === b.truncated && a.patch === b.patch;
}

export default function ChangesPanel(props: Props) {
  const { repoPath, status } = props;
  const [checked, setChecked] = useState<Record<Side, Set<string>>>({ staged: new Set(), unstaged: new Set() });
  /** 行选中（高亮）：Ctrl+A / Ctrl+点击 / Shift+点击维护；与勾选框共同决定批量操作范围。 */
  const [selected, setSelected] = useState<Record<Side, Set<string>>>({ staged: new Set(), unstaged: new Set() });
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [amend, setAmend] = useState(false);
  const [localBusy, setBusy] = useState(false);
  const repoBusy = useRepoBusy(props.repoPath);
  const busy = localBusy || repoBusy;
  const confirm = useConfirm();
  const [filter, setFilter] = useState("");
  const [listMode, setListMode] = useState<"list" | "tree">("list");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [ignoreTarget, setIgnoreTarget] = useState<IgnoreTarget | null>(null);
  const [preview, setPreview] = useState<{ side: Side; path: string; file: FileDiff | null } | null>(null);
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [commitError, setCommitError] = useState("");
  const previewRequest = useRef(0);
  const listsRef = useRef<HTMLDivElement>(null);
  /** 每侧列表的多选锚点：Shift+点击从这里扩展范围。 */
  const selectionAnchor = useRef<Record<Side, string | null>>({ staged: null, unstaged: null });
  const commitTitleRef = useRef<HTMLInputElement>(null);
  const initialPathApplied = useRef(false);
  const scopePath = props.scopePath ?? null;
  const inScope = (path: string) => !scopePath || path === scopePath || path.startsWith(`${scopePath}/`);
  const listSplit = props.listSplit ?? 0.5;
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

  const previewSide = preview?.side;
  // 「显示完整内容」按需重新读取当前文件；预览本身已带 patch 时 DiffView 直接复用，不重复请求。
  const loadPreviewFile = useCallback(async (file: FileDiff, fullContext: boolean) => {
    if (!previewSide) return null;
    const diffs = await api.getWorktreeFileDiff(repoPath, previewSide === "staged", file.path, file.oldPath, fullContext);
    return diffs.find((d) => d.path === file.path || d.oldPath === file.path) ?? null;
  }, [repoPath, previewSide]);

  useEffect(() => {
    previewRequest.current += 1;
    setChecked((prev) => ({
      staged: new Set([...prev.staged].filter((path) => status.staged.some((entry) => entry.path === path))),
      unstaged: new Set([...prev.unstaged].filter((path) => status.unstaged.some((entry) => entry.path === path))),
    }));
    setSelected((prev) => ({
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
  const toggleSelected = (side: Side, path: string) => setSelected((prev) => {
    const next = new Set(prev[side]);
    if (next.has(path)) next.delete(path); else next.add(path);
    return { ...prev, [side]: next };
  });
  /** 批量操作范围 = 行选中 ∪ 勾选框，两种标记都不会被静默丢弃。 */
  const targetPaths = (side: Side) => new Set([...checked[side], ...selected[side]]);
  /** 常规列表多选：Ctrl / Meta 切换行选中，Shift 从锚点扩展范围，普通点击只预览并单选。 */
  const onRowClick = (event: ReactMouseEvent<HTMLDivElement>, side: Side, entry: StatusEntry, visible: StatusEntry[]) => {
    event.currentTarget.parentElement?.focus({ preventScroll: true });
    if (entry.status === "conflicted") { props.onOpenConflict(); return; }
    if (event.shiftKey) {
      const anchor = selectionAnchor.current[side];
      setSelected((prev) => ({ ...prev, [side]: rangeSelection(visible.map((item) => item.path), anchor, entry.path) }));
      if (!anchor) selectionAnchor.current[side] = entry.path;
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      selectionAnchor.current[side] = entry.path;
      toggleSelected(side, entry.path);
      return;
    }
    selectionAnchor.current[side] = entry.path;
    setSelected((prev) => ({ ...prev, [side]: new Set([entry.path]) }));
    void showPreview(side, entry.path);
  };
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

  /** 还原更改：已暂存 + 未暂存一并恢复到 HEAD；新增文件按 deleteNew 删除。 */
  const restorePaths = (paths: string[], deleteNew: boolean, label: string) => {
    if (paths.length === 0) return props.setMessage("没有可还原的变更");
    void confirm({
      title: `还原 ${label} 的更改？`,
      body: deleteNew
        ? "已暂存与未暂存的修改都将恢复到 HEAD，新增文件 / 目录将被删除。此操作无法通过 Git 恢复。"
        : "已暂存与未暂存的修改都将恢复到 HEAD。此操作无法通过 Git 恢复。",
      confirmLabel: "还原更改",
      danger: true,
    }).then((ok) => {
      if (!ok) return;
      previewRequest.current += 1;
      setPreview(null);
      void run(() => api.resetChanges(repoPath, paths, deleteNew), `已还原 ${label} 的更改`);
    });
  };

  /** 目录下（两侧合并去重）的全部变更路径，供目录右键批量操作；冲突文件除外。 */
  const pathsUnder = (dir: string) => {
    const prefix = `${dir}/`;
    const paths = new Set<string>();
    for (const entry of [...status.staged, ...status.unstaged]) {
      if (entry.status !== "conflicted" && entry.path.startsWith(prefix)) paths.add(entry.path);
    }
    return [...paths];
  };
  const sidePathsUnder = (side: Side, dir: string) => scoped(side === "staged" ? status.staged : status.unstaged)
    .filter((entry) => entry.path.startsWith(`${dir}/`))
    .map((entry) => entry.path);

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
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
      // 常规列表交互：Ctrl+A 选中当前（过滤后）列表的全部文件，不改变勾选框。
      event.preventDefault();
      setSelected((prev) => ({ ...prev, [side]: new Set(visible.map((entry) => entry.path)) }));
      return;
    }
    if (visible.length === 0) return;
    const index = preview?.side === side ? visible.findIndex((entry) => entry.path === preview.path) : -1;
    const openMenuAt = (target: StatusEntry, element: HTMLElement | null) => {
      const rect = element?.getBoundingClientRect();
      setMenu({ x: rect?.left ?? 40, y: rect?.bottom ?? 80, side, kind: "file", entry: target });
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

  const resizeLists = (delta: number) => {
    if (!props.onListSplit) return;
    const height = listsRef.current?.clientHeight ?? 1;
    props.onListSplit(Math.min(0.85, Math.max(0.15, listSplit + delta / Math.max(1, height))));
  };

  const renderList = (side: Side, entries: StatusEntry[]) => {
    const scopedEntries = scoped(entries);
    const filtered = scopedEntries.filter((entry) => entry.path.toLowerCase().includes(filter.trim().toLowerCase()));
    const visible = listMode === "tree" ? [...filtered].sort((a, b) => a.path.localeCompare(b.path)) : filtered;
    const rows: FileTreeRow<StatusEntry>[] = listMode === "tree"
      ? buildFileTreeRows(visible.map((entry, index) => ({ path: entry.path, index, value: entry })), collapsed)
      : visible.map((entry, index) => ({ kind: "file", value: entry, index, depth: 0 }));
    const activeIndex = preview?.side === side ? visible.findIndex((entry) => entry.path === preview.path) : -1;
    return <section className="changes-list">
      <div className="changes-list-header">
        <strong>{side === "staged" ? "已暂存" : "未暂存"}<span className="count-badge">{scopedEntries.length}</span></strong>
        <div>
          <button disabled={busy || scopedEntries.length === 0} onClick={() => stagePaths(side, scopedEntries.map((e) => e.path))}>{side === "staged" ? "全部取消" : "全部暂存"}</button>
          <button disabled={busy || targetPaths(side).size === 0} onClick={() => stagePaths(side, [...targetPaths(side)])}>{side === "staged" ? "取消选中" : "暂存选中"}</button>
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
        {rows.map((row) => row.kind === "dir" ? (
          <button
            key={`${side}-dir-${row.path}`}
            className="changes-directory"
            style={{ paddingLeft: 8 + row.depth * 14 }}
            tabIndex={-1}
            title={row.path}
            onClick={() => setCollapsed((prev) => { const next = new Set(prev); if (next.has(row.path)) next.delete(row.path); else next.add(row.path); return next; })}
            onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, side, kind: "dir", dir: row.path }); }}
          >
            <Icon name={collapsed.has(row.path) ? "folder" : "chevron-down"} size={13} />
            <span className="changes-dir-spacer" aria-hidden="true" />
            <span>{row.path.split("/").pop()}</span>
          </button>
        ) : (
          <div
            key={`${side}-${row.value.path}`}
            id={`changes-${side}-${row.index}`}
            className={`changes-item${selected[side].has(row.value.path) ? " selected" : ""}${preview?.path === row.value.path && preview.side === side ? " preview" : ""}${row.value.status === "conflicted" ? " conflicted" : ""}`}
            style={{ paddingLeft: 8 + row.depth * 14 }}
            data-path={row.value.path}
            role="option"
            aria-selected={selected[side].has(row.value.path)}
            onClick={(event) => onRowClick(event, side, row.value, visible)}
            onDoubleClick={() => { if (row.value.status !== "conflicted") stagePaths(side, [row.value.path]); }}
            onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, side, kind: "file", entry: row.value }); }}
            title={row.value.path}
          >
            <input type="checkbox" aria-label={`选择 ${row.value.path}`} checked={checked[side].has(row.value.path)} onChange={() => { selectionAnchor.current[side] = row.value.path; toggle(side, row.value.path); }} onClick={(e) => e.stopPropagation()} />
            <span className={`file-status status-${row.value.status}`}>{row.value.status === "conflicted" ? "!" : row.value.status[0].toUpperCase()}</span>
            <span className="file-path">{listMode === "tree" ? row.value.path.split("/").pop() : row.value.path}</span>
            {row.value.status === "conflicted" && <Icon name="conflict" size={14} />}
          </div>
        ))}
        {visible.length === 0 && <div className="panel-hint">{scopedEntries.length === 0 ? "（空）" : "无匹配文件"}</div>}
      </div>
    </section>;
  };

  return (
    <div className="changes-panel">
      <div className="changes-left" style={{ width: props.width }}>
        {props.error && <InlineError message={props.error} />}
        <div className="changes-filter"><Icon name="search" size={14} /><input aria-label="过滤变更文件" placeholder="过滤文件…" value={filter} onChange={(e) => setFilter(e.target.value)} />{filter && <button type="button" className="filter-clear" aria-label="清除文件过滤" title="清除文件过滤" onClick={() => setFilter("")}><Icon name="close" size={12} /></button>}<button type="button" className={`text-toggle changes-tree-toggle${listMode === "tree" ? " active" : ""}`} title="切换文件列表 / 目录树" onClick={() => setListMode(listMode === "list" ? "tree" : "list")}>{listMode === "list" ? "目录树" : "列表"}</button></div>
        {props.conflictCount > 0 && <button className="conflict-banner" onClick={props.onOpenConflict}><Icon name="conflict" /><span>{props.conflictCount} 个冲突待解决</span><strong>进入解决 →</strong></button>}
        <div className="changes-lists" ref={listsRef}>
          <div className="changes-list-slot" style={{ flex: `0 0 ${listSplit * 100}%` }}>
            {renderList("unstaged", status.unstaged)}
          </div>
          <SplitHandle direction="horizontal" label="调整未暂存 / 已暂存列表高度" onResize={resizeLists} onReset={() => props.onListSplit?.(0.5)} />
          <div className="changes-list-slot" style={{ flex: 1 }}>
            {renderList("staged", status.staged)}
          </div>
        </div>
        <div className="commit-box">
          {commitError && <InlineError message={commitError} />}
          <input ref={commitTitleRef} aria-label="提交标题" title="提交标题：提交信息首行，显示在提交图与日志列表中；建议 50 字符以内，用一句话概括本次改动" placeholder="提交标题（必填）" disabled={busy} value={title} onChange={(e) => { setTitle(e.target.value); setCommitError(""); }} onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); doCommit(); }
          }} />
          <div className="commit-title-count">
            <span>{title.length > 50 ? "标题建议不超过 50 字符 · " : ""}{title.length}/50</span>
          </div>
          <textarea aria-label="提交正文" title="提交正文：可选详细说明，位于标题后的空行；写清原因、影响与验证方式，不会显示在日志列表首行" placeholder="提交正文（可选）" disabled={busy} value={body} onChange={(e) => { setBody(e.target.value); setCommitError(""); }} rows={3} onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); doCommit(); }
          }} />
          <div className="commit-actions">
            <label className="amend-checkbox" title="修正上一次提交（git commit --amend）">
              <input type="checkbox" disabled={busy} checked={amend} onChange={(e) => void toggleAmend(e.target.checked)} />
              <span>修正上次提交 (Amend)</span>
            </label>
            <button className="primary commit-button" disabled={busy || (!amend && scopedStaged.length === 0)} onClick={doCommit}>{busy ? <span className="spinner" /> : <Icon name="check" />}{amend ? `修正提交 (${scopedStaged.length})` : `提交 (${scopedStaged.length})`}</button>
          </div>
        </div>
      </div>
      <SplitHandle direction="vertical" label="调整变更文件列表宽度" onResize={(delta) => props.onWidth(Math.max(0, props.width + delta))} onReset={() => props.onWidth(420)} />
      <div className="changes-preview">
        {preview?.file ? <DiffView
          files={[preview.file]}
          loadFile={loadPreviewFile}
          highlightEnabled={props.highlightEnabled}
          onFileAction={props.onFileAction}
          showFileHeader={false}
          showStats

          hunkActions={preview.file.status !== "conflicted" ? {
            staged: preview.side === "staged",
            busy,
            onStageHunk: (f, idx) => applyHunk(f, idx, preview.side === "staged" ? "unstage" : "stage"),
            onDiscardHunk: preview.side === "unstaged" && preview.file.status !== "new" ? (f, idx) => applyHunk(f, idx, "discard") : undefined,
          } : undefined}
        /> : preview ? previewError ? <div className="empty-state" role="alert">{previewError}</div> : <div className="empty-state"><span className="spinner" /><span>diff 加载中…</span></div> : <div className="empty-state"><Icon name="file" size={28} /><strong>选择一个文件</strong><span>查看工作区或暂存区差异</span></div>}
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} ariaLabel={menu.kind === "dir" ? `目录 ${menu.dir} 操作` : `${menu.entry.path} 操作`} items={menu.kind === "dir" ? [
        { id: "stage-dir", label: menu.side === "staged" ? "取消暂存目录下全部文件" : "暂存目录下全部文件", onSelect: () => stagePaths(menu.side, sidePathsUnder(menu.side, menu.dir)) },
        { id: "sep-restore", separator: true },
        { id: "restore-dir", label: "还原更改…", danger: true, onSelect: () => {
          const paths = pathsUnder(menu.dir);
          const hasNew = [...status.staged, ...status.unstaged].some((entry) => entry.path.startsWith(`${menu.dir}/`) && entry.status === "new");
          restorePaths(paths, hasNew, `目录 ${menu.dir}`);
        } },
        ...(menu.side === "unstaged" ? [
          { id: "sep-ignore", separator: true },
          { id: "ignore-dir", label: "添加到 ignore…", onSelect: () => setIgnoreTarget({ relativePath: menu.dir, scope: "directory" }) },
        ] : []),
      ] : [
        ...(menu.entry.status !== "conflicted" ? [{ id: "stage", label: menu.side === "staged" ? "取消暂存" : "暂存", onSelect: () => stagePaths(menu.side, [menu.entry.path]) }] : [{ id: "resolve", label: "解决冲突", icon: "conflict" as const, onSelect: props.onOpenConflict }]),
        { id: "open", label: "打开文件", icon: "external", onSelect: () => props.onPathAction("open", menu.entry.path) },
        { id: "reveal", label: "在文件管理器中显示", icon: "folder", onSelect: () => props.onPathAction("reveal", menu.entry.path) },
        { id: "copy", label: "复制相对路径", icon: "copy", onSelect: () => props.onPathAction("copy-path", menu.entry.path) },
        ...(menu.entry.status !== "conflicted" ? [
          { id: "sep-restore", separator: true },
          { id: "restore", label: "还原更改…", danger: true, onSelect: () => restorePaths([menu.entry.path], menu.entry.status === "new", menu.entry.path) },
        ] : []),
        ...(menu.side === "unstaged" ? [
          { id: "sep-ignore", separator: true },
          { id: "ignore-file", label: "添加到 ignore…", onSelect: () => setIgnoreTarget({ relativePath: menu.entry.path, scope: "file" }) },
          ...(menu.entry.path.includes(".") && !menu.entry.path.endsWith(".") ? [{
            id: "ignore-ext",
            label: `忽略同类后缀 (*.${menu.entry.path.split(".").pop()})…`,
            onSelect: () => setIgnoreTarget({ relativePath: menu.entry.path, scope: "file", initialPattern: `*.${menu.entry.path.split(".").pop()}` }),
          }] : []),
          { id: "sep", separator: true },
          menu.entry.status === "new"
            ? { id: "delete", label: "删除未跟踪文件…", danger: true, onSelect: () => props.onDiscard([menu.entry.path], true) }
            : { id: "discard", label: "丢弃未暂存变更…", danger: true, onSelect: () => props.onDiscard([menu.entry.path], false) },
        ] : []),
      ]} />}
      {ignoreTarget && <IgnorePathDialog
        repoPath={repoPath}
        relativePath={ignoreTarget.relativePath}
        scope={ignoreTarget.scope}
        initialPattern={ignoreTarget.initialPattern}
        onClose={() => setIgnoreTarget(null)}
        onChanged={() => props.onRefresh()}
        setMessage={props.setMessage}
      />}
    </div>
  );
}
