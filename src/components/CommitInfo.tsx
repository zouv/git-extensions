import type { CommitDetail, ContainedInfo } from "../types";
import { formatDate } from "../api";

interface Props {
  commit: CommitDetail | null;
  contained: ContainedInfo | null;
  loading: boolean;
}

export default function CommitInfo({ commit, contained, loading }: Props) {
  if (loading) return <div className="panel-hint">提交信息加载中…</div>;
  if (!commit) return <div className="panel-hint">选择一个提交查看详情</div>;
  return (
    <div className="commit-info">
      <div className="commit-meta">
        <div><span className="meta-label">提交</span>{commit.oid}</div>
        <div>
          <span className="meta-label">作者</span>
          {commit.authorName} &lt;{commit.authorEmail}&gt; · {formatDate(commit.authorTime)}
        </div>
        <div>
          <span className="meta-label">提交者</span>
          {commit.committerName} · {formatDate(commit.committerTime)}
        </div>
        {commit.parents.length > 0 && (
          <div>
            <span className="meta-label">父提交</span>
            {commit.parents.map((p) => p.slice(0, 7)).join(" ")}
          </div>
        )}
        {contained?.describe && (
          <div><span className="meta-label">最近标签</span>{contained.describe}</div>
        )}
        {contained && contained.branches.length > 0 && (
          <div>
            <span className="meta-label">包含于</span>
            <span className="contained-list">{contained.branches.join(", ")}</span>
          </div>
        )}
        {contained && contained.tags.length > 0 && (
          <div>
            <span className="meta-label">标签</span>
            <span className="contained-list">{contained.tags.join(", ")}</span>
          </div>
        )}
      </div>
      <pre className="commit-message">{commit.message}</pre>
    </div>
  );
}
