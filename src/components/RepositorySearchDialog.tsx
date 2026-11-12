import { useMemo, useRef, useState } from "react";
import type { RepositoryRecord } from "../repositoryRecords";
import type { RepoInfo } from "../types";
import { displayRepoName } from "../repoGroups";
import type { RepoGroupConfig } from "../repoGroups";
import Dialog from "../ui/Dialog";
import ContextMenu from "../ui/ContextMenu";
import RepositoryRecordList, { repositoryRecordMatches } from "./RepositoryRecordList";

export interface RepositorySearchDialogProps {
  config: RepoGroupConfig;
  records: RepositoryRecord[];
  repos: RepoInfo[];
  activePath: string | null;
  errors: Record<string, string>;
  busy: boolean;
  onClose: () => void;
  onOpen: (path: string) => Promise<boolean>;
  onRemove: (paths: string[]) => Promise<void>;
  onRelocate: (path: string) => Promise<void>;
}

/** 仓库专用查找：别名 / 原名 / 路径 / 分组匹配，成功打开才关闭。 */
export default function RepositorySearchDialog(props: RepositorySearchDialogProps) {
  const [query, setQuery] = useState("");
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const [menu, setMenu] = useState<{ path: string; x: number; y: number } | null>(null);
  const operation = useRef(false);
  const propsRef = useRef(props);
  const inputRef = useRef<HTMLInputElement>(null);
  propsRef.current = props;
  const locked = props.busy || pending;
  const results = useMemo(() => props.records.map((record, index) => ({ record, index }))
    .filter(({ record }) => repositoryRecordMatches(props.config, record, query))
    .sort((a, b) => b.record.lastOpenedAt - a.record.lastOpenedAt || a.index - b.index)
    .map(({ record }) => record), [props.records, props.config, query]);
  const focused = results.find((record) => record.path === focusedPath) ?? results[0];
  const errors = { ...localErrors, ...props.errors };
  const close = () => { if (!propsRef.current.busy && !operation.current) propsRef.current.onClose(); };
  const run = async (action: () => Promise<void>, path: string) => {
    if (propsRef.current.busy || operation.current) return;
    operation.current = true;
    setPending(true);
    setMessage("");
    setMenu(null);
    try { await action(); }
    catch (error) {
      const text = String(error);
      setMessage(text);
      setLocalErrors((old) => ({ ...old, [path]: text }));
    } finally { operation.current = false; setPending(false); }
  };
  const relocate = (path: string) => void run(async () => {
    await propsRef.current.onRelocate(path);
    setLocalErrors((old) => { const next = { ...old }; delete next[path]; return next; });
  }, path);
  const open = (path: string) => void run(async () => {
    if (await propsRef.current.onOpen(path)) propsRef.current.onClose();
    else setLocalErrors((old) => ({ ...old, [path]: "打开失败。请重新定位目录，或移除这条记录（不删除磁盘文件）。" }));
  }, path);

  return <>
    <Dialog title="查找仓库" onClose={close} busy={locked} resizable sizeKey="repository-search" minWidth={360} minHeight={320}
      className="repository-search-dialog" footer={<><span className="repository-manager-footer-hint">↑ / ↓ 浏览 · Enter 打开 · Esc 关闭</span><button disabled={locked || !focused} className="primary" onClick={() => focused && open(focused.path)}>{focused?.path === props.activePath ? "激活仓库" : "打开 / 激活"}</button><button disabled={locked} onClick={close}>关闭</button></>}>
      <div className="repository-search-content">
        <input ref={inputRef} data-autofocus className="repository-search-input" aria-label="搜索仓库记录" placeholder="搜索本地别名、仓库名、路径或分组" value={query}
          onChange={(event) => { setQuery(event.target.value); setFocusedPath(null); }} onKeyDown={(event) => {
            if (event.key === "Enter") { event.preventDefault(); if (focused && !locked) open(focused.path); }
            else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const list = event.currentTarget.parentElement?.querySelector<HTMLElement>(".repository-record-row[tabindex='0']");
              list?.focus();
            }
          }} />
        <div className="repository-search-summary muted">{results.length} 条记录 · {query.trim() ? "按别名、名称、路径与分组筛选" : "最近打开优先，同时间保持记录顺序"}</div>
        <RepositoryRecordList config={props.config} records={results} repos={props.repos} activePath={props.activePath} errors={errors} busy={locked}
          focusedPath={focusedPath} onFocusPath={setFocusedPath} onOpen={open} openOnClick onContextMenu={(path, x, y) => setMenu({ path, x, y })}
          emptyMessage={props.records.length === 0 ? "还没有仓库记录，请先打开或添加仓库。" : "没有匹配的仓库，尝试名称、路径或分组。"} />
        <div className="repository-search-actions">
          <span className="repository-manager-focused-name muted" title={focused?.path}>{focused ? displayRepoName(props.config, focused) : "没有选中记录"}</span>
          <button disabled={locked || !focused} onClick={() => focused && relocate(focused.path)}>重新定位目录…</button>
          <button className="danger-button" disabled={locked || !focused} onClick={() => focused && void run(() => propsRef.current.onRemove([focused.path]), focused.path)}>移除记录…</button>
        </div>
        <p className="repository-manager-save-note">打开成功才关闭此窗口；失败记录会保留。重新定位由系统目录选择处理；移除只删本地记录，不删除磁盘文件。</p>
        {message && <div className="repository-manager-inline-error" role="alert">{message}</div>}
      </div>
    </Dialog>
    {menu && <ContextMenu x={menu.x} y={menu.y} ariaLabel="仓库查找结果操作" onClose={() => setMenu(null)} items={[
      { id: "open", label: "打开 / 激活仓库", disabled: locked, onSelect: () => open(menu.path) },
      { id: "relocate", label: "重新定位目录…", disabled: locked, onSelect: () => relocate(menu.path) },
      { id: "remove", label: "移除记录…（不删磁盘文件）", danger: true, disabled: locked, onSelect: () => void run(() => propsRef.current.onRemove([menu.path]), menu.path) },
    ]} />}
  </>;
}
