import { useRef, useState } from "react";
import type { RefObject } from "react";
import type { AheadBehind, BranchInfo, GitMaintenanceAction, RepoFileTarget, RepoInfo } from "../types";
import type { GridDisplayOptions } from "../settings";
import Icon from "../ui/Icon";
import type { IconName } from "../ui/Icon";
import ContextMenu from "../ui/ContextMenu";
import type { MenuItem } from "../ui/ContextMenu";

interface Props {
  repo: RepoInfo;
  branches: BranchInfo[];
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
  leftRef: string | null;
  display: GridDisplayOptions;
  selectedShortId: string | null;
  conflictCount: number;
  onFilter: (value: string) => void;
  onCheckoutBranch: (name: string) => void;
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
  onRemotes: () => void;
  onWorktrees: () => void;
  onPullOptions: () => void;
  onMerge: () => void;
  onSearch: () => void;
  onCommandLog: () => void;
  onBisectStart: () => void;
  onSettings: () => void;
  onRecovery: () => void;
  onCompare: () => void;
  onClearCompareBase: () => void;
  onRemote: (kind: "fetch" | "pull" | "push") => void;
  onFileExplorer: () => void;
  onEditRepoFile: (target: RepoFileTarget) => void;
  onUpdateAllSubmodules: () => void;
  onSyncAllSubmodules: () => void;
  onMaintenance: (action: GitMaintenanceAction | "edit-config") => void;
  onRepositorySettings: () => void;
  onCloseRepo: () => void;
  onGoCurrent: () => void;
  onGoCommit: () => void;
  onGoChild: () => void;
  onGoParent: (kind: "parent" | "first" | "last") => void;
  onGoMergeBase: () => void;
  onNavigateBackward: () => void;
  onNavigateForward: () => void;
  onQuickSearch: () => void;
  onQuickSearchPrev: () => void;
  onQuickSearchNext: () => void;
  onBranchScope: (scope: "all" | "current" | "filtered") => void;
  onToggleDisplay: (option: keyof GridDisplayOptions) => void;
  onCommit: () => void;
  onUndoLastCommit: () => void;
  onResetChanges: () => void;
  onCreateBranch: () => void;
  onDeleteBranch: () => void;
  onCheckoutBranchDialog: () => void;
  onCreateTag: () => void;
  onCheckoutRevision: () => void;
  onRebase: () => void;
  onFormatPatch: () => void;
  onApplyPatch: () => void;
  onConflict: () => void;
  onCherryPick: () => void;
  onArchive: () => void;
}

type Point = { x: number; y: number };

function ToolButton({ icon, label, title, onClick, disabled = false, primary = false }: { icon: IconName; label?: string; title: string; onClick: () => void; disabled?: boolean; primary?: boolean }) {
  return <button className={`tool-button${primary ? " primary" : ""}`} title={title} aria-label={label ?? title} disabled={disabled} onClick={onClick}><Icon name={icon} />{label && <span>{label}</span>}</button>;
}

function MenuButton({ icon, label, open, onClick, buttonRef }: { icon: IconName; label: string; open: boolean; onClick: () => void; buttonRef: RefObject<HTMLButtonElement | null> }) {
  return <button ref={buttonRef} type="button" className="tool-button menu-tool-button" title={`${label} 菜单`} aria-label={`${label} 菜单`} aria-haspopup="menu" aria-expanded={open} onPointerDown={(event) => { if (open) event.stopPropagation(); }} onClick={onClick}><Icon name={icon} /><Icon name="chevron-down" size={11} /></button>;
}

