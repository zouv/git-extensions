import { useCallback, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { FileDiff } from "../types";
import { buildFileTreeRows } from "../viewState";
import Icon from "../ui/Icon";

interface Props {
  files: FileDiff[];
  selectedPath: string | null;
  loading?: boolean;
  emptyLabel?: string;
  onSelect: (file: FileDiff) => void;
}

const optionId = (path: string) => `commit-file-option-${encodeURIComponent(path)}`;
const MAX_ROWS = 500;

/** 提交详情下方的变更文件列表：列表 / 文件树切换，与底部 Diff 面板联动，上下键 / Enter 选择。 */
export default function CommitFilesPanel({ files, selectedPath, loading = false, emptyLabel = "该提交没有文件变更", onSelect }: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  const [treeMode, setTreeMode] = useState(false);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const visibleFiles = useMemo(() => files.length > MAX_ROWS ? files.slice(0, MAX_ROWS) : files, [files]);
  const rows = useMemo(() => treeMode
    ? buildFileTreeRows(visibleFiles.map((file, index) => ({ path: file.path, index, value: file })), collapsedFolders)
    : visibleFiles.map((file, index) => ({ kind: "file" as const, value: file, index, depth: 0 })),
  [collapsedFolders, treeMode, visibleFiles]);
  const fileRows = useMemo(() => rows.filter((row) => row.kind === "file"), [rows]);
  const select = useCallback((file: FileDiff) => {
    onSelect(file);
    listRef.current?.focus({ preventScroll: true });
  }, [onSelect]);
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // 目录行是独立按钮，Enter / Space 留给它自己折叠。
    if ((event.target as HTMLElement | null)?.closest(".commit-file-dir")) return;
    if (fileRows.length === 0) return;
    const index = fileRows.findIndex((row) => row.value.path === selectedPath);
    let next = index;
    if (event.key === "ArrowDown") next = Math.min(fileRows.length - 1, index + 1);
    else if (event.key === "ArrowUp") next = Math.max(0, index < 0 ? 0 : index - 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = fileRows.length - 1;
    else if (event.key === "Enter" || event.key === " ") { next = index < 0 ? 0 : index; }
    else return;
    event.preventDefault();
    const file = fileRows[next]?.value;
    // 键盘只移动 / 打开选中项；再次点击同一文件才由父组件切换关闭底部 Diff。
    if (file && file.path !== selectedPath) onSelect(file);
    const items = listRef.current?.querySelectorAll<HTMLElement>(".commit-file-item");
    items?.[next]?.scrollIntoView({ block: "nearest" });
  };
  const toggleFolder = (path: string) => setCollapsedFolders((prev) => {
    const next = new Set(prev);
    if (next.has(path)) next.delete(path); else next.add(path);
    return next;
  });

  return (
    <div className="commit-files">
      <div className="commit-files-header">
        <span>变更文件 ({files.length})</span>
        <button type="button" className={`text-toggle${treeMode ? " active" : ""}`} title="切换列表 / 文件树" aria-pressed={treeMode} onClick={() => setTreeMode((value) => !value)}>{treeMode ? "列表" : "目录树"}</button>
      </div>
      {files.length > MAX_ROWS && <div className="diff-file-note">仅显示前 {MAX_ROWS} 个文件。</div>}
      <div
        className="commit-files-list"
        ref={listRef}
        role="listbox"
        aria-label="提交变更文件"
        aria-activedescendant={selectedPath ? optionId(selectedPath) : undefined}
        tabIndex={0}
        onKeyDown={onKeyDown}
      >
        {loading && files.length === 0 && <div className="panel-hint"><span className="spinner" /> 正在读取文件列表…</div>}
        {!loading && files.length === 0 && <div className="panel-hint">{emptyLabel}</div>}
        {rows.map((row) => {
          if (row.kind === "dir") {
            const isCollapsed = collapsedFolders.has(row.path);
            return (
              <button
                type="button"
                key={`dir-${row.path}`}
                className="commit-file-dir"
                style={{ paddingLeft: 8 + row.depth * 14 }}
                aria-expanded={!isCollapsed}
                onClick={() => toggleFolder(row.path)}
              >
                <Icon name={isCollapsed ? "folder" : "chevron-down"} size={12} />
                <span>{row.path.split("/").pop()}</span>
              </button>
            );
          }
          const file = row.value;
          const selected = file.path === selectedPath;
          return (
            <div
              key={`${file.oldPath ?? ""}->${file.path}`}
              id={optionId(file.path)}
              className={`commit-file-item${selected ? " selected" : ""}`}
              style={treeMode ? { paddingLeft: 8 + row.depth * 14 } : undefined}
              role="option"
              aria-selected={selected}
              tabIndex={-1}
              title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
              onClick={() => select(file)}
            >
              <span className={`file-status status-${file.status}`}>{file.status === "conflicted" ? "!" : file.status[0].toUpperCase()}</span>
              <span className="file-path">{treeMode ? file.path.split("/").pop() : file.path}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
