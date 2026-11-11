import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import type { BranchInfo, SubmoduleInfo, TagInfo, WorktreeInfo } from "../types";
import { buildBranchTree } from "../viewState";
import type { BranchTreeNode } from "../viewState";
import { planBranchFolderDelete } from "../branchDelete";
import type { BranchRefKind } from "../branchDelete";
import Icon from "../ui/Icon";
import ContextMenu from "../ui/ContextMenu";
import type { MenuItem } from "../ui/ContextMenu";

interface Props {
  branches: BranchInfo[];
  tags: TagInfo[];
  submodules: SubmoduleInfo[];
  worktrees: WorktreeInfo[];
  activeRef: string | null;
  workspace: "history" | "changes";
  changeCount: number;
  width: number;
  conflictCount: number;
  onWorkspace: (workspace: "history" | "changes") => void;
  onFilter: (ref: string | null) => void;
  onCheckout: (name: string) => void;
  onCheckoutRemote?: (remoteBranch: string) => void;
  onMergeRef?: (ref: string) => void;
  onRenameBranch?: (branch: BranchInfo) => void;
  onDeleteRemoteBranch?: (remoteBranch: string) => void;
  onCompare: (ref: string) => void;
  onNewBranch: (startPoint: string) => void;
  onDeleteBranch: (branch: BranchInfo) => void;
  onDeleteBranchFolder?: (prefix: string, kind: BranchRefKind) => void;
  onDeleteTag: (name: string) => void;
  onStash: () => void;
  onSubmodules: () => void;
  onWorktrees?: () => void;
  onCopyPath: (path: string) => void;
  onRevealPath: (path: string) => void;
  onOpenWorktree: (path: string) => void;
}

type RefMenuTarget = { x: number; y: number; kind: "branch" | "remote" | "tag"; name: string; branch?: BranchInfo };
type SubmoduleMenuTarget = { x: number; y: number; kind: "submodule"; name: string; path: string };
type WorktreeMenuTarget = { x: number; y: number; kind: "worktree"; name: string; path: string };
type FolderMenuTarget = { x: number; y: number; kind: "local-folder" | "remote-folder"; name: string; prefix: string };
type MenuTarget = RefMenuTarget | WorktreeMenuTarget | SubmoduleMenuTarget | FolderMenuTarget;

