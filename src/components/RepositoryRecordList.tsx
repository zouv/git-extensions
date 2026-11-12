import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { RepositoryRecord } from "../repositoryRecords";
import type { RepoInfo } from "../types";
import { displayRepoName, groupById, groupForRepo } from "../repoGroups";
import type { RepoGroupConfig } from "../repoGroups";
import type { SessionMeta } from "./RepositoryTabs";

export function repositoryRecordMatches(config: RepoGroupConfig, record: RepositoryRecord, query: string): boolean {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const group = groupById(config, groupForRepo(config, record.path));
  const text = [displayRepoName(config, record), record.name, record.path, group?.name,
    group?.id === "default" ? "未分组" : ""].join("\n").toLocaleLowerCase();
  return terms.every((term) => text.includes(term));
}

export interface RepositoryRecordListProps {
  config: RepoGroupConfig;
  records: RepositoryRecord[];
  repos: RepoInfo[];
  activePath: string | null;
  errors: Record<string, string>;
  meta?: Record<string, SessionMeta>;
  busy: boolean;
  focusedPath: string | null;
  onFocusPath: (path: string | null) => void;
  onOpen: (path: string) => void;
  openOnClick?: boolean;
  selectedPaths?: ReadonlySet<string>;
  onToggleSelection?: (path: string) => void;
  onSelectAll?: () => void;
  onContextMenu?: (path: string, x: number, y: number) => void;
  emptyMessage?: string;
}

/** 一个 roving 停靠点；方向键浏览、Space 勾选、Enter / 双击打开，行操作集中到菜单。 */
export default function RepositoryRecordList(props: RepositoryRecordListProps) {
  const { records, config, focusedPath, onFocusPath } = props;
  const listRef = useRef<HTMLDivElement>(null);
  const rows = useRef(new Map<string, HTMLDivElement>());
  const helpId = useId();
  const [hasFocus, setHasFocus] = useState(false);
  const effectivePath = records.some((record) => record.path === focusedPath) ? focusedPath : records[0]?.path ?? null;
  const openPaths = new Set(props.repos.map((repo) => repo.path));

  useEffect(() => {
    if (focusedPath !== effectivePath) onFocusPath(effectivePath);
  }, [focusedPath, effectivePath, onFocusPath]);

  useEffect(() => {
    if (!hasFocus || !effectivePath) return;
    const target = rows.current.get(effectivePath);
    const active = document.activeElement;
    if (active === document.body || listRef.current?.contains(active)) target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: "nearest" });
  }, [effectivePath, hasFocus]);

  const keydown = (event: KeyboardEvent<HTMLDivElement>, path: string) => {
    const index = records.findIndex((record) => record.path === path);
    const next = event.key === "Home" ? 0 : event.key === "End" ? records.length - 1
      : event.key === "ArrowDown" ? Math.min(records.length - 1, index + 1)
      : event.key === "ArrowUp" ? Math.max(0, index - 1) : null;
    if (next !== null) {
      event.preventDefault();
      const record = records[next];
      if (record) {
        onFocusPath(record.path);
        rows.current.get(record.path)?.focus({ preventScroll: true });
        rows.current.get(record.path)?.scrollIntoView({ block: "nearest" });
      }
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (!props.busy) props.onOpen(path);
    } else if (event.key === " " && props.onToggleSelection) {
      event.preventDefault();
      if (!props.busy) props.onToggleSelection(path);
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a" && props.onSelectAll) {
      event.preventDefault();
      if (!props.busy) props.onSelectAll();
    } else if ((event.key === "F10" && event.shiftKey) || event.key === "ContextMenu") {
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      props.onContextMenu?.(path, rect.left + 24, rect.bottom);
    }
  };

  return <div className="repository-record-list" ref={listRef} role="list" aria-label="仓库记录" aria-describedby={helpId}
    onFocusCapture={() => setHasFocus(true)} onBlurCapture={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHasFocus(false);
    }}>
    <span id={helpId} className="sr-only">方向键浏览，Enter 或双击打开。{props.onToggleSelection && "空格勾选，Ctrl+A 全选当前结果。"}{props.onContextMenu && "Shift+F10 打开仓库操作。"}</span>
    {records.map((record) => {
      const group = groupById(config, groupForRepo(config, record.path));
      const session = props.meta?.[record.path];
      const error = props.errors[record.path] || session?.error;
      const opened = openPaths.has(record.path);
      const status = error ? "打开失败" : record.path === props.activePath ? "当前" : opened ? "已打开" : "未打开";
      const selected = props.selectedPaths?.has(record.path) ?? false;
      const name = displayRepoName(config, record);
      return <div key={record.path} ref={(element) => { if (element) rows.current.set(record.path, element); else rows.current.delete(record.path); }}
        className={`repository-record-row${effectivePath === record.path ? " focused" : ""}${selected ? " selected" : ""}`}
        role="listitem" tabIndex={effectivePath === record.path ? 0 : -1}
        aria-label={`${name}，${record.path}，${group?.id === "default" ? "未分组" : group?.name ?? "未分组"}，${status}${selected ? "，已勾选" : ""}`}
        onFocus={() => onFocusPath(record.path)} onClick={(event) => {
          onFocusPath(record.path);
          event.currentTarget.focus({ preventScroll: true });
          if (props.openOnClick && !props.busy) props.onOpen(record.path);
        }} onDoubleClick={() => { if (!props.busy && !props.openOnClick) props.onOpen(record.path); }}
        onKeyDown={(event) => keydown(event, record.path)} onContextMenu={(event) => {
          if (!props.onContextMenu) return;
          event.preventDefault();
          onFocusPath(record.path);
          event.currentTarget.focus({ preventScroll: true });
          props.onContextMenu(record.path, event.clientX, event.clientY);
        }}>
        {props.onToggleSelection && <span role="checkbox" aria-checked={selected} aria-disabled={props.busy}
          aria-label={`选择 ${name}`} className={`repository-record-checkbox${selected ? " checked" : ""}`}
          onDoubleClick={(event) => event.stopPropagation()} onClick={(event) => {
            event.stopPropagation();
            onFocusPath(record.path);
            rows.current.get(record.path)?.focus({ preventScroll: true });
            if (!props.busy) props.onToggleSelection?.(record.path);
          }}>{selected ? "✓" : ""}</span>}
        <div className="repository-record-details">
          <div className="repository-record-heading"><strong title={name}>{name}</strong>
            {config.aliases[record.path] && <span className="muted repository-record-original" title={record.name}>{record.name}</span>}
          </div>
          <div className="repository-record-path mono" title={record.path}>{record.path}</div>
          {error && <div className="repository-record-error" role="status">{error}</div>}
        </div>
        <div className="repository-record-tags">
          <span className="repository-record-group" title={group?.name}><i style={{ background: group?.color }} />{group?.id === "default" ? "未分组" : group?.name ?? "未分组"}</span>
          <span className={`repository-record-status${error ? " error" : ""}`}>{status}</span>
          {session?.loading && <span className="muted">加载中</span>}
          {session?.busy && <span className="warning-text">操作中</span>}
          {session?.dirty && <span className="warning-text">有草稿</span>}
          {!!session?.conflictCount && <span className="warning-text">{session.conflictCount} 个冲突</span>}
        </div>
      </div>;
    })}
    {records.length === 0 && <div className="repository-record-empty" role="status">{props.emptyMessage ?? "没有匹配的仓库记录"}</div>}
  </div>;
}
