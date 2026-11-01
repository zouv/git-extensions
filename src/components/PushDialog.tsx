import { useEffect, useState } from "react";
import { api } from "../api";
import { useRepoBusy } from "../useRepoBusy";
import type { PushInfo } from "../types";
import Dialog from "../ui/Dialog";

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
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    api.getPushInfo(props.repoPath).then((next) => {
      if (!alive) return;
      setInfo(next); setTarget(next.branch);
    }).catch((e) => { if (alive) setError(String(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [props.repoPath]);

  const push = async () => {
    if (!info || busy || (!info.hasUpstream && (!remote || !target.trim()))) return;
    setBusy(true); setError("");
    try {
      await api.push(props.repoPath, info.hasUpstream ? undefined : remote, info.hasUpstream ? undefined : target.trim(), info);
      props.onNotify("success", "Push 完成");
      props.onChanged(); props.onClose();
    } catch (e) {
      setError(String(e));
      props.onNotify("error", "Push 失败，未自动更换远程", String(e));
    } finally { setBusy(false); }
  };

  return <Dialog title="推送提交" busy={busy} onClose={props.onClose} footer={<>
    <button disabled={busy} onClick={props.onClose}>取消</button>
    <button className="primary" disabled={busy || loading || !info || (!info.hasUpstream && (!remote || !target.trim()))} onClick={() => void push()}>{busy ? "推送中…" : info?.hasUpstream ? "Push" : "推送并建立 upstream"}</button>
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
        <p className="muted">成功后建立 upstream；不使用强制推送。</p>
      </>}
    </div>}
    {error && <pre className="push-error" role="alert">{error}</pre>}
  </Dialog>;
}
