import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getVersion } from "@tauri-apps/api/app";
import type { RepoInfo } from "../types";
import type { RepoGroupConfig } from "../repoGroups";
import {
  DEFAULT_GROUP_ID, isGroupActive, pinnedGroups, reorderPinned,
  toggleActiveGroup, togglePin,
} from "../repoGroups";
import type { SessionMeta } from "./RepositoryTabs";
import RepositoryTabs from "./RepositoryTabs";
import ContextMenu from "../ui/ContextMenu";
import type { MenuItem } from "../ui/ContextMenu";
import Dialog from "../ui/Dialog";
import Icon from "../ui/Icon";
import GroupAvatar from "./GroupAvatar";
import appIcon from "../../src-tauri/icons/32x32.png";

interface Props {
  repos: RepoInfo[];
  activePath: string | null;
  meta: Record<string, SessionMeta>;
  repoGroups: RepoGroupConfig;
  onActivate: (path: string) => void;
  onClose: (path: string) => void;
  onCloseOthers: (path: string) => void;
  onOpen: () => void;
  onClone: () => void;
  onCreate: () => void;
  onCommandPalette: () => void;
  onOpenRightOf: (path: string) => void;
  onSettings: () => void;
  onCopyPath: (path: string) => void;
  onReveal: (path: string) => void;
  onReorderRepo: (orderedPaths: string[]) => void;
  onRepoGroupsChange: (next: RepoGroupConfig) => void;
  onSetRepoAlias: (path: string, alias: string) => void;
  onManageGroups: () => void;
  onCloseWindow: () => void;
  recentRepos: string[];
  onOpenRecent: (path: string) => void;
}

const win = getCurrentWindow();

