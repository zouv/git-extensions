import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { RepoInfo } from "../types";
import type { TagGroupConfig } from "../tagGroups";
import {
  DEFAULT_GROUP_ID, isGroupActive, pinnedGroups, reorderPinned, setActiveGroups,
  toggleActiveGroup,
} from "../tagGroups";
import type { SessionMeta } from "./RepositoryTabs";
import RepositoryTabs from "./RepositoryTabs";
import ContextMenu from "../ui/ContextMenu";
import type { MenuItem } from "../ui/ContextMenu";
import Icon from "../ui/Icon";
import GroupAvatar from "./GroupAvatar";
import appIcon from "../../src-tauri/icons/32x32.png";

interface Props {
  repos: RepoInfo[];
  activePath: string | null;
  meta: Record<string, SessionMeta>;
  tagGroups: TagGroupConfig | null;
  onActivate: (path: string) => void;
  onClose: (path: string) => void;
  onCloseOthers: (path: string) => void;
  onOpen: () => void;
  onSettings: () => void;
  onCopyPath: (path: string) => void;
  onReveal: (path: string) => void;
  onReorderRepo: (fromPath: string, toPath: string) => void;
  onTagGroupsChange: (next: TagGroupConfig) => void;
  onManageGroups: () => void;
  onCloseWindow: () => void;
}

const win = getCurrentWindow();

/** 自绘顶部栏：应用图标 + 分组入口 + Pin 组图标 + 仓库页签 + 窗口控制。 */
export default function TitleBar(props: Props) {
  const [appMenu, setAppMenu] = useState<{ x: number; y: number } | null>(null);
  const [groupMenu, setGroupMenu] = useState<{ x: number; y: number } | null>(null);
  const [maximized, setMaximized] = useState(false);
  const [dragPin, setDragPin] = useState<string | null>(null);
  const appBtn = useRef<HTMLButtonElement>(null);
  const groupBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let disposed = false;
    void win.isMaximized().then((v) => { if (!disposed) setMaximized(v); });
    const unlisten = win.onResized(() => { void win.isMaximized().then((v) => { if (!disposed) setMaximized(v); }); });
    return () => { disposed = true; void unlisten.then((f) => f()); };
  }, []);

  const config = props.tagGroups;
  const pinned = config ? pinnedGroups(config) : [];
  const activeGroupIds = config?.activeGroupIds ?? [DEFAULT_GROUP_ID];
  const onlyDefault = activeGroupIds.length === 1 && activeGroupIds[0] === DEFAULT_GROUP_ID;

  const openMenu = (setter: (v: { x: number; y: number } | null) => void, el: HTMLElement | null) => {
    if (!el) return;
    const r = el.getBoundingClientRect();
    setter({ x: r.left, y: r.bottom + 2 });
  };

  const groupMenuItems: MenuItem[] = config ? [
    ...config.groups.map((g) => ({
      id: `switch-${g.id}`,
      label: g.name,
      checked: isGroupActive(config, g.id),
      onSelect: () => props.onTagGroupsChange(toggleActiveGroup(config, g.id)),
    })),
    { id: "sep-quick", separator: true },
    { id: "show-all", label: "显示全部组", icon: "group" as const, onSelect: () => props.onTagGroupsChange(setActiveGroups(config, config.groups.map((g) => g.id))) },
    { id: "show-default", label: "仅显示 Default", onSelect: () => props.onTagGroupsChange(setActiveGroups(config, [DEFAULT_GROUP_ID])) },
    { id: "sep-manage", separator: true },
    { id: "manage", label: "管理分组…", icon: "group" as const, onSelect: props.onManageGroups },
  ] : [];

  const dropPin = (targetId: string) => {
    if (!config || !dragPin || dragPin === targetId) { setDragPin(null); return; }
    const ids = pinned.map((g) => g.id);
    const from = ids.indexOf(dragPin);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) { setDragPin(null); return; }
    ids.splice(from, 1);
    ids.splice(to, 0, dragPin);
    props.onTagGroupsChange(reorderPinned(config, ids));
    setDragPin(null);
  };

  return (
    <div className="title-bar" data-tauri-drag-region>
      <button
        ref={appBtn}
        className="title-app-icon"
        title="Git Extensions 菜单"
        aria-label="应用菜单"
        onClick={() => openMenu(setAppMenu, appBtn.current)}
      >
        <img src={appIcon} width={20} height={20} alt="" draggable={false} />
      </button>

      <button
        ref={groupBtn}
        className={`icon-button title-group-button${config && !onlyDefault ? " has-group" : ""}`}
        title="标签分组（可多选）"
        aria-label="标签分组"
        disabled={!config}
        onClick={() => openMenu(setGroupMenu, groupBtn.current)}
      >
        <Icon name="group" size={17} />
      </button>

      {config && pinned.length > 0 && (
        <div className="title-pinned" role="group" aria-label="已 Pin 的分组">
          {pinned.map((g) => (
            <button
              key={g.id}
              className={`title-pin${isGroupActive(config, g.id) ? " active" : ""}${dragPin === g.id ? " dragging" : ""}`}
              title={`${g.name}（左键切换显示，右键分组菜单，可拖拽排序）`}
              aria-label={`分组 ${g.name}`}
              aria-pressed={isGroupActive(config, g.id)}
              draggable
              onDragStart={() => setDragPin(g.id)}
              onDragEnd={() => setDragPin(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => dropPin(g.id)}
              onClick={() => props.onTagGroupsChange(toggleActiveGroup(config, g.id))}
              onContextMenu={(e) => {
                e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect();
                setGroupMenu({ x: r.left, y: r.bottom + 2 });
              }}
            >
              <GroupAvatar id={g.id} name={g.name} size={22} active={isGroupActive(config, g.id)} />
            </button>
          ))}
        </div>
      )}

      <RepositoryTabs
        repos={props.repos}
        activePath={props.activePath}
        meta={props.meta}
        onActivate={props.onActivate}
        onClose={props.onClose}
        onCloseOthers={props.onCloseOthers}
        onOpen={props.onOpen}
        onCopyPath={props.onCopyPath}
        onReveal={props.onReveal}
        onReorder={props.onReorderRepo}
      />

      <div className="title-window-controls">
        <button className="title-win-btn" title="最小化" aria-label="最小化" onClick={() => void win.minimize()}><Icon name="minimize" size={15} /></button>
        <button className="title-win-btn" title={maximized ? "还原" : "最大化"} aria-label={maximized ? "还原" : "最大化"} onClick={() => void win.toggleMaximize()}><Icon name={maximized ? "restore" : "maximize"} size={14} /></button>
        <button className="title-win-btn title-win-close" title="关闭" aria-label="关闭" onClick={props.onCloseWindow}><Icon name="close" size={15} /></button>
      </div>

      {appMenu && (
        <ContextMenu x={appMenu.x} y={appMenu.y} onClose={() => setAppMenu(null)} ariaLabel="应用菜单" items={[
          { id: "open", label: "打开仓库…", icon: "plus", onSelect: props.onOpen },
          { id: "settings", label: "设置", icon: "settings", onSelect: props.onSettings },
        ]} />
      )}
      {groupMenu && config && (
        <ContextMenu x={groupMenu.x} y={groupMenu.y} onClose={() => setGroupMenu(null)} ariaLabel="标签分组" items={groupMenuItems} />
      )}
    </div>
  );
}
