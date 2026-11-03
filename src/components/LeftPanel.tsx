import { useState } from "react";
import type { BranchInfo, SubmoduleInfo, TagInfo, WorktreeInfo } from "../types";
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
  onCompare: (ref: string) => void;
  onNewBranch: (startPoint: string) => void;
  onDeleteBranch: (branch: BranchInfo) => void;
  onDeleteTag: (name: string) => void;
  onStash: () => void;
  onSubmodules: () => void;
  onCopyPath: (path: string) => void;
  onRevealPath: (path: string) => void;
}

type RefMenuTarget = { x: number; y: number; kind: "branch" | "remote" | "tag"; name: string; branch?: BranchInfo };
type WorktreeMenuTarget = { x: number; y: number; kind: "worktree"; name: string; path: string };
type MenuTarget = RefMenuTarget | WorktreeMenuTarget;

export default function LeftPanel(props: Props) {
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const local = props.branches.filter((b) => !b.isRemote);
  const remote = props.branches.filter((b) => b.isRemote);
  const toggle = (name: string) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });
  const historySelected = (name: string | null) => props.workspace === "history" && props.activeRef === name;

  const group = (id: string, label: string, count: number) => (
    <button className="tree-group" onClick={() => toggle(id)} aria-expanded={!collapsed.has(id)}><Icon name="chevron-down" size={12} /><span>{label}</span><span className="tree-count">{count}</span></button>
  );
  const openMenu = (event: React.MouseEvent, target: Omit<RefMenuTarget, "x" | "y">) => {
    event.preventDefault();
    setMenu({ ...target, x: event.clientX, y: event.clientY });
  };
  const openWorktreeMenu = (event: React.MouseEvent, worktree: WorktreeInfo) => {
    event.preventDefault();
    setMenu({ kind: "worktree", name: worktree.name, path: worktree.path, x: event.clientX, y: event.clientY });
  };
  const refRow = (name: string, kind: "branch" | "remote", branch: BranchInfo) => (
    <div
      className={`tree-item${historySelected(name) ? " selected" : ""}`}
      role="treeitem"
      aria-selected={historySelected(name)}
      tabIndex={0}
      key={name}
      title={name}
      onClick={() => { props.onFilter(name); props.onWorkspace("history"); }}
      onDoubleClick={() => { if (kind === "branch" && !branch.isHead) props.onCheckout(name); }}
      onContextMenu={(e) => openMenu(e, { kind, name, branch })}
      onKeyDown={(e) => {
        if (e.key === "Enter") { props.onFilter(name); props.onWorkspace("history"); }
        if (e.key === "F10" && e.shiftKey) { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setMenu({ kind, name, branch, x: r.left, y: r.bottom }); }
      }}
    >
      <Icon name={kind === "branch" ? "branch" : "fetch"} size={14} />
      <span className={branch.isHead ? "branch-head" : ""}>{name}</span>
      {branch.isHead && <span className="head-marker">HEAD</span>}
    </div>
  );

  const menuItems: MenuItem[] = (() => {
    if (!menu) return [];
    if (menu.kind === "worktree") return [
      { id: "copy", label: "复制路径", icon: "copy", onSelect: () => props.onCopyPath(menu.path) },
      { id: "reveal", label: "在文件管理器中显示", icon: "external", onSelect: () => props.onRevealPath(menu.path) },
    ];
    return [
      ...(menu.kind === "branch" ? [
        { id: "checkout", label: "切换分支", icon: "branch" as const, disabled: menu.branch?.isHead, onSelect: () => props.onCheckout(menu.name) },
        { id: "new", label: "基于此新建分支…", icon: "plus" as const, onSelect: () => props.onNewBranch(menu.name) },
      ] : []),
      { id: "compare", label: "与当前分支对比", icon: "compare" as const, onSelect: () => props.onCompare(menu.name) },
      { id: "copy", label: "复制名称", icon: "copy" as const, onSelect: () => { void navigator.clipboard?.writeText(menu.name); } },
      ...(menu.kind === "branch" ? [{ id: "sep", separator: true }, { id: "delete", label: "删除分支…", icon: "close" as const, danger: true, disabled: menu.branch?.isHead, onSelect: () => { if (menu.branch) props.onDeleteBranch(menu.branch); } }] : []),
      ...(menu.kind === "tag" ? [{ id: "sep-tag", separator: true }, { id: "delete-tag", label: "删除标签…", icon: "close" as const, danger: true, onSelect: () => props.onDeleteTag(menu.name) }] : []),
    ];
  })();

  return (
    <aside className="left-panel" style={{ width: props.width }}>
      <div className="tree-items" role="tree" aria-label="仓库引用">
        <div
          className={`tree-item local-changes${props.workspace === "changes" ? " selected" : ""}`}
          role="treeitem"
          aria-selected={props.workspace === "changes"}
          tabIndex={0}
          onClick={() => props.onWorkspace("changes")}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); props.onWorkspace("changes"); } }}
        >
          <Icon name="changes" size={14} /><span>本地变更</span>{props.changeCount > 0 && <span className="tree-count">{props.changeCount}</span>}
        </div>
        <div className={`tree-item all-revisions${historySelected(null) ? " selected" : ""}`} role="treeitem" aria-selected={historySelected(null)} tabIndex={0} onClick={() => { props.onFilter(null); props.onWorkspace("history"); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); props.onFilter(null); props.onWorkspace("history"); } }}><Icon name="history" size={14} />全部提交</div>
        {group("local", "本地分支", local.length)}
        {!collapsed.has("local") && local.map((b) => refRow(b.name, "branch", b))}
        {group("remote", "远程分支", remote.length)}
        {!collapsed.has("remote") && remote.map((b) => refRow(b.name, "remote", b))}
        {group("tags", "标签", props.tags.length)}
        {!collapsed.has("tags") && props.tags.map((tag) => <div className={`tree-item${historySelected(tag.name) ? " selected" : ""}`} role="treeitem" aria-selected={historySelected(tag.name)} tabIndex={0} key={tag.name} title={tag.name} onClick={() => { props.onFilter(tag.name); props.onWorkspace("history"); }} onContextMenu={(e) => openMenu(e, { kind: "tag", name: tag.name })}><Icon name="tag" size={14} /><span>{tag.name}</span></div>)}
        {group("submodules", "Submodules", props.submodules.length)}
        {!collapsed.has("submodules") && props.submodules.map((module) => (
          <div className="tree-item" role="treeitem" tabIndex={0} key={module.path} title={`${module.path} · ${module.status}`} onClick={props.onSubmodules} onKeyDown={(e) => { if (e.key === "Enter") props.onSubmodules(); }}>
            <Icon name="folder" size={14} /><span>{module.path}</span>{module.status !== "clean" && <span className="tree-count">{module.status}</span>}
          </div>
        ))}
        {!collapsed.has("submodules") && props.submodules.length === 0 && <div className="tree-empty">（无子模块）</div>}
        {group("worktrees", "Worktrees", props.worktrees.length)}
        {!collapsed.has("worktrees") && props.worktrees.map((worktree) => (
          <div className="tree-item" role="treeitem" tabIndex={0} key={worktree.path} title={worktree.path} onContextMenu={(e) => openWorktreeMenu(e, worktree)} onKeyDown={(e) => { if (e.key === "F10" && e.shiftKey) { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setMenu({ kind: "worktree", name: worktree.name, path: worktree.path, x: r.left, y: r.bottom }); } }}>
            <Icon name="branch" size={14} /><span>{worktree.name}</span>{worktree.locked && <span className="tree-count">locked</span>}
          </div>
        ))}
        {!collapsed.has("worktrees") && props.worktrees.length === 0 && <div className="tree-empty">（无 linked worktree）</div>}
      </div>
      {props.conflictCount > 0 && <button className="conflict-entry" onClick={() => props.onWorkspace("changes")}><Icon name="conflict" />{props.conflictCount} 个冲突待解决</button>}
      <div className="left-panel-footer">
        <button onClick={props.onStash}><Icon name="stash" size={14} />Stash</button>
        <button onClick={props.onSubmodules}><Icon name="folder" size={14} />子模块</button>
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
    </aside>
  );
}
