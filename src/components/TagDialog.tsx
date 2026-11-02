import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { useRepoBusy } from "../useRepoBusy";
import type { TagInfo } from "../types";
import type { TagGroupConfig } from "../tagGroups";
import {
  DEFAULT_GROUP_ID, displayName, forgetTag, isGroupActive, primaryGroupId,
  setTagGroup, toggleActiveGroup, visibleTags,
} from "../tagGroups";
import Dialog from "../ui/Dialog";
import { useConfirm } from "../ui/Confirm";

interface Props {
  repoPath: string;
  initialTarget?: string;
  config: TagGroupConfig;
  onConfigChange: (next: TagGroupConfig) => void;
  onClose: () => void;
  onChanged: () => void;
  setMessage: (msg: string) => void;
}

export default function TagDialog({ repoPath, initialTarget, config, onConfigChange, onClose, onChanged, setMessage }: Props) {
  const [tags, setTags] = useState<TagInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [target, setTarget] = useState(initialTarget ?? "");
  const [tagMessage, setTagMessage] = useState("");
  const [localBusy, setBusy] = useState(false);
  const repoBusy = useRepoBusy(repoPath);
  const busy = localBusy || repoBusy;
  const confirm = useConfirm();
  const reload = useCallback(() => { api.tagList(repoPath).then(setTags).catch((e) => setMessage(String(e))); }, [repoPath, setMessage]);
  useEffect(reload, [reload]);
  const run = async (action: () => Promise<unknown>, success: string): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    try { await action(); setMessage(success); reload(); onChanged(); return true; }
    catch (e) { setMessage(String(e)); return false; }
    finally { setBusy(false); }
  };
  const shown = visibleTags(config, tags);
  const create = () => {
    const trimmed = name.trim();
    // 新标签归入当前选中的第一个非 Default 组（Default 不写记录）。
    const groupId = primaryGroupId(config);
    if (groupId !== DEFAULT_GROUP_ID) onConfigChange(setTagGroup(config, trimmed, groupId));
    void run(() => api.createTag(repoPath, trimmed, target.trim() || undefined, tagMessage || undefined), `已创建标签 ${trimmed}`);
  };
  return <Dialog title="标签管理" onClose={onClose} busy={busy} footer={<button disabled={busy} onClick={onClose}>关闭</button>}>
    <div className="tag-group-filter">
      <span className="muted">显示分组（可多选）</span>
      <div className="tag-group-chips" role="group" aria-label="显示分组（可多选）">
        {config.groups.map((g) => (
          <button
            type="button"
            key={g.id}
            className={`tag-group-chip${isGroupActive(config, g.id) ? " active" : ""}`}
            aria-pressed={isGroupActive(config, g.id)}
            onClick={() => onConfigChange(toggleActiveGroup(config, g.id))}
          >{g.name}</button>
        ))}
      </div>
    </div>
    <div className="branch-list">{shown.map((tag) => <div key={tag.name} className={`branch-item${selected === tag.name ? " selected" : ""}`} onClick={() => setSelected(tag.name)}><span title={config.aliases[tag.name] ? `${displayName(config, tag.name)}（原标签 ${tag.name}）` : tag.name}>{displayName(config, tag.name)}{config.aliases[tag.name] && <span className="muted"> ({tag.name})</span>}{tag.subject ? ` · ${tag.subject}` : ""}</span><span className="branch-oid">{tag.oid.slice(0, 7)}</span></div>)}{shown.length === 0 && <div className="panel-hint">（所选分组无标签）</div>}</div>
    <div className="branch-actions">
      {selected && <select value={config.assignments[selected] ?? DEFAULT_GROUP_ID} onChange={(e) => onConfigChange(setTagGroup(config, selected, e.target.value))} aria-label="选中标签的分组" title="把选中标签移到分组">
        {config.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
      </select>}
      <button className="danger-button" disabled={busy || !selected} onClick={async () => { if (await confirm({ title: `删除标签 ${displayName(config, selected!)}？`, body: `只删除本地标签${config.aliases[selected!] ? ` ${selected}（显示名 ${config.aliases[selected!]}）` : ""}，不影响远程标签。`, danger: true, confirmLabel: "删除标签" })) { const deleted = selected!; void run(() => api.deleteTag(repoPath, deleted), `已删除标签 ${deleted}`).then((ok) => { if (ok) { setSelected(null); onConfigChange(forgetTag(config, deleted)); } }); } }}>删除选中…</button>
    </div>
    <div className="branch-create tag-create"><input data-autofocus placeholder="标签名" value={name} onChange={(e) => setName(e.target.value)} /><input placeholder="目标 sha（空 = HEAD）" value={target} onChange={(e) => setTarget(e.target.value)} /><input placeholder="附注信息（空 = 轻量标签）" value={tagMessage} onChange={(e) => setTagMessage(e.target.value)} /><button className="primary" disabled={busy || !name.trim()} onClick={create}>新建</button></div>
  </Dialog>;
}
