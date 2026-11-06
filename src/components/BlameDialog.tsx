import { useEffect, useRef, useState } from "react";
import { api, formatDate } from "../api";
import type { BlameLine } from "../types";
import Dialog from "../ui/Dialog";

const LINE_H = 20;

interface Props {
  repoPath: string;
  file: string;
  oid?: string;
  onClose: () => void;
  onOpenCommit?: (oid: string) => void;
}

export default function BlameDialog({ repoPath, file, oid, onClose, onOpenCommit }: Props) {
  const [lines, setLines] = useState<BlameLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(480);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = listRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setViewportH(element.clientHeight));
    observer.observe(element);
    setViewportH(element.clientHeight);
    return () => observer.disconnect();
  }, [loading]);

  useEffect(() => {
    let cancelled = false;
    api
      .blameFile(repoPath, file, oid)
      .then((result) => {
        if (!cancelled) {
          setLines(result);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(String(e));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [repoPath, file, oid]);

  const start = Math.max(0, Math.floor(scrollTop / LINE_H) - 5);
  const end = Math.min(lines.length, start + Math.ceil(viewportH / LINE_H) + 10);

  return (
    <Dialog title={`Blame · ${file}`} onClose={onClose} wide footer={<button onClick={onClose}>关闭</button>}>
      {loading && <div className="panel-hint">加载中…</div>}
      {error && <div className="panel-hint">{error}</div>}
      {!loading && !error && (
        <div className="blame-list" ref={listRef} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
          <div className="diff-lines" style={{ height: lines.length * LINE_H }}>
            {lines.slice(start, end).map((line) => (
              <div key={line.line} className="blame-row" style={{ top: (line.line - 1) * LINE_H, height: LINE_H }}>
                {onOpenCommit && line.oid && !/^0+$/.test(line.oid)
                  ? <button type="button" className="blame-sha blame-sha-button" title={`查看提交 ${line.oid}`} onClick={() => onOpenCommit(line.oid)}>{line.shortId}</button>
                  : <span className="blame-sha" title={line.oid}>{line.shortId}</span>}
                <span className="blame-author">{line.author}</span>
                <span className="blame-date">{line.oid ? formatDate(line.time).slice(0, 10) : "—"}</span>
                <span className="blame-lineno">{line.line}</span>
                <span className="blame-content">{line.content || " "}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Dialog>
  );
}
