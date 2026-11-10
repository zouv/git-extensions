import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { api } from "../api";
import { useRepoBusy } from "../useRepoBusy";
import type { ExplorerTarget, FileDiff, StatusSnapshot, StashInfo } from "../types";
import DiffView from "../components/DiffView";
import Icon from "../ui/Icon";
import { loadSettings } from "../settings";
import { useConfirm } from "../ui/Confirm";
import InlineError from "../ui/InlineError";

interface Props {
  target: ExplorerTarget;
  onBusyChange: (busy: boolean) => void;
  onDirtyChange: (dirty: boolean) => void;
  setMessage: (message: string) => void;
}

interface WorkingFile {
  path: string;
  oldPath: string | null;
  status: string;
  staged: boolean;
}

function workingFiles(status: StatusSnapshot): WorkingFile[] {
  const byPath = new Map<string, WorkingFile>();
  for (const entry of status.staged) {
    byPath.set(entry.path, { path: entry.path, oldPath: entry.oldPath, status: entry.status, staged: true });
  }
  for (const entry of status.unstaged) {
    byPath.set(entry.path, { path: entry.path, oldPath: entry.oldPath, status: entry.status, staged: false });
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

interface StashFile {
  path: string;
  oldPath: string | null;
  status: string;
  staged?: boolean;
}

interface DirNode {
  kind: "dir";
  name: string;
  path: string;
  children: TreeNode[];
}

interface FileNode {
  kind: "file";
  name: string;
  file: StashFile;
}

type TreeNode = DirNode | FileNode;

function buildFileTree(files: StashFile[]): TreeNode[] {
  const root: DirNode = { kind: "dir", name: "", path: "", children: [] };
  for (const file of files) {
    const parts = file.path.split("/");
    let node = root;
    for (let index = 0; index < parts.length - 1; index += 1) {
      const name = parts[index];
      let child = node.children.find((item): item is DirNode => item.kind === "dir" && item.name === name);
      if (!child) {
        child = {
          kind: "dir",
          name,
          path: parts.slice(0, index + 1).join("/"),
          children: [],
        };
        node.children.push(child);
      }
      node = child;
    }
    node.children.push({ kind: "file", name: parts[parts.length - 1], file });
  }
  const sort = (directory: DirNode) => {
    directory.children.sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === "dir" ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
    for (const child of directory.children) {
      if (child.kind === "dir") sort(child);
    }
  };
  sort(root);
  return root.children;
}

/** 对应 Git Extensions 的 FormStash：工作区变更与 stash 共用文件树 / diff，
 * 支持全部/选中文件 stash、Keep index、Include untracked、Apply/Drop。 */
export default function StashWindow({ target, onBusyChange, onDirtyChange, setMessage }: Props) {
  const repoPath = target.repo.path;
  const [stashes, setStashes] = useState<StashInfo[]>([]);
  const [status, setStatus] = useState<StatusSnapshot | null>(null);
  const [stashOid, setStashOid] = useState<string | null>(null);
  const [stashFiles, setStashFiles] = useState<FileDiff[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<FileDiff | null>(null);
  const [stashMessage, setStashMessage] = useState("");
  const [filter, setFilter] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [keepIndex, setKeepIndex] = useState(false);
  const [includeUntracked, setIncludeUntracked] = useState(false);
  const [error, setError] = useState("");
  const [localBusy, setBusy] = useState(false);
  const [highlightEnabled, setHighlightEnabled] = useState(true);
  const repoBusy = useRepoBusy(repoPath);
  const busy = localBusy || repoBusy;
  const confirm = useConfirm();

  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);
  useEffect(() => () => onBusyChange(false), [onBusyChange]);
  useEffect(() => { onDirtyChange(stashMessage.trim().length > 0); }, [stashMessage, onDirtyChange]);
  useEffect(() => { setHighlightEnabled(loadSettings().highlightEnabled); }, []);

  const working = useMemo(() => status ? workingFiles(status) : [], [status]);
  const isWorking = stashOid === null;
  const files: StashFile[] = isWorking
    ? working
    : stashFiles.map((file) => ({ path: file.path, oldPath: file.oldPath, status: file.status }));
  const visibleFiles = useMemo(() => {
    const query = filter.trim();
    if (!query) return files;
    let regex: RegExp | null = null;
    try { regex = new RegExp(query, "i"); } catch { /* 非法正则退回子串匹配 */ }
    return files.filter((file) => regex
      ? regex.test(file.path)
      : file.path.toLowerCase().includes(query.toLowerCase()));
  }, [files, filter]);
  const tree = useMemo(() => buildFileTree(visibleFiles), [visibleFiles]);

  const renderTree = (nodes: TreeNode[], depth: number): ReactNode => nodes.map((node) => {
    if (node.kind === "dir") {
      const isCollapsed = collapsed.has(node.path);
      const toggle = () => setCollapsed((prev) => {
        const next = new Set(prev);
        if (next.has(node.path)) next.delete(node.path); else next.add(node.path);
        return next;
      });
      return <div key={`dir:${node.path}`}>
        <div className="stash-dir-row" style={{ paddingLeft: 8 + depth * 14 }} onClick={toggle}>
          <span className={`stash-chevron${isCollapsed ? " collapsed" : ""}`}>▾</span>
          <Icon name="folder" size={13} />
          <span className="file-path">{node.name}</span>
        </div>
        {!isCollapsed && renderTree(node.children, depth + 1)}
      </div>;
    }
    const file = node.file;
    return <div
      key={`file:${file.path}`}
      className={`stash-file-row${selectedPath === file.path ? " selected" : ""}`}
      role="option"
      aria-selected={selectedPath === file.path}
      tabIndex={0}
      style={{ paddingLeft: 8 + depth * 14 }}
      onClick={() => void selectFile(file.path)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); void selectFile(file.path); } }}
      title={file.path}
    >
      {isWorking && <input
        type="checkbox"
        aria-label={`选择 ${file.path}`}
        checked={checked.has(file.path)}
        disabled={busy}
        onChange={() => setChecked((prev) => {
          const next = new Set(prev);
          if (next.has(file.path)) next.delete(file.path); else next.add(file.path);
          return next;
        })}
        onClick={(e) => e.stopPropagation()}
      />}
      <span className={`file-status status-${file.status}`}>{file.status === "conflicted" ? "!" : file.status[0].toUpperCase()}</span>
      <span className="file-path">{node.name}</span>
    </div>;
  });

  const reload = useCallback(async () => {
    setError("");
    try {
      const [nextStashes, nextStatus] = await Promise.all([api.stashList(repoPath), api.getStatus(repoPath)]);
      setStashes(nextStashes);
      setStatus(nextStatus);
      setChecked((prev) => new Set([...prev].filter((path) => nextStatus.staged.some((e) => e.path === path) || nextStatus.unstaged.some((e) => e.path === path))));
      if (stashOid && !nextStashes.some((stash) => stash.oid === stashOid)) {
        setStashOid(null);
      }
    } catch (reason) {
      setError(String(reason));
      setMessage(String(reason));
    }
  }, [repoPath, stashOid, setMessage]);

  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => {
    if (!stashOid) { setStashFiles([]); return; }
    let alive = true;
    api.getCommitFiles(repoPath, stashOid).then((next) => {
      if (alive) setStashFiles(next);
    }).catch((reason) => { if (alive) { setError(String(reason)); setMessage(String(reason)); } });
    return () => { alive = false; };
  }, [repoPath, stashOid, setMessage]);

  const selectFile = async (path: string) => {
    setSelectedPath(path);
    setPreview(null);
    if (isWorking) {
      const file = working.find((item) => item.path === path);
      if (!file) return;
      try {
        const diffs = await api.getWorktreeFileDiff(repoPath, file.staged, file.path, file.oldPath);
        setPreview(diffs.find((item) => item.path === path || item.oldPath === path) ?? null);
      } catch (reason) { setError(String(reason)); setMessage(String(reason)); }
      return;
    }
    if (!stashOid) return;
    const file = stashFiles.find((item) => item.path === path);
    if (!file) return;
    try {
      const diffs = await api.getCommitFileDiff(repoPath, stashOid, file.path, file.oldPath);
      setPreview(diffs.find((item) => item.path === path || item.oldPath === path) ?? null);
    } catch (reason) { setError(String(reason)); setMessage(String(reason)); }
  };

  const run = async (action: () => Promise<unknown>, success: string) => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      await action();
      setMessage(success);
      setPreview(null);
      await reload();
    } catch (reason) {
      setError(String(reason));
      setMessage(String(reason));
    } finally {
      setBusy(false);
    }
  };

  const stashAll = () => void run(
    () => api.stashPush(repoPath, stashMessage, includeUntracked, keepIndex),
    "已保存 stash",
  );

  const stashSelected = () => void run(
    () => api.stashPush(repoPath, stashMessage, includeUntracked, keepIndex, [...checked]),
    "已保存选中的变更",
  );

  const applyStash = () => {
    const stash = stashes.find((item) => item.oid === stashOid);
    if (stash) void run(() => api.stashApply(repoPath, stash.name, false, stash.oid), "已应用 stash");
  };

  const dropStash = async () => {
    const stash = stashes.find((item) => item.oid === stashOid);
    if (!stash) return;
    if (!await confirm({ title: `删除 ${stash.name}？`, body: "删除后无法通过 Stash 列表恢复。", danger: true, confirmLabel: "删除 Stash" })) return;
    void run(() => api.stashDrop(repoPath, stash.name, stash.oid), "已删除 stash");
  };

  return <div className="stash-window">
    <div className="stash-toolbar">
      <label>Show:
        <select
          value={stashOid ?? ""}
          disabled={busy}
          onChange={(e) => {
            const value = e.target.value;
            setStashOid(value || null);
            setSelectedPath(null);
            setPreview(null);
            setStashFiles([]);
            if (value) setStashMessage("");
          }}
        >
          <option value="">Current working directory changes</option>
          {stashes.map((stash) => <option key={stash.oid} value={stash.oid}>{stash.name} · {stash.message || "（无说明）"}</option>)}
        </select>
      </label>
      <button disabled={busy} onClick={() => void reload()}>刷新</button>
    </div>
    {error && <InlineError message={error} />}
    <div className="stash-body">
      <div className="stash-files" role="listbox" aria-label={isWorking ? "工作区变更" : "Stash 变更"}>
        <div className="stash-filter"><input aria-label="过滤文件" placeholder="Filter files using a regular expression…" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
        {tree.length === 0 && <div className="panel-hint">{files.length === 0 ? (isWorking ? "工作区没有变更。" : "该 stash 没有文件。") : "无匹配文件。"}</div>}
        {renderTree(tree, 0)}
      </div>
      <div className="stash-preview">
        {preview
          ? <DiffView
            files={[preview]}
            highlightEnabled={highlightEnabled}
            showFileHeader={false}
            prefKey={repoPath}
            loadFile={(file) => isWorking
              ? api.getWorktreeFileDiff(repoPath, (working.find((item) => item.path === file.path)?.staged ?? false), file.path, file.oldPath)
                .then((diffs) => diffs.find((item) => item.path === file.path || item.oldPath === file.path) ?? null)
              : stashOid
                ? api.getCommitFileDiff(repoPath, stashOid, file.path, file.oldPath)
                  .then((diffs) => diffs.find((item) => item.path === file.path || item.oldPath === file.path) ?? null)
                : Promise.resolve(null)}
          />
          : <div className="empty-state">{isWorking ? "选择一个工作区文件查看差异" : "选择一个 stash 文件查看差异"}</div>}
      </div>
    </div>
    <div className="stash-footer">
      <label className="stash-message">Message:
        <input
          disabled={busy || !isWorking}
          value={isWorking ? stashMessage : (stashes.find((item) => item.oid === stashOid)?.message ?? "")}
          onChange={(e) => setStashMessage(e.target.value)}
          placeholder={isWorking ? "stash 说明（可空）" : ""}
        />
      </label>
      <div className="stash-options">
        <label className="checkbox-row"><input type="checkbox" disabled={busy || !isWorking} checked={keepIndex} onChange={(e) => setKeepIndex(e.target.checked)} />Keep index</label>
        <label className="checkbox-row"><input type="checkbox" disabled={busy || !isWorking} checked={includeUntracked} onChange={(e) => setIncludeUntracked(e.target.checked)} />Include untracked</label>
      </div>
      <div className="stash-actions">
        {isWorking ? <>
          <button disabled={busy || working.length === 0} onClick={stashAll}>Stash all changes</button>
          <button disabled={busy || checked.size === 0} onClick={stashSelected}>Stash selected changes</button>
        </> : <>
          <button disabled={busy} onClick={applyStash}>Apply Selected Stash</button>
          <button className="danger-button" disabled={busy} onClick={() => void dropStash()}>Drop Selected Stash</button>
        </>}
      </div>
    </div>
  </div>;
}
