import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useRepoBusy } from "../useRepoBusy";
import type { RebaseAction, RebasePlan, RebaseTodoEntry, RebaseDraft } from "../types";
import Icon from "../ui/Icon";
import { useConfirm } from "../ui/Confirm";

interface Props {
  repoPath: string;
  startOid: string;
  draft?: RebaseDraft;
  onDraftChange: (oid: string, draft: RebaseDraft | null) => void;
  onExit: () => void;
  onConflict: () => void;
  onChanged: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onNotify: (kind: "success" | "error" | "info", message: string, details?: string) => void;
}

const actions: RebaseAction[] = ["pick", "reword", "squash", "fixup", "drop"];

export default function RebasePlanner(props: Props) {
  const [plan, setPlan] = useState<RebasePlan | null>(props.draft?.plan ?? null);
  const [entries, setEntries] = useState<RebaseTodoEntry[]>(props.draft?.entries ?? []);
  const [loading, setLoading] = useState(!props.draft);
  const [localBusy, setBusy] = useState(false);
  const repoBusy = useRepoBusy(props.repoPath);
  const busy = localBusy || repoBusy;
  const [error, setError] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [batchAction, setBatchAction] = useState<RebaseAction>("pick");
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [dirty, setDirty] = useState(props.draft?.dirty ?? false);
  const loadSequence = useRef(0);
  const confirm = useConfirm();

  const load = useCallback(async () => {
    const id = ++loadSequence.current; setLoading(true); setError("");
    try {
      const next = await api.prepareInteractiveRebase(props.repoPath, props.startOid);
      if (id !== loadSequence.current) return;
      setPlan(next); setEntries(next.entries.map((entry) => ({ ...entry }))); setDirty(false);
    } catch (e) { if (id === loadSequence.current) setError(String(e)); }
    finally { if (id === loadSequence.current) setLoading(false); }
  }, [props.repoPath, props.startOid]);
  useEffect(() => { if (!props.draft) void load(); return () => { loadSequence.current++; }; }, [load]);
  useEffect(() => props.onDirtyChange(dirty), [dirty, props.onDirtyChange]);
  useEffect(() => { if (plan) props.onDraftChange(props.startOid, { plan, entries, dirty }); }, [plan, entries, dirty, props.startOid, props.onDraftChange]);

  const update = (index: number, action: RebaseAction) => {
    if (busy) return;
    setDirty(true);
    setEntries((prev) => prev.map((entry, i) => i === index ? { ...entry, action } : entry));
  };
  const move = (from: number, to: number) => {
    if (busy || to < 0 || to >= entries.length || from === to) return;
    setDirty(true);
    setEntries((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  };
  const invalidFirst = entries.find((entry) => entry.action !== "drop")?.action === "squash" || entries.find((entry) => entry.action !== "drop")?.action === "fixup";
  const invalidMessage = entries.some((entry) => (entry.action === "reword" || entry.action === "squash") && !entry.message.trim());
  const dropped = entries.filter((entry) => entry.action === "drop").length;
  const actionSummary = actions
    .map((action) => ({ action, count: entries.filter((entry) => entry.action === action).length }))
    .filter((item) => item.count > 0)
    .map((item) => `${item.count} ${item.action}`)
    .join(" · ");

  const exit = async () => {
    if (busy) return;
    props.onExit();
  };
  const reset = async () => {
    if (dirty && !await confirm({ title: "重置 Rebase 计划？", body: "将丢弃当前重排、动作和提交信息编辑，并重新读取原始计划。", confirmLabel: "重置计划", danger: true })) return;
    await load();
  };

  const start = async () => {
    if (!plan || invalidFirst || invalidMessage || busy) return;
    const ok = await confirm({
      title: "开始交互式 Rebase？",
      body: <div><p>将以 <code>{plan.onto.slice(0, 10)}</code> 为基底重写 <strong>{plan.branch.replace(/^refs\/heads\//, "")}</strong> 的 {entries.length} 个提交。</p><p>受影响的保留提交可能获得新的 SHA{dropped > 0 ? `；${dropped} 个提交将被丢弃` : ""}。</p></div>,
      confirmLabel: "开始 Rebase",
      danger: true,
      requireAck: true,
      ackLabel: `我确认重写本地历史${dropped ? `并丢弃 ${dropped} 个提交` : ""}；已推送历史可能需要协作处理`,
    });
    if (!ok || busy) return;
    setBusy(true); setError("");
    try {
      await api.startInteractiveRebase(props.repoPath, { ...plan, entries });
      setDirty(false); setPlan(null);
      props.onNotify("success", `Rebase 完成：${entries.length - dropped} 个提交已处理`);
      props.onDraftChange(props.startOid, null); props.onChanged(); props.onExit();
    } catch (e) {
      const operation = await api.getOperationState(props.repoPath).catch(() => null);
      const branchName = plan?.branch.replace(/^refs\/heads\//, "");
      const onto = operation?.onto ?? "";
      const ontoMatches = !!plan && (onto === plan.onto || onto.startsWith(plan.onto) || plan.onto.startsWith(onto));
      // 只有能证明是本次计划产生的 rebase 才清空草稿；遗留或外部 rebase 不能当成“已暂停”。
      const started = operation?.kind === "rebase" && ontoMatches && (!operation.headName || operation.headName === branchName);
      if (started) {
        setDirty(false); setPlan(null); props.onDraftChange(props.startOid, null);
        props.onNotify("info", "Rebase 已暂停，等待处理冲突或提交信息", String(e));
        props.onConflict();
      } else {
        setError(String(e));
        props.onNotify("error", "Rebase 未开始", String(e));
      }
    } finally { setBusy(false); }
  };

  return (
    <div className="task-view rebase-planner">
      <div className="task-header">
        <button className="icon-button" title="返回历史（计划草稿会保留）" disabled={busy} onClick={() => void exit()}>←</button>
        <Icon name="branch" /><strong>交互式 Rebase</strong>
        {plan && <span>{plan.branch} → <code>{plan.onto.slice(0, 10)}</code></span>}
        <div className="toolbar-spacer" />
        <button disabled={busy || loading} onClick={() => void reset()}><Icon name="refresh" />重置计划</button>
        <button className="primary" disabled={busy || loading || !plan || invalidFirst || entries.length === 0 || invalidMessage} onClick={() => void start()}>{busy ? <span className="spinner" /> : <Icon name="branch" />}开始 Rebase…</button>
      </div>
      {error && <div className="inline-error"><Icon name="warning" /><span>{error}</span></div>}
      {invalidFirst && <div className="inline-warning">第一个提交不能使用 squash 或 fixup，因为它没有可合并的前一个提交。</div>}
      <div className="rebase-plan-meta">{plan ? <><span>最旧在上、最新在下</span><span>{entries.length} 个提交</span><span>{actionSummary || "全部 pick"}</span><span>拖动只编辑计划，不会修改仓库</span></> : <span>正在读取线性提交范围…</span>}</div>
      {invalidMessage && <div className="inline-warning">reword / squash 的提交信息不能为空。</div>}
      <div className="rebase-batch"><button disabled={busy || loading} onClick={() => setChecked(new Set(entries.map((entry) => entry.oid)))}>全选</button><button disabled={busy || !checked.size} onClick={() => setChecked(new Set())}>清空选择</button><span>选中 {checked.size} 个</span><select aria-label="批量 Rebase 动作" value={batchAction} disabled={busy} onChange={(e) => setBatchAction(e.target.value as RebaseAction)}>{actions.map((action) => <option key={action} value={action}>{action}</option>)}</select><button disabled={busy || !checked.size} onClick={() => { setDirty(true); setEntries((prev) => prev.map((entry) => checked.has(entry.oid) ? { ...entry, action: batchAction } : entry)); }}>应用动作</button><span className="panel-hint">Alt+↑/↓ 重排；未执行计划只保留在当前仓库页签。原 HEAD 会先备份。</span></div>
      <div className="rebase-list">
        {loading ? <div className="empty-state"><span className="spinner" /><span>准备 Rebase 计划…</span></div> : entries.map((entry, index) => <div className={`rebase-entry${entry.action === "drop" ? " dropped" : ""}${dropIndex === index && dragIndex !== null && dragIndex !== index ? " drop-target" : ""}`} key={entry.oid} draggable={!busy} tabIndex={0} onKeyDown={(e) => { if (e.altKey && e.key === "ArrowUp") { e.preventDefault(); move(index, index - 1); } else if (e.altKey && e.key === "ArrowDown") { e.preventDefault(); move(index, index + 1); } }} onDragStart={() => setDragIndex(index)} onDragOver={(e) => { e.preventDefault(); setDropIndex(index); }} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropIndex((current) => current === index ? null : current); }} onDragEnd={() => { setDragIndex(null); setDropIndex(null); }} onDrop={() => { if (dragIndex !== null) move(dragIndex, index); setDragIndex(null); setDropIndex(null); }}>
          <input type="checkbox" aria-label={`选择提交 ${entry.shortId}`} disabled={busy} checked={checked.has(entry.oid)} onChange={() => setChecked((prev) => { const next = new Set(prev); if (next.has(entry.oid)) next.delete(entry.oid); else next.add(entry.oid); return next; })} />
          <span className="drag-handle" title="拖动调整顺序">☰</span>
          <select aria-label={`${entry.subject} 的动作`} disabled={busy} value={entry.action} onChange={(e) => update(index, e.target.value as RebaseAction)}>{actions.map((action) => <option key={action} value={action}>{action}</option>)}</select>
          <code>{entry.shortId}</code>
          <div className="rebase-entry-content">
            <div className={entry.action === "drop" ? "strike" : ""}>{entry.subject}</div>
            {(entry.action === "reword" || entry.action === "squash") && <textarea aria-label={`${entry.subject} 的新提交信息`} rows={2} disabled={busy} value={entry.message} onChange={(e) => { setDirty(true); setEntries((prev) => prev.map((item, i) => i === index ? { ...item, message: e.target.value } : item)); }} />}
          </div>
          <div className="rebase-move"><button disabled={busy || index === 0} title="上移 (Alt+↑)" onClick={() => move(index, index - 1)}>↑</button><button disabled={busy || index === entries.length - 1} title="下移 (Alt+↓)" onClick={() => move(index, index + 1)}>↓</button></div>
        </div>)}
      </div>
      {plan && !loading && <div className="rebase-warning"><Icon name="warning" /><span>执行会重写 {plan.branch} 上此范围内的提交 SHA。包含 merge commit、脏工作区或不完整计划会被后端拒绝。</span></div>}
    </div>
  );
}
