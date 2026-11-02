import { useRef, useState } from "react";
import type { TagInfo } from "../types";
import type { TagGroupConfig } from "../tagGroups";
import {
  DEFAULT_GROUP_ID, createGroup, deleteGroup, displayName, forgetTag, groupById,
  renameGroup, setTagAlias, setTagGroup, tagsInGroup, togglePin,
} from "../tagGroups";
import { api } from "../api";
import Dialog from "../ui/Dialog";
import Icon from "../ui/Icon";
import GroupAvatar from "./GroupAvatar";

interface Props {
  repoPath: string;
  config: TagGroupConfig;
  tags: TagInfo[];
  busy: boolean;
  onChange: (next: TagGroupConfig) => void;
  onClose: () => void;
  setMessage: (msg: string) => void;
}

/** 标签分组管理器：新建 / 重命名 / Pin / 删除组，以及把标签分配到组。 */
export default function TagGroupsDialog({ repoPath, config, tags, busy, onChange, onClose, setMessage }: Props) {
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string; tags: string[] } | null>(null);
  const [moveToDefault, setMoveToDefault] = useState(true);
  const [aliasDrafts, setAliasDrafts] = useState<Record<string, string>>({});
  const skipAliasBlur = useRef<string | null>(null);

  const saveAlias = (tagName: string) => {
    const draft = aliasDrafts[tagName];
    if (draft === undefined) return;
    onChange(setTagAlias(config, tagName, draft));
    setAliasDrafts((prev) => {
      const next = { ...prev };
      delete next[tagName];
      return next;
    });
  };
  const cancelAlias = (tagName: string) => {
    skipAliasBlur.current = tagName;
    setAliasDrafts((prev) => {
      const next = { ...prev };
      delete next[tagName];
      return next;
    });
  };

  const submitRename = (groupId: string) => {
    const next = renameGroup(config, groupId, renameValue);
    if (next === config) setMessage("组名为空或与其它组重名");
    onChange(next);
    setRenaming(null);
  };

  const removeGroup = (groupId: string) => {
    const group = groupById(config, groupId);
    if (!group || groupId === DEFAULT_GROUP_ID) return;
    const members = tagsInGroup(config, tags, groupId);
    if (members.length === 0) { onChange(deleteGroup(config, groupId, true)); return; }
    setMoveToDefault(true);
    setPendingDelete({ id: groupId, name: group.name, tags: members.map((t) => t.name) });
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const { id, tags: tagNames } = pendingDelete;
    if (!moveToDefault && tagNames.length > 0) {
      setDeleting(true);
      try {
        for (const name of tagNames) await api.deleteTag(repoPath, name);
        setMessage(`已删除分组及 ${tagNames.length} 个标签`);
      } catch (e) {
        setMessage(String(e));
        setDeleting(false);
        return;
      }
      setDeleting(false);
    }
    let next = deleteGroup(config, id, moveToDefault);
    // 标签随组一起删除时，同时清理它们的别名（移入 Default 的标签保留别名）。
    if (!moveToDefault) for (const name of tagNames) next = forgetTag(next, name);
    onChange(next);
    setPendingDelete(null);
  };

  return (
    <>
    <Dialog title="标签分组管理" onClose={onClose} busy={busy || deleting} wide footer={<button disabled={busy || deleting} onClick={onClose}>关闭</button>}>
      <div className="group-manager-list">
        {config.groups.map((group) => {
          const members = tagsInGroup(config, tags, group.id);
          const isDefault = group.id === DEFAULT_GROUP_ID;
          return (
            <div className="group-manager-row" key={group.id}>
              <GroupAvatar id={group.id} name={group.name} size={26} />
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
                <span className="group-manager-name" title={group.name}>{group.name}{isDefault && <span className="muted">（未分组标签）</span>}</span>
              )}
              <span className="tree-count">{members.length}</span>
              <div className="group-manager-actions">
                {!isDefault && <>
                  <button className="icon-button" title={group.pinned ? "取消 Pin" : "Pin 到顶部栏"} onClick={() => onChange(togglePin(config, group.id))}><Icon name="pin" size={14} /></button>
                  <button className="icon-button" title="重命名" onClick={() => { setRenaming(group.id); setRenameValue(group.name); }}><Icon name="edit" size={14} /></button>
                  <button className="icon-button danger-button" title="删除分组" onClick={() => void removeGroup(group.id)}><Icon name="trash" size={14} /></button>
                </>}
              </div>
            </div>
          );
        })}
      </div>
      <div className="branch-create">
        <input data-autofocus placeholder="新分组名称" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && newName.trim()) { onChange(createGroup(config, newName)); setNewName(""); } }} />
        <button className="primary" disabled={!newName.trim()} onClick={() => { const next = createGroup(config, newName); if (next === config) setMessage("组名为空、重名或已达上限"); onChange(next); setNewName(""); }}>新建分组</button>
      </div>
      <div className="section-label">更换标签分组与显示名（别名仅影响界面，Git 仍用真实标签名）</div>
      <div className="group-assign-list">
        {tags.map((tag) => (
          <div className="group-assign-row" key={tag.name}>
            <Icon name="tag" size={13} />
            <span className="group-assign-tag" title={tag.name}>{displayName(config, tag.name)}{config.aliases[tag.name] && <span className="muted"> ({tag.name})</span>}</span>
            <input
              className="alias-input"
              placeholder="显示名（空 = 原名）"
              value={aliasDrafts[tag.name] ?? config.aliases[tag.name] ?? ""}
              title="自定义标签在界面中的显示名，留空恢复原名"
              onChange={(e) => setAliasDrafts((prev) => ({ ...prev, [tag.name]: e.target.value }))}
              onBlur={() => {
                if (skipAliasBlur.current === tag.name) { skipAliasBlur.current = null; return; }
                saveAlias(tag.name);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") { cancelAlias(tag.name); e.currentTarget.blur(); }
              }}
              aria-label={`${tag.name} 的显示名`}
            />
            <select
              value={config.assignments[tag.name] ?? DEFAULT_GROUP_ID}
              onChange={(e) => onChange(setTagGroup(config, tag.name, e.target.value))}
              aria-label={`${tag.name} 的分组`}
            >
              {config.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
        ))}
        {tags.length === 0 && <div className="panel-hint">（无标签）</div>}
      </div>
    </Dialog>
    {pendingDelete && (
      <Dialog
        title={`删除分组 ${pendingDelete.name}？`}
        onClose={() => { if (!deleting) setPendingDelete(null); }}
        busy={deleting}
        footer={<>
          <button disabled={deleting} onClick={() => setPendingDelete(null)}>取消</button>
          <button className="danger-button" disabled={deleting} onClick={() => void confirmDelete()}>{deleting ? "删除中…" : "删除分组"}</button>
        </>}
      >
        <div className="confirm-body">
          <p>该分组包含 {pendingDelete.tags.length} 个标签。</p>
          <div className="confirm-file-list">{pendingDelete.tags.join("\n")}</div>
        </div>
        <label className="force-label">
          <input type="checkbox" checked={moveToDefault} onChange={(e) => setMoveToDefault(e.target.checked)} />
          将组内标签移入 Default
        </label>
        {!moveToDefault && <p className="warning-text">取消勾选：删除分组时会<b>同时删除上述 {pendingDelete.tags.length} 个本地 Git 标签</b>，不可撤销（不影响远程标签）。</p>}
      </Dialog>
    )}
    </>
  );
}
