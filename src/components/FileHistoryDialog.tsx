import { useEffect, useState } from "react";
import { api, formatDate } from "../api";
import type { FileDiff, FileLogEntry } from "../types";
import DiffView from "./DiffView";
import Dialog from "../ui/Dialog";

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
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null); setSelected(null); setDiff(null);
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
    setDiff(null); setDiffError(null); setDiffLoading(true);
    const versionPath = entries.find((entry) => entry.oid === selected)?.filePath ?? file;
    api
      .getCommitFiles(repoPath, selected)
      .then((manifest) => {
        if (cancelled) return null;
        const change = manifest.find((f) => f.path === versionPath || f.oldPath === versionPath);
        return api.getCommitFileDiff(repoPath, selected, versionPath, change?.oldPath);
      })
      .then((files) => {
        if (cancelled || !files) return;
        setDiff(files.find((f) => f.path === versionPath || f.oldPath === versionPath) ?? null);
      })
      .catch((e) => { if (!cancelled) setDiffError(String(e)); })
      .finally(() => { if (!cancelled) setDiffLoading(false); });
    return () => {
      cancelled = true;
    };
  }, [repoPath, file, selected, entries]);

  return (
    <Dialog title={`文件历史 · ${file}`} onClose={onClose} wide footer={<button onClick={onClose}>关闭</button>}>
      {loading && <div className="panel-hint">加载中…</div>}
      {error && <div className="panel-hint">{error}</div>}
      {!loading && !error && (
        <>
          <div className="history-list">
            {entries.map((entry) => (
              <div key={entry.oid} className={`history-item${selected === entry.oid ? " selected" : ""}`} onClick={() => setSelected(entry.oid)}>
                <span className="blame-sha">{entry.shortId}</span>
                <span className="history-subject" title={entry.subject}>{entry.subject}</span>
                <span className="blame-author">{entry.authorName}</span>
                <span className="blame-date">{formatDate(entry.authorTime)}</span>
              </div>
            ))}
            {entries.length === 0 && <div className="panel-hint">（无历史记录）</div>}
          </div>
          <div className="history-diff">{diffError ? <div className="inline-error" role="alert">{diffError}</div> : diffLoading ? <div className="panel-hint" role="status">正在读取该版本的文件差异…</div> : diff ? <DiffView files={[diff]} highlightEnabled={highlightEnabled} /> : <div className="panel-hint">选择提交查看该文件的 diff</div>}</div>
        </>
      )}
    </Dialog>
  );
}
