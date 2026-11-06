import type { CommitDetail, ContainedInfo } from "../types";
import { formatDate } from "../api";

interface Props {
  commit: CommitDetail | null;
  contained: ContainedInfo | null;
  loading: boolean;
  onCopy?: (text: string, label: string) => void;
  onFilterRef?: (name: string) => void;
}

function RefButtons({ names, onFilterRef }: { names: string[]; onFilterRef?: (name: string) => void }) {
  return <span className="contained-list">{names.map((name) => onFilterRef
    ? <button type="button" className="ref-link" key={name} onClick={() => onFilterRef(name)}>{name}</button>
    : <span key={name}>{name}</span>)}</span>;
}

export default function CommitInfo({ commit, contained, loading, onCopy, onFilterRef }: Props) {
  if (loading) return <div className="panel-hint">提交信息加载中…</div>;
  if (!commit) return <div className="panel-hint">选择一个提交查看详情</div>;
  return (
    <div className="commit-info">
      <div className="commit-meta">
        <div><span className="meta-label">提交</span><code className="commit-oid" title={commit.oid}>{commit.oid}</code>{onCopy && <button type="button" className="link-button" onClick={() => onCopy(commit.oid, "完整 SHA")}>复制</button>}</div>
        <div>
          <span className="meta-label">作者</span>
          {commit.authorName} &lt;{commit.authorEmail}&gt; · {formatDate(commit.authorTime)}
          {onCopy && <button type="button" className="link-button" onClick={() => onCopy(commit.authorEmail, "作者邮箱")}>复制邮箱</button>}
        </div>
        <div>
          <span className="meta-label">提交者</span>
          {commit.committerName} · {formatDate(commit.committerTime)}
        </div>
        {commit.parents.length > 0 && (
          <div>
            <span className="meta-label">父提交</span>
            {commit.parents.map((p) => <code key={p} className="parent-oid" title={p}>{p.slice(0, 7)}</code>)}
          </div>
        )}
        {contained?.describe && (
          <div><span className="meta-label">最近标签</span>{contained.describe}</div>
        )}
        {contained && contained.branches.length > 0 && (
          <div><span className="meta-label">包含于</span><RefButtons names={contained.branches} onFilterRef={onFilterRef} /></div>
        )}
        {contained && contained.tags.length > 0 && (
          <div><span className="meta-label">标签</span><RefButtons names={contained.tags} onFilterRef={onFilterRef} /></div>
        )}
      </div>
      <pre className="commit-message">{commit.message}</pre>
    </div>
  );
}
