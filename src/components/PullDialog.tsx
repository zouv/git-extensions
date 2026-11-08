import { useState } from "react";
import { api } from "../api";
import { useRepoBusy } from "../useRepoBusy";
import type { PullMode } from "../types";
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
  const [pruneOnFetch, setPruneOnFetch] = useState(false);
  const [error, setError] = useState("");
  const [localBusy, setBusy] = useState(false);
  const repoBusy = useRepoBusy(props.repoPath);
  const busy = localBusy || repoBusy;

  const runPull = async () => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      if (pruneOnFetch) {
        await api.fetch(props.repoPath, undefined, true);
      }
      const out = await api.pull(props.repoPath, mode, autostash);
      props.onNotify("success", "Pull 完成", out);
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
      props.onNotify("error", "Pull 失败", details);
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
          {busy ? "正在拉取…" : "执行 Pull"}
        </button>
      </>}
    >
      {error && <InlineError message={error} />}
      <div className="dialog-form">
        <label>
          <span>合并 / 变基策略</span>
          <select aria-label="Pull 策略" disabled={busy} value={mode} onChange={(e) => setMode(e.target.value as PullMode)}>
            <option value="default">按 Git 配置默认策略</option>
            <option value="rebase">变基到上游最新提交 (--rebase)</option>
            <option value="ff-only">仅允许快进 (--ff-only)</option>
            <option value="no-ff">强制生成合并提交 (--no-ff)</option>
          </select>
        </label>
        <label className="checkbox-row">
          <input type="checkbox" disabled={busy} checked={autostash} onChange={(e) => setAutostash(e.target.checked)} />
          <span>自动暂存并恢复本地未提交修改 (<code>--autostash</code>)</span>
        </label>
        <label className="checkbox-row">
          <input type="checkbox" disabled={busy} checked={pruneOnFetch} onChange={(e) => setPruneOnFetch(e.target.checked)} />
          <span>拉取前清理已删除的远程跟踪分支 (<code>fetch --prune</code>)</span>
        </label>
      </div>
    </Dialog>
  );
}
