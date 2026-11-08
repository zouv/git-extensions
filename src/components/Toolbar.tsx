import { useRef, useState } from "react";
import type { AheadBehind, RepoInfo } from "../types";
import Icon from "../ui/Icon";
import type { IconName } from "../ui/Icon";
import ContextMenu from "../ui/ContextMenu";
import type { MenuItem } from "../ui/ContextMenu";

interface Props {
  repo: RepoInfo;
  loading: boolean;
  busy: boolean;
  revisionCount: number;
  aheadBehind: AheadBehind | null;
  filter: string;
  workspace: "history" | "changes";
  inspectorVisible: boolean;
  leftVisible: boolean;
  inspectorPosition: "right" | "bottom";
  compareBase: string | null;
  onFilter: (value: string) => void;
  onOpen: () => void;
  onRefresh: () => void;
  onToggleLeft: () => void;
  onToggleInspector: () => void;
  onInspectorPosition: (position: "right" | "bottom") => void;
  onResetLayout: () => void;
  onWideDiff: () => void;
  onFocusHistory: () => void;
  onBranches: () => void;
  onStash: () => void;
  onTags: () => void;
  onSubmodules: () => void;
  onRemotes?: () => void;
  onWorktrees?: () => void;
  onPullOptions?: () => void;
  onMerge?: () => void;
  onSearch?: () => void;
  onCommandLog?: () => void;
  onBisectStart?: () => void;
  onSettings: () => void;
  onRecovery: () => void;
  onCompare: () => void;
  onClearCompareBase: () => void;
  onRemote: (kind: "fetch" | "pull" | "push") => void;
}

function ToolButton({ icon, label, title, onClick, disabled = false, primary = false }: { icon: IconName; label?: string; title: string; onClick: () => void; disabled?: boolean; primary?: boolean }) {
  return <button className={`tool-button${primary ? " primary" : ""}`} title={title} aria-label={label ?? title} disabled={disabled} onClick={onClick}><Icon name={icon} />{label && <span>{label}</span>}</button>;
}