export default function Toolbar(props: Props) {
  const { repo, loading, busy, revisionCount, aheadBehind, filter, display, leftRef } = props;
  const [repositoryMenu, setRepositoryMenu] = useState<Point | null>(null);
  const [navigateMenu, setNavigateMenu] = useState<Point | null>(null);
  const [viewMenu, setViewMenu] = useState<Point | null>(null);
  const [commandsMenu, setCommandsMenu] = useState<Point | null>(null);
  const [branchMenu, setBranchMenu] = useState<Point | null>(null);
  const repositoryButton = useRef<HTMLButtonElement>(null);
  const navigateButton = useRef<HTMLButtonElement>(null);
  const viewButton = useRef<HTMLButtonElement>(null);
  const commandsButton = useRef<HTMLButtonElement>(null);
  const branchButton = useRef<HTMLButtonElement>(null);
  const openMenu = (element: HTMLElement | null, setter: (value: Point | null) => void) => {
    if (!element) return;
    const rect = element.getBoundingClientRect();
    setter({ x: rect.left, y: rect.bottom + 2 });
  };
  const toggleMenu = (current: Point | null, setter: (value: Point | null) => void, element: HTMLElement | null) => {
    if (current) setter(null);
    else openMenu(element, setter);
  };

  const currentBranch = repo.headBranch ?? "HEAD";
  const hasSelection = !!props.selectedShortId;

  const repositoryItems: MenuItem[] = [
    { id: "refresh", label: "刷新", icon: "refresh", shortcut: "F5", onSelect: props.onRefresh },
    { id: "file-explorer", label: "文件资源管理器", icon: "folder", shortcut: "Ctrl+Shift+O", onSelect: props.onFileExplorer },
    { id: "sep-repo-1", separator: true },
    { id: "remotes", label: "远程仓库…", icon: "fetch", onSelect: props.onRemotes },
    { id: "sep-repo-2", separator: true },
    { id: "submodules", label: "管理子模块…", icon: "folder", shortcut: "Ctrl+Shift+M", onSelect: props.onSubmodules },
    { id: "update-submodules", label: "更新所有子模块", icon: "pull", disabled: busy, onSelect: props.onUpdateAllSubmodules },
    { id: "sync-submodules", label: "同步所有子模块", icon: "refresh", disabled: busy, onSelect: props.onSyncAllSubmodules },
    { id: "sep-repo-3", separator: true },
    { id: "worktrees", label: "管理 Worktree…", icon: "branch", shortcut: "Ctrl+Alt+W", onSelect: props.onWorktrees },
    { id: "sep-repo-4", separator: true },
    { id: "edit-gitignore", label: "编辑 .gitignore", icon: "edit", disabled: busy, onSelect: () => props.onEditRepoFile("gitignore") },
    { id: "edit-exclude", label: "编辑 .git/info/exclude", icon: "edit", disabled: busy, onSelect: () => props.onEditRepoFile("exclude") },
    { id: "edit-gitattributes", label: "编辑 .gitattributes", icon: "edit", disabled: busy, onSelect: () => props.onEditRepoFile("gitattributes") },
    { id: "edit-mailmap", label: "编辑 .mailmap", icon: "edit", disabled: busy, onSelect: () => props.onEditRepoFile("mailmap") },
    { id: "sep-repo-5", separator: true },
    { id: "maintenance", label: "Git 维护", icon: "settings", children: [
      { id: "gc", label: "压缩 Git 数据库 (git gc)", icon: "settings", disabled: busy, onSelect: () => props.onMaintenance("gc") },
      { id: "delete-index-lock", label: "删除 index.lock", icon: "trash", danger: true, disabled: busy, onSelect: () => props.onMaintenance("delete-index-lock") },
      { id: "edit-config", label: "编辑 .git/config", icon: "edit", disabled: busy, onSelect: () => props.onMaintenance("edit-config") },
      { id: "sep-maint", separator: true },
      { id: "recovery", label: "恢复历史（HEAD 备份与 reflog）…", icon: "history", disabled: busy, onSelect: props.onRecovery },
      { id: "command-log", label: "Git 命令执行日志…", shortcut: "Ctrl+Shift+G", onSelect: props.onCommandLog },
    ] },
    { id: "repo-settings", label: "Repository settings…", icon: "settings", onSelect: props.onRepositorySettings },
    { id: "sep-repo-6", separator: true },
    { id: "close-repo", label: "关闭仓库页签", icon: "close", shortcut: "Ctrl+W", onSelect: props.onCloseRepo },
  ];

  const navigateItems: MenuItem[] = [
    { id: "go-current", label: "转到当前提交 (HEAD)", icon: "history", disabled: !repo.headOid, onSelect: props.onGoCurrent },
    { id: "go-commit", label: "转到提交（搜索）…", icon: "search", shortcut: "Ctrl+G", onSelect: props.onGoCommit },
    { id: "sep-nav-1", separator: true },
    { id: "go-child", label: "转到子提交", icon: "branch", disabled: !hasSelection, onSelect: props.onGoChild },
    { id: "go-parent", label: "转到父提交", icon: "branch", disabled: !hasSelection, onSelect: () => props.onGoParent("parent") },
    { id: "go-first-parent", label: "转到第一个父提交", icon: "branch", disabled: !hasSelection, onSelect: () => props.onGoParent("first") },
    { id: "go-last-parent", label: "转到最后一个父提交", icon: "branch", disabled: !hasSelection, onSelect: () => props.onGoParent("last") },
    { id: "go-merge-base", label: "转到共同祖先（merge base）", icon: "compare", disabled: !hasSelection, onSelect: props.onGoMergeBase },
    { id: "sep-nav-2", separator: true },
    { id: "nav-backward", label: "向后导航", icon: "history", shortcut: "Alt+Left", onSelect: props.onNavigateBackward },
    { id: "nav-forward", label: "向前导航", icon: "history", shortcut: "Alt+Right", onSelect: props.onNavigateForward },
    { id: "sep-nav-3", separator: true },
    { id: "quick-search", label: "快速搜索（聚焦过滤框）", icon: "search", shortcut: "Ctrl+F", onSelect: props.onQuickSearch },
    { id: "quick-search-prev", label: "快速搜索：上一处", shortcut: "Alt+Up", onSelect: props.onQuickSearchPrev },
    { id: "quick-search-next", label: "快速搜索：下一处", shortcut: "Alt+Down", onSelect: props.onQuickSearchNext },
  ];

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
    { id: "sep-scope", separator: true },
    { id: "scope-all", label: "显示所有分支", icon: "branch", checked: leftRef === null, onSelect: () => props.onBranchScope("all") },
    { id: "scope-current", label: "仅显示当前分支", icon: "branch", checked: leftRef === currentBranch, onSelect: () => props.onBranchScope("current") },
    { id: "scope-filtered", label: "仅显示左侧选中的引用", icon: "branch", checked: leftRef !== null && leftRef !== currentBranch, disabled: leftRef === null, onSelect: () => props.onBranchScope("filtered") },
    { id: "advanced-filter", label: "高级筛选（聚焦过滤框）", icon: "search", shortcut: "Ctrl+F", onSelect: props.onQuickSearch },
    { id: "sep-grid-labels", separator: true },
    { id: "show-remote-branches", label: "显示远程分支标签", checked: display.showRemoteBranches, onSelect: () => props.onToggleDisplay("showRemoteBranches") },
    { id: "show-tags", label: "显示标签", checked: display.showTags, onSelect: () => props.onToggleDisplay("showTags") },
    { id: "show-relative-date", label: "显示相对时间", checked: display.relativeDate, onSelect: () => props.onToggleDisplay("relativeDate") },
    { id: "sep-grid-columns", separator: true },
    { id: "show-graph-column", label: "显示提交图列", checked: display.showGraphColumn, onSelect: () => props.onToggleDisplay("showGraphColumn") },
    { id: "show-author-column", label: "显示作者列", checked: display.showAuthorColumn, onSelect: () => props.onToggleDisplay("showAuthorColumn") },
    { id: "show-date-column", label: "显示日期列", checked: display.showDateColumn, onSelect: () => props.onToggleDisplay("showDateColumn") },
    { id: "show-sha-column", label: "显示 SHA-1 列", checked: display.showShaColumn, onSelect: () => props.onToggleDisplay("showShaColumn") },
  ];

  const commandItems: MenuItem[] = [
    { id: "commit", label: "提交…", icon: "check", shortcut: "Ctrl+Enter", disabled: busy, onSelect: props.onCommit },
    { id: "undo-last-commit", label: "撤销上一次提交…", icon: "restore", disabled: busy, onSelect: props.onUndoLastCommit },
    { id: "sep-cmd-1", separator: true },
    { id: "pull-fetch", label: "Pull / Fetch…", icon: "pull", disabled: busy, onSelect: props.onPullOptions },
    { id: "push", label: "Push…", icon: "push", shortcut: "Ctrl+Shift+P", disabled: busy, onSelect: () => props.onRemote("push") },
    { id: "sep-cmd-2", separator: true },
    { id: "stash", label: "管理 Stash…", icon: "stash", shortcut: "Ctrl+Shift+S", disabled: busy, onSelect: props.onStash },
    { id: "reset-changes", label: "Reset 变更…", icon: "restore", danger: true, disabled: busy, onSelect: props.onResetChanges },
    { id: "sep-cmd-3", separator: true },
    { id: "create-branch", label: "创建分支…", icon: "branch", disabled: busy, onSelect: props.onCreateBranch },
    { id: "delete-branch", label: "删除分支…", icon: "trash", danger: true, disabled: busy, onSelect: props.onDeleteBranch },
    { id: "checkout-branch", label: "检出分支…", icon: "branch", shortcut: "Ctrl+Shift+B", disabled: busy, onSelect: props.onCheckoutBranchDialog },
    { id: "merge", label: "合并分支…", icon: "branch", disabled: busy, onSelect: props.onMerge },
    { id: "rebase", label: "Rebase 到选中提交…", icon: "history", disabled: busy || !hasSelection, onSelect: props.onRebase },
    { id: "conflicts", label: `解决合并冲突…${props.conflictCount > 0 ? ` (${props.conflictCount})` : ""}`, icon: "conflict", disabled: props.conflictCount === 0, onSelect: props.onConflict },
    { id: "sep-cmd-4", separator: true },
    { id: "create-tag", label: "创建标签…", icon: "tag", shortcut: "Ctrl+Shift+T", disabled: busy, onSelect: props.onCreateTag },
    { id: "delete-tag", label: "删除标签…", icon: "tag", danger: true, disabled: busy, onSelect: props.onTags },
    { id: "sep-cmd-5", separator: true },
    { id: "cherry-pick", label: "Cherry-pick 选中提交…", icon: "copy", disabled: busy || !hasSelection, onSelect: props.onCherryPick },
    { id: "archive", label: "导出选中提交归档…", icon: "file", disabled: busy || !hasSelection, onSelect: props.onArchive },
    { id: "checkout-revision", label: "检出修订…", icon: "history", disabled: busy, onSelect: props.onCheckoutRevision },
    { id: "bisect", label: "Bisect 二分排查…", icon: "search", disabled: busy, onSelect: props.onBisectStart },
    { id: "reflog", label: "显示 reflog…", icon: "history", disabled: busy, onSelect: props.onRecovery },
    { id: "sep-cmd-6", separator: true },
    { id: "format-patch", label: "导出选中提交补丁…", icon: "file", disabled: !hasSelection, onSelect: props.onFormatPatch },
    { id: "apply-patch", label: "应用补丁…", icon: "file", disabled: busy, onSelect: props.onApplyPatch },
  ];

  const branchItems: MenuItem[] = [
    ...props.branches.filter((branch) => !branch.isRemote).map((branch) => ({
      id: `branch-${branch.name}`,
      label: branch.name,
      icon: "branch" as const,
      checked: branch.isHead,
      disabled: branch.isHead,
      title: branch.isHead ? "当前分支" : `切换到 ${branch.name}`,
      onSelect: () => props.onCheckoutBranch(branch.name),
    })),
    ...(props.branches.some((branch) => !branch.isRemote) ? [{ id: "sep-branch", separator: true }] : []),
    { id: "manage-branches", label: "分支管理…", icon: "branch" as const, shortcut: "Ctrl+Shift+B", onSelect: props.onBranches },
  ];

  return (
    <div className="toolbar">
      <div className="toolbar-group toolbar-menu-group">
        <MenuButton icon="repository" label="Repository" open={!!repositoryMenu} buttonRef={repositoryButton} onClick={() => toggleMenu(repositoryMenu, setRepositoryMenu, repositoryButton.current)} />
        <MenuButton icon="navigate" label="Navigate" open={!!navigateMenu} buttonRef={navigateButton} onClick={() => toggleMenu(navigateMenu, setNavigateMenu, navigateButton.current)} />
        <MenuButton icon="view" label="View" open={!!viewMenu} buttonRef={viewButton} onClick={() => toggleMenu(viewMenu, setViewMenu, viewButton.current)} />
        <MenuButton icon="commands" label="Commands" open={!!commandsMenu} buttonRef={commandsButton} onClick={() => toggleMenu(commandsMenu, setCommandsMenu, commandsButton.current)} />
      </div>
      <div className="toolbar-separator" />
      <div className="toolbar-group">
        <ToolButton icon="menu" title="显示 / 隐藏导航 (Ctrl+B)" onClick={props.onToggleLeft} />
        <ToolButton icon="refresh" title="刷新当前仓库 (F5)" disabled={loading || busy} onClick={props.onRefresh} />
      </div>
      <div className="toolbar-separator" />
      <div className="toolbar-group branch-toolbar-group">
        <button
          ref={branchButton}
          className="branch-switch"
          disabled={busy}
          onClick={() => { if (branchMenu) setBranchMenu(null); else openMenu(branchButton.current, setBranchMenu); }}
          onPointerDown={(event) => { if (branchMenu) event.stopPropagation(); }}
          title="切换分支 / 分支管理"
          aria-haspopup="menu"
          aria-expanded={!!branchMenu}
        >
          <Icon name="branch" /><strong>{repo.headBranch ?? " detached HEAD"}</strong>{aheadBehind && (aheadBehind.ahead > 0 || aheadBehind.behind > 0) && <span>↑{aheadBehind.ahead} ↓{aheadBehind.behind}</span>}<Icon name="chevron-down" size={13} />
        </button>
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
        <ToolButton icon="search" title="高级提交与代码搜索 (Ctrl+Shift+H)" onClick={props.onSearch} />
      </>}
      <span className="revision-count" title="当前提交数量">{revisionCount.toLocaleString()} 条</span>
      <ToolButton icon="settings" title="设置与快捷键 (Ctrl+,)" onClick={props.onSettings} />
      <div className="toolbar-overflow">
        <ToolButton icon="history" title="恢复历史：HEAD 备份与 reflog" disabled={busy} onClick={props.onRecovery} />
        <ToolButton icon="stash" title="Stash (Ctrl+Shift+S)" disabled={busy} onClick={props.onStash} />
        <ToolButton icon="tag" title="标签 (Ctrl+Shift+T)" disabled={busy} onClick={props.onTags} />
        <ToolButton icon="folder" title="子模块 (Ctrl+Shift+M)" disabled={busy} onClick={props.onSubmodules} />
      </div>
      {repositoryMenu && <ContextMenu x={repositoryMenu.x} y={repositoryMenu.y} onClose={() => setRepositoryMenu(null)} ariaLabel="Repository" items={repositoryItems} />}
      {navigateMenu && <ContextMenu x={navigateMenu.x} y={navigateMenu.y} onClose={() => setNavigateMenu(null)} ariaLabel="Navigate" items={navigateItems} />}
      {viewMenu && <ContextMenu x={viewMenu.x} y={viewMenu.y} onClose={() => setViewMenu(null)} ariaLabel="View" items={viewItems} />}
      {commandsMenu && <ContextMenu x={commandsMenu.x} y={commandsMenu.y} onClose={() => setCommandsMenu(null)} ariaLabel="Commands" items={commandItems} />}
      {branchMenu && <ContextMenu x={branchMenu.x} y={branchMenu.y} onClose={() => setBranchMenu(null)} ariaLabel="切换分支" items={branchItems} />}
    </div>
  );
}
