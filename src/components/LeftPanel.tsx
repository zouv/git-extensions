import { useState } from "react";
import type { BranchInfo, TagInfo } from "../types";
import Icon from "../ui/Icon";
import ContextMenu from "../ui/ContextMenu";
import type { MenuItem } from "../ui/ContextMenu";

interface Props {
  branches: BranchInfo[];
  tags: TagInfo[];
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
}

type MenuTarget = { x: number; y: number; kind: "branch" | "remote" | "tag"; name: string; branch?: BranchInfo };

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

  const group = (id: string, label: string, count: number) => (
    <button className="tree-group" onClick={() => toggle(id)} aria-expanded={!collapsed.has(id)}><Icon name="chevron-down" size={12} /><span>{label}</span><span className="tree-count">{count}</span></button>
  );
  const openMenu = (event: React.MouseEvent, target: Omit<MenuTarget, "x" | "y">) => {
    event.preventDefault();
    setMenu({ ...target, x: event.clientX, y: event.clientY });
  };
  const refRow = (name: string, kind: "branch" | "remote", branch: BranchInfo) => (
    <div
      className={`tree-item${props.activeRef === name ? " selected" : ""}`}
      role="treeitem"
      aria-selected={props.activeRef === name}
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

  const menuItems: MenuItem[] = menu ? [
    ...(menu.kind === "branch" ? [
      { id: "checkout", label: "切换分支", icon: "branch" as const, disabled: menu.branch?.isHead, onSelect: () => props.onCheckout(menu.name) },
      { id: "new", label: "基于此新建分支…", icon: "plus" as const, onSelect: () => props.onNewBranch(menu.name) },
    ] : []),
    { id: "compare", label: "与当前分支对比", icon: "compare", onSelect: () => props.onCompare(menu.name) },
    { id: "copy", label: "复制名称", icon: "copy", onSelect: () => { void navigator.clipboard?.writeText(menu.name); } },
    ...(menu.kind === "branch" ? [{ id: "sep", separator: true }, { id: "delete", label: "删除分支…", icon: "close" as const, danger: true, disabled: menu.branch?.isHead, onSelect: () => { if (menu.branch) props.onDeleteBranch(menu.branch); } }] : []),
    ...(menu.kind === "tag" ? [{ id: "sep-tag", separator: true }, { id: "delete-tag", label: "删除标签…", icon: "close" as const, danger: true, onSelect: () => props.onDeleteTag(menu.name) }] : []),
  ] : [];

  return (
    <aside className="left-panel" style={{ width: props.width }}>
      <div className="workspace-switch" role="tablist" aria-label="工作区">
        <button role="tab" aria-selected={props.workspace === "history"} className={props.workspace === "history" ? "active" : ""} onClick={() => props.onWorkspace("history")}><Icon name="history" />历史</button>
        <button role="tab" aria-selected={props.workspace === "changes"} className={props.workspace === "changes" ? "active" : ""} onClick={() => props.onWorkspace("changes")}><Icon name="changes" />变更{props.changeCount > 0 && <span className="count-badge">{props.changeCount}</span>}</button>
      </div>
      <div className="tree-items" role="tree" aria-label="仓库引用">
        <div className={`tree-item all-revisions${props.activeRef === null ? " selected" : ""}`} role="treeitem" tabIndex={0} onClick={() => { props.onFilter(null); props.onWorkspace("history"); }}><Icon name="history" size={14} />全部提交</div>
        {group("local", "本地分支", local.length)}
        {!collapsed.has("local") && local.map((b) => refRow(b.name, "branch", b))}
        {group("remote", "远程分支", remote.length)}
        {!collapsed.has("remote") && remote.map((b) => refRow(b.name, "remote", b))}
        {group("tags", "标签", props.tags.length)}
        {!collapsed.has("tags") && props.tags.map((tag) => <div className={`tree-item${props.activeRef === tag.name ? " selected" : ""}`} role="treeitem" tabIndex={0} key={tag.name} title={tag.name} onClick={() => { props.onFilter(tag.name); props.onWorkspace("history"); }} onContextMenu={(e) => openMenu(e, { kind: "tag", name: tag.name })}><Icon name="tag" size={14} /><span>{tag.name}</span></div>)}
        <div className="tree-section-actions">
          <button onClick={props.onStash}><Icon name="stash" size={14} />Stash</button>
          <button onClick={props.onSubmodules}><Icon name="folder" size={14} />子模块</button>
        </div>
      </div>
      {props.conflictCount > 0 && <button className="conflict-entry" onClick={() => props.onWorkspace("changes")}><Icon name="conflict" />{props.conflictCount} 个冲突待解决</button>}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
    </aside>
  );
}
