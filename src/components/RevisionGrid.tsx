import { useEffect, useMemo, useRef, useState } from "react";
import type { Revision } from "../types";
import { formatDate } from "../api";

const ROW_H = 26;
const LANE_W = 14;
const NODE_R = 4;
const PALETTE = [
  "#e06c75", "#61afef", "#98c379", "#d19a66", "#c678dd",
  "#56b6c2", "#e5c07b", "#be5046", "#7ec8e3", "#b5ceA8",
];
const MAX_GRAPH_W = 320;

interface Props {
  revisions: Revision[];
  selectedOid: string | null;
  onSelect: (oid: string) => void;
  onContextAction: (action: "cherry-pick" | "revert" | "rebase", rev: Revision) => void;
  loading: boolean;
}

/** 虚拟化提交列表：DOM 只渲染可见行，分支图只画可见区域的 Canvas。 */
export default function RevisionGrid({ revisions, selectedOid, onSelect, onContextAction, loading }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(600);
  const [menu, setMenu] = useState<{ x: number; y: number; rev: Revision } | null>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("blur", close);
    };
  }, [menu]);

  const graphWidth = useMemo(() => {
    let lanes = 1;
    // 只扫已加载行的 lane 数，O(n) 一次，不随滚动重算
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

  // 键盘导航 / 外部选中时，把选中行滚回虚拟列表视口。
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !selectedOid) return;
    const index = revisions.findIndex((r) => r.oid === selectedOid);
    if (index < 0) return;
    const top = index * ROW_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_H > el.scrollTop + el.clientHeight) {
      el.scrollTop = top + ROW_H - el.clientHeight;
    }
  }, [revisions, selectedOid]);

  // 画可见区域的分支图
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
      // 竖线：连到下一行中点
      for (let lane = 0; lane < rev.activeLanes.length; lane++) {
        if (!rev.activeLanes[lane]) continue;
        ctx.strokeStyle = color(lane);
        ctx.beginPath();
        ctx.moveTo(x(lane), y);
        ctx.lineTo(x(lane), y + ROW_H);
        ctx.stroke();
      }
      // fork / 非首 parent 的连线
      rev.parentLanes.forEach((pl, idx) => {
        if (pl === rev.lane && idx === 0) return;
        ctx.strokeStyle = color(pl);
        ctx.beginPath();
        ctx.moveTo(x(rev.lane), y);
        ctx.bezierCurveTo(x(rev.lane), y + ROW_H / 2, x(pl), y + ROW_H / 2, x(pl), y + ROW_H);
        ctx.stroke();
      });
      // merge：其它 lane 汇入本节点
      for (const ml of rev.mergedLanes) {
        ctx.strokeStyle = color(ml);
        ctx.beginPath();
        ctx.moveTo(x(ml), y);
        ctx.bezierCurveTo(x(ml), y, x(rev.lane), y, x(rev.lane), y);
        ctx.stroke();
      }
      // 节点
      ctx.fillStyle = rev.refs.length > 0 ? "#e5c07b" : color(rev.lane);
      ctx.beginPath();
      ctx.arc(x(rev.lane), y, rev.refs.length > 0 ? NODE_R + 1 : NODE_R, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [revisions, startRow, endRow, graphWidth]);

  return (
    <div
      className="revision-grid"
      ref={scrollRef}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div className="revision-content" style={{ height: revisions.length * ROW_H }}>
        <canvas
          ref={canvasRef}
          className="graph-canvas"
          style={{ top: startRow * ROW_H, width: graphWidth }}
        />
        {revisions.slice(startRow, endRow).map((rev, i) => {
          const row = startRow + i;
          return (
            <div
              key={rev.oid}
              className={`revision-row${rev.oid === selectedOid ? " selected" : ""}`}
              style={{ top: row * ROW_H, left: graphWidth, height: ROW_H }}
              onClick={() => onSelect(rev.oid)}
              onContextMenu={(e) => {
                e.preventDefault();
                onSelect(rev.oid);
                setMenu({ x: e.clientX, y: e.clientY, rev });
              }}
            >
              <span className="rev-refs">
                {rev.refs.map((ref, j) => (
                  <span key={j} className={`ref-badge ref-${ref.kind}`}>
                    {ref.name}
                  </span>
                ))}
              </span>
              <span className="rev-subject" title={rev.subject}>{rev.subject}</span>
              <span className="rev-author">{rev.authorName}</span>
              <span className="rev-date">{formatDate(rev.authorTime)}</span>
              <span className="rev-sha">{rev.shortId}</span>
            </div>
          );
        })}
      </div>
      {revisions.length === 0 && !loading && <div className="empty-hint">暂无提交记录</div>}
      {loading && <div className="loading-hint">加载中… 已加载 {revisions.length} 条</div>}
      {menu && (
        <div className="context-menu" style={{ left: menu.x, top: menu.y }}>
          <div className="context-item" onClick={() => onContextAction("cherry-pick", menu.rev)}>
            Cherry-pick 此提交
          </div>
          <div className="context-item" onClick={() => onContextAction("revert", menu.rev)}>
            Revert 此提交
          </div>
          <div className="context-item" onClick={() => onContextAction("rebase", menu.rev)}>
            将当前分支 rebase 到此提交
          </div>
        </div>
      )}
    </div>
  );
}
