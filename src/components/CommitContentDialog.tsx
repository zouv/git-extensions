import { useEffect, useState } from "react";
import { api, formatDate } from "../api";
import type { CommitDetail, FileDiff } from "../types";
import Dialog from "../ui/Dialog";
import DiffView from "./DiffView";
import InlineError from "../ui/InlineError";

interface Props {
  repoPath: string;
  oid: string;
  onClose: () => void;
}

/** Push 界面「查看提交内容」：提交信息 + 文件清单与按需单文件 diff。 */
export default function CommitContentDialog({ repoPath, oid, onClose }: Props) {
  const [detail, setDetail] = useState<CommitDetail | null>(null);
  const [files, setFiles] = useState<FileDiff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true); setError("");
    Promise.all([api.getCommit(repoPath, oid), api.getCommitFiles(repoPath, oid)])
      .then(([nextDetail, nextFiles]) => {
        if (!alive) return;
        setDetail(nextDetail); setFiles(nextFiles);
      })
      .catch((reason) => { if (alive) setError(String(reason)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [repoPath, oid]);

  return <Dialog
    wide
    title={`提交 ${detail?.shortId ?? oid.slice(0, 7)}`}
    onClose={onClose}
    className="commit-content-dialog"
    footer={<button className="primary" onClick={onClose}>关闭</button>}
  >
    {error && <InlineError message={error} />}
    {loading && <div className="panel-hint"><span className="spinner" /> 正在读取提交内容…</div>}
    {detail && <>
      <div className="commit-content-meta"><strong>{detail.authorName}</strong> · {formatDate(detail.authorTime)} · <code>{detail.oid}</code></div>
      <pre className="commit-content-message">{detail.message}</pre>
      <div className="commit-content-diff">
        <DiffView
          files={files}
          loadFile={(file) => api.getCommitFileDiff(repoPath, oid, file.path, file.oldPath)
            .then((diffs) => diffs.find((item) => item.path === file.path || item.oldPath === file.path) ?? null)}
          prefKey={repoPath}
        />
      </div>
    </>}
  </Dialog>;
}