import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FileDiff } from "../types";
import {
  buildInlineRows, buildSplitRows, diffWindow, isHunkRow,
  parsePatch, selectedFileIndex,
} from "../viewState";
import type { InlineRow, PatchLine, SplitRow } from "../viewState";
import { languageForPath } from "../languages";
import type { HighlightResponse } from "../highlight.worker";
import ContextMenu from "../ui/ContextMenu";
import Icon from "../ui/Icon";

const LINE_H = 20;
const MAX_HIGHLIGHT_LINES = 5000;

export type FileAction = "history" | "blame" | "open" | "reveal" | "copy-path";
type DiffMode = "inline" | "split";

interface Props {
  files: FileDiff[];
  loading?: boolean;
  loadFile?: (file: FileDiff) => Promise<FileDiff | null>;
  highlightEnabled?: boolean;
  onFileAction?: (action: FileAction, file: FileDiff) => void;
  /** 单文件预览时隐藏文件标题与文件列表，避免与外部文件列表重复。 */
  showFileHeader?: boolean;
}

type DisplayRow = { kind: "dir"; path: string; depth: number } | { kind: "file"; file: FileDiff; index: number; depth: number };

export default function DiffView({ files, loading, highlightEnabled = true, onFileAction, loadFile, showFileHeader = true }: Props) {
  const [selected, setSelected] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(400);
  const [menu, setMenu] = useState<{ x: number; y: number; file: FileDiff } | null>(null);
  const [highlight, setHighlight] = useState<Map<number, string>>(new Map());
  const [wrap, setWrap] = useState(false);
  const [listMode, setListMode] = useState<"list" | "tree">("list");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [diffMode, setDiffMode] = useState<DiffMode>("inline");
  const [collapse, setCollapse] = useState(false);
  const [expandedFolds, setExpandedFolds] = useState<Set<string>>(new Set());
  const [activeHunk, setActiveHunk] = useState(-1);
  const workerRef = useRef<Worker | null>(null);
  const reqRef = useRef(0);
  const patchRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedPath = useRef<string | null>(null);
  useEffect(() => { setSelected(selectedFileIndex(files, selectedPath.current)); }, [files]);

  const manifestFile = files.length > 0 ? files[Math.min(selected, files.length - 1)] : null;
  const [loaded, setLoaded] = useState<{ source: FileDiff; value: FileDiff | null } | null>(null);
  const [patchError, setPatchError] = useState("");
  const lazySequence = useRef(0);
  const file = loadFile ? loaded?.source === manifestFile ? loaded.value : null : manifestFile;
  const patchLoading = !!loadFile && !!manifestFile && loaded?.source !== manifestFile && !patchError;
  useEffect(() => {
    const id = ++lazySequence.current; setPatchError("");
    if (!loadFile || !manifestFile) return;
    loadFile(manifestFile).then((value) => { if (id === lazySequence.current) setLoaded({ source: manifestFile, value }); })
      .catch((e) => { if (id === lazySequence.current) { setPatchError(String(e)); setLoaded({ source: manifestFile, value: null }); } });
    return () => { lazySequence.current++; };
  }, [manifestFile, loadFile]);

  const parsed = useMemo(() => parsePatch(file?.patch ?? ""), [file]);
  const contentLines = useMemo(() => parsed.lines.filter((line) => line.kind === "add" || line.kind === "del" || line.kind === "ctx"), [parsed]);
  // 单文件预览不重复显示文件名：隐藏 diff/index/---/+++ 这些标准路径头。
  const visibleLines = useMemo(() => showFileHeader
    ? parsed.lines
    : parsed.lines.filter((line) => !(line.kind === "meta" && /^(diff --git|index |--- |\+\+\+ )/.test(line.text))), [parsed, showFileHeader]);
  const displayRows = useMemo(
    () => diffMode === "inline"
      ? buildInlineRows(visibleLines, collapse, expandedFolds)
      : buildSplitRows(visibleLines, collapse, expandedFolds),
    [collapse, diffMode, expandedFolds, visibleLines],
  );
  const hunkRows = useMemo(() => displayRows.reduce<number[]>((rows, row, index) => {
    if (isHunkRow(row)) rows.push(index);
    return rows;
  }, []), [displayRows]);
  const effectiveWrap = wrap && contentLines.length <= MAX_HIGHLIGHT_LINES;

  useEffect(() => {
    const el = patchRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setViewportH(el.clientHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, [loading, files.length]);

  useEffect(() => {
    const id = ++reqRef.current;
    setHighlight(new Map());
    if (!file || !highlightEnabled || contentLines.length === 0 || contentLines.length > MAX_HIGHLIGHT_LINES) return;
    const language = languageForPath(file.path);
    if (!language) return;
    if (!workerRef.current) workerRef.current = new Worker(new URL("../highlight.worker.ts", import.meta.url), { type: "module" });
    const worker = workerRef.current;
    const targets = contentLines.map((line) => ({ sourceIndex: line.sourceIndex, text: line.content }));
    worker.onmessage = (e: MessageEvent<HighlightResponse>) => {
      if (e.data.id !== reqRef.current) return;
      const map = new Map<number, string>();
      e.data.html.forEach((html, i) => { if (html !== null) map.set(targets[i].sourceIndex, html); });
      setHighlight(map);
    };
    worker.postMessage({ id, language, lines: targets.map((target) => target.text) });
  }, [file, contentLines, highlightEnabled]);

  useEffect(() => () => { workerRef.current?.terminate(); workerRef.current = null; }, []);
  useEffect(() => { setExpandedFolds(new Set()); }, [file]);

  const rows = useMemo<DisplayRow[]>(() => {
    if (listMode === "list") return files.map((f, index) => ({ kind: "file", file: f, index, depth: 0 }));
    const result: DisplayRow[] = [];
    const seen = new Set<string>();
    files.map((entry, index) => ({ file: entry, index })).sort((a, b) => a.file.path.localeCompare(b.file.path)).forEach(({ file: entry, index }) => {
      const parts = entry.path.split("/");
      let hidden = false;
      for (let i = 1; i < parts.length; i++) {
        const dir = parts.slice(0, i).join("/");
        if ([...collapsed].some((c) => dir.startsWith(c + "/"))) { hidden = true; break; }
        if (!seen.has(dir)) { result.push({ kind: "dir", path: dir, depth: i - 1 }); seen.add(dir); }
        if (collapsed.has(dir)) { hidden = true; break; }
      }
      if (!hidden) result.push({ kind: "file", file: entry, index, depth: Math.max(0, parts.length - 1) });
    });
    return result;
  }, [collapsed, files, listMode]);

  const { start, end } = diffWindow(displayRows.length, scrollTop, viewportH, LINE_H);
  useEffect(() => {
    const el = patchRef.current;
    if (!el) return;
    const top = effectiveWrap ? el.scrollTop : Math.min(el.scrollTop, Math.max(0, displayRows.length * LINE_H - el.clientHeight));
    el.scrollTop = top; setScrollTop(top);
  }, [displayRows, effectiveWrap]);

  const computeActiveHunk = useCallback(() => {
    const el = patchRef.current;
    if (!el || hunkRows.length === 0) return -1;
    if (effectiveWrap) {
      const headers = [...el.querySelectorAll<HTMLElement>("[data-hunk-row]")];
      let index = -1;
      headers.forEach((header, i) => { if (header.offsetTop <= el.scrollTop + 8) index = i; });
      return index;
    }
    const row = Math.floor(el.scrollTop / LINE_H);
    let index = -1;
    hunkRows.forEach((hunkRow, i) => { if (hunkRow <= row + 1) index = i; });
    return index;
  }, [effectiveWrap, hunkRows]);

  useEffect(() => { setActiveHunk(computeActiveHunk()); }, [computeActiveHunk, displayRows]);

  const goDiff = useCallback((direction: number) => {
    const el = patchRef.current;
    if (!el || hunkRows.length === 0) return;
    const current = computeActiveHunk();
    const next = direction > 0
      ? Math.min(hunkRows.length - 1, current < 0 ? 0 : current + 1)
      : Math.max(0, current < 0 ? 0 : current - 1);
    if (effectiveWrap) {
      const header = el.querySelectorAll<HTMLElement>("[data-hunk-row]")[next];
      if (header) el.scrollTop = Math.max(0, header.offsetTop - 8);
    } else {
      el.scrollTop = Math.max(0, hunkRows[next] * LINE_H - 8);
    }
    setScrollTop(el.scrollTop);
    setActiveHunk(next);
  }, [computeActiveHunk, effectiveWrap, hunkRows]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
      const root = rootRef.current;
      if (!root || root.offsetParent === null) return;
      if (document.querySelector(".modal-backdrop, .context-menu")) return;
      if ((event.target as HTMLElement | null)?.closest("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      goDiff(event.key === "ArrowUp" ? -1 : 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goDiff]);

  const resetPatchScroll = () => { setScrollTop(0); setActiveHunk(-1); if (patchRef.current) patchRef.current.scrollTop = 0; };
  const selectFile = (index: number) => { selectedPath.current = files[index]?.path ?? null; setSelected(index); resetPatchScroll(); };
  const changeDiffMode = (mode: DiffMode) => { setDiffMode(mode); setExpandedFolds(new Set()); resetPatchScroll(); };
  const toggleCollapse = () => { setCollapse((value) => !value); setExpandedFolds(new Set()); resetPatchScroll(); };
  const toggleFold = (runId: string) => setExpandedFolds((prev) => {
    const next = new Set(prev);
    if (next.has(runId)) next.delete(runId); else next.add(runId);
    return next;
  });

  const renderContent = (line: PatchLine) => {
    const html = highlight.get(line.sourceIndex);
    if (html === undefined) return line.text || " ";
    const sign = line.kind === "add" ? "+" : line.kind === "del" ? "-" : " ";
    return <><span className="diff-sign">{sign}</span><span dangerouslySetInnerHTML={{ __html: html }} /></>;
  };

  const renderFold = (row: Extract<InlineRow | SplitRow, { kind: "fold" }>, index: number) => (
    <button
      key={`fold-${row.runId}`}
      type="button"
      className={`diff-line line-fold${effectiveWrap ? " wrapped" : ""}`}
      style={effectiveWrap ? undefined : { top: index * LINE_H, height: LINE_H }}
      title="展开未修改片段"
      onClick={() => toggleFold(row.runId)}
    >
      ⋯ {row.count} 行未修改（点击展开）
    </button>
  );

  const renderInlineRow = (row: InlineRow, index: number) => {
    if (row.kind === "fold") return renderFold(row, index);
    const line = row.line;
    const style = effectiveWrap ? undefined : { top: index * LINE_H, height: LINE_H };
    const className = `diff-line line-${line.kind}${effectiveWrap ? " wrapped" : ""}`;
    if (line.kind === "hunk") return <div key={`line-${line.sourceIndex}`} className={className} style={style} data-hunk-row="">{line.text}</div>;
    if (line.kind === "meta" || line.kind === "note") return <div key={`line-${line.sourceIndex}`} className={className} style={style}>{line.text}</div>;
    return <div key={`line-${line.sourceIndex}`} className={className} style={style}>{renderContent(line)}</div>;
  };

  const renderCell = (line: PatchLine | null, side: "old" | "new") => {
    if (!line) return <div className="diff-cell empty" aria-hidden="true" />;
    const lineClass = line.kind === "add" ? " line-add" : line.kind === "del" ? " line-del" : "";
    const lineNo = side === "old" ? line.oldLine : line.newLine;
    const sign = side === "old" ? (line.kind === "del" ? "-" : line.kind === "ctx" ? " " : "") : (line.kind === "add" ? "+" : line.kind === "ctx" ? " " : "");
    const html = highlight.get(line.sourceIndex);
    return (
      <div className={`diff-cell${lineClass}${effectiveWrap ? " wrapped" : ""}`}>
        <span className="diff-no">{lineNo ?? ""}</span>
        <span className="diff-sign">{sign}</span>
        {html !== undefined ? <span className="diff-text" dangerouslySetInnerHTML={{ __html: html }} /> : <span className="diff-text">{line.content || " "}</span>}
      </div>
    );
  };

  const renderSplitRow = (row: SplitRow, index: number) => {
    if (row.kind === "fold") return renderFold(row, index);
    const style = effectiveWrap ? undefined : { top: index * LINE_H, height: LINE_H };
    if (row.kind === "whole") {
      const line = row.line;
      return <div key={`whole-${line.sourceIndex}`} className={`diff-line line-${line.kind}${effectiveWrap ? " wrapped" : ""}`} style={style} data-hunk-row={line.kind === "hunk" ? "" : undefined}>{line.text}</div>;
    }
    return <div key={`pair-${index}`} className={`diff-row${effectiveWrap ? " wrapped" : ""}`} style={style}>{renderCell(row.left, "old")}{renderCell(row.right, "new")}</div>;
  };

  const renderRow = (row: InlineRow | SplitRow, index: number) => (
    diffMode === "inline" ? renderInlineRow(row as InlineRow, index) : renderSplitRow(row as SplitRow, index)
  );

  if (loading) return <div className="empty-state"><span className="spinner" /><span>正在加载差异…</span></div>;
  if (files.length === 0) return <div className="empty-state"><Icon name="changes" size={28} /><strong>无变更内容</strong><span>选择其它提交或文件查看差异。</span></div>;

  const showFileList = showFileHeader && files.length > 1;
  const hasHunks = hunkRows.length > 0;

  return (
    <div className="diff-view" ref={rootRef}>
      <div className="diff-body">
        {showFileList && (
          <div className="diff-file-column">
            <div className="diff-file-header">
              <span>文件</span>
              <button className={`text-toggle${listMode === "tree" ? " active" : ""}`} title="切换文件列表 / 目录树" onClick={() => setListMode(listMode === "list" ? "tree" : "list")}>{listMode === "list" ? "列表" : "目录树"}</button>
            </div>
            <div className="diff-file-list" role="listbox" aria-label="差异文件">
              {rows.map((row) => row.kind === "dir" ? (
                <button className="diff-directory" key={`dir-${row.path}`} style={{ paddingLeft: 8 + row.depth * 14 }} onClick={() => setCollapsed((prev) => { const next = new Set(prev); if (next.has(row.path)) next.delete(row.path); else next.add(row.path); return next; })}><Icon name={collapsed.has(row.path) ? "folder" : "chevron-down"} size={13} /><span>{row.path.split("/").pop()}</span></button>
              ) : (
                <div
                  key={`${row.file.path}-${row.index}`}
                  className={`diff-file-item${row.index === selected ? " selected" : ""}`}
                  style={{ paddingLeft: 8 + row.depth * 14 }}
                  data-file-index={row.index}
                  role="option"
                  aria-selected={row.index === selected}
                  tabIndex={row.index === selected ? 0 : -1}
                  title={row.file.oldPath ? `${row.file.oldPath} → ${row.file.path}` : row.file.path}
                  onClick={() => selectFile(row.index)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectFile(row.index); } else if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); const visible = rows.filter((r): r is Extract<DisplayRow, { kind: "file" }> => r.kind === "file"); const current = visible.findIndex((r) => r.index === selected); const next = visible[Math.max(0, Math.min(visible.length - 1, current + (e.key === "ArrowDown" ? 1 : -1)))]?.index ?? selected; selectFile(next); (e.currentTarget.parentElement?.querySelector(`[data-file-index="${next}"]`) as HTMLElement | null)?.focus(); } }}
                  onContextMenu={(e) => {
                    if (!onFileAction) return;
                    e.preventDefault(); selectFile(row.index); setMenu({ x: e.clientX, y: e.clientY, file: row.file });
                  }}
                >
                  <span className={`file-status status-${row.file.status}`}>{row.file.status[0].toUpperCase()}</span>
                  <span className="file-path">{listMode === "tree" ? row.file.path.split("/").pop() : row.file.path}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="diff-main">
          <div className="diff-toolbar">
            {showFileHeader && <span className="panel-title">{manifestFile?.path}</span>}
            {showFileHeader && <span className="diff-toolbar-separator" aria-hidden="true" />}
            <div className="diff-mode-group" role="group" aria-label="差异视图模式">
              <button className={`text-toggle${diffMode === "inline" ? " active" : ""}`} aria-pressed={diffMode === "inline"} title="Inline view（行内差异）" onClick={() => changeDiffMode("inline")}>Inline</button>
              <button className={`text-toggle${diffMode === "split" ? " active" : ""}`} aria-pressed={diffMode === "split"} title="Split view（并排差异）" onClick={() => changeDiffMode("split")}>Split</button>
            </div>
            <button className="icon-button diff-prev" title="上一处差异 (Alt+↑)" aria-label="上一处差异" disabled={!hasHunks || activeHunk <= 0} onClick={() => goDiff(-1)}><Icon name="chevron-down" size={14} /></button>
            <button className="icon-button" title="下一处差异 (Alt+↓)" aria-label="下一处差异" disabled={!hasHunks || activeHunk >= hunkRows.length - 1} onClick={() => goDiff(1)}><Icon name="chevron-down" size={14} /></button>
            <button className={`text-toggle${collapse ? " active" : ""}`} aria-pressed={collapse} title="Collapse Unchanged Fragments（折叠未修改片段）" onClick={toggleCollapse}>折叠未修改</button>
            <button className={`text-toggle${wrap ? " active" : ""}`} disabled={contentLines.length > MAX_HIGHLIGHT_LINES} title={contentLines.length > MAX_HIGHLIGHT_LINES ? "超大 patch 不支持自动换行" : "自动换行"} onClick={() => setWrap(!wrap)}>换行</button>
            <button className="icon-button" title="复制当前 patch" onClick={() => { if (file) void navigator.clipboard?.writeText(file.patch); }}><Icon name="copy" size={14} /></button>
          </div>
          {file?.truncated && <div className="truncated-hint" role="status">文件或 patch 超过安全限制，未完整显示；请使用外部工具查看。</div>}
          <div className={`diff-patch${effectiveWrap ? " wrap" : ""}`} onScroll={(e) => { setScrollTop(e.currentTarget.scrollTop); setActiveHunk(computeActiveHunk()); }} ref={patchRef}>
            {patchLoading ? <div className="empty-state"><span className="spinner" />正在读取单文件 diff…</div> : patchError ? <div className="empty-state" role="alert">{patchError}</div> : file?.isBinary ? <div className="empty-state"><Icon name="file" size={28} /><span>二进制文件，无法显示文本 diff</span></div> : (
              <div className={`diff-lines${diffMode === "split" ? " split" : ""}${effectiveWrap ? " wrapped" : ""}`} style={effectiveWrap ? undefined : { height: displayRows.length * LINE_H }}>
                {(effectiveWrap ? displayRows : displayRows.slice(start, end)).map((row, i) => renderRow(row, effectiveWrap ? i : start + i))}
              </div>
            )}
            {!patchLoading && !patchError && !file?.isBinary && visibleLines.length === 0 && !file?.truncated && <div className="panel-hint">无文本差异（可能仅权限/路径变化）</div>}
            {wrap && !effectiveWrap && <div className="panel-hint">巨型 patch 使用虚拟滚动，已暂停换行。</div>}
          </div>
        </div>
      </div>
      {menu && onFileAction && <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={[
        { id: "open", label: "打开文件", icon: "external", onSelect: () => onFileAction("open", menu.file) },
        { id: "history", label: "查看文件历史", icon: "history", onSelect: () => onFileAction("history", menu.file) },
        { id: "blame", label: "Blame（逐行归属）", onSelect: () => onFileAction("blame", menu.file) },
        { id: "sep", separator: true },
        { id: "reveal", label: "在文件管理器中显示", icon: "folder", onSelect: () => onFileAction("reveal", menu.file) },
        { id: "copy", label: "复制相对路径", icon: "copy", onSelect: () => onFileAction("copy-path", menu.file) },
      ]} />}
    </div>
  );
}
