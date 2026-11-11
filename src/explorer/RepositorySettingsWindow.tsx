import { useEffect, useState } from "react";
import { api } from "../api";
import type { AheadBehind, ExplorerTarget, PushInfo, RemoteInfo, RepoInfo } from "../types";
import InlineError from "../ui/InlineError";

interface Props {
  target: ExplorerTarget;
  setMessage?: (message: string) => void;
}

/** 仓库配置内容：主窗口弹窗与资源管理器轻量窗口共用。 */
export function RepositorySettingsContent({ repo, setMessage }: { repo: RepoInfo; setMessage?: (message: string) => void }) {
  const repoPath = repo.path;
  const [remotes, setRemotes] = useState<RemoteInfo[] | null>(null);
  const [pushInfo, setPushInfo] = useState<PushInfo | null>(null);
  const [aheadBehind, setAheadBehind] = useState<AheadBehind | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    setLoading(true); setError("");
    try {
      const [nextRemotes, nextPush, nextAhead] = await Promise.all([
        api.remoteList(repoPath),
        api.getPushInfo(repoPath).catch(() => null),
        api.getAheadBehind(repoPath).catch(() => null),
      ]);
      setRemotes(nextRemotes);
      setPushInfo(nextPush);
      setAheadBehind(nextAhead);
    } catch (reason) {
      setError(String(reason));
      setMessage?.(String(reason));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void reload(); }, [repoPath]);

  return <>
    <div className="repository-settings-actions">
      <button disabled={loading} onClick={() => void reload()}>刷新</button>
    </div>
    {error && <InlineError message={error} />}
    {loading && !remotes && <div className="empty-state"><span className="spinner" /><span>读取仓库设置…</span></div>}
    <div className="repository-settings-body">
      <section>
        <h4>仓库</h4>
        <dl className="repository-settings-grid">
          <dt>名称</dt><dd>{repo.name}</dd>
          <dt>路径</dt><dd className="mono">{repoPath}</dd>
          <dt>当前分支</dt><dd>{repo.headBranch ?? "detached HEAD"}</dd>
          <dt>HEAD</dt><dd className="mono">{repo.headOid ?? "—"}</dd>
          <dt>状态</dt><dd>{repo.isEmpty ? "空仓库" : "正常仓库"}</dd>
        </dl>
      </section>
      <section>
        <h4>上游 / 同步</h4>
        <dl className="repository-settings-grid">
          <dt>Upstream</dt><dd>{pushInfo?.upstream ?? "未配置"}</dd>
          <dt>推送目标</dt><dd>{pushInfo?.hasUpstream ? pushInfo.branch : "需要显式选择远程和分支"}</dd>
          <dt>Ahead / Behind</dt><dd>{aheadBehind ? `${aheadBehind.ahead} / ${aheadBehind.behind}` : "未配置或无法读取"}</dd>
        </dl>
      </section>
      <section>
        <h4>远程仓库</h4>
        {remotes && remotes.length === 0 && <p className="panel-hint">当前仓库没有配置远程。</p>}
        {remotes && remotes.length > 0 && <div className="repository-remotes" role="table" aria-label="远程仓库">
          <div className="repository-remotes-row repository-remotes-head" role="row">
            <span role="columnheader">名称</span><span role="columnheader">Fetch URL</span><span role="columnheader">Push URL</span>
          </div>
          {remotes.map((remote) => <div className="repository-remotes-row" role="row" key={remote.name}>
            <span role="cell"><strong>{remote.name}</strong></span>
            <span role="cell" className="mono" title={remote.fetchUrl}>{remote.fetchUrl || "—"}</span>
            <span role="cell" className="mono" title={remote.pushUrl}>{remote.pushUrl || "—"}</span>
          </div>)}
        </div>}
      </section>
      <div className="settings-note">此面板只读展示当前仓库配置。远程地址修改请使用工具栏的「远程管理」；分支、上游和推送目标由 Git 配置决定。</div>
    </div>
  </>;
}

export default function RepositorySettingsWindow({ target, setMessage }: Props) {
  return <div className="repository-settings-window">
    <div className="repository-settings-toolbar">
      <strong>Repository settings</strong>
    </div>
    <RepositorySettingsContent repo={target.repo} setMessage={setMessage} />
  </div>;
}
