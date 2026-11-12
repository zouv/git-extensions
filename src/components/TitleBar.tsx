import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getVersion } from "@tauri-apps/api/app";
import type { RepoInfo } from "../types";
import type { RepoGroupConfig } from "../repoGroups";
import type { SessionMeta } from "./RepositoryTabs";
import RepositoryTabs from "./RepositoryTabs";
import ContextMenu from "../ui/ContextMenu";
import Dialog from "../ui/Dialog";
import Icon from "../ui/Icon";
import RepositoryGroupNav from "./RepositoryGroupNav";
import appIcon from "../../src-tauri/icons/32x32.png";
import aboutIcon from "../../src-tauri/icons/128x128.png";

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
  onManageGroups?: () => void;
  onSearchRepositories: () => void;
  onManageRepoGroups: (groupId?: string) => void;
  onCloseWindow: () => void;
  recentRepos: string[];
  onOpenRecent: (path: string) => void;
}

const win = getCurrentWindow();

/** 同行自绘顶部栏：应用 / 组入口 / Pin 图标 / 打开页签 / 查找与窗口控制。 */
export default function TitleBar(props: Props) {
  const [appMenu, setAppMenu] = useState<{ x: number; y: number } | null>(null);
  const [maximized, setMaximized] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [version, setVersion] = useState("");
  const appBtn = useRef<HTMLButtonElement>(null);
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

  const openMenu = (setter: (v: { x: number; y: number } | null) => void, el: HTMLElement | null) => {
    if (!el) return;
    const r = el.getBoundingClientRect();
    setter({ x: r.left, y: r.bottom + 2 });
  };

  return (
    <div className="title-bar repository-navigation-title">
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

        <RepositoryGroupNav config={config} onChange={props.onRepoGroupsChange} onManage={props.onManageRepoGroups ?? props.onManageGroups ?? (() => {})} />
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
      <button type="button" className="title-repo-search" title="查找仓库" aria-label="查找仓库" onClick={props.onSearchRepositories}>
        <Icon name="search" size={16} />
      </button>
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
      {aboutOpen && (
        <Dialog title="关于 Git Extensions" className="about-dialog" onClose={() => setAboutOpen(false)} footer={<button className="primary" onClick={() => setAboutOpen(false)}>关闭</button>}>
          <div className="about-app">
            <img className="about-app-icon" src={aboutIcon} width={64} height={64} alt="" />
            <div className="about-app-info">
              <h4>Git Extensions</h4>
              <p className="about-app-meta">版本 {version || "—"} · 作者 @zouv</p>
              <p className="about-app-desc">本地 Git 仓库浏览与操作工具。<br />基于 Tauri 2、Rust 与 React 构建。</p>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
