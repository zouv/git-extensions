import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { RefLabel, Revision } from "../types";
import { formatDate, formatRelativeDate } from "../api";
import { DEFAULT_LAYOUT } from "../settings";
import type { GridDisplayOptions } from "../settings";
import ContextMenu from "../ui/ContextMenu";
import type { MenuItem } from "../ui/ContextMenu";

const ROW_H = 28;
const LANE_W = 14;
const NODE_R = 4;
const PALETTE = ["#e06c75", "#65a9f5", "#57bd8a", "#d19a66", "#c678dd", "#56b6c2", "#d5a84e", "#be5046", "#7ec8e3", "#b5cea8"];
const MAX_GRAPH_W = 320;
const optionId = (oid: string) => `revision-option-${oid}`;
const HEADER_H = 26;
const COLUMN_GAP = 10;
/** 行内左右 padding 合计（左 6 + 右 10），列宽计算时需要。 */
const ROW_PADDING = 16;

/** View history 等轻量窗口启用的受控列宽；主窗口不传则沿用 CSS 自适应列。 */
export interface RevisionColumnWidths {
  refs: number;
  subject: number;
  author: number;
  date: number;
  sha: number;
}

export const DEFAULT_REVISION_COLUMN_WIDTHS: RevisionColumnWidths = {
  refs: 64, subject: 190, author: 96, date: 116, sha: 58,
};

export const REVISION_COLUMN_LIMITS: Record<keyof RevisionColumnWidths, [number, number]> = {
  refs: [48, 600],
  subject: [64, 1200],
  author: [56, 600],
  date: [80, 600],
  sha: [48, 200],
};

const COLUMN_LABELS: Record<keyof RevisionColumnWidths, string> = {
  refs: "引用", subject: "主题", author: "作者", date: "日期", sha: "SHA",
};