export default function Toolbar(props: Props) {
  const { repo, loading, busy, revisionCount, aheadBehind, filter } = props;
  const [viewMenu, setViewMenu] = useState<{ x: number; y: number } | null>(null);
  const [moreMenu, setMoreMenu] = useState<{ x: number; y: number } | null>(null);
  const viewButton = useRef<HTMLButtonElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const openMenu = (element: HTMLElement | null, setter: (value: { x: number; y: number } | null) => void) => {
    if (!element) return;
    const rect = element.getBoundingClientRect();
    setter({ x: rect.left, y: rect.bottom + 2 });
  };

  const viewItems: MenuItem[] = [
    { id: "left", label: "显示 / 隐藏左侧导航", icon: "menu", shortcut: "Ctrl+B", checked: props.leftVisible, keepOpen: true, onSelect: props.onToggleLeft },
    { id: "inspector", label: "显示 / 隐藏检查器", icon: "panel", checked: props.inspectorVisible, keepOpen: true, onSelect: props.onToggleInspector },
    { id: "sep-position", separator: true },
    { id: "position-right", label: "检查器停靠右侧", checked: props.inspectorPosition === "right", onSelect: () => props.onInspectorPosition("right") },
    { id: "position-bottom", label: "检查器停靠底部", checked: props.inspectorPosition === "bottom", onSelect: () => props.onInspectorPosition("bottom") },
    { id: "sep-preset", separator: true },
    { id: "layout-default", label: "布局：默认", onSelect: props.onResetLayout },
    { id: "layout-wide", label: "布局：宽 Diff", onSelect: props.onWideDiff },
    { id: "layout-focus", label: "布局：专注历史", onSelect: props.onFocusHistory },
  ];

  const moreItems: MenuItem[] = [
    ...(props.onSearch ? [{ id: "search", label: "高级搜索（提交历史 / 代码全文）…", icon: "search" as const, shortcut: "Ctrl+Shift+H", onSelect: props.onSearch }] : []),
    ...(props.onMerge ? [{ id: "merge", label: "合并分支到当前 HEAD…", icon: "branch" as const, onSelect: props.onMerge }] : []),
    ...(props.onPullOptions ? [{ id: "pull-options", label: "Pull 选项（Rebase / Autostash）…", icon: "pull" as const, onSelect: props.onPullOptions }] : []),
    ...(props.onRemotes ? [{ id: "remotes", label: "远程仓库管理 (Remotes)…", icon: "fetch" as const, onSelect: props.onRemotes }] : []),
    ...(props.onWorktrees ? [{ id: "worktrees", label: "Worktree 管理…", icon: "branch" as const, onSelect: props.onWorktrees }] : []),
    { id: "sep-more-1", separator: true },
    { id: "recovery", label: "恢复历史（HEAD 备份与 reflog）", icon: "history", onSelect: props.onRecovery },
    { id: "stash", label: "Stash 管理…", icon: "stash", shortcut: "Ctrl+Shift+S", onSelect: props.onStash },
    { id: "tags", label: "标签管理…", icon: "tag", shortcut: "Ctrl+Shift+T", onSelect: props.onTags },
    { id: "submodules", label: "子模块…", icon: "folder", shortcut: "Ctrl+Shift+M", onSelect: props.onSubmodules },
    ...(props.onBisectStart || props.onCommandLog ? [{ id: "sep-more-2", separator: true }] : []),
    ...(props.onBisectStart ? [{ id: "bisect", label: "启动 Git Bisect 二分排查…", onSelect: props.onBisectStart }] : []),
    ...(props.onCommandLog ? [{ id: "command-log", label: "Git 命令执行日志…", shortcut: "Ctrl+Shift+G", onSelect: props.onCommandLog }] : []),
  ];

  return (
    <div className="toolbar">
      <div className="toolbar-group">
        <ToolButton icon="menu" title="显示 / 隐藏导航 (Ctrl+B)" onClick={props.onToggleLeft} />
        <ToolButton icon="plus" title="打开仓库 (Ctrl+O)" onClick={props.onOpen} />
        <ToolButton icon="refresh" title="刷新当前仓库 (F5)" disabled={loading || busy} onClick={props.onRefresh} />
      </div>
      <div className="toolbar-separator" />
      <div className="toolbar-group branch-toolbar-group">
        <button className="branch-switch" disabled={busy} onClick={props.onBranches} title="分支管理 (Ctrl+Shift+B)"><Icon name="branch" /><strong>{repo.headBranch ?? " detached HEAD"}</strong>{aheadBehind && (aheadBehind.ahead > 0 || aheadBehind.behind > 0) && <span>↑{aheadBehind.ahead} ↓{aheadBehind.behind}</span>}<Icon name="chevron-down" size={13} /></button>
      </div>
      <div className="toolbar-group remote-actions">
        <ToolButton icon="fetch" label="Fetch" title="Fetch (Ctrl+Shift+F)" disabled={busy} onClick={() => props.onRemote("fetch")} />
        <ToolButton icon="pull" label="Pull" title="Pull (Ctrl+Shift+L)" disabled={busy} onClick={() => props.onRemote("pull")} />
        <ToolButton icon="push" label="Push" title="Push (Ctrl+Shift+P)" disabled={busy} onClick={() => props.onRemote("push")} />
      </div>
      <div className="toolbar-spacer" />
      {props.workspace === "history" && <>
        <ToolButton icon="compare" title="创建提交 / 分支对比" disabled={busy} onClick={props.onCompare} />
        {props.compareBase && <button type="button" className="compare-base-chip" title="当前对比基准；点击清除" onClick={props.onClearCompareBase}>基准 {props.compareBase.slice(0, 7)}<Icon name="close" size={11} /></button>}
        <div className="filter-box"><Icon name="search" /><input className="revision-filter" aria-label="过滤提交" placeholder="过滤提交… (Ctrl+F)" value={filter} onChange={(e) => props.onFilter(e.target.value)} />{filter && <button aria-label="清除过滤" onClick={() => props.onFilter("")}><Icon name="close" size={12} /></button>}</div>
        {props.onSearch && <ToolButton icon="search" title="高级提交与代码搜索 (Ctrl+Shift+H)" onClick={props.onSearch} />}
      </>}
      <span className="revision-count" title="当前提交数量">{revisionCount.toLocaleString()} 条</span>
      <button ref={viewButton} type="button" className="tool-button toolbar-view" title="视图与布局" aria-label="视图与布局" aria-haspopup="menu" aria-expanded={!!viewMenu} onPointerDown={(event) => { if (viewMenu) event.stopPropagation(); }} onClick={() => { if (viewMenu) setViewMenu(null); else openMenu(viewButton.current, setViewMenu); }}><Icon name="panel" /><span>视图</span></button>
      <ToolButton icon="settings" title="设置与快捷键 (Ctrl+,)" onClick={props.onSettings} />
      <div className="toolbar-overflow">
        <ToolButton icon="history" title="恢复历史：HEAD 备份与 reflog" disabled={busy} onClick={props.onRecovery} />
        <ToolButton icon="stash" title="Stash (Ctrl+Shift+S)" disabled={busy} onClick={props.onStash} />
        <ToolButton icon="tag" title="标签 (Ctrl+Shift+T)" disabled={busy} onClick={props.onTags} />
        <ToolButton icon="more" title="子模块 (Ctrl+Shift+M)" disabled={busy} onClick={props.onSubmodules} />
      </div>
      <button ref={moreButton} type="button" className="tool-button toolbar-more" title="更多操作" aria-label="更多操作" aria-haspopup="menu" aria-expanded={!!moreMenu} onPointerDown={(event) => { if (moreMenu) event.stopPropagation(); }} onClick={() => { if (moreMenu) setMoreMenu(null); else openMenu(moreButton.current, setMoreMenu); }}><Icon name="more" /><span>更多</span></button>
      {viewMenu && <ContextMenu x={viewMenu.x} y={viewMenu.y} onClose={() => setViewMenu(null)} ariaLabel="视图" items={viewItems} />}
      {moreMenu && <ContextMenu x={moreMenu.x} y={moreMenu.y} onClose={() => setMoreMenu(null)} ariaLabel="更多操作" items={moreItems} />}
    </div>
  );
}
