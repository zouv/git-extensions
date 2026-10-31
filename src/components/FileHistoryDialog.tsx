import { useEffect, useState } from "react";
import { api, formatDate } from "../api";
import type { FileDiff, FileLogEntry } from "../types";
import DiffView from "./DiffView";

interface Props {
  repoPath: string;
  file: string;
  highlightEnabled?: boolean;
  onClose: () => void;
}

export default function FileHistoryDialog({ repoPath, file, highlightEnabled, onClose }: Props) {
  const [entries, setEntries] = useState<FileLogEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .fileLog(repoPath, file)
      .then((result) => {
        if (cancelled) return;
        setEntries(result);
        setLoading(false);
        if (result.length > 0) setSelected(result[0].oid);
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
  }, [repoPath, file]);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setDiff(null);
    api
      .getCommitDiff(repoPath, selected)
      .then((files) => {
        if (cancelled) return;
        setDiff(files.find((f) => f.path === file || f.oldPath === file) ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [repoPath, file, selected]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3>文件历史 · {file}</h3>
        {loading && <div className="panel-hint">加载中…</div>}
        {error && <div className="panel-hint">{error}</div>}
        {!loading && !error && (
          <>
            <div className="history-list">
              {entries.map((e) => (
                <div
                  key={e.oid}
                  className={`history-item${selected === e.oid ? " selected" : ""}`}
                  onClick={() => setSelected(e.oid)}
                >
                  <span className="blame-sha">{e.shortId}</span>
                  <span className="history-subject" title={e.subject}>{e.subject}</span>
                  <span className="blame-author">{e.authorName}</span>
                  <span className="blame-date">{formatDate(e.authorTime)}</span>
                </div>
              ))}
              {entries.length === 0 && <div className="panel-hint">（无历史记录）</div>}
            </div>
            <div className="history-diff">
              {diff ? <DiffView files={[diff]} highlightEnabled={highlightEnabled} /> : <div className="panel-hint">选择提交查看该文件的 diff</div>}
            </div>
          </>
        )}
        <div className="modal-footer">
          <button onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}
