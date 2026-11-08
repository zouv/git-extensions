import { useState } from "react";
import { api, formatDate } from "../api";
import type { GrepMatch, ScopedHistoryEntry } from "../types";
import Dialog from "../ui/Dialog";
import InlineError from "../ui/InlineError";
import Icon from "../ui/Icon";

interface Props {
  repoPath: string;
  onClose: () => void;
  onSelectCommit: (oid: string) => void;
  onOpenFileAtLine?: (file: string, line: number) => void;
}

export default function SearchDialog({ repoPath, onClose, onSelectCommit, onOpenFileAtLine }: Props) {
  const [tab, setTab] = useState<"commits" | "grep">("commits");
  const [query, setQuery] = useState("");
  const [author, setAuthor] = useState("");
  const [filePath, setFilePath] = useState("");
  const [allRefs, setAllRefs] = useState(true);
  const [commitResults, setCommitResults] = useState<ScopedHistoryEntry[]>([]);

  const [grepPattern, setGrepPattern] = useState("");
  const [grepRev, setGrepRev] = useState("");
  const [ignoreCase, setIgnoreCase] = useState(true);
  const [grepResults, setGrepResults] = useState<GrepMatch[]>([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const runCommitSearch = async () => {
    if (loading) return;
    setLoading(true); setError("");
    try {
      const res = await api.searchCommits(repoPath, query, author, filePath, allRefs, 300);
      setCommitResults(res);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const runGrepSearch = async () => {
    if (loading || !grepPattern.trim()) return;
    setLoading(true); setError("");
    try {
      const res = await api.gitGrep(repoPath, grepPattern.trim(), grepRev.trim() || undefined, ignoreCase, 500);
      setGrepResults(res);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      title="高级搜索（提交历史 / 代码全文）"
      wide
      busy={loading}
      onClose={onClose}
      footer={<button onClick={onClose}>关闭</button>}
    >
      <div className="tabs" role="tablist" aria-label="搜索模式" style={{ marginBottom: 10 }}>
        <button role="tab" aria-selected={tab === "commits"} className={tab === "commits" ? "active" : ""} onClick={() => setTab("commits")}>
          提交历史搜索 ({commitResults.length})
        </button>
        <button role="tab" aria-selected={tab === "grep"} className={tab === "grep" ? "active" : ""} onClick={() => setTab("grep")}>
          代码全文搜索 git grep ({grepResults.length})
        </button>
      </div>
      {error && <InlineError message={error} />}
      {tab === "commits" ? (
        <>
          <div className="dialog-form">
            <div className="branch-create">
              <input
                data-autofocus
                placeholder="提交信息关键字 (--grep)"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void runCommitSearch(); }}
              />
              <input
                placeholder="作者名称或邮箱 (--author)"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void runCommitSearch(); }}
              />
            </div>
            <div className="branch-create">
              <input
                placeholder="限定文件或目录路径（可选）"
                value={filePath}
                onChange={(e) => setFilePath(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void runCommitSearch(); }}
              />
              <label className="force-label">
                <input type="checkbox" checked={allRefs} onChange={(e) => setAllRefs(e.target.checked)} />
                搜索所有分支 (--all)
              </label>
              <button className="primary" disabled={loading} onClick={() => void runCommitSearch()}>
                <Icon name="search" />{loading ? "搜索中…" : "搜索提交"}
              </button>
            </div>
          </div>
          <div className="branch-list" role="listbox" aria-label="提交搜索结果">
            {commitResults.map((entry) => (
              <div
                key={entry.oid}
                role="option"
                aria-selected={false}
                className="branch-item"
                tabIndex={0}
                onClick={() => { onSelectCommit(entry.oid); onClose(); }}
              >
                <span><code>{entry.shortId}</code> {entry.subject}</span>
                <span className="branch-oid">{entry.authorName} · {formatDate(entry.authorTime)}</span>
              </div>
            ))}
            {commitResults.length === 0 && !loading && <div className="panel-hint">输入条件后按回车或点击「搜索提交」检索全库历史。</div>}
          </div>
        </>
      ) : (
        <>
          <div className="dialog-form">
            <div className="branch-create">
              <input
                data-autofocus
                placeholder="要搜索的代码文本或正则表达式"
                value={grepPattern}
                onChange={(e) => setGrepPattern(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void runGrepSearch(); }}
              />
              <input
                placeholder="指定分支 / 提交（留空搜工作区）"
                value={grepRev}
                onChange={(e) => setGrepRev(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void runGrepSearch(); }}
              />
              <label className="force-label">
                <input type="checkbox" checked={ignoreCase} onChange={(e) => setIgnoreCase(e.target.checked)} />
                忽略大小写
              </label>
              <button className="primary" disabled={loading || !grepPattern.trim()} onClick={() => void runGrepSearch()}>
                <Icon name="search" />{loading ? "搜索中…" : "搜索代码"}
              </button>
            </div>
          </div>
          <div className="branch-list" role="listbox" aria-label="代码搜索结果">
            {grepResults.map((match, idx) => (
              <div
                key={`${match.path}:${match.line}:${idx}`}
                role="option"
                aria-selected={false}
                className="branch-item"
                tabIndex={0}
                onClick={() => { if (onOpenFileAtLine) { onOpenFileAtLine(match.path, match.line); onClose(); } }}
              >
                <span className="mono"><strong>{match.path}:{match.line}</strong> {match.text}</span>
              </div>
            ))}
            {grepResults.length === 0 && !loading && <div className="panel-hint">输入代码关键字后按回车或点击「搜索代码」。</div>}
          </div>
        </>
      )}
    </Dialog>
  );
}
