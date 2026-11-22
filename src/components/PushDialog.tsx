import { useEffect, useState } from "react";
import { api, formatDate } from "../api";
import { useRepoBusy } from "../useRepoBusy";
import type { PushInfo, UnpushedCommits } from "../types";
import Dialog from "../ui/Dialog";
import InlineError from "../ui/InlineError";
import CommitContentDialog from "./CommitContentDialog";
import { useDirtyClose } from "../ui/useDirtyClose";
import { useConfirm } from "../ui/Confirm";

interface Props {
  repoPath: string;
  onClose: () => void;
  onChanged: () => void;
  onNotify: (kind: "success" | "error" | "info", message: string, details?: string) => void;
}

export default function PushDialog(props: Props) {
  const [info, setInfo] = useState<PushInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [localBusy, setBusy] = useState(false);
  const repoBusy = useRepoBusy(props.repoPath);
  const busy = localBusy || repoBusy;
  const [remote, setRemote] = useState("");
  const [target, setTarget] = useState("");
  const [forceWithLease, setForceWithLease] = useState(false);
  const [forcePush, setForcePush] = useState(false);
  const [pushTags, setPushTags] = useState(false);
  const [recurseSubmodules, setRecurseSubmodules] = useState(false);
  const [error, setError] = useState("");
  const [unpushed, setUnpushed] = useState<UnpushedCommits | null>(null);
  const [commitsLoading, setCommitsLoading] = useState(false);
  const [commitsError, setCommitsError] = useState("");
  const [viewOid, setViewOid] = useState<string | null>(null);
  const confirm = useConfirm();
  const dirty = !!info && (!info.hasUpstream && (remote !== "" || target !== info.branch) || forceWithLease || forcePush || pushTags || recurseSubmodules);
  const close = useDirtyClose(dirty, busy, props.onClose);

  useEffect(() => {
    let alive = true;
    api.getPushInfo(props.repoPath).then((next) => {
      if (!alive) return;
      setInfo(next); setTarget(next.branch);
    }).catch((e) => { if (alive) setError(String(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [props.repoPath]);

  // 待推送提交：有 upstream 时比较 upstream；无 upstream 时按显式选择的远程 / 目标分支。
  useEffect(() => {
    if (!info) return;
    const explicit = !info.hasUpstream;
    if (explicit && (!remote || !target.trim())) { setUnpushed(null); setCommitsError(""); return; }
    let alive = true;
    setCommitsLoading(true); setCommitsError("");
    api.getUnpushedCommits(props.repoPath, explicit ? remote : null, explicit ? target.trim() : null)
      .then((next) => { if (alive) setUnpushed(next); })
      .catch((reason) => { if (alive) { setUnpushed(null); setCommitsError(String(reason)); } })
      .finally(() => { if (alive) setCommitsLoading(false); });
    return () => { alive = false; };
  }, [info, remote, target, props.repoPath]);

  const push = async () => {
    if (!info || busy || (!info.hasUpstream && (!remote || !target.trim()))) return;
    if (forcePush) {
      const ok = await confirm({
        title: "使用 --force 强制推送？",
        body: "这会无条件覆盖远端分支历史，不会检查远端是否被他人更新；优先使用 --force-with-lease。",
        confirmLabel: "确认强制推送",
        danger: true,
        requireAck: true,
        ackLabel: "我确认无条件重写远端分支历史",
      });
      if (!ok) return;
    } else if (forceWithLease) {
      const ok = await confirm({
        title: "使用 --force-with-lease 强制推送？",
        body: "若远端分支自上次抓取后没有被他人更新，将覆盖远端分支历史（常用于 Rebase 或 Amend 之后）。",
        confirmLabel: "确认强制推送",
        danger: true,
        requireAck: true,
        ackLabel: "我确认重写远端分支历史（带有 lease 保护）",
      });
      if (!ok) return;
    }
    setBusy(true); setError("");
    try {
      await api.push(
        props.repoPath,
        info.hasUpstream ? undefined : remote,
        info.hasUpstream ? undefined : target.trim(),
        info,
        forceWithLease,
        pushTags,
        forcePush,
        recurseSubmodules,
      );
      props.onNotify("success", "Push 完成");
      props.onChanged(); props.onClose();
    } catch (e) {
      setError(String(e));
      props.onNotify("error", "Push 失败，未自动更换远程", String(e));
    } finally { setBusy(false); }
  };

  return <Dialog title="推送提交" wide busy={busy} onClose={close} footer={<>
    <button disabled={busy} onClick={close}>取消</button>
    <button className={forcePush || forceWithLease ? "danger-button" : "primary"} disabled={busy || loading || !info || (!info.hasUpstream && (!remote || !target.trim()))} onClick={() => void push()}>{busy ? "推送中…" : info?.hasUpstream ? (forcePush ? "Force Push" : forceWithLease ? "Force Push (with lease)" : "Push") : "推送并建立 upstream"}</button>
  </>}>
    {loading && <p className="panel-hint">正在读取推送配置…</p>}
    {info && <div className="push-options">
      <p>本地分支：<strong>{info.branch}</strong> · <code>{info.headOid.slice(0, 10)}</code></p>
      {info.hasUpstream ? <>
        <p>Upstream：<strong>{info.upstream}</strong></p>
        <p className="muted">使用已有 Git 推送配置（含 pushRemote / push.default），失败时保留原错误，不改推其他远程。</p>
      </> : <>
        <p>当前分支没有 upstream，请明确选择推送目标。</p>
        <label>远程<select data-autofocus value={remote} disabled={busy} onChange={(e) => setRemote(e.target.value)}>
          <option value="">请选择远程</option>
          {info.remotes.map((name) => <option key={name} value={name}>{name}</option>)}
        </select></label>
        <label>目标分支<input value={target} disabled={busy} onChange={(e) => setTarget(e.target.value)} /></label>
        {info.remotes.length === 0 && <p className="panel-hint">仓库没有已配置远程，请先配置远程后重新打开。</p>}
        <p>推送：<code>{info.branchRef}</code> → <strong>{remote || "未选择远程"}/{target || "未填写分支"}</strong></p>
      </>}
      <div className="push-commits">
        <strong>待推送提交{unpushed && unpushed.baseRef ? ` (${unpushed.commits.length}${unpushed.truncated ? "+" : ""})` : ""}</strong>
        {commitsLoading && <p className="panel-hint"><span className="spinner" /> 正在读取待推送提交…</p>}
        {commitsError && <InlineError message={commitsError} />}
        {!commitsLoading && !commitsError && !info.hasUpstream && (!remote || !target.trim()) && (
          <p className="panel-hint">选择远程与目标分支后列出待推送提交。</p>
        )}
        {!commitsLoading && !commitsError && unpushed && !unpushed.baseRef && (
          <p className="panel-hint">{info.hasUpstream
            ? "无法确定 upstream 的本地状态，请先 Fetch。"
            : `远程分支 ${remote}/${target.trim()} 尚未抓取到本地，无法列出待推送提交；可先 Fetch。`}</p>
        )}
        {!commitsLoading && unpushed?.baseRef && unpushed.commits.length === 0 && (
          <p className="panel-hint">没有待推送提交（与 {unpushed.baseRef.replace("refs/remotes/", "")} 一致）。</p>
        )}
        {unpushed && unpushed.commits.length > 0 && <>
          <div className="push-commit-list">
            {unpushed.commits.map((commit) => (
              <button key={commit.oid} type="button" className="push-commit-row" title={`查看提交 ${commit.shortId} 的内容`} onClick={() => setViewOid(commit.oid)}>
                <code>{commit.shortId}</code>
                <span className="push-commit-subject">{commit.subject || "（无说明）"}</span>
                <span className="push-commit-meta">{commit.authorName} · {formatDate(commit.authorTime)}</span>
              </button>
            ))}
          </div>
          {unpushed.truncated && <p className="panel-hint">仅显示前 500 条待推送提交。</p>}
          <p className="panel-hint">点击提交可查看提交信息与文件差异。</p>
        </>}
      </div>
      <div className="push-flags">
        <label className="checkbox-row">
          <input type="checkbox" disabled={busy} checked={pushTags} onChange={(e) => setPushTags(e.target.checked)} />
          <span>同时推送本地标签 (<code>--tags</code>)</span>
        </label>
        <label className="checkbox-row">
          <input type="checkbox" disabled={busy} checked={recurseSubmodules} onChange={(e) => setRecurseSubmodules(e.target.checked)} />
          <span>检查子模块已推送 (<code>--recurse-submodules=check</code>)</span>
        </label>
        <label className="checkbox-row">
          <input type="checkbox" disabled={busy} checked={forceWithLease} onChange={(e) => { setForceWithLease(e.target.checked); if (e.target.checked) setForcePush(false); }} />
          <span>安全强制推送 (<code>--force-with-lease</code>，Rebase / Amend 后更新远端)</span>
        </label>
        <label className="checkbox-row">
          <input type="checkbox" disabled={busy} checked={forcePush} onChange={(e) => { setForcePush(e.target.checked); if (e.target.checked) setForceWithLease(false); }} />
          <span>无条件强制推送 (<code>--force</code>，危险)</span>
        </label>
      </div>
    </div>}
    {error && <pre className="push-error" role="alert">{error}</pre>}
    {viewOid && <CommitContentDialog repoPath={props.repoPath} oid={viewOid} onClose={() => setViewOid(null)} />}
  </Dialog>;
}
