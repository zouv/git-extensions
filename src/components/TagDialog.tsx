import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { useRepoBusy } from "../useRepoBusy";
import type { TagInfo } from "../types";
import type { TagGroupConfig } from "../tagGroups";
import { DEFAULT_GROUP_ID, setActiveGroup, setTagGroup, visibleTags } from "../tagGroups";
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
  const run = async (action: () => Promise<unknown>, success: string) => {
    if (busy) return;
    setBusy(true);
    try { await action(); setMessage(success); reload(); onChanged(); }
    catch (e) { setMessage(String(e)); }
    finally { setBusy(false); }
  };
  const shown = visibleTags(config, tags);
  const create = () => {
    const trimmed = name.trim();
    // 新标签归入当前所在组（Default 不写记录）。
    if (config.activeGroupId !== DEFAULT_GROUP_ID) onConfigChange(setTagGroup(config, trimmed, config.activeGroupId));
    void run(() => api.createTag(repoPath, trimmed, target.trim() || undefined, tagMessage || undefined), `已创建标签 ${trimmed}`);
  };
  return <Dialog title="标签管理" onClose={onClose} busy={busy} footer={<button disabled={busy} onClick={onClose}>关闭</button>}>
    <div className="tag-group-filter">
      <span className="muted">分组</span>
      <select value={config.activeGroupId} onChange={(e) => onConfigChange(setActiveGroup(config, e.target.value))} aria-label="标签分组">
        {config.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
      </select>
    </div>
    <div className="branch-list">{shown.map((tag) => <div key={tag.name} className={`branch-item${selected === tag.name ? " selected" : ""}`} onClick={() => setSelected(tag.name)}><span>{tag.name}{tag.subject ? ` · ${tag.subject}` : ""}</span><span className="branch-oid">{tag.oid.slice(0, 7)}</span></div>)}{shown.length === 0 && <div className="panel-hint">（该分组无标签）</div>}</div>
    <div className="branch-actions">
      {selected && <select value={config.assignments[selected] ?? DEFAULT_GROUP_ID} onChange={(e) => onConfigChange(setTagGroup(config, selected, e.target.value))} aria-label="选中标签的分组" title="把选中标签移到分组">
        {config.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
      </select>}
      <button className="danger-button" disabled={busy || !selected} onClick={async () => { if (await confirm({ title: `删除标签 ${selected}？`, body: "只删除本地标签，不影响远程标签。", danger: true, confirmLabel: "删除标签" })) void run(() => api.deleteTag(repoPath, selected!), `已删除标签 ${selected}`); }}>删除选中…</button>
    </div>
    <div className="branch-create tag-create"><input data-autofocus placeholder="标签名" value={name} onChange={(e) => setName(e.target.value)} /><input placeholder="目标 sha（空 = HEAD）" value={target} onChange={(e) => setTarget(e.target.value)} /><input placeholder="附注信息（空 = 轻量标签）" value={tagMessage} onChange={(e) => setTagMessage(e.target.value)} /><button className="primary" disabled={busy || !name.trim()} onClick={create}>新建</button></div>
  </Dialog>;
}
