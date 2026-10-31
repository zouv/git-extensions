import { useEffect, useMemo, useRef, useState } from "react";
import type { FileDiff } from "../types";
import { languageForPath } from "../languages";
import type { HighlightResponse } from "../highlight.worker";

const LINE_H = 20;
/** 超过该行数的文件不做语法高亮，控制 worker 负载 */
const MAX_HIGHLIGHT_LINES = 5000;

interface Props {
  files: FileDiff[];
  loading?: boolean;
  highlightEnabled?: boolean;
  onFileAction?: (action: "history" | "blame", file: FileDiff) => void;
}

type LineKind = "add" | "del" | "hunk" | "meta" | "ctx";

function classify(line: string): LineKind {
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  if (/^(diff |index |---|\+\+\+|new file|deleted file|similarity|rename |old mode|new mode)/.test(line))
    return "meta";
  return "ctx";
}

/** diff 查看：左文件列表（右键历史 / blame），右虚拟化 patch + Worker 异步语法高亮。 */
export default function DiffView({ files, loading, highlightEnabled = true, onFileAction }: Props) {
  const [selected, setSelected] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(400);
  const [menu, setMenu] = useState<{ x: number; y: number; file: FileDiff } | null>(null);
  const [highlight, setHighlight] = useState<Map<number, string>>(new Map());
  const workerRef = useRef<Worker | null>(null);
  const reqRef = useRef(0);

  const file = files.length > 0 ? files[Math.min(selected, files.length - 1)] : null;
  const lines = useMemo(() => (file ? file.patch.split("\n") : []), [file]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menu]);

  // 选中文件变化时在 Worker 里高亮；旧请求结果直接丢弃
  useEffect(() => {
    const id = ++reqRef.current;
    setHighlight(new Map());
    if (!file || !highlightEnabled) return;
    const language = languageForPath(file.path);
    if (!language || lines.length === 0 || lines.length > MAX_HIGHLIGHT_LINES) return;
    if (!workerRef.current) {
      workerRef.current = new Worker(new URL("../highlight.worker.ts", import.meta.url), {
        type: "module",
      });
    }
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
      e.data.html.forEach((html, i) => {
        if (html !== null) map.set(targets[i].row, html);
      });
      setHighlight(map);
    };
    worker.postMessage({ id, language, lines: targets.map((t) => t.text) });
  }, [file, lines, highlightEnabled]);

  useEffect(() => () => {
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  const start = Math.max(0, Math.floor(scrollTop / LINE_H) - 5);
  const end = Math.min(lines.length, start + Math.ceil(viewportH / LINE_H) + 10);

  if (loading) return <div className="panel-hint">diff 加载中…</div>;
  if (files.length === 0) return <div className="panel-hint">无变更内容</div>;

  return (
    <div className="diff-view">
      <div className="diff-file-list">
        {files.map((f, i) => (
          <div
            key={`${f.path}-${i}`}
            className={`diff-file-item${i === selected ? " selected" : ""}`}
            title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}
            onClick={() => {
              setSelected(i);
              setScrollTop(0);
            }}
            onContextMenu={(e) => {
              if (!onFileAction) return;
              e.preventDefault();
              setSelected(i);
              setMenu({ x: e.clientX, y: e.clientY, file: f });
            }}
          >
            <span className={`file-status status-${f.status}`}>{f.status[0].toUpperCase()}</span>
            <span className="file-path">{f.path}</span>
          </div>
        ))}
      </div>
      <div
        className="diff-patch"
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        ref={(el) => {
          if (el && el.clientHeight !== viewportH) setViewportH(el.clientHeight);
        }}
      >
        {file?.isBinary ? (
          <div className="panel-hint">二进制文件，无法显示 diff</div>
        ) : (
          <div className="diff-lines" style={{ height: lines.length * LINE_H }}>
            {lines.slice(start, end).map((line, i) => {
              const row = start + i;
              const html = highlight.get(row);
              return (
                <div
                  key={row}
                  className={`diff-line line-${classify(line)}`}
                  style={{ top: row * LINE_H, height: LINE_H }}
                >
                  {html !== undefined ? (
                    <span dangerouslySetInnerHTML={{ __html: line.charAt(0) + html }} />
                  ) : (
                    line || " "
                  )}
                </div>
              );
            })}
            {file?.truncated && (
              <div className="panel-hint" style={{ top: lines.length * LINE_H }}>
                （patch 过大，已截断）
              </div>
            )}
          </div>
        )}
      </div>
      {menu && onFileAction && (
        <div className="context-menu" style={{ left: menu.x, top: menu.y }}>
          <div className="context-item" onClick={() => onFileAction("history", menu.file)}>
            查看文件历史
          </div>
          <div className="context-item" onClick={() => onFileAction("blame", menu.file)}>
            Blame（逐行归属）
          </div>
        </div>
      )}
    </div>
  );
}
