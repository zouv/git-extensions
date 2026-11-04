import { useEffect, useState } from "react";
import { api } from "../api";
import { useRepoBusy } from "../useRepoBusy";
import type { CommandOutput, ExplorerTarget, OperationState } from "../types";

interface Props {
  target: ExplorerTarget;
  onBusyChange: (busy: boolean) => void;
}

export default function PullWindow({ target, onBusyChange }: Props) {
  const [aheadBehind, setAheadBehind] = useState<string>("");
  const [operation, setOperation] = useState<OperationState | null>(null);
  const [output, setOutput] = useState<CommandOutput | null>(null);
  const [error, setError] = useState("");
  const [localBusy, setBusy] = useState(false);
  const repoBusy = useRepoBusy(target.repo.path);
  const busy = localBusy || repoBusy;

  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);
  useEffect(() => () => onBusyChange(false), [onBusyChange]);
  useEffect(() => {
    api.getAheadBehind(target.repo.path).then((value) => {
      setAheadBehind(value ? `ahead ${value.ahead} / behind ${value.behind}` : "未配置 upstream");
    }).catch(() => setAheadBehind(""));
  }, [target.repo.path]);

  const pull = async () => {
    if (busy) return;
    setBusy(true); setError(""); setOutput(null);
    try {
      const result = await api.pullWithOutput(target.repo.path);
      setOutput(result);
      setOperation(await api.getOperationState(target.repo.path).catch(() => null));
    } catch (reason) {
      setError(String(reason));
      const state = await api.getOperationState(target.repo.path).catch(() => null);
      setOperation(state);
    } finally {
      setBusy(false);
    }
  };

  return <div className="pull-window">
    <div className="pull-summary">
      <p><strong>{target.repo.name}</strong> · 当前分支 <strong>{target.repo.headBranch ?? "detached HEAD"}</strong></p>
      <p className="muted">{aheadBehind || "正在读取 upstream…"}</p>
      <p className="settings-note">Pull 会使用当前分支的 Git upstream 配置执行 <code>git pull</code>，可能产生合并或冲突。失败时保留 Git 原始输出。</p>
      <button className="primary" disabled={busy} onClick={() => void pull()}>{busy ? "Pull 执行中…" : "执行 Pull"}</button>
    </div>
    {error && <><div className="inline-error" role="alert">{error}</div>
      {operation?.conflicts.length ? <button onClick={() => void api.openRepositoryInMain(target.repo.path)}>转到主窗口解决冲突</button> : null}
    </>}
    {output && <section className="command-output">
      <h4>Pull 输出</h4>
      {output.stdout && <><strong>stdout</strong><pre>{output.stdout}</pre></>}
      {output.stderr && <><strong>stderr</strong><pre>{output.stderr}</pre></>}
      {!output.stdout && !output.stderr && <p className="muted">（已完成，无输出）</p>}
      <p className="panel-hint">退出码：{output.exitCode ?? "未知"}</p>
    </section>}
  </div>;
}
