import { useEffect, useState } from "react";
import { api, formatDate } from "../api";
import type { BlameLine } from "../types";
import Dialog from "../ui/Dialog";

const LINE_H = 20;

interface Props {
  repoPath: string;
  file: string;
  oid?: string;
  onClose: () => void;
}

export default function BlameDialog({ repoPath, file, oid, onClose }: Props) {
  const [lines, setLines] = useState<BlameLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [scrollTop, setScrollTop] = useState(0);

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

  const viewportH = 480;
  const start = Math.max(0, Math.floor(scrollTop / LINE_H) - 5);
  const end = Math.min(lines.length, start + Math.ceil(viewportH / LINE_H) + 10);

  return (
    <Dialog title={`Blame · ${file}`} onClose={onClose} wide footer={<button onClick={onClose}>关闭</button>}>
      {loading && <div className="panel-hint">加载中…</div>}
      {error && <div className="panel-hint">{error}</div>}
      {!loading && !error && (
        <div className="blame-list" style={{ height: viewportH }} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
          <div className="diff-lines" style={{ height: lines.length * LINE_H }}>
            {lines.slice(start, end).map((line) => (
              <div key={line.line} className="blame-row" style={{ top: (line.line - 1) * LINE_H, height: LINE_H }}>
                <span className="blame-sha" title={line.oid}>{line.shortId}</span>
                <span className="blame-author">{line.author}</span>
                <span className="blame-date">{formatDate(line.time).slice(0, 10)}</span>
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
