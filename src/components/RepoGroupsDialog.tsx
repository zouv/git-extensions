import { useRef, useState } from "react";
import type { RepoInfo } from "../types";
import type { RepoGroupConfig } from "../repoGroups";
import {
  DEFAULT_GROUP_ID, GROUP_COLOR_PRESETS, createGroup, deleteGroup, displayRepoName, groupById,
  renameGroup, reposInGroup, setGroupColor, setRepoAlias, setRepoGroup, togglePin,
} from "../repoGroups";
import Dialog from "../ui/Dialog";
import Icon from "../ui/Icon";
import GroupAvatar from "./GroupAvatar";

interface Props {
  config: RepoGroupConfig;
  repos: RepoInfo[];
  onChange: (next: RepoGroupConfig) => void;
  onClose: () => void;
}

/** 仓库页签分组管理器：组的 CRUD / Pin，以及逐页签更换分组与编辑显示名。 */
export default function RepoGroupsDialog({ config, repos, onChange, onClose }: Props) {
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string; repos: string[]; closedCount: number } | null>(null);
  const [aliasDrafts, setAliasDrafts] = useState<Record<string, string>>({});
  const skipAliasBlur = useRef<string | null>(null);

  const submitRename = (groupId: string) => {
    const next = renameGroup(config, groupId, renameValue);
    onChange(next);
    setRenaming(null);
  };

  const beginDelete = (groupId: string) => {
    const group = groupById(config, groupId);
    if (!group || groupId === DEFAULT_GROUP_ID) return;
    const members = reposInGroup(config, repos, groupId);
    const assignedCount = Object.values(config.assignments).filter((id) => id === groupId).length;
    setPendingDelete({
      id: groupId,
      name: group.name,
      repos: members.map((repo) => displayRepoName(config, repo)),
      closedCount: Math.max(0, assignedCount - members.length),
    });
  };

  const saveAlias = (repoPath: string) => {
    const draft = aliasDrafts[repoPath];
    if (draft === undefined) return;
    onChange(setRepoAlias(config, repoPath, draft));
    setAliasDrafts((prev) => {
      const next = { ...prev };
      delete next[repoPath];
      return next;
    });
  };
  const cancelAlias = (repoPath: string) => {
    skipAliasBlur.current = repoPath;
    setAliasDrafts((prev) => {
      const next = { ...prev };
      delete next[repoPath];
      return next;
    });
  };

  return (
    <>
      <Dialog title="仓库页签分组管理" onClose={onClose} wide footer={<button onClick={onClose}>关闭</button>}>
        <div className="group-manager-list">
          {config.groups.map((group) => {
            const members = reposInGroup(config, repos, group.id);
            const isDefault = group.id === DEFAULT_GROUP_ID;
            return (
              <div className="group-manager-row" key={group.id}>
                <GroupAvatar id={group.id} name={group.name} color={group.color} size={26} />
                {renaming === group.id ? (
                  <input
                    data-autofocus
                    className="group-rename-input"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") submitRename(group.id); if (e.key === "Escape") setRenaming(null); }}
                    onBlur={() => submitRename(group.id)}
                  />
                ) : (
                  <span className="group-manager-name" title={group.name}>{group.name}{isDefault && <span className="muted">（未分组仓库页签）</span>}</span>
                )}
                <span className="tree-count" title={`当前打开的页签 ${members.length} 个`}>{members.length}</span>
                <div className="group-color-picker" role="group" aria-label={`${group.name} 的颜色`}>
                  {GROUP_COLOR_PRESETS.map((preset) => (
                    <button
                      key={preset.value}
                      className={`group-color-swatch${group.color === preset.value ? " selected" : ""}`}
                      style={{ background: preset.value }}
                      title={preset.label}
                      aria-label={`将分组 ${group.name} 设为${preset.label}`}
                      aria-pressed={group.color === preset.value}
                      onClick={() => onChange(setGroupColor(config, group.id, preset.value))}
                    >
                      {group.color === preset.value && <Icon name="check" size={11} />}
                    </button>
                  ))}
                </div>
                <div className="group-manager-actions">
                  {!isDefault && <>
                    <button
                      className={`group-pin-button${group.pinned ? " pinned" : ""}`}
                      title={group.pinned ? "取消 Pin" : "Pin 到顶部栏"}
                      aria-pressed={group.pinned}
                      onClick={() => onChange(togglePin(config, group.id))}
                    >
                      <Icon name="pin" size={14} />
                      <span>{group.pinned ? "已 Pin" : "Pin"}</span>
                    </button>
                    <button className="icon-button" title="重命名" onClick={() => { setRenaming(group.id); setRenameValue(group.name); }}><Icon name="edit" size={14} /></button>
                    <button className="icon-button danger-button" title="删除分组" onClick={() => beginDelete(group.id)}><Icon name="trash" size={14} /></button>
                  </>}
                </div>
              </div>
            );
          })}
        </div>
        <div className="branch-create">
          <input data-autofocus placeholder="新分组名称" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && newName.trim()) { const next = createGroup(config, newName); if (next !== config) { onChange(next); setNewName(""); } } }} />
          <button className="primary" disabled={!newName.trim()} onClick={() => { const next = createGroup(config, newName); if (next !== config) { onChange(next); setNewName(""); } }}>新建分组</button>
        </div>
        <div className="section-label">更换仓库页签的分组与显示名（别名只影响页签显示，不改仓库路径）</div>
        <div className="group-assign-list">
          {repos.map((repo) => (
            <div className="group-assign-row" key={repo.path}>
              <Icon name="folder" size={13} />
              <span className="group-assign-tag" title={repo.path}>{displayRepoName(config, repo)}{config.aliases[repo.path] && <span className="muted"> ({repo.name})</span>}</span>
              <input
                className="alias-input"
                placeholder="页签显示名（空 = 仓库名）"
                value={aliasDrafts[repo.path] ?? config.aliases[repo.path] ?? ""}
                title="自定义仓库页签的显示名，留空恢复仓库名"
                onChange={(e) => setAliasDrafts((prev) => ({ ...prev, [repo.path]: e.target.value }))}
                onBlur={() => {
                  if (skipAliasBlur.current === repo.path) { skipAliasBlur.current = null; return; }
                  saveAlias(repo.path);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") { cancelAlias(repo.path); e.currentTarget.blur(); }
                }}
                aria-label={`${repo.name} 的页签显示名`}
              />
              <select
                value={config.assignments[repo.path] ?? DEFAULT_GROUP_ID}
                onChange={(e) => onChange(setRepoGroup(config, repo.path, e.target.value))}
                aria-label={`${repo.name} 的分组`}
              >
                {config.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
          ))}
          {repos.length === 0 && <div className="panel-hint">（当前没有打开的仓库页签）</div>}
        </div>
      </Dialog>
      {pendingDelete && (
        <Dialog
          title={`删除分组 ${pendingDelete.name}？`}
          onClose={() => setPendingDelete(null)}
          footer={<>
            <button onClick={() => setPendingDelete(null)}>取消</button>
            <button className="danger-button" onClick={() => { onChange(deleteGroup(config, pendingDelete.id)); setPendingDelete(null); }}>删除分组</button>
          </>}
        >
          <div className="confirm-body">
            <p>组内 {pendingDelete.repos.length} 个打开的仓库页签将移入 Default，不会被关闭或删除。</p>
            {pendingDelete.repos.length > 0 && <div className="confirm-file-list">{pendingDelete.repos.join("\n")}</div>}
            {pendingDelete.closedCount > 0 && <p className="panel-hint">另有 {pendingDelete.closedCount} 个已关闭仓库的分组记录一并清回 Default。</p>}
          </div>
        </Dialog>
      )}
    </>
  );
}