function clampColumn(key: keyof RevisionColumnWidths, value: number): number {
  const [min, max] = REVISION_COLUMN_LIMITS[key];
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** 只过滤标签显示；提交图 lane 数据仍由后端完整生成。 */
function refsForDisplay(refs: RefLabel[], display: GridDisplayOptions): RefLabel[] {
  return refs.filter((ref) => (ref.kind !== "remote" || display.showRemoteBranches) && (ref.kind !== "tag" || display.showTags));
}

export type RevisionAction =
  | "reset"
  | "diff"
  | "cherry-pick"
  | "revert"
  | "rebase"
  | "merge-into-head"
  | "fixup"
  | "squash-commit"
  | "export-patch"
  | "export-archive"
  | "bisect-bad"
  | "bisect-good"
  | "copy-sha"
  | "copy-subject"
  | "compare-head"
  | "compare-base"
  | "new-branch"
  | "new-tag"
  | "interactive-rebase";

interface Props {
  revisions: Revision[];
  selectedOids: string[];
  onSelect: (oid: string, additive: boolean) => void;
  onContextAction: (action: RevisionAction, rev: Revision) => void;
  loading: boolean;
  /** 当前待对比的基准提交；用于把菜单项从「设为基准」切换为「与基准对比」。 */
  compareBase?: string | null;
  /** 过滤条件变化时重置增量图宽扫描。 */
  layoutKey?: string;
  /** 轻量窗口只暴露已具备完整处理链路的动作。 */
  allowedActions?: RevisionAction[];
  /** View 菜单控制的列 / 标签 / 日期显示。 */
  display?: GridDisplayOptions;
  /** 轻量窗口：显示列头并启用列宽拖拽（主窗口不传，保持原布局）。 */
  showColumnHeader?: boolean;
  columnWidths?: RevisionColumnWidths;
  /** 双击列头分隔线时恢复的列宽。 */
  defaultColumnWidths?: RevisionColumnWidths;
  onColumnWidthsChange?: (widths: RevisionColumnWidths) => void;
}

export default function RevisionGrid({ revisions, selectedOids, onSelect, onContextAction, loading, compareBase, layoutKey, allowedActions, display = DEFAULT_LAYOUT, showColumnHeader = false, columnWidths, defaultColumnWidths, onColumnWidthsChange }: Props) {
  const can = (action: RevisionAction) => !allowedActions || allowedActions.includes(action);
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(600);
  const [viewportW, setViewportW] = useState(800);
  const [menu, setMenu] = useState<{ x: number; y: number; rev: Revision } | null>(null);
  const selectedOid = selectedOids[selectedOids.length - 1] ?? null;
  const [graphWidth, setGraphWidth] = useState(8 + LANE_W);
  const graphW = display.showGraphColumn ? graphWidth : 0;
  const graphScan = useRef({ key: "", length: 0, lanes: 1, firstOid: "" });
  const resizeDrag = useRef<{ key: keyof RevisionColumnWidths; startX: number; startWidth: number; snapshot: RevisionColumnWidths } | null>(null);
  const headerH = showColumnHeader ? HEADER_H : 0;
  const columnsTotal = columnWidths
    ? columnWidths.refs + columnWidths.subject + columnWidths.author + columnWidths.date + columnWidths.sha + COLUMN_GAP * 4 + ROW_PADDING
    : 0;
  /** 列宽模式下行宽：至少铺满可视宽度，列总宽超出时让网格横向滚动。 */
  const rowWidth = columnWidths ? Math.max(columnsTotal, viewportW - graphW) : undefined;

  // 日志按 300 条分批到达；只扫描新增尾部，避免每批重扫全部记录。
  useEffect(() => {
    const key = layoutKey ?? "";
    const previous = graphScan.current;
    const reset = previous.key !== key || revisions.length < previous.length
      || (previous.length > 0 && revisions[0]?.oid !== previous.firstOid);
    let lanes = reset ? 1 : previous.lanes;
    for (let i = reset ? 0 : previous.length; i < revisions.length; i++) {
      const revision = revisions[i];
      lanes = Math.max(lanes, revision.activeLanes.length, revision.lane + 1);
    }
    graphScan.current = { key, length: revisions.length, lanes, firstOid: revisions[0]?.oid ?? "" };
    const next = Math.min(8 + lanes * LANE_W, MAX_GRAPH_W);
    setGraphWidth((current) => current === next ? current : next);
  }, [layoutKey, revisions]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      setViewportH(el.clientHeight);
      setViewportW(el.clientWidth);
    });
    observer.observe(el);
    setViewportH(el.clientHeight);
    setViewportW(el.clientWidth);
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
    // 列头占据内容顶部，滚动定位需要带上这段偏移，避免选中行藏到列头下。
    const top = headerH + index * ROW_H;
    if (top < el.scrollTop + headerH) el.scrollTop = top - headerH;
    else if (top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_H - el.clientHeight;
  }, [revisions, selectedOid, headerH]);

  useEffect(() => {
    if (!display.showGraphColumn) return;
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
      const hasVisibleRefs = refsForDisplay(rev.refs, display).length > 0;
      ctx.fillStyle = hasVisibleRefs ? "#d5a84e" : color(rev.lane);
      ctx.beginPath(); ctx.arc(x(rev.lane), y, hasVisibleRefs ? NODE_R + 1 : NODE_R, 0, Math.PI * 2); ctx.fill();
    }
  }, [revisions, startRow, endRow, graphWidth, display.showGraphColumn, display.showRemoteBranches, display.showTags]);

  useEffect(() => () => document.body.classList.remove("column-resizing"), []);

  const startColumnResize = (event: ReactPointerEvent<HTMLElement>, key: keyof RevisionColumnWidths) => {
    if (!columnWidths || !onColumnWidthsChange || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    resizeDrag.current = { key, startX: event.clientX, startWidth: columnWidths[key], snapshot: { ...columnWidths } };
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.classList.add("column-resizing");
  };
  const moveColumnResize = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = resizeDrag.current;
    if (!drag || !onColumnWidthsChange) return;
    const width = clampColumn(drag.key, drag.startWidth + event.clientX - drag.startX);
    if (width !== drag.snapshot[drag.key]) onColumnWidthsChange({ ...drag.snapshot, [drag.key]: width });
  };
  const endColumnResize = (event: ReactPointerEvent<HTMLElement>) => {
    resizeDrag.current = null;
    document.body.classList.remove("column-resizing");
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const nudgeColumn = (key: keyof RevisionColumnWidths, delta: number) => {
    if (!columnWidths || !onColumnWidthsChange) return;
    const width = clampColumn(key, columnWidths[key] + delta);
    if (width !== columnWidths[key]) onColumnWidthsChange({ ...columnWidths, [key]: width });
  };
  const columnStyle = (key: keyof RevisionColumnWidths) => columnWidths
    ? { flex: `0 0 ${columnWidths[key]}px`, width: columnWidths[key], maxWidth: columnWidths[key] }
    : undefined;
  const renderColumnHeader = (key: keyof RevisionColumnWidths) => (
    <span className={`rev-head-cell rev-${key}`} style={columnStyle(key)}>
      <span className="rev-head-label">{COLUMN_LABELS[key]}</span>
      {columnWidths && onColumnWidthsChange && <span
        className="rev-col-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label={`调整${COLUMN_LABELS[key]}列宽`}
        title="拖拽调整列宽，双击恢复默认"
        tabIndex={0}
        onPointerDown={(event) => startColumnResize(event, key)}
        onPointerMove={moveColumnResize}
        onPointerUp={endColumnResize}
        onPointerCancel={endColumnResize}
        onKeyDown={(event) => {
          // 分隔线是独立控件：按键不再触发网格的选中 / 差异导航。
          event.stopPropagation();
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          nudgeColumn(key, (event.key === "ArrowRight" ? 1 : -1) * (event.shiftKey ? 32 : 8));
        }}
        onDoubleClick={(event) => {
          if (!columnWidths || !defaultColumnWidths || !onColumnWidthsChange) return;
          event.preventDefault();
          event.stopPropagation();
          onColumnWidthsChange({ ...columnWidths, [key]: defaultColumnWidths[key] });
        }}
      />}
    </span>
  );

  return (
    <div
      className="revision-grid"
      ref={scrollRef}
      role="listbox"
      aria-label="提交历史"
      aria-multiselectable
      aria-activedescendant={selectedOid ? optionId(selectedOid) : undefined}
      tabIndex={0}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      onKeyDown={(e) => {
        if ((e.target as HTMLElement | null)?.closest(".context-menu")) return;
        if ((e.key === "F10" && e.shiftKey) || e.key === "ContextMenu") {
          const rev = revisions.find((item) => item.oid === selectedOid);
          if (!rev) return;
          e.preventDefault();
          const rect = e.currentTarget.getBoundingClientRect();
          setMenu({ x: rect.left + 24, y: rect.top + 30, rev });
          return;
        }
        const target = e.target as HTMLElement | null;
        if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
        const selectedIndex = revisions.findIndex((item) => item.oid === selectedOid);
        if (e.key === "Enter") {
          const rev = selectedIndex >= 0 ? revisions[selectedIndex] : null;
          if (!rev) return;
          e.preventDefault();
          onContextAction("diff", rev);
          return;
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End", "PageDown", "PageUp"].includes(e.key)) return;
        let next = selectedIndex;
        if (e.key === "ArrowDown") next = Math.min(revisions.length - 1, selectedIndex + 1);
        else if (e.key === "ArrowUp") next = Math.max(0, selectedIndex < 0 ? 0 : selectedIndex - 1);
        else if (e.key === "Home") next = 0;
        else if (e.key === "End") next = revisions.length - 1;
        else if (e.key === "PageDown") next = Math.min((selectedIndex < 0 ? 0 : selectedIndex) + 20, revisions.length - 1);
        else if (e.key === "PageUp") next = Math.max((selectedIndex < 0 ? 0 : selectedIndex) - 20, 0);
        if (next < 0 || !revisions[next]) return;
        e.preventDefault();
        onSelect(revisions[next].oid, false);
      }}
    >
      {showColumnHeader && columnWidths && (
        <div
          className="revision-header"
          role="presentation"
          style={{ height: HEADER_H, width: graphW + (rowWidth ?? 0), paddingLeft: graphW + 6, paddingRight: 10 }}
        >
          {renderColumnHeader("refs")}
          {renderColumnHeader("subject")}
          {renderColumnHeader("author")}
          {renderColumnHeader("date")}
          {renderColumnHeader("sha")}
        </div>
      )}
      <div className="revision-content" style={{ height: revisions.length * ROW_H }}>
        <canvas ref={canvasRef} className="graph-canvas" style={{ top: startRow * ROW_H, width: graphWidth, display: display.showGraphColumn ? undefined : "none" }} />
        {revisions.slice(startRow, endRow).map((rev, i) => {
          const row = startRow + i;
          const selected = selectedOids.includes(rev.oid);
          return (
            <div
              key={rev.oid}
              id={optionId(rev.oid)}
              className={`revision-row${selected ? " selected" : ""}`}
              style={{ top: row * ROW_H, left: graphW, height: ROW_H, width: rowWidth }}
              role="option"
              aria-selected={selected}
              aria-posinset={row + 1}
              aria-setsize={revisions.length}
              tabIndex={-1}
              onClick={(e) => { onSelect(rev.oid, (e.ctrlKey || e.metaKey) && selectedOids.length > 0); scrollRef.current?.focus({ preventScroll: true }); }}
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
              <span className="rev-refs" style={columnStyle("refs")}>{refsForDisplay(rev.refs, display).map((ref, j) => <span key={j} className={`ref-badge ref-${ref.kind}`}>{ref.name}</span>)}</span>
              <span className="rev-subject" style={columnStyle("subject")} title={rev.subject}>{rev.subject}</span>
              {display.showAuthorColumn && <span className="rev-author" style={columnStyle("author")} title={rev.authorName}>{rev.authorName}</span>}
              {display.showDateColumn && <span className="rev-date" style={columnStyle("date")}>{display.relativeDate ? formatRelativeDate(rev.authorTime) : formatDate(rev.authorTime)}</span>}
              {display.showShaColumn && <span className="rev-sha" style={columnStyle("sha")}>{rev.shortId}</span>}
            </div>
          );
        })}
      </div>
      {revisions.length === 0 && !loading && <div className="empty-state"><strong>暂无提交记录</strong><span>空仓库或当前过滤条件没有结果。</span></div>}
      {loading && <div className="loading-hint"><span className="spinner" />正在加载 · 已接收 {revisions.length.toLocaleString()} 条</div>}
      {menu && (() => {
        const copyItems: MenuItem[] = [
          ...(can("copy-sha") ? [{ id: "copy-sha", label: "复制完整 SHA", icon: "copy" as const, shortcut: "Ctrl+Shift+C", onSelect: () => onContextAction("copy-sha", menu.rev) }] : []),
          ...(can("copy-subject") ? [{ id: "copy-subject", label: "复制提交主题", icon: "copy" as const, onSelect: () => onContextAction("copy-subject", menu.rev) }] : []),
        ];
        const compareItems: MenuItem[] = [
          ...(can("compare-base") ? [{ id: "compare-base", label: compareBase === menu.rev.oid ? "取消对比基准" : compareBase ? `与基准 ${compareBase.slice(0, 7)} 对比` : "设为对比基准", icon: "compare" as const, onSelect: () => onContextAction("compare-base", menu.rev) }] : []),
          ...(can("compare-head") ? [{ id: "compare-head", label: "与当前分支对比", icon: "compare" as const, onSelect: () => onContextAction("compare-head", menu.rev) }] : []),
        ];
        const branchItems: MenuItem[] = [
          ...(can("new-branch") ? [{ id: "new-branch", label: "在此新建分支…", icon: "branch" as const, onSelect: () => onContextAction("new-branch", menu.rev) }] : []),
          ...(can("new-tag") ? [{ id: "new-tag", label: "在此新建标签…", icon: "tag" as const, onSelect: () => onContextAction("new-tag", menu.rev) }] : []),
          ...(can("merge-into-head") ? [{ id: "merge-into-head", label: "合并此提交到当前分支…", icon: "branch" as const, onSelect: () => onContextAction("merge-into-head", menu.rev) }] : []),
        ];
        const historyItems: MenuItem[] = [
          ...(can("cherry-pick") ? [{ id: "cherry", label: "Cherry-pick 此提交…", onSelect: () => onContextAction("cherry-pick", menu.rev) }] : []),
          ...(can("revert") ? [{ id: "revert", label: "Revert 此提交…", onSelect: () => onContextAction("revert", menu.rev) }] : []),
          ...(can("fixup") ? [{ id: "fixup", label: "创建 Fixup 提交（修正此提交）", onSelect: () => onContextAction("fixup", menu.rev) }] : []),
          ...(can("squash-commit") ? [{ id: "squash-commit", label: "创建 Squash 提交", onSelect: () => onContextAction("squash-commit", menu.rev) }] : []),
          ...(can("rebase") ? [{ id: "rebase", label: "将当前分支 Rebase 到此提交…", danger: true, onSelect: () => onContextAction("rebase", menu.rev) }] : []),
          ...(can("reset") ? [{ id: "reset", label: "Reset 当前 HEAD 到此提交…", danger: true, onSelect: () => onContextAction("reset", menu.rev) }] : []),
          ...(can("interactive-rebase") ? [{ id: "interactive", label: "从此提交开始交互式 Rebase…", danger: true, onSelect: () => onContextAction("interactive-rebase", menu.rev) }] : []),
        ];
        const exportItems: MenuItem[] = [
          ...(can("export-patch") ? [{ id: "export-patch", label: "导出补丁 (.patch)…", icon: "file" as const, onSelect: () => onContextAction("export-patch", menu.rev) }] : []),
          ...(can("export-archive") ? [{ id: "export-archive", label: "导出归档 (.zip)…", icon: "file" as const, onSelect: () => onContextAction("export-archive", menu.rev) }] : []),
        ];
        const bisectItems: MenuItem[] = [
          ...(can("bisect-bad") ? [{ id: "bisect-bad", label: "标记此提交为坏 (Bad)", icon: "warning" as const, onSelect: () => onContextAction("bisect-bad", menu.rev) }] : []),
          ...(can("bisect-good") ? [{ id: "bisect-good", label: "标记此提交为好 (Good)", icon: "check" as const, onSelect: () => onContextAction("bisect-good", menu.rev) }] : []),
        ];
        const items: MenuItem[] = [
          ...(can("diff") ? [{ id: "diff", label: "查看差异", icon: "view" as const, onSelect: () => onContextAction("diff", menu.rev) }] : []),
          ...(copyItems.length > 0 ? [{ id: "copy", label: "复制", icon: "copy" as const, children: copyItems }] : []),
          ...(compareItems.length > 0 ? [{ id: "compare", label: "对比", icon: "compare" as const, children: compareItems }] : []),
          ...(branchItems.length > 0 ? [{ id: "sep-branch", separator: true }, { id: "branch-actions", label: "分支与标签", icon: "branch" as const, children: branchItems }] : []),
          ...(historyItems.length > 0 || exportItems.length > 0 || bisectItems.length > 0 ? [{ id: "sep-history", separator: true }] : []),
          ...(historyItems.length > 0 ? [{ id: "history-actions", label: "历史操作", icon: "history" as const, children: historyItems }] : []),
          ...(exportItems.length > 0 ? [{ id: "export", label: "导出", icon: "file" as const, children: exportItems }] : []),
          ...(bisectItems.length > 0 ? [{ id: "bisect", label: "Bisect 二分排查", icon: "search" as const, children: bisectItems }] : []),
        ];
        return <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} ariaLabel={`提交 ${menu.rev.shortId} 操作`} items={items} />;
      })()}
    </div>
  );
}
