import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useRepoBusy } from "../useRepoBusy";
import type { FileDiff, StatusEntry, StatusSnapshot } from "../types";
import DiffView from "./DiffView";
import type { FileAction } from "./DiffView";
import ContextMenu from "../ui/ContextMenu";
import SplitHandle from "../ui/SplitHandle";
import Icon from "../ui/Icon";

interface Props {
  repoPath: string;
  status: StatusSnapshot;
  width: number;
  conflictCount: number;
  onWidth: (width: number) => void;
  onRefresh: (historyChanged?: boolean) => void;
  refreshVersion: number;
  setMessage: (msg: string) => void;
  highlightEnabled?: boolean;
  onFileAction?: (action: FileAction, file: FileDiff) => void;
  onPathAction: (action: "open" | "reveal" | "copy-path", path: string) => void;
  onDiscard: (paths: string[], untracked: boolean) => void;
  onOpenConflict: () => void;
  onDirtyChange: (dirty: boolean) => void;
}

type Side = "staged" | "unstaged";
type MenuTarget = { x: number; y: number; side: Side; entry: StatusEntry };

export default function ChangesPanel(props: Props) {
  const { repoPath, status } = props;
  const [checked, setChecked] = useState<Record<Side, Set<string>>>({ staged: new Set(), unstaged: new Set() });
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [localBusy, setBusy] = useState(false);
  const repoBusy = useRepoBusy(props.repoPath);
  const busy = localBusy || repoBusy;
  const [filter, setFilter] = useState("");
  const [preview, setPreview] = useState<{ side: Side; path: string; file: FileDiff | null } | null>(null);
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const [previewError, setPreviewError] = useState("");
  const previewRequest = useRef(0);

  useEffect(() => {
    previewRequest.current += 1;
    setChecked((prev) => ({
      staged: new Set([...prev.staged].filter((path) => status.staged.some((entry) => entry.path === path))),
      unstaged: new Set([...prev.unstaged].filter((path) => status.unstaged.some((entry) => entry.path === path))),
    }));
    if (preview) {
      const entries = preview.side === "staged" ? status.staged : status.unstaged;
      if (entries.some((entry) => entry.path === preview.path)) void showPreview(preview.side, preview.path);
      else setPreview(null);
    }
  }, [status, props.refreshVersion]);

  useEffect(() => {
    props.onDirtyChange(title.trim().length > 0 || body.trim().length > 0);
  }, [body, title, props.onDirtyChange]);

  const showPreview = async (side: Side, path: string) => {
    const request = ++previewRequest.current;
    setPreviewError(""); setPreview({ side, path, file: null });
    try {
      const oldPath = (side === "staged" ? status.staged : status.unstaged).find((entry) => entry.path === path)?.oldPath;
      const diffs = await api.getWorktreeFileDiff(repoPath, side === "staged", path, oldPath);
      if (request !== previewRequest.current) return;
      const file = diffs.find((d) => d.path === path || d.oldPath === path) ?? null;
      setPreview({ side, path, file });
      if (!file) setPreviewError("文件差异已改变或消失，请刷新后重选。");
    } catch (e) {
      if (request === previewRequest.current) { setPreviewError(String(e)); props.setMessage(String(e)); }
    }
  };

  const run = async (action: () => Promise<unknown>, success: string, historyChanged = false) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      props.setMessage(success);
      props.onRefresh(historyChanged);
    } catch (e) {
      props.setMessage(String(e));
    } finally { setBusy(false); }
  };
  const toggle = (side: Side, path: string) => setChecked((prev) => {
    const next = new Set(prev[side]);
    if (next.has(path)) next.delete(path); else next.add(path);
    return { ...prev, [side]: next };
  });
  const stagePaths = (side: Side, paths: string[]) => {
    const entries = side === "staged" ? status.staged : status.unstaged;
    const conflicted = paths.filter((path) => entries.some((entry) => entry.path === path && entry.status === "conflicted"));
    const safePaths = paths.filter((path) => !conflicted.includes(path));
    const conflictHint = conflicted.length > 0 ? `${conflicted.length} 个冲突文件未${side === "staged" ? "取消暂存" : "暂存"}，请进入冲突中心解决` : "";
    if (safePaths.length === 0) {
      return props.setMessage(conflictHint || "先选择要操作的文件");
    }
    previewRequest.current += 1;
    setPreview(null);
    void run(
      () => side === "unstaged" ? api.stageFiles(repoPath, safePaths) : api.unstageFiles(repoPath, safePaths),
      `${side === "unstaged" ? "已暂存" : "已取消暂存"} ${safePaths.length} 个文件${conflictHint ? `；${conflictHint}` : ""}`,
    );
  };
  const doCommit = () => {
    if (busy) return;
    if (status.staged.length === 0) return props.setMessage("没有已暂存的变更");
    if (!title.trim()) return props.setMessage("提交标题不能为空");
    const message = title.trim() + (body.trim() ? `\n\n${body.trim()}` : "");
    void run(async () => {
      const result = await api.commit(repoPath, message);
      setTitle(""); setBody("");
      return result;
    }, "提交完成", true);
  };

  const renderList = (side: Side, entries: StatusEntry[]) => {
    const visible = entries.filter((entry) => entry.path.toLowerCase().includes(filter.trim().toLowerCase()));
    return <section className="changes-list">
      <div className="changes-list-header">
        <strong>{side === "staged" ? "已暂存" : "未暂存"}<span className="count-badge">{entries.length}</span></strong>
        <div>
          <button disabled={busy || entries.length === 0} onClick={() => stagePaths(side, entries.map((e) => e.path))}>{side === "staged" ? "全部取消" : "全部暂存"}</button>
          <button disabled={busy || checked[side].size === 0} onClick={() => stagePaths(side, [...checked[side]])}>{side === "staged" ? "取消选中" : "暂存选中"}</button>
        </div>
      </div>
      <div className="changes-items">
        {visible.map((entry) => <div
          key={`${side}-${entry.path}`}
          className={`changes-item${preview?.path === entry.path && preview.side === side ? " selected" : ""}${entry.status === "conflicted" ? " conflicted" : ""}`}
          onClick={() => entry.status === "conflicted" ? props.onOpenConflict() : void showPreview(side, entry.path)}
          onDoubleClick={() => { if (entry.status !== "conflicted") stagePaths(side, [entry.path]); }}
          onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, side, entry }); }}
          title={entry.path}
        >
          <input type="checkbox" aria-label={`选择 ${entry.path}`} checked={checked[side].has(entry.path)} onChange={() => toggle(side, entry.path)} onClick={(e) => e.stopPropagation()} />
          <span className={`file-status status-${entry.status}`}>{entry.status === "conflicted" ? "!" : entry.status[0].toUpperCase()}</span>
          <span className="file-path">{entry.path}</span>
          {entry.status === "conflicted" && <Icon name="conflict" size={14} />}
        </div>)}
        {visible.length === 0 && <div className="panel-hint">{entries.length === 0 ? "（空）" : "无匹配文件"}</div>}
      </div>
    </section>;
  };

  return (
    <div className="changes-panel">
      <div className="changes-left" style={{ width: props.width }}>
        <div className="changes-filter"><Icon name="search" size={14} /><input aria-label="过滤变更文件" placeholder="过滤文件…" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
        {props.conflictCount > 0 && <button className="conflict-banner" onClick={props.onOpenConflict}><Icon name="conflict" /><span>{props.conflictCount} 个冲突待解决</span><strong>进入解决 →</strong></button>}
        {renderList("unstaged", status.unstaged)}
        {renderList("staged", status.staged)}
        <div className="commit-box">
          <input aria-label="提交标题" placeholder="提交标题（必填）" disabled={busy} value={title} onChange={(e) => setTitle(e.target.value)} />
          <div className="commit-title-count">{title.length > 50 ? "标题建议不超过 50 字符 · " : ""}{title.length}/50</div>
          <textarea aria-label="提交正文" placeholder="提交正文（可选）" disabled={busy} value={body} onChange={(e) => setBody(e.target.value)} rows={3} onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); doCommit(); }
          }} />
          <button className="primary commit-button" disabled={busy || status.staged.length === 0} onClick={doCommit}>{busy ? <span className="spinner" /> : <Icon name="check" />}提交 ({status.staged.length})</button>
        </div>
      </div>
      <SplitHandle direction="vertical" label="调整变更文件列表宽度" onResize={(delta) => props.onWidth(Math.min(720, Math.max(300, props.width + delta)))} onReset={() => props.onWidth(420)} />
      <div className="changes-preview">
        {preview ? previewError ? <div className="empty-state" role="alert">{previewError}</div> : preview.file ? <DiffView files={[preview.file]} highlightEnabled={props.highlightEnabled} onFileAction={props.onFileAction} /> : <div className="empty-state"><span className="spinner" /><span>diff 加载中…</span></div> : <div className="empty-state"><Icon name="file" size={28} /><strong>选择一个文件</strong><span>查看工作区或暂存区差异</span></div>}
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={[
        ...(menu.entry.status !== "conflicted" ? [{ id: "stage", label: menu.side === "staged" ? "取消暂存" : "暂存", onSelect: () => stagePaths(menu.side, [menu.entry.path]) }] : [{ id: "resolve", label: "解决冲突", icon: "conflict" as const, onSelect: props.onOpenConflict }]),
        { id: "open", label: "打开文件", icon: "external", onSelect: () => props.onPathAction("open", menu.entry.path) },
        { id: "reveal", label: "在文件管理器中显示", icon: "folder", onSelect: () => props.onPathAction("reveal", menu.entry.path) },
        { id: "copy", label: "复制相对路径", icon: "copy", onSelect: () => props.onPathAction("copy-path", menu.entry.path) },
        ...(menu.side === "unstaged" ? [
          { id: "sep", separator: true },
          menu.entry.status === "new"
            ? { id: "delete", label: "删除未跟踪文件…", danger: true, onSelect: () => props.onDiscard([menu.entry.path], true) }
            : { id: "discard", label: "丢弃未暂存变更…", danger: true, onSelect: () => props.onDiscard([menu.entry.path], false) },
        ] : []),
      ]} />}
    </div>
  );
}
