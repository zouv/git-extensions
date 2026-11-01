import type { AheadBehind, RepoInfo } from "../types";
import Icon from "../ui/Icon";
import type { IconName } from "../ui/Icon";

interface Props {
  repo: RepoInfo;
  loading: boolean;
  busy: boolean;
  revisionCount: number;
  aheadBehind: AheadBehind | null;
  filter: string;
  workspace: "history" | "changes";
  inspectorVisible: boolean;
  onFilter: (value: string) => void;
  onOpen: () => void;
  onRefresh: () => void;
  onToggleLeft: () => void;
  onToggleInspector: () => void;
  onBranches: () => void;
  onStash: () => void;
  onTags: () => void;
  onSubmodules: () => void;
  onSettings: () => void;
  onRecovery: () => void;
  onCompare: () => void;
  onRemote: (kind: "fetch" | "pull" | "push") => void;
}

function ToolButton({ icon, label, title, onClick, disabled = false, primary = false }: { icon: IconName; label?: string; title: string; onClick: () => void; disabled?: boolean; primary?: boolean }) {
  return <button className={`tool-button${primary ? " primary" : ""}`} title={title} aria-label={label ?? title} disabled={disabled} onClick={onClick}><Icon name={icon} />{label && <span>{label}</span>}</button>;
}

export default function Toolbar(props: Props) {
  const { repo, loading, busy, revisionCount, aheadBehind, filter } = props;
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
        <div className="filter-box"><Icon name="search" /><input className="revision-filter" aria-label="过滤提交" placeholder="过滤提交… (Ctrl+F)" value={filter} onChange={(e) => props.onFilter(e.target.value)} />{filter && <button aria-label="清除过滤" onClick={() => props.onFilter("")}><Icon name="close" size={12} /></button>}</div>
      </>}
      <span className="revision-count" title="当前提交数量">{revisionCount.toLocaleString()} 条</span>
      <ToolButton icon="panel" title="显示 / 隐藏检查器" onClick={props.onToggleInspector} primary={props.inspectorVisible} />
      <ToolButton icon="settings" title="设置与快捷键 (Ctrl+,)" onClick={props.onSettings} />
      <div className="toolbar-overflow">
        <ToolButton icon="history" title="恢复历史：HEAD 备份与 reflog" disabled={busy} onClick={props.onRecovery} />
        <ToolButton icon="stash" title="Stash (Ctrl+Shift+S)" disabled={busy} onClick={props.onStash} />
        <ToolButton icon="tag" title="标签 (Ctrl+Shift+T)" disabled={busy} onClick={props.onTags} />
        <ToolButton icon="more" title="子模块 (Ctrl+Shift+M)" disabled={busy} onClick={props.onSubmodules} />
      </div>
    </div>
  );
}
