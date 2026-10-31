import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { FileDiff, StatusEntry, StatusSnapshot } from "../types";
import DiffView from "./DiffView";

interface Props {
  repoPath: string;
  status: StatusSnapshot;
  onRefresh: () => void;
  setMessage: (msg: string) => void;
  highlightEnabled?: boolean;
  onFileAction?: (action: "history" | "blame", file: FileDiff) => void;
}

type Side = "staged" | "unstaged";

export default function ChangesPanel({ repoPath, status, onRefresh, setMessage, highlightEnabled, onFileAction }: Props) {
  const [checked, setChecked] = useState<Record<Side, Set<string>>>({
    staged: new Set(),
    unstaged: new Set(),
  });
  const [message, setCommitMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ path: string; file: FileDiff | null } | null>(null);
  const diffCache = useRef(new Map<Side, FileDiff[]>());

  // 刷新后 diff 缓存失效
  useEffect(() => {
    diffCache.current.clear();
    setPreview(null);
    setChecked({ staged: new Set(), unstaged: new Set() });
  }, [status]);

  const toggle = (side: Side, path: string) => {
    setChecked((prev) => {
      const next = new Set(prev[side]);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return { ...prev, [side]: next };
    });
  };

  const showPreview = async (side: Side, path: string) => {
    setPreview({ path, file: null });
    try {
      let diffs = diffCache.current.get(side);
      if (!diffs) {
        diffs = await api.getWorktreeDiff(repoPath, side === "staged");
        diffCache.current.set(side, diffs);
      }
      const file = diffs.find((d) => d.path === path || d.oldPath === path) ?? null;
      setPreview({ path, file });
    } catch (e) {
      setMessage(String(e));
    }
  };

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await action();
      setMessage(success);
      onRefresh();
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  };

  const stage = () => {
    const paths = [...checked.unstaged];
    if (paths.length === 0) return setMessage("先勾选要暂存的文件");
    void run(() => api.stageFiles(repoPath, paths), `已暂存 ${paths.length} 个文件`);
  };
  const unstage = () => {
    const paths = [...checked.staged];
    if (paths.length === 0) return setMessage("先勾选要取消暂存的文件");
    void run(() => api.unstageFiles(repoPath, paths), `已取消暂存 ${paths.length} 个文件`);
  };
  const doCommit = () => {
    if (busy) return;
    if (status.staged.length === 0) return setMessage("没有已暂存的变更");
    if (!message.trim()) return setMessage("提交信息不能为空");
    void run(async () => {
      const out = await api.commit(repoPath, message);
      setCommitMessage("");
      return out;
    }, "提交完成");
  };

  const renderList = (side: Side, entries: StatusEntry[]) => (
    <div className="changes-list">
      <div className="changes-list-header">
        <span>{side === "staged" ? `已暂存 (${entries.length})` : `未暂存 (${entries.length})`}</span>
        <button disabled={busy || entries.length === 0} onClick={side === "staged" ? unstage : stage}>
          {side === "staged" ? "取消暂存选中" : "暂存选中"}
        </button>
      </div>
      <div className="changes-items">
        {entries.map((entry) => (
          <div
            key={entry.path}
            className={`changes-item${preview?.path === entry.path ? " selected" : ""}`}
            onClick={() => void showPreview(side, entry.path)}
          >
            <input
              type="checkbox"
              checked={checked[side].has(entry.path)}
              onChange={() => toggle(side, entry.path)}
              onClick={(e) => e.stopPropagation()}
            />
            <span className={`file-status status-${entry.status}`}>{entry.status[0].toUpperCase()}</span>
            <span className="file-path" title={entry.path}>{entry.path}</span>
          </div>
        ))}
        {entries.length === 0 && <div className="panel-hint">（空）</div>}
      </div>
    </div>
  );

  return (
    <div className="changes-panel">
      <div className="changes-left">
        {renderList("unstaged", status.unstaged)}
        {renderList("staged", status.staged)}
        <div className="commit-box">
          <textarea
            placeholder="提交信息…"
            value={message}
            onChange={(e) => setCommitMessage(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                e.preventDefault();
                doCommit();
              }
            }}
            rows={3}
          />
          <button className="primary" disabled={busy || status.staged.length === 0} onClick={doCommit}>
            提交 ({status.staged.length})
          </button>
        </div>
      </div>
      <div className="changes-preview">
        {preview ? (
          preview.file ? (
            <DiffView files={[preview.file]} highlightEnabled={highlightEnabled} onFileAction={onFileAction} />
          ) : (
            <div className="panel-hint">diff 加载中…</div>
          )
        ) : (
          <div className="panel-hint">点击文件查看 diff</div>
        )}
      </div>
    </div>
  );
}
