import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { ExplorerTarget, FileContent } from "../types";
import Icon from "../ui/Icon";
import InlineError from "../ui/InlineError";

interface Props {
  target: ExplorerTarget;
  setMessage?: (message: string) => void;
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
  path: string;
}

type TreeNode = DirNode | FileNode;

function buildTree(files: string[]): TreeNode[] {
  const root: DirNode = { kind: "dir", name: "", path: "", children: [] };
  for (const file of files) {
    const parts = file.split("/");
    let node = root;
    for (let index = 0; index < parts.length - 1; index += 1) {
      const name = parts[index];
      let child = node.children.find((item): item is DirNode => item.kind === "dir" && item.name === name);
      if (!child) {
        child = { kind: "dir", name, path: parts.slice(0, index + 1).join("/"), children: [] };
        node.children.push(child);
      }
      node = child;
    }
    node.children.push({ kind: "file", name: parts[parts.length - 1], path: file });
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

/** 当前分支 HEAD 已提交文件的树形浏览：左文件树，右文件内容。 */
export default function ViewFilesWindow({ target, setMessage }: Props) {
  const repoPath = target.repo.path;
  const [files, setFiles] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<FileContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [contentLoading, setContentLoading] = useState(false);
  const [error, setError] = useState("");

  const reload = async () => {
    setLoading(true); setError("");
    try {
      setFiles(await api.listHeadFiles(repoPath));
    } catch (reason) {
      setError(String(reason));
      setMessage?.(String(reason));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void reload(); }, [repoPath]);

  useEffect(() => {
    if (!selected) { setContent(null); return; }
    let alive = true;
    setContentLoading(true); setError("");
    api.getFileContent(repoPath, selected)
      .then((next) => { if (alive) setContent(next); })
      .catch((reason) => { if (alive) setError(String(reason)); })
      .finally(() => { if (alive) setContentLoading(false); });
    return () => { alive = false; };
  }, [repoPath, selected]);

  const visibleFiles = useMemo(() => {
    const query = filter.trim();
    if (!query) return files;
    let regex: RegExp | null = null;
    try { regex = new RegExp(query, "i"); } catch { /* 非法正则退回子串匹配 */ }
    return files.filter((file) => regex
      ? regex.test(file)
      : file.toLowerCase().includes(query.toLowerCase()));
  }, [files, filter]);
  const tree = useMemo(() => buildTree(visibleFiles), [visibleFiles]);

  const renderTree = (nodes: TreeNode[], depth: number) => nodes.map((node) => {
    if (node.kind === "dir") {
      const isCollapsed = collapsed.has(node.path);
      return <div key={`dir:${node.path}`}>
        <div
          className="view-files-tree-row view-files-dir"
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => setCollapsed((prev) => {
            const next = new Set(prev);
            if (next.has(node.path)) next.delete(node.path); else next.add(node.path);
            return next;
          })}
        >
          <span className={`stash-chevron${isCollapsed ? " collapsed" : ""}`}>▾</span>
          <Icon name="folder" size={13} />
          <span className="file-path">{node.name}</span>
        </div>
        {!isCollapsed && renderTree(node.children, depth + 1)}
      </div>;
    }
    return <div
      key={`file:${node.path}`}
      className={`view-files-tree-row${selected === node.path ? " selected" : ""}`}
      style={{ paddingLeft: 8 + depth * 14 }}
      role="option"
      aria-selected={selected === node.path}
      tabIndex={0}
      title={node.path}
      onClick={() => setSelected(node.path)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setSelected(node.path);
        }
      }}
    >
      <Icon name="file" size={13} />
      <span className="file-path">{node.name}</span>
    </div>;
  });

  return <div className="view-files-window">
    <div className="view-files-toolbar">
      <div>
        <strong>View files</strong>
        <span className="muted">{target.repo.headBranch ?? "HEAD"} · {files.length} 个已提交文件</span>
      </div>
      <input aria-label="过滤文件" placeholder="Filter files…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <button disabled={loading} onClick={() => void reload()}>刷新</button>
    </div>
    {error && <InlineError message={error} />}
    <div className="view-files-body">
      <div className="view-files-tree" role="listbox" aria-label="当前分支已提交文件">
        {loading && <div className="panel-hint"><span className="spinner" /> 读取文件列表…</div>}
        {!loading && files.length === 0 && <div className="panel-hint">当前分支还没有已提交文件。</div>}
        {!loading && files.length > 0 && visibleFiles.length === 0 && <div className="panel-hint">无匹配文件。</div>}
        {!loading && renderTree(tree, 0)}
      </div>
      <div className="view-files-content">
        {contentLoading && <div className="empty-state"><span className="spinner" /> 读取文件内容…</div>}
        {!contentLoading && !selected && <div className="empty-state"><Icon name="file" size={28} /><strong>选择一个文件</strong><span>查看当前分支已提交内容</span></div>}
        {!contentLoading && selected && content && (content.binary
          ? <div className="empty-state">二进制文件（{content.size.toLocaleString()} 字节）</div>
          : <>
            {content.truncated && <div className="settings-note">文件超过 2 MiB，仅显示前 2 MiB。</div>}
            <pre>{content.content}</pre>
          </>)}
      </div>
    </div>
  </div>;
}
