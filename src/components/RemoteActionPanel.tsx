import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, onRemoteProgress } from "../api";
import type { BranchInfo, PushInfo, RemoteInfo } from "../types";
import Icon from "../ui/Icon";
import InlineError from "../ui/InlineError";
import { useConfirm } from "../ui/Confirm";
import CommitContentDialog from "./CommitContentDialog";

export type RemoteActionKind = "fetch" | "pull" | "push";
export interface RemoteActionAnchor { left: number; top: number; bottom: number }

interface Props {
  repoPath: string;
  kind: RemoteActionKind;
  anchor: RemoteActionAnchor;
  branches: BranchInfo[];
  currentBranch: string | null;
  onClose: () => void;
  onChanged: () => void;
  onConflict: () => void;
  onNotify: (kind: "success" | "error" | "info", message: string, details?: string) => void;
}

type Phase = "options" | "running" | "done" | "error";

const TITLES: Record<RemoteActionKind, string> = {
  fetch: "Fetch Remote Changes",
  pull: "Pull (Fetch & Merge)",
  push: "Push Changes To Remote",
};
const ICONS: Record<RemoteActionKind, "fetch" | "pull" | "push"> = { fetch: "fetch", pull: "pull", push: "push" };
const MAX_LOG_LINES = 200;

function newOperationId(): string {
  return `remote-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function parsePercent(line: string): number | null {
  const match = /(\d{1,3})%/.exec(line);
  if (!match) return null;
  const value = Number(match[1]);
  return value >= 0 && value <= 100 ? value : null;
}

function splitUpstream(upstream: string | null): { remote: string; branch: string } | null {
  if (!upstream) return null;
  const slash = upstream.indexOf("/");
  if (slash <= 0 || slash === upstream.length - 1) return null;
  return { remote: upstream.slice(0, slash), branch: upstream.slice(slash + 1) };
}

/** 工具栏 Fetch / Pull / Push 的锚定面板：先选选项，确认后在同一面板显示实时进度与输出。 */
export default function RemoteActionPanel(props: Props) {
  const { kind, repoPath, branches } = props;
  const panelRef = useRef<HTMLDivElement>(null);
  const confirm = useConfirm();
  const phaseRef = useRef<Phase>("options");
  const activeOperation = useRef("");
  const [phase, setPhase] = useState<Phase>("options");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [remotes, setRemotes] = useState<RemoteInfo[]>([]);
  const [pushInfo, setPushInfo] = useState<PushInfo | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [percent, setPercent] = useState<number | null>(null);
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const [remote, setRemote] = useState("");
  const [remoteBranch, setRemoteBranch] = useState("");
  const [force, setForce] = useState(false);
  const [noTags, setNoTags] = useState(false);
  const [rebase, setRebase] = useState(false);
  const [pushTags, setPushTags] = useState(false);
  const [noVerify, setNoVerify] = useState(false);
  const [forcePush, setForcePush] = useState(false);
  const [unpushed, setUnpushed] = useState<{ count: number; truncated: boolean; list: { oid: string; shortId: string; subject: string }[]; baseRef: string | null } | null>(null);
  const [viewOid, setViewOid] = useState<string | null>(null);

  useEffect(() => { phaseRef.current = phase; }, [phase]);

  const remoteBranches = branches.filter((branch) => branch.isRemote && (!remote || branch.name.startsWith(`${remote}/`)));
  const branchLabel = (name: string) => remote && name.startsWith(`${remote}/`) ? name.slice(remote.length + 1) : name;
  const upstream = splitUpstream(pushInfo?.upstream ?? null);
  const remoteBranchName = branchLabel(remoteBranch);

  // 载入远程与推送预览；Fetch 只需要远程列表，Pull / Push 还需要 upstream 映射。
  useEffect(() => {
    let alive = true;
    const requests = kind === "fetch"
      ? api.remoteList(repoPath).then((nextRemotes) => ({ nextRemotes, info: null }))
      : Promise.all([api.remoteList(repoPath), api.getPushInfo(repoPath).catch(() => null)]).then(([nextRemotes, info]) => ({ nextRemotes, info }));
    requests
      .then(({ nextRemotes, info }) => {
        if (!alive) return;
        setRemotes(nextRemotes);
        setPushInfo(info);
        if (kind === "push" && info) {
          const parts = splitUpstream(info.upstream);
          setRemote(parts?.remote ?? info.remotes[0] ?? "");
          setRemoteBranch(parts?.branch ?? info.branch);
          return;
        }
        const upstreamParts = splitUpstream(info?.upstream ?? null);
        const current = props.currentBranch;
        const preferred = nextRemotes.find((item) => current && branches.some((branch) => branch.isRemote && branch.name === `${item.name}/${current}`));
        const chosen = upstreamParts?.remote ?? preferred?.name ?? nextRemotes[0]?.name ?? "";
        setRemote(chosen);
        if (kind === "pull" && chosen) {
          // 优先使用配置的 upstream（可能是本地分支名与远程分支名不同的情况）。
          const configured = upstreamParts ? `${upstreamParts.remote}/${upstreamParts.branch}` : "";
          const inferred = current ? `${chosen}/${current}` : "";
          const exists = (name: string) => !!name && branches.some((branch) => branch.isRemote && branch.name === name);
          const first = branches.find((branch) => branch.isRemote && branch.name.startsWith(`${chosen}/`));
          setRemoteBranch(exists(configured) ? configured : exists(inferred) ? inferred : first?.name ?? "");
        }
      })
      .catch((e) => { if (alive) setLoadError(String(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // 面板打开期间仓库引用不会整体替换；仅在仓库变化时重新载入。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, repoPath]);

  // 切换远程时，Pull 的远程分支回到该远程下的第一个分支。
  useEffect(() => {
    if (kind !== "pull" || !remote) return;
    if (remoteBranch.startsWith(`${remote}/`)) return;
    const first = branches.find((branch) => branch.isRemote && branch.name.startsWith(`${remote}/`));
    setRemoteBranch(first?.name ?? "");
  }, [kind, remote, branches, remoteBranch]);

  // 订阅进度事件；用 ref 过滤，保证监听在操作开始前就已注册。
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void onRemoteProgress((progress) => {
      if (progress.operationId !== activeOperation.current) return;
      const next = parsePercent(progress.line);
      setLines((prev) => {
        // 同一阶段的百分比行原地替换，避免 0%…100% 刷满日志；其它输出正常追加。
        const merged = [...prev];
        if (next !== null && merged.length > 0 && parsePercent(merged[merged.length - 1]) !== null) {
          merged[merged.length - 1] = progress.line;
        } else {
          merged.push(progress.line);
        }
        return merged.slice(-MAX_LOG_LINES);
      });
      if (next !== null) setPercent((prev) => (prev === null ? next : Math.max(prev, next)));
    }).then((fn) => { if (disposed) fn(); else unlisten = fn; });
    return () => { disposed = true; unlisten?.(); };
  }, []);

  // 待推送提交：按当前选择的目标比较 upstream / 远程跟踪引用。
  useEffect(() => {
    if (kind !== "push" || !pushInfo) return;
    const explicit = !pushInfo.hasUpstream || remote !== upstream?.remote || remoteBranch !== upstream?.branch;
    if (explicit && (!remote || !remoteBranch.trim())) { setUnpushed(null); return; }
    let alive = true;
    api.getUnpushedCommits(repoPath, explicit ? remote : null, explicit ? remoteBranch.trim() : null)
      .then((next) => { if (alive) setUnpushed({ count: next.commits.length, truncated: next.truncated, list: next.commits, baseRef: next.baseRef }); })
      .catch(() => { if (alive) setUnpushed(null); });
    return () => { alive = false; };
  }, [kind, pushInfo, remote, remoteBranch, repoPath, upstream?.remote, upstream?.branch]);

  // 顶部对齐触发按钮；面板高度变化时重新夹取，避免超出视口。
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const place = () => {
      const rect = el.getBoundingClientRect();
      const left = Math.max(8, Math.min(props.anchor.left, window.innerWidth - rect.width - 8));
      const top = Math.max(8, Math.min(props.anchor.bottom + 6, window.innerHeight - rect.height - 8));
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(el);
    window.addEventListener("resize", place);
    return () => { observer.disconnect(); window.removeEventListener("resize", place); };
  }, [props.anchor]);

  // 焦点与关闭：执行中不允许关闭；弹窗打开时 Esc / 外部点击交给弹窗。
  // 用 ref 持有最新回调，避免父组件轮询重渲染时重新聚焦 / 重复绑定监听。
  const onCloseRef = useRef(props.onClose);
  onCloseRef.current = props.onClose;
  useLayoutEffect(() => {
    const el = panelRef.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    el?.querySelector<HTMLElement>("select, input, button.primary")?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || phaseRef.current === "running") return;
      if (document.querySelector(".modal-backdrop")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onCloseRef.current();
    };
    const pointerdown = (event: PointerEvent) => {
      if (phaseRef.current === "running") return;
      const target = event.target as Element | null;
      if (!target || panelRef.current?.contains(target)) return;
      if (target.closest("[data-remote-action]") || target.closest(".modal-backdrop")) return;
      onCloseRef.current();
    };
    window.addEventListener("keydown", keydown, true);
    document.addEventListener("pointerdown", pointerdown);
    return () => {
      window.removeEventListener("keydown", keydown, true);
      document.removeEventListener("pointerdown", pointerdown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  const startProgress = () => {
    const id = newOperationId();
    activeOperation.current = id;
    setLines([]); setPercent(null); setOutput(""); setError("");
    setPhase("running");
    return id;
  };

  const finishSuccess = (message: string, result: string) => {
    setOutput(result.trim());
    setPhase("done");
    props.onChanged();
    props.onNotify("success", message, result.trim() || undefined);
    // Push 后 upstream / HEAD 可能已变化；刷新预览，避免再次推送时沿用旧判断。
    if (kind === "push") void api.getPushInfo(repoPath).then(setPushInfo).catch(() => {});
  };

  const runFetch = async () => {
    const id = startProgress();
    try {
      const result = await api.fetchWithProgress(repoPath, { remote: remote || undefined, force, noTags }, id);
      finishSuccess("Fetch 完成", result);
    } catch (e) {
      setError(String(e)); setPhase("error");
      props.onNotify("error", "Fetch 失败", String(e));
    }
  };

  const runPull = async () => {
    if (!remote || !remoteBranch) { setError("请选择远程和远程分支。"); return; }
    const id = startProgress();
    try {
      const result = await api.pullWithProgress(repoPath, rebase ? "rebase" : "default", false, remote, remoteBranchName, false, "auto", id);
      finishSuccess("Pull 完成", result);
    } catch (e) {
      const details = String(e);
      const state = await api.getOperationState(repoPath).catch(() => null);
      if (state && state.kind !== "none") {
        props.onNotify("info", "Pull 产生冲突，已进入冲突解决中心", details);
        props.onChanged();
        props.onClose();
        props.onConflict();
        return;
      }
      setError(details); setPhase("error");
      props.onNotify("error", "Pull 失败", details);
    }
  };

  const runPush = async () => {
    if (!pushInfo) return;
    if (!remote || !remoteBranch.trim()) { setError("请选择远程和目标分支。"); return; }
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
    }
    const unchanged = pushInfo.hasUpstream && upstream?.remote === remote && upstream?.branch === remoteBranch.trim();
    const id = startProgress();
    try {
      const result = await api.pushWithProgress(
        repoPath,
        unchanged ? undefined : remote,
        unchanged ? undefined : remoteBranch.trim(),
        pushInfo,
        false,
        pushTags,
        forcePush,
        false,
        noVerify,
        id,
      );
      finishSuccess("Push 完成", result);
    } catch (e) {
      setError(String(e)); setPhase("error");
      props.onNotify("error", "Push 失败，未自动更换远程", String(e));
    }
  };

  const run = () => {
    setError("");
    if (kind === "fetch") void runFetch();
    else if (kind === "pull") void runPull();
    else void runPush();
  };

  const command = kind === "fetch"
    ? `git fetch --progress --verbose${force ? " --force" : ""}${noTags ? " --no-tags" : ""}${remote ? ` ${remote}` : ""}`
    : kind === "pull"
      ? `git pull --progress${rebase ? " --rebase" : ""}${remote ? ` ${remote}` : ""}${remoteBranchName ? ` ${remoteBranchName}` : ""}`
      : `git push --progress --verbose${forcePush ? " --force" : ""}${pushTags ? " --tags" : ""}${noVerify ? " --no-verify" : ""}${!pushInfo?.hasUpstream || upstream?.remote !== remote || upstream?.branch !== remoteBranch.trim() ? ` --set-upstream -- ${remote} ${pushInfo?.branchRef ?? "HEAD"}:refs/heads/${remoteBranch.trim()}` : ""}`;

  const running = phase === "running";
  const canRun = !loading && !loadError && !!remote
    && (kind !== "pull" || !!remoteBranch)
    && (kind !== "push" || (!!pushInfo && !!remoteBranch.trim()));

  return (
    <div className="remote-panel" ref={panelRef} role="dialog" aria-modal="false" aria-label={TITLES[kind]} style={{ left: props.anchor.left, top: props.anchor.bottom + 6 }}>
      <div className="remote-panel-title"><Icon name={ICONS[kind]} /> <strong>{TITLES[kind]}</strong></div>
      <div className="remote-panel-body">
        {loading && <div className="panel-hint"><span className="spinner" /> 正在读取远程配置…</div>}
        {loadError && <InlineError message={loadError} />}
        {!loading && !loadError && <>
          <div className="remote-panel-form">
            {kind === "push" && <>
              <span className="remote-panel-label">Local Branch:</span>
              <select aria-label="本地分支" disabled value={pushInfo?.branch ?? ""}>
                {branches.filter((branch) => !branch.isRemote).map((branch) => <option key={branch.name} value={branch.name}>{branch.name}</option>)}
              </select>
            </>}
            <span className="remote-panel-label">Remote:</span>
            <select aria-label="远程" value={remote} disabled={running} onChange={(e) => setRemote(e.target.value)}>
              {remotes.length === 0 && <option value="">（没有远程）</option>}
              {remotes.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
            </select>
            {kind === "pull" && <>
              <span className="remote-panel-label">Remote Branch:</span>
              <select aria-label="远程分支" value={remoteBranch} disabled={running || !remote} onChange={(e) => setRemoteBranch(e.target.value)}>
                <option value="">请选择分支</option>
                {remoteBranches.map((branch) => <option key={branch.name} value={branch.name}>{branchLabel(branch.name)}</option>)}
              </select>
              <span className="remote-panel-label">Into:</span>
              <span className="remote-panel-static"><Icon name="branch" size={13} />{props.currentBranch ?? "（detached HEAD）"}</span>
            </>}
            {kind === "push" && <>
              <span className="remote-panel-label">Remote Branch:</span>
              <input aria-label="目标分支" list="remote-panel-targets" value={remoteBranch} disabled={running || !remote} onChange={(e) => setRemoteBranch(e.target.value)} />
              <datalist id="remote-panel-targets">{remoteBranches.map((branch) => <option key={branch.name} value={branchLabel(branch.name)} />)}</datalist>
            </>}
          </div>
          {kind === "pull" && remoteBranches.length === 0 && <div className="panel-hint">该远程还没有已抓取的远程分支；请先执行 Fetch。</div>}
          {kind === "pull" && <label className="checkbox-row"><input type="checkbox" disabled={running} checked={rebase} onChange={(e) => setRebase(e.target.checked)} /><span>Use rebase instead of merge</span></label>}
          {kind === "fetch" && <>
            <label className="checkbox-row"><input type="checkbox" disabled={running} checked={force} onChange={(e) => setForce(e.target.checked)} /><span>Force override local refs</span></label>
            <label className="checkbox-row"><input type="checkbox" disabled={running} checked={noTags} onChange={(e) => setNoTags(e.target.checked)} /><span>Fetch without tags</span></label>
          </>}
          {kind === "push" && <>
            <label className="checkbox-row"><input type="checkbox" disabled={running} checked={pushTags} onChange={(e) => setPushTags(e.target.checked)} /><span>Push all tags</span></label>
            <label className="checkbox-row"><input type="checkbox" disabled={running} checked={noVerify} onChange={(e) => setNoVerify(e.target.checked)} /><span>Bypass the pre-push hook</span></label>
            <label className="checkbox-row"><input type="checkbox" disabled={running} checked={forcePush} onChange={(e) => setForcePush(e.target.checked)} /><span>Force push</span></label>
            <div className="remote-panel-commits">
              <strong>待推送提交{unpushed ? ` (${unpushed.count}${unpushed.truncated ? "+" : ""})` : ""}</strong>
              {unpushed && !unpushed.baseRef && <span className="muted">目标分支尚未抓取到本地，可先 Fetch。</span>}
              {unpushed && unpushed.baseRef && unpushed.count === 0 && <span className="muted">没有待推送提交。</span>}
              {unpushed && unpushed.list.length > 0 && <div className="remote-panel-commit-list">
                {unpushed.list.map((commit) => (
                  <button key={commit.oid} type="button" className="remote-panel-commit" disabled={running} title={`查看提交 ${commit.shortId} 的内容`} onClick={() => setViewOid(commit.oid)}>
                    <code>{commit.shortId}</code><span>{commit.subject || "（无说明）"}</span>
                  </button>
                ))}
              </div>}
            </div>
          </>}
          {phase === "options" && error && <InlineError message={error} />}
        </>}
        {phase !== "options" && <>
          <div className="remote-panel-running">
            {running ? <><span className="spinner" /> Running. Please wait…</> : phase === "done" ? <><Icon name="check" size={14} /> 完成</> : <><Icon name="warning" size={14} /> 失败</>}
          </div>
          <code className="remote-panel-command">$ {command}</code>
          <div className={`remote-panel-track${percent === null ? " indeterminate" : ""}`} role="progressbar" aria-label="操作进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}>
            <div className="remote-panel-fill" style={percent === null ? undefined : { width: `${percent}%` }} />
          </div>
          {lines.length > 0 && <pre className="remote-panel-log" aria-label="Git 进度输出">{lines.join("\n")}</pre>}
          {phase === "done" && output && <pre className="remote-panel-log" aria-label="Git 输出">{output}</pre>}
          {phase === "error" && <InlineError message={error} />}
        </>}
      </div>
      <div className="remote-panel-footer">
        {phase === "options"
          ? <>
            <button disabled={running || !canRun} onClick={() => props.onClose()}>Cancel</button>
            <button className={forcePush ? "danger-button" : "primary"} disabled={!canRun} onClick={run}>{forcePush ? "Force Push" : "OK"}</button>
          </>
          : running
            ? <button disabled title="操作执行中，面板会持续显示进度">执行中…</button>
            : <>
              <button onClick={() => { setPhase("options"); setError(""); }}>返回选项</button>
              <button className="primary" onClick={() => props.onClose()}>关闭</button>
            </>}
      </div>
      {viewOid && <CommitContentDialog repoPath={repoPath} oid={viewOid} onClose={() => setViewOid(null)} />}
    </div>
  );
}
