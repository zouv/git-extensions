import { useEffect, useMemo, useRef, useState } from "react";
import type { FileDiff } from "../types";
import { languageForPath } from "../languages";
import type { HighlightResponse } from "../highlight.worker";
import ContextMenu from "../ui/ContextMenu";
import Icon from "../ui/Icon";

const LINE_H = 20;
const MAX_HIGHLIGHT_LINES = 5000;

export type FileAction = "history" | "blame" | "open" | "reveal" | "copy-path";

interface Props {
  files: FileDiff[];
  loading?: boolean;
  highlightEnabled?: boolean;
  onFileAction?: (action: FileAction, file: FileDiff) => void;
}

type LineKind = "add" | "del" | "hunk" | "meta" | "ctx";
type DisplayRow = { kind: "dir"; path: string; depth: number } | { kind: "file"; file: FileDiff; index: number; depth: number };

function classify(line: string): LineKind {
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  if (/^(diff |index |---|\+\+\+|new file|deleted file|similarity|rename |old mode|new mode)/.test(line)) return "meta";
  return "ctx";
}

export default function DiffView({ files, loading, highlightEnabled = true, onFileAction }: Props) {
  const [selected, setSelected] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(400);
  const [menu, setMenu] = useState<{ x: number; y: number; file: FileDiff } | null>(null);
  const [highlight, setHighlight] = useState<Map<number, string>>(new Map());
  const [wrap, setWrap] = useState(false);
  const [mode, setMode] = useState<"list" | "tree">("list");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const workerRef = useRef<Worker | null>(null);
  const reqRef = useRef(0);
  const patchRef = useRef<HTMLDivElement>(null);

  const file = files.length > 0 ? files[Math.min(selected, files.length - 1)] : null;
  const lines = useMemo(() => (file ? file.patch.split("\n") : []), [file]);

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
    if (!file || !highlightEnabled) return;
    const language = languageForPath(file.path);
    if (!language || lines.length === 0 || lines.length > MAX_HIGHLIGHT_LINES) return;
    if (!workerRef.current) workerRef.current = new Worker(new URL("../highlight.worker.ts", import.meta.url), { type: "module" });
    const worker = workerRef.current;
    const targets: { row: number; text: string }[] = [];
    lines.forEach((line, row) => {
      const kind = classify(line);
      if (kind === "meta" || kind === "hunk") return;
      targets.push({ row, text: line.slice(1) });
    });
    worker.onmessage = (e: MessageEvent<HighlightResponse>) => {
      if (e.data.id !== reqRef.current) return;
      const map = new Map<number, string>();
      e.data.html.forEach((html, i) => { if (html !== null) map.set(targets[i].row, html); });
      setHighlight(map);
    };
    worker.postMessage({ id, language, lines: targets.map((t) => t.text) });
  }, [file, lines, highlightEnabled]);

  useEffect(() => () => { workerRef.current?.terminate(); workerRef.current = null; }, []);

  const rows = useMemo<DisplayRow[]>(() => {
    if (mode === "list") return files.map((f, index) => ({ kind: "file", file: f, index, depth: 0 }));
    const result: DisplayRow[] = [];
    const seen = new Set<string>();
    files.map((file, index) => ({ file, index })).sort((a, b) => a.file.path.localeCompare(b.file.path)).forEach(({ file, index }) => {
      const parts = file.path.split("/");
      let hidden = false;
      for (let i = 1; i < parts.length; i++) {
        const dir = parts.slice(0, i).join("/");
        if ([...collapsed].some((c) => dir === c || dir.startsWith(c + "/"))) hidden = true;
        if (!seen.has(dir)) { result.push({ kind: "dir", path: dir, depth: i - 1 }); seen.add(dir); }
      }
      if (!hidden) result.push({ kind: "file", file, index, depth: Math.max(0, parts.length - 1) });
    });
    return result;
  }, [collapsed, files, mode]);

  const start = Math.max(0, Math.floor(scrollTop / LINE_H) - 5);
  const end = Math.min(lines.length, start + Math.ceil(viewportH / LINE_H) + 10);
  const selectFile = (index: number) => { setSelected(index); setScrollTop(0); if (patchRef.current) patchRef.current.scrollTop = 0; };
  const renderLine = (line: string, row: number) => {
    const html = highlight.get(row);
    return <div key={row} className={`diff-line line-${classify(line)}${wrap ? " wrapped" : ""}`} style={wrap ? undefined : { top: row * LINE_H, height: LINE_H }}>{html !== undefined ? <span dangerouslySetInnerHTML={{ __html: line.charAt(0) + html }} /> : line || " "}</div>;
  };

  if (loading) return <div className="empty-state"><span className="spinner" /><span>正在加载差异…</span></div>;
  if (files.length === 0) return <div className="empty-state"><Icon name="changes" size={28} /><strong>无变更内容</strong><span>选择其它提交或文件查看差异。</span></div>;

  return (
    <div className="diff-view">
      <div className="diff-toolbar">
        <span className="panel-title">{file?.path}</span>
        <button className="icon-button" title="上一个文件" disabled={selected <= 0} onClick={() => selectFile(selected - 1)}>↑</button>
        <button className="icon-button" title="下一个文件" disabled={selected >= files.length - 1} onClick={() => selectFile(selected + 1)}>↓</button>
        <button className={`text-toggle${mode === "tree" ? " active" : ""}`} title="切换文件列表 / 目录树" onClick={() => setMode(mode === "list" ? "tree" : "list")}>{mode === "list" ? "列表" : "目录树"}</button>
        <button className={`text-toggle${wrap ? " active" : ""}`} disabled={lines.length > MAX_HIGHLIGHT_LINES} title={lines.length > MAX_HIGHLIGHT_LINES ? "超大 patch 不支持自动换行" : "自动换行"} onClick={() => setWrap(!wrap)}>换行</button>
        <button className="icon-button" title="复制当前 patch" onClick={() => { if (file) void navigator.clipboard?.writeText(file.patch); }}><Icon name="copy" size={14} /></button>
      </div>
      <div className="diff-body">
        <div className="diff-file-list" role="listbox" aria-label="差异文件">
          {rows.map((row) => row.kind === "dir" ? (
            <button className="diff-directory" key={`dir-${row.path}`} style={{ paddingLeft: 8 + row.depth * 14 }} onClick={() => setCollapsed((prev) => { const next = new Set(prev); if (next.has(row.path)) next.delete(row.path); else next.add(row.path); return next; })}><Icon name={collapsed.has(row.path) ? "folder" : "chevron-down"} size={13} /><span>{row.path.split("/").pop()}</span></button>
          ) : (
            <div
              key={`${row.file.path}-${row.index}`}
              className={`diff-file-item${row.index === selected ? " selected" : ""}`}
              style={{ paddingLeft: 8 + row.depth * 14 }}
              role="option"
              aria-selected={row.index === selected}
              tabIndex={row.index === selected ? 0 : -1}
              title={row.file.oldPath ? `${row.file.oldPath} → ${row.file.path}` : row.file.path}
              onClick={() => selectFile(row.index)}
              onContextMenu={(e) => {
                if (!onFileAction) return;
                e.preventDefault(); selectFile(row.index); setMenu({ x: e.clientX, y: e.clientY, file: row.file });
              }}
            >
              <span className={`file-status status-${row.file.status}`}>{row.file.status[0].toUpperCase()}</span>
              <span className="file-path">{mode === "tree" ? row.file.path.split("/").pop() : row.file.path}</span>
            </div>
          ))}
        </div>
        <div className={`diff-patch${wrap ? " wrap" : ""}`} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)} ref={patchRef}>
          {file?.isBinary ? <div className="empty-state"><Icon name="file" size={28} /><span>二进制文件，无法显示文本 diff</span></div> : (
            <div className={`diff-lines${wrap ? " wrapped" : ""}`} style={wrap ? undefined : { height: lines.length * LINE_H }}>
              {(wrap ? lines.map(renderLine) : lines.slice(start, end).map((line, i) => renderLine(line, start + i)))}
              {file?.truncated && <div className="truncated-hint">patch 过大，已截断</div>}
            </div>
          )}
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
