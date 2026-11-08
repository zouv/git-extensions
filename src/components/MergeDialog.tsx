import { useState } from "react";
import { api } from "../api";
import { useRepoBusy } from "../useRepoBusy";
import type { BranchInfo, MergeMode } from "../types";
import Dialog from "../ui/Dialog";
import InlineError from "../ui/InlineError";
import { useDirtyClose } from "../ui/useDirtyClose";

interface Props {
  repoPath: string;
  headBranch: string | null;
  branches: BranchInfo[];
  initialTarget?: string;
  onClose: () => void;
  onChanged: () => void;
  onConflict: () => void;
  onNotify: (kind: "success" | "error" | "info", message: string, details?: string) => void;
}

export default function MergeDialog(props: Props) {
  const candidates = props.branches.filter((b) => !b.isHead);
  const [target, setTarget] = useState(props.initialTarget ?? candidates[0]?.name ?? "");
  const [mode, setMode] = useState<MergeMode>("default");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [localBusy, setBusy] = useState(false);
  const repoBusy = useRepoBusy(props.repoPath);
  const busy = localBusy || repoBusy;
  const close = useDirtyClose(message.trim().length > 0, busy, props.onClose);

  const runMerge = async () => {
    const trimmed = target.trim();
    if (!trimmed || busy) return;
    setBusy(true); setError("");
    try {
      const out = await api.mergeBranch(
        props.repoPath,
        trimmed,
        mode,
        mode !== "ff-only" && message.trim() ? message.trim() : undefined,
      );
      props.onNotify("success", mode === "squash" ? `已将 ${trimmed} 压缩暂存到工作区，请提交变更` : `已合并 ${trimmed}`, out);
      props.onChanged();
      props.onClose();
    } catch (e) {
      const details = String(e);
      const state = await api.getOperationState(props.repoPath).catch(() => null);
      if (state && state.kind !== "none") {
        props.onNotify("info", "合并产生冲突，已进入冲突解决中心", details);
        props.onChanged();
        props.onClose();
        props.onConflict();
        return;
      }
      setError(details);
      props.onNotify("error", "合并未完成", details);
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={`合并到 ${props.headBranch ?? "当前 HEAD"}`}
      busy={busy}
      onClose={close}
      footer={<>
        <button disabled={busy} onClick={close}>取消</button>
        <button className="primary" disabled={busy || !target.trim()} onClick={() => void runMerge()}>
          {busy ? "合并中…" : mode === "squash" ? "执行 Squash 合并" : "执行合并"}
        </button>
      </>}
    >
      {error && <InlineError message={error} />}
      <div className="dialog-form">
        <label>
          <span>要合并的分支 / 引用</span>
          <input
            data-autofocus
            list="merge-branch-candidates"
            placeholder="输入或选择分支名 / 标签 / SHA"
            disabled={busy}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
          <datalist id="merge-branch-candidates">
            {candidates.map((b) => <option key={`${b.isRemote ? "r" : "l"}:${b.name}`} value={b.name} />)}
          </datalist>
        </label>
        <label>
          <span>合并策略</span>
          <select aria-label="合并策略" disabled={busy} value={mode} onChange={(e) => setMode(e.target.value as MergeMode)}>
            <option value="default">默认（可快进则快进，否则创建合并提交）</option>
            <option value="no-ff">始终创建合并提交 (--no-ff)</option>
            <option value="ff-only">仅允许快进合并 (--ff-only)</option>
            <option value="squash">压缩合并到暂存区 (--squash，不自动提交)</option>
          </select>
        </label>
        {mode !== "ff-only" && mode !== "squash" && (
          <label>
            <span>自定义合并提交信息（可选）</span>
            <input
              placeholder={`留空使用 Git 默认 Merge 信息`}
              disabled={busy}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </label>
        )}
      </div>
    </Dialog>
  );
}
