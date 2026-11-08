import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { useRepoBusy } from "../useRepoBusy";
import type { RemoteInfo } from "../types";
import Dialog from "../ui/Dialog";
import InlineError from "../ui/InlineError";
import { useConfirm } from "../ui/Confirm";

interface Props {
  repoPath: string;
  onClose: () => void;
  onChanged: () => void;
  setMessage: (msg: string) => void;
}

export default function RemotesDialog({ repoPath, onClose, onChanged, setMessage }: Props) {
  const [remotes, setRemotes] = useState<RemoteInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const [editRename, setEditRename] = useState("");
  const [error, setError] = useState("");
  const [localBusy, setBusy] = useState(false);
  const repoBusy = useRepoBusy(repoPath);
  const busy = localBusy || repoBusy;
  const confirm = useConfirm();

  const load = useCallback(async () => {
    try {
      const list = await api.remoteList(repoPath);
      setRemotes(list);
      if (list.length > 0 && (!selected || !list.some((r) => r.name === selected))) {
        setSelected(list[0].name);
        setEditUrl(list[0].fetchUrl);
        setEditRename(list[0].name);
      } else if (list.length === 0) {
        setSelected(null);
      }
    } catch (e) {
      setError(String(e));
    }
  }, [repoPath, selected]);

  useEffect(() => { void load(); }, [load]);

  const current = remotes.find((r) => r.name === selected) ?? null;

  const run = async (action: () => Promise<unknown>, success: string) => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      await action();
      setMessage(success);
      await load();
      onChanged();
    } catch (e) {
      setError(String(e));
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  };

  const addRemote = () => {
    const trimmedName = name.trim();
    const trimmedUrl = url.trim();
    if (!trimmedName || !trimmedUrl) return;
    void run(async () => {
      await api.remoteAdd(repoPath, trimmedName, trimmedUrl);
      setName(""); setUrl("");
      setSelected(trimmedName);
    }, `已添加远程 ${trimmedName}`);
  };

  const updateUrl = () => {
    if (!current || !editUrl.trim()) return;
    void run(
      () => api.remoteSetUrl(repoPath, current.name, editUrl.trim(), false),
      `已更新远程 ${current.name} 的 URL`,
    );
  };

  const renameRemote = () => {
    if (!current || !editRename.trim() || editRename.trim() === current.name) return;
    const nextName = editRename.trim();
    void run(async () => {
      await api.remoteRename(repoPath, current.name, nextName);
      setSelected(nextName);
    }, `已将远程 ${current.name} 重命名为 ${nextName}`);
  };

  const removeRemote = async () => {
    if (!current) return;
    const ok = await confirm({
      title: `移除远程仓库 ${current.name}？`,
      body: `将移除远程配置 ${current.name} (${current.fetchUrl}) 及其本地跟踪分支引用。`,
      confirmLabel: "移除远程",
      danger: true,
    });
    if (!ok) return;
    void run(() => api.remoteRemove(repoPath, current.name), `已移除远程 ${current.name}`);
  };

  return (
    <Dialog
      title="远程仓库管理 (Remotes)"
      wide
      busy={busy}
      onClose={onClose}
      footer={<>
        <button disabled={busy || remotes.length === 0} onClick={() => void run(() => api.fetch(repoPath, current?.name, true), `已抓取并清理 ${current?.name ?? "远程"} 的过期跟踪分支`)}>
          Fetch --prune {current ? `(${current.name})` : ""}
        </button>
        <button onClick={onClose} disabled={busy}>关闭</button>
      </>}
    >
      {error && <InlineError message={error} />}
      <div className="branch-list" role="listbox" aria-label="远程仓库">
        {remotes.map((r) => (
          <div
            key={r.name}
            role="option"
            aria-selected={r.name === selected}
            className={`branch-item${r.name === selected ? " selected" : ""}`}
            tabIndex={0}
            onClick={() => { setSelected(r.name); setEditUrl(r.fetchUrl); setEditRename(r.name); }}
          >
            <strong>{r.name}</strong>
            <span className="branch-oid">{r.fetchUrl}</span>
          </div>
        ))}
        {remotes.length === 0 && <div className="panel-hint">当前仓库尚未配置任何远程仓库。</div>}
      </div>
      {current && (
        <div className="dialog-form">
          <div className="branch-create">
            <input aria-label="远程 URL" placeholder="远程 URL" disabled={busy} value={editUrl} onChange={(e) => setEditUrl(e.target.value)} />
            <button disabled={busy || !editUrl.trim() || editUrl.trim() === current.fetchUrl} onClick={updateUrl}>保存 URL</button>
          </div>
          <div className="branch-create">
            <input aria-label="重命名远程" placeholder="远程名称" disabled={busy} value={editRename} onChange={(e) => setEditRename(e.target.value)} />
            <button disabled={busy || !editRename.trim() || editRename.trim() === current.name} onClick={renameRemote}>重命名</button>
            <button className="danger-button" disabled={busy} onClick={() => void removeRemote()}>移除此远程…</button>
          </div>
        </div>
      )}
      <div className="branch-create">
        <input placeholder="新远程名 (如 upstream)" disabled={busy} value={name} onChange={(e) => setName(e.target.value)} />
        <input placeholder="新远程 URL (https:// 或 git@...)" disabled={busy} value={url} onChange={(e) => setUrl(e.target.value)} />
        <button className="primary" disabled={busy || !name.trim() || !url.trim()} onClick={addRemote}>添加远程</button>
      </div>
    </Dialog>
  );
}