export default function LeftPanel(props: Props) {
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [focusKey, setFocusKey] = useState("changes");
  const panelRef = useRef<HTMLElement>(null);
  const [refFilter, setRefFilter] = useState("");
  const [refLimit, setRefLimit] = useState(200);
  const query = refFilter.trim().toLocaleLowerCase();
  const matchRef = (name: string) => !query || name.toLocaleLowerCase().includes(query);
  const local = props.branches.filter((b) => !b.isRemote && matchRef(b.name));
  const remote = props.branches.filter((b) => b.isRemote && matchRef(b.name));
  const tags = props.tags.filter((tag) => matchRef(tag.name));
  const toggle = (name: string) => {
    setFocusKey(`group-${name}`);
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };
  const focusProps = (key: string) => ({
    "data-tree-key": key,
    tabIndex: focusKey === key ? 0 : -1,
    onFocus: () => setFocusKey(key),
  });
  const treeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-tree-key]")]
      .filter((element) => element.getClientRects().length > 0);
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "Home" ? 0
      : event.key === "End" ? items.length - 1
      : event.key === "ArrowDown" ? (index < 0 ? 0 : Math.min(items.length - 1, index + 1))
      : (index <= 0 ? 0 : index - 1);
    event.preventDefault();
    items[next]?.focus();
  };
  // 列表刷新 / 折叠 / 过滤后，原焦点项可能已卸载；把唯一 tab stop 落回“本地变更”。
  useEffect(() => {
    if (!panelRef.current?.querySelector(`[data-tree-key="${CSS.escape(focusKey)}"]`)) setFocusKey("changes");
  }, [collapsed, focusKey, props.branches, props.submodules, props.tags, props.worktrees, refFilter]);
  const historySelected = (name: string | null) => props.workspace === "history" && props.activeRef === name;

  const group = (id: string, label: string, count: number) => (
    <button className="tree-group" {...focusProps(`group-${id}`)} onClick={() => toggle(id)} aria-expanded={!collapsed.has(id) || !!query}><Icon name="chevron-down" size={12} /><span>{label}</span><span className="tree-count">{count}</span></button>
  );
  const openMenu = (event: ReactMouseEvent, target: Omit<RefMenuTarget, "x" | "y">) => {
    event.preventDefault();
    setMenu({ ...target, x: event.clientX, y: event.clientY });
  };
  const openWorktreeMenu = (event: ReactMouseEvent, worktree: WorktreeInfo) => {
    event.preventDefault();
    setMenu({ kind: "worktree", name: worktree.name, path: worktree.path, x: event.clientX, y: event.clientY });
  };
  const openSubmoduleMenu = (event: ReactMouseEvent, module: SubmoduleInfo) => {
    event.preventDefault();
    setMenu({ kind: "submodule", name: module.path, path: module.path, x: event.clientX, y: event.clientY });
  };
  const refRow = (name: string, kind: "branch" | "remote", branch: BranchInfo, label = name, depth = 0) => (
    <div
      className={`tree-item${historySelected(name) ? " selected" : ""}`}
      style={depth > 0 ? { paddingLeft: 12 + depth * 14 } : undefined}
      role="treeitem"
      aria-selected={historySelected(name)}
      {...focusProps(`ref-${kind}-${name}`)}
      key={name}
      title={name}
      onClick={() => { props.onFilter(name); props.onWorkspace("history"); }}
      onDoubleClick={() => {
        if (kind === "branch" && !branch.isHead) props.onCheckout(name);
        else if (kind === "remote" && props.onCheckoutRemote) props.onCheckoutRemote(name);
      }}
      onContextMenu={(e) => openMenu(e, { kind, name, branch })}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); props.onFilter(name); props.onWorkspace("history"); }
        if (e.key === "F10" && e.shiftKey) { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setMenu({ kind, name, branch, x: r.left, y: r.bottom }); }
      }}
    >
      <Icon name={kind === "branch" ? "branch" : "fetch"} size={14} />
      <span className={branch.isHead ? "branch-head" : ""}>{label}</span>
      {branch.isHead && <span className="head-marker">HEAD</span>}
    </div>
  );

  const localTree = useMemo(() => buildBranchTree(local.slice(0, refLimit)), [local, refLimit]);
  const remoteTree = useMemo(() => buildBranchTree(remote.slice(0, refLimit)), [remote, refLimit]);

  const renderBranchTree = (nodes: BranchTreeNode[], kind: "branch" | "remote", depth = 0): ReactNode[] => {
    const out: ReactNode[] = [];
    for (const node of nodes) {
      if (node.kind === "branch") {
        out.push(refRow(node.branch.name, kind, node.branch, node.label, depth));
      } else {
        const folderKey = `folder-${kind}-${node.prefix}`;
        const isCollapsed = collapsed.has(folderKey) && !query;
        const folderMenuKind: "local-folder" | "remote-folder" = kind === "branch" ? "local-folder" : "remote-folder";
        out.push(
          <button
            key={folderKey}
            type="button"
            className="tree-folder"
            style={{ paddingLeft: 12 + depth * 14 }}
            {...focusProps(`group-${folderKey}`)}
            aria-expanded={!isCollapsed}
            onClick={() => toggle(folderKey)}
            onContextMenu={(e) => { e.preventDefault(); setMenu({ kind: folderMenuKind, name: node.name, prefix: node.prefix, x: e.clientX, y: e.clientY }); }}
            onKeyDown={(e) => {
              if (e.key === "F10" && e.shiftKey) {
                e.preventDefault();
                const rect = e.currentTarget.getBoundingClientRect();
                setMenu({ kind: folderMenuKind, name: node.name, prefix: node.prefix, x: rect.left, y: rect.bottom });
              }
            }}
          >
            <Icon name={isCollapsed ? "folder" : "chevron-down"} size={12} />
            <span>{node.name}</span>
            <span className="tree-count">{node.count}</span>
          </button>,
        );
        if (!isCollapsed) {
          out.push(...renderBranchTree(node.children, kind, depth + 1));
        }
      }
    }
    return out;
  };

  const menuItems: MenuItem[] = (() => {
    if (!menu) return [];
    if (menu.kind === "submodule") return [
      { id: "open", label: "打开子模块管理", icon: "folder", onSelect: props.onSubmodules },
      { id: "copy", label: "复制路径", icon: "copy", onSelect: () => props.onCopyPath(menu.path) },
      { id: "reveal", label: "在文件管理器中显示", icon: "external", onSelect: () => props.onRevealPath(menu.path) },
    ];
    if (menu.kind === "worktree") return [
      { id: "open", label: "在新页签打开", icon: "plus", onSelect: () => props.onOpenWorktree(menu.path) },
      ...(props.onWorktrees ? [{ id: "manage-wt", label: "管理 Worktrees…", icon: "branch" as const, onSelect: props.onWorktrees }] : []),
      { id: "copy", label: "复制路径", icon: "copy", onSelect: () => props.onCopyPath(menu.path) },
      { id: "reveal", label: "在文件管理器中显示", icon: "external", onSelect: () => props.onRevealPath(menu.path) },
    ];
    if (menu.kind === "local-folder" || menu.kind === "remote-folder") {
      if (!props.onDeleteBranchFolder) return [];
      const kind: BranchRefKind = menu.kind === "local-folder" ? "local" : "remote";
      const plan = planBranchFolderDelete(props.branches, menu.prefix, kind);
      if (kind === "local" && plan.headBranch) {
        return [{
          id: "delete-branch-folder",
          label: "删除目录下所有分支…（含当前分支，请先切换）",
          icon: "close" as const,
          danger: true,
          disabled: true,
          title: `目录包含当前检出的分支 ${plan.headBranch}，请先切换到其他分支`,
        }];
      }
      return [{
        id: kind === "local" ? "delete-branch-folder" : "delete-remote-branch-folder",
        label: kind === "local" ? "删除目录下所有分支…" : "删除目录下所有远程分支…",
        icon: "close" as const,
        danger: true,
        disabled: plan.names.length === 0,
        title: `将删除目录 ${menu.prefix}/ 下的 ${plan.names.length} 个分支`,
        onSelect: () => props.onDeleteBranchFolder?.(menu.prefix, kind),
      }];
    }
    return [
      ...(menu.kind === "branch" ? [
        { id: "checkout", label: "切换分支", icon: "branch" as const, disabled: menu.branch?.isHead, onSelect: () => props.onCheckout(menu.name) },
        ...(props.onMergeRef ? [{ id: "merge", label: "合并到当前分支…", icon: "branch" as const, disabled: menu.branch?.isHead, onSelect: () => props.onMergeRef?.(menu.name) }] : []),
        { id: "new", label: "基于此新建分支…", icon: "plus" as const, onSelect: () => props.onNewBranch(menu.name) },
        ...(props.onRenameBranch && menu.branch ? [{ id: "rename", label: "重命名分支…", onSelect: () => { if (menu.branch) props.onRenameBranch?.(menu.branch); } }] : []),
      ] : []),
      ...(menu.kind === "remote" ? [
        ...(props.onCheckoutRemote ? [{ id: "checkout-remote", label: "检出为本地跟踪分支…", icon: "branch" as const, onSelect: () => props.onCheckoutRemote?.(menu.name) }] : []),
        ...(props.onMergeRef ? [{ id: "merge-remote", label: "合并到当前分支…", icon: "branch" as const, onSelect: () => props.onMergeRef?.(menu.name) }] : []),
        { id: "new-from-remote", label: "基于此新建分支…", icon: "plus" as const, onSelect: () => props.onNewBranch(menu.name) },
      ] : []),
      ...(menu.kind === "tag" && props.onMergeRef ? [
        { id: "merge-tag", label: "合并此标签到当前分支…", icon: "branch" as const, onSelect: () => props.onMergeRef?.(menu.name) },
      ] : []),
      { id: "compare", label: "与当前分支对比", icon: "compare" as const, onSelect: () => props.onCompare(menu.name) },
      { id: "copy", label: "复制名称", icon: "copy" as const, onSelect: () => { void navigator.clipboard?.writeText(menu.name); } },
      ...(menu.kind === "branch" ? [{ id: "sep", separator: true }, { id: "delete", label: "删除分支…", icon: "close" as const, danger: true, disabled: menu.branch?.isHead, onSelect: () => { if (menu.branch) props.onDeleteBranch(menu.branch); } }] : []),
      ...(menu.kind === "remote" && props.onDeleteRemoteBranch ? [{ id: "sep-remote", separator: true }, { id: "delete-remote", label: "删除远程分支…", icon: "close" as const, danger: true, onSelect: () => props.onDeleteRemoteBranch?.(menu.name) }] : []),
      ...(menu.kind === "tag" ? [{ id: "sep-tag", separator: true }, { id: "delete-tag", label: "删除标签…", icon: "close" as const, danger: true, onSelect: () => props.onDeleteTag(menu.name) }] : []),
    ];
  })();

  return (
    <aside className="left-panel" ref={panelRef} style={{ width: props.width }}>
      <div className="tree-filter">
        <Icon name="search" size={13} />
        <input aria-label="过滤分支和标签" placeholder="过滤分支 / 标签…" value={refFilter} onChange={(e) => { setRefFilter(e.target.value); setRefLimit(200); setFocusKey("changes"); }} onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); e.currentTarget.closest(".left-panel")?.querySelector<HTMLElement>("[data-tree-key]")?.focus(); } }} />
      </div>
      <div className="tree-items" role="tree" aria-label="仓库引用" onKeyDown={treeKeyDown}>
        <div
          className={`tree-item local-changes${props.workspace === "changes" ? " selected" : ""}`}
          role="treeitem"
          aria-selected={props.workspace === "changes"}
          {...focusProps("changes")}
          onClick={() => props.onWorkspace("changes")}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); props.onWorkspace("changes"); } }}
        >
          <Icon name="changes" size={14} /><span>本地变更</span>{props.changeCount > 0 && <span className="tree-count">{props.changeCount}</span>}
        </div>
        <div className={`tree-item all-revisions${historySelected(null) ? " selected" : ""}`} role="treeitem" aria-selected={historySelected(null)} {...focusProps("history")} onClick={() => { props.onFilter(null); props.onWorkspace("history"); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); props.onFilter(null); props.onWorkspace("history"); } }}><Icon name="history" size={14} />全部提交</div>
        {group("local", "本地分支", local.length)}
        {(!collapsed.has("local") || !!query) && renderBranchTree(localTree, "branch")}
        {(!collapsed.has("local") || !!query) && local.length > refLimit && <button className="tree-more" onClick={() => setRefLimit((value) => value + 200)}>显示更多（还有 {local.length - refLimit} 个）</button>}
        {group("remote", "远程分支", remote.length)}
        {(!collapsed.has("remote") || !!query) && renderBranchTree(remoteTree, "remote")}
        {(!collapsed.has("remote") || !!query) && remote.length > refLimit && <button className="tree-more" onClick={() => setRefLimit((value) => value + 200)}>显示更多（还有 {remote.length - refLimit} 个）</button>}
        {group("tags", "标签", tags.length)}
        {(!collapsed.has("tags") || !!query) && tags.slice(0, refLimit).map((tag) => <div
          className={`tree-item${historySelected(tag.name) ? " selected" : ""}`}
          role="treeitem"
          aria-selected={historySelected(tag.name)}
          {...focusProps(`tag-${tag.name}`)}
          key={tag.name}
          title={tag.name}
          onClick={() => { props.onFilter(tag.name); props.onWorkspace("history"); }}
          onContextMenu={(e) => openMenu(e, { kind: "tag", name: tag.name })}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); props.onFilter(tag.name); props.onWorkspace("history"); }
            if (e.key === "F10" && e.shiftKey) { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setMenu({ kind: "tag", name: tag.name, x: r.left, y: r.bottom }); }
          }}
        ><Icon name="tag" size={14} /><span>{tag.name}</span></div>)}
        {(!collapsed.has("tags") || !!query) && tags.length > refLimit && <button className="tree-more" onClick={() => setRefLimit((value) => value + 200)}>显示更多（还有 {tags.length - refLimit} 个）</button>}
        {group("submodules", "Submodules", props.submodules.length)}
        {!collapsed.has("submodules") && props.submodules.map((module) => (
          <div className="tree-item" role="treeitem" {...focusProps(`submodule-${module.path}`)} key={module.path} title={`${module.path} · ${module.status}`} onClick={props.onSubmodules} onContextMenu={(e) => openSubmoduleMenu(e, module)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); props.onSubmodules(); } if (e.key === "F10" && e.shiftKey) { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setMenu({ kind: "submodule", name: module.path, path: module.path, x: r.left, y: r.bottom }); } }}>
            <Icon name="folder" size={14} /><span>{module.path}</span>{module.status !== "clean" && <span className="tree-count">{module.status}</span>}
          </div>
        ))}
        {!collapsed.has("submodules") && props.submodules.length === 0 && <div className="tree-empty">（无子模块）</div>}
        {group("worktrees", "Worktrees", props.worktrees.length)}
        {!collapsed.has("worktrees") && props.worktrees.map((worktree) => (
          <div className="tree-item" role="treeitem" {...focusProps(`worktree-${worktree.path}`)} key={worktree.path} title={worktree.path} onDoubleClick={() => props.onOpenWorktree(worktree.path)} onContextMenu={(e) => openWorktreeMenu(e, worktree)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); props.onOpenWorktree(worktree.path); } if (e.key === "F10" && e.shiftKey) { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setMenu({ kind: "worktree", name: worktree.name, path: worktree.path, x: r.left, y: r.bottom }); } }}>
            <Icon name="branch" size={14} /><span>{worktree.name}</span>{worktree.locked && <span className="tree-count">locked</span>}
          </div>
        ))}
        {!collapsed.has("worktrees") && props.worktrees.length === 0 && <div className="tree-empty">（无 linked worktree）</div>}
      </div>
      {props.conflictCount > 0 && <button className="conflict-entry" onClick={() => props.onWorkspace("changes")}><Icon name="conflict" />{props.conflictCount} 个冲突待解决</button>}
      <div className="left-panel-footer">
        <button onClick={props.onStash}><Icon name="stash" size={14} />Stash</button>
        <button onClick={props.onSubmodules}><Icon name="folder" size={14} />子模块</button>
        {props.onWorktrees && <button onClick={props.onWorktrees}><Icon name="branch" size={14} />Worktrees</button>}
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} ariaLabel={`${menu.name} 操作`} />}
    </aside>
  );
}
