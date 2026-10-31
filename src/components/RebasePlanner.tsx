import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { RebaseAction, RebasePlan, RebaseTodoEntry } from "../types";
import Icon from "../ui/Icon";
import { useConfirm } from "../ui/Confirm";

interface Props {
  repoPath: string;
  startOid: string;
  onExit: () => void;
  onConflict: () => void;
  onChanged: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onNotify: (kind: "success" | "error" | "info", message: string, details?: string) => void;
}

const actions: RebaseAction[] = ["pick", "reword", "squash", "fixup", "drop"];

export default function RebasePlanner(props: Props) {
  const [plan, setPlan] = useState<RebasePlan | null>(null);
  const [entries, setEntries] = useState<RebaseTodoEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const confirm = useConfirm();

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const next = await api.prepareInteractiveRebase(props.repoPath, props.startOid);
      setPlan(next); setEntries(next.entries.map((entry) => ({ ...entry }))); setDirty(false);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [props.repoPath, props.startOid]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => props.onDirtyChange(dirty), [dirty, props.onDirtyChange]);
  useEffect(() => () => props.onDirtyChange(false), [props.onDirtyChange]);

  const update = (index: number, action: RebaseAction) => {
    setDirty(true);
    setEntries((prev) => prev.map((entry, i) => i === index ? { ...entry, action } : entry));
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= entries.length || from === to) return;
    setDirty(true);
    setEntries((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  };
  const invalidFirst = entries.find((entry) => entry.action !== "drop")?.action === "squash" || entries.find((entry) => entry.action !== "drop")?.action === "fixup";
  const dropped = entries.filter((entry) => entry.action === "drop").length;

  const exit = async () => {
    if (dirty && !await confirm({ title: "放弃 Rebase 计划？", body: "当前重排、动作和提交信息编辑尚未执行，离开后将丢失。", confirmLabel: "放弃计划", danger: true })) return;
    setDirty(false);
    props.onExit();
  };
  const reset = async () => {
    if (dirty && !await confirm({ title: "重置 Rebase 计划？", body: "将丢弃当前重排、动作和提交信息编辑，并重新读取原始计划。", confirmLabel: "重置计划", danger: true })) return;
    await load();
  };

  const start = async () => {
    if (!plan || invalidFirst || busy) return;
    const ok = await confirm({
      title: "开始交互式 Rebase？",
      body: <div><p>将以 <code>{plan.onto.slice(0, 10)}</code> 为基底重写 <strong>{plan.branch}</strong> 的 {entries.length} 个提交。</p><p>所有保留下来的提交都会获得新的 SHA{dropped > 0 ? `；${dropped} 个提交将被丢弃` : ""}。</p></div>,
      confirmLabel: "开始 Rebase",
      danger: true,
      requireAck: dropped > 0,
      ackLabel: `我确认丢弃 ${dropped} 个提交并重写后续历史`,
    });
    if (!ok) return;
    setBusy(true); setError("");
    try {
      await api.startInteractiveRebase(props.repoPath, plan.onto, plan.originalHead, entries);
      setDirty(false);
      props.onNotify("success", `Rebase 完成：${entries.length - dropped} 个提交已处理`);
      props.onChanged(); props.onExit();
    } catch (e) {
      const operation = await api.getOperationState(props.repoPath).catch(() => null);
      if (operation?.kind === "rebase") { setDirty(false); props.onNotify("info", "Rebase 已暂停，等待处理冲突或提交信息", String(e)); props.onConflict(); }
      else setError(String(e));
    } finally { setBusy(false); }
  };

  return (
    <div className="task-view rebase-planner">
      <div className="task-header">
        <button className="icon-button" title="返回历史" disabled={busy} onClick={() => void exit()}>←</button>
        <Icon name="branch" /><strong>交互式 Rebase</strong>
        {plan && <span>{plan.branch} → <code>{plan.onto.slice(0, 10)}</code></span>}
        <div className="toolbar-spacer" />
        <button disabled={busy || loading} onClick={() => void reset()}><Icon name="refresh" />重置计划</button>
        <button className="primary" disabled={busy || loading || !plan || invalidFirst || entries.length === 0} onClick={() => void start()}>{busy ? <span className="spinner" /> : <Icon name="branch" />}开始 Rebase…</button>
      </div>
      {error && <div className="inline-error"><Icon name="warning" /><span>{error}</span></div>}
      {invalidFirst && <div className="inline-warning">第一个提交不能使用 squash 或 fixup，因为它没有可合并的前一个提交。</div>}
      <div className="rebase-plan-meta">{plan ? <><span>最旧在上、最新在下</span><span>{entries.length} 个提交</span><span>{dropped} 个 drop</span><span>拖动只编辑计划，不会修改仓库</span></> : <span>正在读取线性提交范围…</span>}</div>
      <div className="rebase-list">
        {loading ? <div className="empty-state"><span className="spinner" /><span>准备 Rebase 计划…</span></div> : entries.map((entry, index) => <div className={`rebase-entry${entry.action === "drop" ? " dropped" : ""}`} key={entry.oid} draggable={!busy} tabIndex={0} onKeyDown={(e) => { if (e.altKey && e.key === "ArrowUp") { e.preventDefault(); move(index, index - 1); } else if (e.altKey && e.key === "ArrowDown") { e.preventDefault(); move(index, index + 1); } }} onDragStart={() => setDragIndex(index)} onDragOver={(e) => e.preventDefault()} onDrop={() => { if (dragIndex !== null) move(dragIndex, index); setDragIndex(null); }}>
          <span className="drag-handle" title="拖动调整顺序">☰</span>
          <select aria-label={`${entry.subject} 的动作`} disabled={busy} value={entry.action} onChange={(e) => update(index, e.target.value as RebaseAction)}>{actions.map((action) => <option key={action} value={action}>{action}</option>)}</select>
          <code>{entry.shortId}</code>
          <div className="rebase-entry-content">
            <div className={entry.action === "drop" ? "strike" : ""}>{entry.subject}</div>
            {(entry.action === "reword" || entry.action === "squash") && <textarea aria-label={`${entry.subject} 的新提交信息`} rows={2} value={entry.message} onChange={(e) => { setDirty(true); setEntries((prev) => prev.map((item, i) => i === index ? { ...item, message: e.target.value } : item)); }} />}
          </div>
          <div className="rebase-move"><button disabled={busy || index === 0} title="上移 (Alt+↑)" onClick={() => move(index, index - 1)}>↑</button><button disabled={busy || index === entries.length - 1} title="下移 (Alt+↓)" onClick={() => move(index, index + 1)}>↓</button></div>
        </div>)}
      </div>
      {plan && !loading && <div className="rebase-warning"><Icon name="warning" /><span>执行会重写 {plan.branch} 上此范围内的提交 SHA。包含 merge commit、脏工作区或不完整计划会被后端拒绝。</span></div>}
    </div>
  );
}
