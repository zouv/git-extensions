import { useEffect, useMemo, useRef, useState } from "react";
import type { Revision } from "../types";
import { formatDate } from "../api";
import ContextMenu from "../ui/ContextMenu";

const ROW_H = 28;
const LANE_W = 14;
const NODE_R = 4;
const PALETTE = ["#e06c75", "#65a9f5", "#57bd8a", "#d19a66", "#c678dd", "#56b6c2", "#d5a84e", "#be5046", "#7ec8e3", "#b5cea8"];
const MAX_GRAPH_W = 320;

export type RevisionAction = "reset" | "diff" | "cherry-pick" | "revert" | "rebase" | "copy-sha" | "copy-subject" | "compare-head" | "compare-base" | "new-branch" | "new-tag" | "interactive-rebase";

interface Props {
  revisions: Revision[];
  selectedOids: string[];
  onSelect: (oid: string, additive: boolean) => void;
  onContextAction: (action: RevisionAction, rev: Revision) => void;
  loading: boolean;
}

export default function RevisionGrid({ revisions, selectedOids, onSelect, onContextAction, loading }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(600);
  const [menu, setMenu] = useState<{ x: number; y: number; rev: Revision } | null>(null);
  const selectedOid = selectedOids[selectedOids.length - 1] ?? null;

  const graphWidth = useMemo(() => {
    let lanes = 1;
    for (const r of revisions) lanes = Math.max(lanes, r.activeLanes.length, r.lane + 1);
    return Math.min(8 + lanes * LANE_W, MAX_GRAPH_W);
  }, [revisions]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setViewportH(el.clientHeight));
    observer.observe(el);
    setViewportH(el.clientHeight);
    return () => observer.disconnect();
  }, []);

  const startRow = Math.max(0, Math.floor(scrollTop / ROW_H) - 5);
  const visibleCount = Math.ceil(viewportH / ROW_H) + 10;
  const endRow = Math.min(revisions.length, startRow + visibleCount);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !selectedOid) return;
    const index = revisions.findIndex((r) => r.oid === selectedOid);
    if (index < 0) return;
    const top = index * ROW_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_H - el.clientHeight;
  }, [revisions, selectedOid]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const h = (endRow - startRow) * ROW_H;
    canvas.width = graphWidth * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${graphWidth}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, graphWidth, h);
    const x = (lane: number) => 8 + lane * LANE_W + LANE_W / 2;
    const color = (lane: number) => PALETTE[lane % PALETTE.length];
    ctx.lineWidth = 1.6;
    for (let i = startRow; i < endRow; i++) {
      const rev = revisions[i];
      const y = (i - startRow) * ROW_H + ROW_H / 2;
      for (let lane = 0; lane < rev.activeLanes.length; lane++) {
        if (!rev.activeLanes[lane]) continue;
        ctx.strokeStyle = color(lane);
        ctx.beginPath(); ctx.moveTo(x(lane), y); ctx.lineTo(x(lane), y + ROW_H); ctx.stroke();
      }
      rev.parentLanes.forEach((pl, idx) => {
        if (pl === rev.lane && idx === 0) return;
        ctx.strokeStyle = color(pl);
        ctx.beginPath(); ctx.moveTo(x(rev.lane), y); ctx.bezierCurveTo(x(rev.lane), y + ROW_H / 2, x(pl), y + ROW_H / 2, x(pl), y + ROW_H); ctx.stroke();
      });
      for (const ml of rev.mergedLanes) {
        ctx.strokeStyle = color(ml);
        ctx.beginPath(); ctx.moveTo(x(ml), y); ctx.bezierCurveTo(x(ml), y, x(rev.lane), y, x(rev.lane), y); ctx.stroke();
      }
      ctx.fillStyle = rev.refs.length > 0 ? "#d5a84e" : color(rev.lane);
      ctx.beginPath(); ctx.arc(x(rev.lane), y, rev.refs.length > 0 ? NODE_R + 1 : NODE_R, 0, Math.PI * 2); ctx.fill();
    }
  }, [revisions, startRow, endRow, graphWidth]);

  return (
    <div className="revision-grid" ref={scrollRef} role="listbox" aria-label="提交历史" aria-multiselectable onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
      <div className="revision-content" style={{ height: revisions.length * ROW_H }}>
        <canvas ref={canvasRef} className="graph-canvas" style={{ top: startRow * ROW_H, width: graphWidth }} />
        {revisions.slice(startRow, endRow).map((rev, i) => {
          const row = startRow + i;
          const selected = selectedOids.includes(rev.oid);
          return (
            <div
              key={rev.oid}
              className={`revision-row${selected ? " selected" : ""}`}
              style={{ top: row * ROW_H, left: graphWidth, height: ROW_H }}
              role="option"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onClick={(e) => onSelect(rev.oid, (e.ctrlKey || e.metaKey) && selectedOids.length > 0)}
              onDoubleClick={() => onContextAction("diff", rev)}
              onContextMenu={(e) => {
                e.preventDefault();
                if (!selected) onSelect(rev.oid, false);
                setMenu({ x: e.clientX, y: e.clientY, rev });
              }}
              onKeyDown={(e) => {
                if (e.key === "Shift" || e.key !== "F10" || !e.shiftKey) return;
                e.preventDefault();
                const rect = e.currentTarget.getBoundingClientRect();
                setMenu({ x: rect.left + 24, y: rect.bottom, rev });
              }}
            >
              <span className="rev-refs">{rev.refs.map((ref, j) => <span key={j} className={`ref-badge ref-${ref.kind}`}>{ref.name}</span>)}</span>
              <span className="rev-subject" title={rev.subject}>{rev.subject}</span>
              <span className="rev-author" title={rev.authorName}>{rev.authorName}</span>
              <span className="rev-date">{formatDate(rev.authorTime)}</span>
              <span className="rev-sha">{rev.shortId}</span>
            </div>
          );
        })}
      </div>
      {revisions.length === 0 && !loading && <div className="empty-state"><strong>暂无提交记录</strong><span>空仓库或当前过滤条件没有结果。</span></div>}
      {loading && <div className="loading-hint"><span className="spinner" />正在加载 · 已接收 {revisions.length.toLocaleString()} 条</div>}
      {menu && <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={[
        { id: "diff", label: "查看差异", onSelect: () => onContextAction("diff", menu.rev) },
        { id: "copy-sha", label: "复制完整 SHA", icon: "copy", shortcut: "Ctrl+Shift+C", onSelect: () => onContextAction("copy-sha", menu.rev) },
        { id: "copy-subject", label: "复制提交主题", icon: "copy", onSelect: () => onContextAction("copy-subject", menu.rev) },
        { id: "compare-base", label: "设为对比基准", icon: "compare", onSelect: () => onContextAction("compare-base", menu.rev) },
        { id: "compare-head", label: "与当前分支对比", icon: "compare", onSelect: () => onContextAction("compare-head", menu.rev) },
        { id: "new-branch", label: "在此新建分支…", icon: "branch", onSelect: () => onContextAction("new-branch", menu.rev) },
        { id: "new-tag", label: "在此新建标签…", icon: "tag", onSelect: () => onContextAction("new-tag", menu.rev) },
        { id: "sep-history", separator: true },
        { id: "cherry", label: "Cherry-pick 此提交…", onSelect: () => onContextAction("cherry-pick", menu.rev) },
        { id: "revert", label: "Revert 此提交…", onSelect: () => onContextAction("revert", menu.rev) },
        { id: "rebase", label: "将当前分支 Rebase 到此提交…", danger: true, onSelect: () => onContextAction("rebase", menu.rev) },
        { id: "reset", label: "Reset 当前 HEAD 到此提交…", danger: true, onSelect: () => onContextAction("reset", menu.rev) },
        { id: "interactive", label: "从此提交开始交互式 Rebase…", danger: true, onSelect: () => onContextAction("interactive-rebase", menu.rev) },
      ]} />}
    </div>
  );
}
