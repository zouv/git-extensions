import { useState } from "react";
import type { CSSProperties } from "react";
import type { RepoInfo } from "../types";
import { displayRepoName, groupById, groupForRepo } from "../repoGroups";
import type { RepoGroupConfig } from "../repoGroups";
import type { IconName } from "../ui/Icon";
import Icon from "../ui/Icon";
import ContextMenu from "../ui/ContextMenu";
import Dialog from "../ui/Dialog";

export interface SessionMeta { busy: boolean; dirty: boolean; conflictCount: number }

interface Props {
  repos: RepoInfo[];
  activePath: string | null;
  meta: Record<string, SessionMeta>;
  repoGroups: RepoGroupConfig;
  onSetAlias: (path: string, alias: string) => void;
  onActivate: (path: string) => void;
  onClose: (path: string) => void;
  onCloseOthers: (path: string) => void;
  onOpen: () => void;
  onCopyPath: (path: string) => void;
  onReveal: (path: string) => void;
  onReorder: (fromPath: string, toPath: string) => void;
}

export default function RepositoryTabs(props: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number; repo: RepoInfo } | null>(null);
  const [dragPath, setDragPath] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [aliasTarget, setAliasTarget] = useState<RepoInfo | null>(null);
  const [aliasValue, setAliasValue] = useState("");
  const label = (repo: RepoInfo) => displayRepoName(props.repoGroups, repo);

  const drop = (targetPath: string) => {
    if (dragPath && dragPath !== targetPath) props.onReorder(dragPath, targetPath);
    setDragPath(null);
    setDropTarget(null);
  };

  return (
    <div className="repository-tabs" data-tauri-drag-region>
      <div className="repository-tab-scroll" role="tablist" aria-label="打开的仓库" data-tauri-drag-region>
        {props.repos.map((repo) => {
          const state = props.meta[repo.path];
          const group = groupById(props.repoGroups, groupForRepo(props.repoGroups, repo.path))!;
          const style = { "--repo-group-color": group.color } as CSSProperties;
          const pathTitle = props.repoGroups.aliases[repo.path] ? `${label(repo)}（${repo.path}）` : repo.path;
          return (
            <div
              className={`repository-tab${repo.path === props.activePath ? " active" : ""}${dragPath === repo.path ? " dragging" : ""}${dropTarget === repo.path && dragPath !== repo.path ? " drop-target" : ""}`}
              key={repo.path}
              role="tab"
              aria-selected={repo.path === props.activePath}
              tabIndex={repo.path === props.activePath ? 0 : -1}
              title={`${pathTitle} · 分组：${group.name}`}
              style={style}
              draggable
              onDragStart={() => setDragPath(repo.path)}
              onDragEnd={() => { setDragPath(null); setDropTarget(null); }}
              onDragOver={(e) => { e.preventDefault(); setDropTarget(repo.path); }}
              onDragLeave={() => setDropTarget((prev) => prev === repo.path ? null : prev)}
              onDrop={() => drop(repo.path)}
              onClick={() => props.onActivate(repo.path)}
              onAuxClick={(e) => { if (e.button === 1) props.onClose(repo.path); }}
              onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, repo }); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") props.onActivate(repo.path); }}
            >
              <Icon name="folder" />
              <span className="repository-tab-name">{label(repo)}</span>
              {state?.busy ? <span className="spinner" aria-label="操作中" /> : state?.conflictCount ? <span className="tab-badge conflict">{state.conflictCount}</span> : state?.dirty ? <span className="dirty-dot" title="有未保存草稿" /> : null}
              <button className="tab-close" aria-label={`关闭 ${label(repo)}`} title={state?.busy ? "操作进行中，暂不能关闭" : "关闭仓库"} disabled={state?.busy} onClick={(e) => { e.stopPropagation(); props.onClose(repo.path); }}><Icon name="close" size={13} /></button>
            </div>
          );
        })}
      </div>
      <button className="icon-button repository-add" title="打开仓库 (Ctrl+O)" aria-label="打开仓库" onClick={props.onOpen}><Icon name="plus" /></button>
      {menu && <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={[
        { id: "open", label: "打开仓库…", icon: "plus" as IconName, onSelect: props.onOpen },
        { id: "alias", label: "设置页签显示名…", icon: "edit" as IconName, onSelect: () => { setAliasValue(props.repoGroups.aliases[menu.repo.path] ?? ""); setAliasTarget(menu.repo); } },
        { id: "sep-alias", separator: true },
        { id: "close", label: "关闭", icon: "close" as IconName, disabled: props.meta[menu.repo.path]?.busy, title: props.meta[menu.repo.path]?.busy ? "操作进行中" : undefined, onSelect: () => props.onClose(menu.repo.path) },
        { id: "close-others", label: "关闭其它", disabled: props.repos.length < 2, onSelect: () => props.onCloseOthers(menu.repo.path) },
        { id: "sep", separator: true },
        { id: "copy", label: "复制路径", icon: "copy" as IconName, onSelect: () => props.onCopyPath(menu.repo.path) },
        { id: "reveal", label: "在文件管理器中显示", icon: "external" as IconName, onSelect: () => props.onReveal(menu.repo.path) },
      ]} />}
      {aliasTarget && (
        <Dialog
          title={`设置页签显示名 · ${aliasTarget.name}`}
          onClose={() => setAliasTarget(null)}
          footer={<>
            <button onClick={() => setAliasTarget(null)}>取消</button>
            <button disabled={!props.repoGroups.aliases[aliasTarget.path]} onClick={() => { props.onSetAlias(aliasTarget.path, ""); setAliasTarget(null); }}>恢复仓库名</button>
            <button className="primary" onClick={() => { props.onSetAlias(aliasTarget.path, aliasValue); setAliasTarget(null); }}>保存</button>
          </>}
        >
          <div className="branch-create">
            <input
              data-autofocus
              placeholder="页签显示名（空 = 仓库名）"
              value={aliasValue}
              onChange={(e) => setAliasValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { props.onSetAlias(aliasTarget.path, aliasValue); setAliasTarget(null); }
                if (e.key === "Escape") setAliasTarget(null);
              }}
            />
          </div>
          <p className="panel-hint">别名只改变页签显示，不影响仓库路径与 Git 操作。</p>
        </Dialog>
      )}
    </div>
  );
}
