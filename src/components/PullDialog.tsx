import { useEffect, useState } from "react";
import { api } from "../api";
import { useRepoBusy } from "../useRepoBusy";
import type { BranchInfo, PullMode, RemoteInfo } from "../types";
import Dialog from "../ui/Dialog";
import InlineError from "../ui/InlineError";

interface Props {
  repoPath: string;
  headBranch: string | null;
  onClose: () => void;
  onChanged: () => void;
  onConflict: () => void;
  onNotify: (kind: "success" | "error" | "info", message: string, details?: string) => void;
}

export default function PullDialog(props: Props) {
  const [mode, setMode] = useState<PullMode>("default");
  const [autostash, setAutostash] = useState(false);
  const [prune, setPrune] = useState(false);
  const [tagsMode, setTagsMode] = useState<"auto" | "all" | "none">("auto");
  const [fetchOnly, setFetchOnly] = useState(false);
  const [source, setSource] = useState<"upstream" | "remote">("upstream");
  const [remotes, setRemotes] = useState<RemoteInfo[]>([]);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [remote, setRemote] = useState("");
  const [remoteBranch, setRemoteBranch] = useState("");
  const [error, setError] = useState("");
  const [localBusy, setBusy] = useState(false);
  const repoBusy = useRepoBusy(props.repoPath);
  const busy = localBusy || repoBusy;

  useEffect(() => {
    let alive = true;
    Promise.all([
      api.remoteList(props.repoPath).catch(() => [] as RemoteInfo[]),
      api.getBranches(props.repoPath).catch(() => [] as BranchInfo[]),
    ]).then(([nextRemotes, nextBranches]) => {
      if (!alive) return;
      setRemotes(nextRemotes);
      setBranches(nextBranches);
      setRemote((current) => current || nextRemotes[0]?.name || "");
    });
    return () => { alive = false; };
  }, [props.repoPath]);

  const remoteBranches = branches.filter((branch) =>
    branch.isRemote && (!remote || branch.name.startsWith(`${remote}/`)));
  const selectedBranch = remoteBranches.find((branch) => branch.name === remoteBranch);
  const branchName = selectedBranch
    ? selectedBranch.name.slice(remote.length + 1)
    : remoteBranch;

  const runPull = async () => {
    if (busy) return;
    if (source === "remote" && (!remote || (!fetchOnly && !branchName))) {
      setError(fetchOnly ? "请选择远程。" : "请选择远程和远程分支。");
      return;
    }
    setBusy(true); setError("");
    try {
      const explicitRemote = source === "remote" ? remote : undefined;
      const explicitBranch = source === "remote" ? branchName : undefined;
      const out = await api.pull(props.repoPath, mode, autostash, explicitRemote, explicitBranch, fetchOnly, prune, tagsMode);
      props.onNotify("success", fetchOnly ? "Fetch 完成" : "Pull 完成", out);
      props.onChanged();
      props.onClose();
    } catch (e) {
      const details = String(e);
      const state = await api.getOperationState(props.repoPath).catch(() => null);
      if (state && state.kind !== "none") {
        props.onNotify("info", "Pull 产生冲突，已进入冲突解决中心", details);
        props.onChanged();
        props.onClose();
        props.onConflict();
        return;
      }
      setError(details);
      props.onNotify("error", fetchOnly ? "Fetch 失败" : "Pull 失败", details);
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={`Pull 选项 (${props.headBranch ?? "当前分支"})`}
      busy={busy}
      onClose={props.onClose}
      footer={<>
        <button disabled={busy} onClick={props.onClose}>取消</button>
        <button className="primary" disabled={busy} onClick={() => void runPull()}>
          {busy ? "正在执行…" : fetchOnly ? "执行 Fetch" : "执行 Pull"}
        </button>
      </>}
    >
      {error && <InlineError message={error} />}
      <div className="dialog-form">
        <label>
          <span>拉取来源</span>
          <select aria-label="拉取来源" disabled={busy || fetchOnly} value={source} onChange={(e) => setSource(e.target.value as "upstream" | "remote")}>
            <option value="upstream">当前分支的 upstream</option>
            <option value="remote">指定远程 / 远程分支</option>
          </select>
        </label>
        {source === "remote" && <>
          <label><span>远程</span><select aria-label="远程" disabled={busy} value={remote} onChange={(e) => { setRemote(e.target.value); setRemoteBranch(""); }}>
            {remotes.length === 0 && <option value="">（没有远程）</option>}
            {remotes.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
          </select></label>
          {!fetchOnly && <label><span>远程分支</span><select aria-label="远程分支" disabled={busy || !remote} value={remoteBranch} onChange={(e) => setRemoteBranch(e.target.value)}>
            <option value="">请选择分支</option>
            {remoteBranches.map((branch) => <option key={branch.name} value={branch.name}>{branch.name.slice(remote.length + 1)}</option>)}
          </select></label>}
        </>}
        <label>
          <span>{fetchOnly ? "Fetch 选项" : "合并 / 变基策略"}</span>
          <select aria-label="Pull 策略" disabled={busy || fetchOnly} value={mode} onChange={(e) => setMode(e.target.value as PullMode)}>
            <option value="default">按 Git 配置默认策略</option>
            <option value="rebase">变基到上游最新提交 (--rebase)</option>
            <option value="ff-only">仅允许快进 (--ff-only)</option>
            <option value="no-ff">强制生成合并提交 (--no-ff)</option>
          </select>
        </label>
        <label className="checkbox-row">
          <input type="checkbox" disabled={busy} checked={fetchOnly} onChange={(e) => setFetchOnly(e.target.checked)} />
          <span>只 Fetch，不合并 (<code>--fetch</code>)</span>
        </label>
        <label className="checkbox-row">
          <input type="checkbox" disabled={busy || fetchOnly} checked={autostash} onChange={(e) => setAutostash(e.target.checked)} />
          <span>自动暂存并恢复本地未提交修改 (<code>--autostash</code>)</span>
        </label>
        <label className="checkbox-row">
          <input type="checkbox" disabled={busy} checked={prune} onChange={(e) => setPrune(e.target.checked)} />
          <span>清理已删除的远程跟踪分支 (<code>--prune</code>)</span>
        </label>
        <label>
          <span>Tag 选项</span>
          <select aria-label="Tag 选项" disabled={busy} value={tagsMode} onChange={(e) => setTagsMode(e.target.value as "auto" | "all" | "none")}>
            <option value="auto">跟随 Git fetch.tagOpt 配置</option>
            <option value="all">获取全部 tags (--tags)</option>
            <option value="none">不获取 tags (--no-tags)</option>
          </select>
        </label>
      </div>
    </Dialog>
  );
}