/** 自绘顶部栏：应用图标 + 仓库页签分组入口 + Pin 组图标 + 仓库页签 + 窗口控制。 */
export default function TitleBar(props: Props) {
  const [appMenu, setAppMenu] = useState<{ x: number; y: number } | null>(null);
  const [groupMenu, setGroupMenu] = useState<{ x: number; y: number } | null>(null);
  const [maximized, setMaximized] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [version, setVersion] = useState("");
  const [dragPin, setDragPin] = useState<string | null>(null);
  const appBtn = useRef<HTMLButtonElement>(null);
  const groupBtn = useRef<HTMLButtonElement>(null);
  const recentPaths = props.recentRepos.filter((path) => path.trim()).slice(0, 5);

  useEffect(() => {
    let disposed = false;
    void win.isMaximized().then((v) => { if (!disposed) setMaximized(v); });
    const unlisten = win.onResized(() => { void win.isMaximized().then((v) => { if (!disposed) setMaximized(v); }); });
    return () => { disposed = true; void unlisten.then((f) => f()); };
  }, []);

  useEffect(() => {
    let alive = true;
    void getVersion().then((value) => { if (alive) setVersion(value); }).catch(() => { /* 版本读取失败时显示占位符 */ });
    return () => { alive = false; };
  }, []);

  const config = props.repoGroups;
  const pinned = pinnedGroups(config);
  const onlyDefault = config.activeGroupIds.length === 1 && config.activeGroupIds[0] === DEFAULT_GROUP_ID;

  const openMenu = (setter: (v: { x: number; y: number } | null) => void, el: HTMLElement | null) => {
    if (!el) return;
    const r = el.getBoundingClientRect();
    setter({ x: r.left, y: r.bottom + 2 });
  };

  const groupMenuItems: MenuItem[] = [
    ...config.groups.map((g) => ({
      id: `switch-${g.id}`,
      label: g.name,
      color: g.color,
      checked: isGroupActive(config, g.id),
      keepOpen: true,
      trailingAction: {
        icon: "pin" as const,
        label: g.id === DEFAULT_GROUP_ID ? "Default 不可 Pin" : g.pinned ? `取消 Pin 分组 ${g.name}` : `Pin 分组 ${g.name} 到顶部栏`,
        checked: g.pinned,
        disabled: g.id === DEFAULT_GROUP_ID,
        keepOpen: true,
        onSelect: () => props.onRepoGroupsChange(togglePin(config, g.id)),
      },
      onSelect: () => props.onRepoGroupsChange(toggleActiveGroup(config, g.id)),
    })),
    { id: "sep-manage", separator: true },
    { id: "manage", label: "管理分组…", icon: "group" as const, onSelect: props.onManageGroups },
  ];

  const dropPin = (targetId: string) => {
    if (!dragPin || dragPin === targetId) { setDragPin(null); return; }
    const ids = pinned.map((g) => g.id);
    const from = ids.indexOf(dragPin);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) { setDragPin(null); return; }
    ids.splice(from, 1);
    ids.splice(to, 0, dragPin);
    props.onRepoGroupsChange(reorderPinned(config, ids));
    setDragPin(null);
  };

  return (
    <div className="title-bar" data-tauri-drag-region>
      <button
        ref={appBtn}
        className="title-app-icon"
        title="Git Extensions 菜单"
        aria-label="应用菜单"
        aria-haspopup="menu"
        aria-expanded={!!appMenu}
        onPointerDown={(event) => { if (appMenu) event.stopPropagation(); }}
        onClick={() => { if (appMenu) setAppMenu(null); else openMenu(setAppMenu, appBtn.current); }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown") return;
          event.preventDefault();
          openMenu(setAppMenu, appBtn.current);
        }}
      >
        <img src={appIcon} width={20} height={20} alt="" draggable={false} />
      </button>

      <div className="title-group-cluster">
        <button
          ref={groupBtn}
          className={`icon-button title-group-button${config && !onlyDefault ? " has-group" : ""}`}
          title="仓库页签分组（可多选）"
          aria-label="仓库页签分组"
          aria-haspopup="menu"
          aria-expanded={!!groupMenu}
          onPointerDown={(event) => { if (groupMenu) event.stopPropagation(); }}
          onClick={() => { if (groupMenu) setGroupMenu(null); else openMenu(setGroupMenu, groupBtn.current); }}
        >
          <Icon name="group" size={17} />
        </button>

        {pinned.length > 0 && (
          <div className="title-pinned" role="group" aria-label="已 Pin 的仓库页签分组">
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
                onClick={() => props.onRepoGroupsChange(toggleActiveGroup(config, g.id))}
                onKeyDown={(event) => {
                  if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
                    event.preventDefault();
                    const rect = event.currentTarget.getBoundingClientRect();
                    setGroupMenu({ x: rect.left, y: rect.bottom + 2 });
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  const r = e.currentTarget.getBoundingClientRect();
                  setGroupMenu({ x: r.left, y: r.bottom + 2 });
                }}
              >
                <GroupAvatar id={g.id} name={g.name} color={g.color} size={22} active={isGroupActive(config, g.id)} />
              </button>
            ))}
          </div>
        )}
      </div>

      <RepositoryTabs
        repos={props.repos}
        activePath={props.activePath}
        meta={props.meta}
        repoGroups={config}
        onSetAlias={props.onSetRepoAlias}
        onActivate={props.onActivate}
        onClose={props.onClose}
        onCloseOthers={props.onCloseOthers}
        onOpen={props.onOpen}
        onOpenRightOf={props.onOpenRightOf}
        onCopyPath={props.onCopyPath}
        onReveal={props.onReveal}
        onReorder={props.onReorderRepo}
        onBlankContextMenu={(x, y) => setAppMenu({ x, y })}
      />

      <div className="title-window-controls">
        <button className="title-win-btn" title="最小化" aria-label="最小化" onClick={() => void win.minimize()}><Icon name="minimize" size={15} /></button>
        <button className="title-win-btn" title={maximized ? "还原" : "最大化"} aria-label={maximized ? "还原" : "最大化"} onClick={() => void win.toggleMaximize()}>{maximized ? <Icon name="restore" size={14} /> : <Icon name="maximize" size={14} />}</button>
        <button className="title-win-btn title-win-close" title="关闭" aria-label="关闭" onClick={props.onCloseWindow}><Icon name="close" size={15} /></button>
      </div>

      {appMenu && (
        <ContextMenu x={appMenu.x} y={appMenu.y} onClose={() => setAppMenu(null)} ariaLabel="应用菜单" items={[
          { id: "open", label: "打开仓库…", icon: "plus", shortcut: "Ctrl+O", onSelect: props.onOpen },
          { id: "clone", label: "克隆仓库…", icon: "fetch", onSelect: props.onClone },
          { id: "create", label: "新建仓库…", icon: "folder", onSelect: props.onCreate },
          { id: "palette", label: "命令面板…", icon: "search", shortcut: "Ctrl+K", onSelect: props.onCommandPalette },
          { id: "settings", label: "设置…", icon: "settings", shortcut: "Ctrl+,", onSelect: props.onSettings },
          { id: "sep-app", separator: true },
          { id: "about", label: "关于 Git Extensions…", onSelect: () => setAboutOpen(true) },
          ...(recentPaths.length > 0 ? [
            { id: "sep-recent", separator: true },
            ...recentPaths.map((path) => ({
              id: `recent-${path}`,
              label: `最近打开：${path.split(/[\\/]/).filter(Boolean).pop() ?? path}`,
              title: path,
              icon: "history" as const,
              onSelect: () => props.onOpenRecent(path),
            })),
          ] : []),
          { id: "sep-exit", separator: true },
          { id: "close-window", label: "关闭窗口", shortcut: "Alt+F4", danger: true, onSelect: props.onCloseWindow },
        ]} />
      )}
      {groupMenu && (
        <ContextMenu x={groupMenu.x} y={groupMenu.y} onClose={() => setGroupMenu(null)} ariaLabel="仓库页签分组" items={groupMenuItems} />
      )}
      {aboutOpen && (
        <Dialog title="关于 Git Extensions" onClose={() => setAboutOpen(false)} footer={<button className="primary" onClick={() => setAboutOpen(false)}>关闭</button>}>
          <div className="about-app">
            <img src={appIcon} width={48} height={48} alt="" />
            <div>
              <h4>Git Extensions</h4>
              <p className="panel-hint">版本 {version || "—"}</p>
            </div>
          </div>
          <p className="panel-hint">本地 Git 仓库浏览与操作工具，基于 Tauri 2、Rust 与 React 构建。</p>
        </Dialog>
      )}
    </div>
  );
}
