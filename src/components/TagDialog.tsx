import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { TagInfo } from "../types";

interface Props {
  repoPath: string;
  onClose: () => void;
  onChanged: () => void;
  setMessage: (msg: string) => void;
}

export default function TagDialog({ repoPath, onClose, onChanged, setMessage }: Props) {
  const [tags, setTags] = useState<TagInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [tagMessage, setTagMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    api.tagList(repoPath).then(setTags).catch((e) => setMessage(String(e)));
  }, [repoPath, setMessage]);

  useEffect(reload, [reload]);

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await action();
      setMessage(success);
      reload();
      onChanged();
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>标签管理</h3>
        <div className="branch-list">
          {tags.map((t) => (
            <div
              key={t.name}
              className={`branch-item${selected === t.name ? " selected" : ""}`}
              onClick={() => setSelected(t.name)}
            >
              <span>{t.name}{t.subject ? ` · ${t.subject}` : ""}</span>
              <span className="branch-oid">{t.oid.slice(0, 7)}</span>
            </div>
          ))}
          {tags.length === 0 && <div className="panel-hint">（无标签）</div>}
        </div>
        <div className="branch-actions">
          <button
            disabled={busy || !selected}
            onClick={() => {
              if (window.confirm(`确定删除标签 ${selected} 吗？（不影响远程）`))
                void run(() => api.deleteTag(repoPath, selected!), `已删除标签 ${selected}`);
            }}
          >
            删除选中
          </button>
        </div>
        <div className="branch-create">
          <input placeholder="标签名" value={name} onChange={(e) => setName(e.target.value)} />
          <input
            placeholder="目标 sha（空 = HEAD）"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
          <input
            placeholder="附注信息（空 = 轻量标签）"
            value={tagMessage}
            onChange={(e) => setTagMessage(e.target.value)}
          />
          <button
            className="primary"
            disabled={busy || !name.trim()}
            onClick={() => void run(() => api.createTag(repoPath, name.trim(), target.trim() || undefined, tagMessage || undefined), `已创建标签 ${name.trim()}`)}
          >
            新建
          </button>
        </div>
        <div className="modal-footer">
          <button onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}
