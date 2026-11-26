import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "../api";
import type { BranchInfo, Statistics, StatBucket, TagInfo } from "../types";
import Dialog from "../ui/Dialog";
import Icon from "../ui/Icon";
import InlineError from "../ui/InlineError";
import { abbreviation, avatarTextColor, repoAvatarColor } from "../repoIdentity";

type Tab = "overview" | "month" | "week";

interface Props {
  repoPath: string;
  branches: BranchInfo[];
  tags: TagInfo[];
  onClose: () => void;
}

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "OVERVIEW" },
  { id: "month", label: "MONTH" },
  { id: "week", label: "WEEK" },
];

/** 单一序列的柱状图：细柱、圆角数据端、两档网格与逐柱悬停提示。 */
function BarChart({ buckets, rangeLabel }: { buckets: StatBucket[]; rangeLabel: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(560);
  const [hover, setHover] = useState<{ x: number; y: number; bucket: StatBucket } | null>(null);
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const height = 280;
  const counts = buckets.map((bucket) => bucket.count);
  const { top, ticks } = niceScale(Math.max(0, ...counts));
  const margin = { top: 16, right: 14, bottom: 30, left: Math.max(38, String(top).length * 7 + 10) };
  const plotW = Math.max(60, width - margin.left - margin.right);
  const plotH = height - margin.top - margin.bottom;
  const baseline = margin.top + plotH;
  const slot = plotW / Math.max(1, buckets.length);
  const barW = Math.min(30, Math.max(5, slot * 0.52));
  const labelEvery = Math.max(1, Math.ceil(buckets.length / Math.max(1, Math.floor(plotW / 58))));
  const showLabel = (index: number) => index % labelEvery === 0 || index === buckets.length - 1;
  const barPath = (x: number, y: number, w: number, h: number) => {
    const radius = Math.min(3, w / 2, h);
    return `M${x},${y + h}V${y + radius}Q${x},${y} ${x + radius},${y}H${x + w - radius}Q${x + w},${y} ${x + w},${y + radius}V${y + h}Z`;
  };

  return (
    <div className="statistics-chart" ref={containerRef}>
      <div className="statistics-chart-caption">{rangeLabel}</div>
      <div className="statistics-chart-plot">
        <svg width={width} height={height} role="img" aria-label={`提交统计柱状图，${rangeLabel || "所选范围"}`}>
          {ticks.map((tick) => {
            const y = baseline - (tick / top) * plotH;
            return <g key={tick}>
              <line x1={margin.left} x2={width - margin.right} y1={y} y2={y} className={tick === 0 ? "statistics-axis" : "statistics-grid"} />
              <text x={margin.left - 8} y={y} className="statistics-tick" textAnchor="end" dominantBaseline="middle">{tick}</text>
            </g>;
          })}
          {buckets.map((bucket, index) => {
            const x = margin.left + index * slot;
            const barX = x + (slot - barW) / 2;
            const barH = top === 0 ? 0 : (bucket.count / top) * plotH;
            const y = baseline - barH;
            return <g key={bucket.key}>
              <rect
                x={x}
                y={margin.top}
                width={slot}
                height={plotH}
                fill="transparent"
                pointerEvents="all"
                onMouseEnter={() => setHover({ x: x + slot / 2, y, bucket })}
                onMouseLeave={() => setHover(null)}
              >
                <title>{`${bucket.label}: ${bucket.count} 个提交`}</title>
              </rect>
              {barH > 0 && <path d={barPath(barX, y, barW, barH)} className="statistics-bar" pointerEvents="none" />}
              {showLabel(index) && <text x={x + slot / 2} y={height - 8} className="statistics-tick" textAnchor="middle">{bucket.label}</text>}
            </g>;
          })}
          {counts.length === 0 || counts.every((count) => count === 0) ? <text x={margin.left + plotW / 2} y={margin.top + plotH / 2} className="statistics-empty" textAnchor="middle">该范围内没有提交</text> : null}
        </svg>
        {hover && <div className="statistics-tooltip" style={{ left: hover.x, top: hover.y - 6 }}><strong>{hover.bucket.label}</strong><span>{hover.bucket.count} 个提交</span></div>}
      </div>
      <table className="sr-only">
        <caption>{rangeLabel || "提交统计"}</caption>
        <thead><tr><th>范围</th><th>提交数</th></tr></thead>
        <tbody>{buckets.map((bucket) => <tr key={bucket.key}><td>{bucket.label}</td><td>{bucket.count}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function niceScale(maxValue: number): { top: number; ticks: number[] } {
  if (maxValue <= 0) return { top: 4, ticks: [0, 1, 2, 3, 4] };
  const rough = maxValue / 7;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const residual = rough / magnitude;
  const step = (residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 5 ? 5 : 10) * magnitude;
  const top = Math.ceil(maxValue / step) * step;
  const ticks: number[] = [];
  for (let value = 0; value <= top + step * 0.001; value += step) ticks.push(Math.round(value));
  return { top, ticks };
}

export default function StatisticsDialog({ repoPath, branches, tags, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("overview");
  const [revspec, setRevspec] = useState("");
  const [author, setAuthor] = useState<string | null>(null);
  const [data, setData] = useState<Statistics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const sequence = useRef(0);

  useEffect(() => {
    const id = ++sequence.current;
    setLoading(true); setError("");
    api.getStatistics(repoPath, revspec || null, author)
      .then((next) => { if (id === sequence.current) setData(next); })
      .catch((e) => { if (id === sequence.current) setError(String(e)); })
      .finally(() => { if (id === sequence.current) setLoading(false); });
    return () => { sequence.current++; };
  }, [repoPath, revspec, author]);

  const buckets = tab === "overview" ? data?.months : tab === "month" ? data?.monthDays : data?.weekDays;
  const rangeLabel = tab === "overview" ? data?.monthsLabel : tab === "month" ? data?.monthLabel : data?.weekLabel;
  const allCommits = data?.authors.reduce((sum, entry) => sum + entry.count, 0) ?? 0;
  const selectedAuthor = author ? data?.authors.find((entry) => entry.key === author) ?? null : null;
  const commits = data?.totalCommits ?? 0;

  return (
    <Dialog title="Statistics" className="statistics-dialog" onClose={onClose}>
      <div className="statistics">
        <div className="statistics-tabs" role="tablist" aria-label="统计范围">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              className={`statistics-tab${tab === entry.id ? " active" : ""}`}
              onClick={() => setTab(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <div className="statistics-main">
          <aside className="statistics-authors">
            <label className="statistics-ref" title="选择统计的 ref 范围">
              <Icon name="branch" size={14} />
              <select aria-label="统计范围" value={revspec} onChange={(e) => { setRevspec(e.target.value); setAuthor(null); }}>
                <option value="">--- (All)</option>
                {branches.length > 0 && <optgroup label="Branches">
                  {branches.map((branch) => <option key={branch.name} value={branch.name}>{branch.name}</option>)}
                </optgroup>}
                {tags.length > 0 && <optgroup label="Tags">
                  {tags.map((tag) => <option key={tag.name} value={tag.name}>{tag.name}</option>)}
                </optgroup>}
              </select>
            </label>
            <div className="statistics-author-list" role="listbox" aria-label="作者">
              <button
                type="button"
                role="option"
                aria-selected={author === null}
                className={`statistics-author${author === null ? " selected" : ""}`}
                onClick={() => setAuthor(null)}
              >
                <span className="statistics-avatar all"><Icon name="group" size={12} /></span>
                <span className="statistics-author-name">--- (All)</span>
                <span className="statistics-author-count">{allCommits}</span>
              </button>
              {data?.authors.map((entry) => {
                const background = repoAvatarColor(entry.key);
                return <button
                  key={entry.key}
                  type="button"
                  role="option"
                  aria-selected={author === entry.key}
                  className={`statistics-author${author === entry.key ? " selected" : ""}`}
                  title={`${entry.name || entry.email} <${entry.email || "无邮箱"}>`}
                  onClick={() => setAuthor(entry.key)}
                >
                  <span className="statistics-avatar" style={{ background, color: avatarTextColor(background) }}>{abbreviation(entry.name || entry.email || "?")}</span>
                  <span className="statistics-author-name">{entry.name || entry.email || "（未知作者）"}</span>
                  <span className="statistics-author-count">{entry.count}</span>
                </button>;
              })}
              {!loading && !error && data?.authors.length === 0 && <div className="panel-hint">该范围没有提交。</div>}
            </div>
          </aside>
          <section className="statistics-chart-area">
            {error ? <InlineError message={error} /> : loading && !data ? <div className="empty-state compact"><span className="spinner" /><span>正在统计提交…</span></div> : <>
              {loading && <span className="statistics-loading" title="正在更新统计"><span className="spinner" /></span>}
              <BarChart buckets={buckets ?? []} rangeLabel={rangeLabel ?? ""} />
              {data?.truncated && <div className="panel-hint">提交数超过 100,000，统计结果已截断。</div>}
              {selectedAuthor && <div className="panel-hint">仅统计 {selectedAuthor.name || selectedAuthor.email} 的提交。</div>}
            </>}
          </section>
        </div>
        <div className="statistics-footer">
          <span>AUTHORS: <strong>{data?.authors.length ?? 0}</strong></span>
          <span>COMMITS: <strong>{commits}</strong></span>
        </div>
      </div>
    </Dialog>
  );
}
