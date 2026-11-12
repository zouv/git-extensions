import { useEffect, useRef, useState } from "react";
import type { RepositoryRecord } from "../repositoryRecords";
import type { RepoInfo } from "../types";
import type { RepoGroupConfig } from "../repoGroups";
import {
  DEFAULT_GROUP_ID, GROUP_COLOR_PRESETS, createGroup, deleteGroup, displayRepoName, groupById,
  pinnedGroups, renameGroup, reposInGroup, setGroupColor, setRepoAlias, setRepoGroup, togglePin,
} from "../repoGroups";
import Dialog from "../ui/Dialog";
import ContextMenu from "../ui/ContextMenu";
import type { MenuItem } from "../ui/ContextMenu";
import { useConfirm } from "../ui/Confirm";
import { useDirtyClose } from "../ui/useDirtyClose";
import GroupAvatar from "./GroupAvatar";
import RepositoryRecordList, { repositoryRecordMatches } from "./RepositoryRecordList";
import type { SessionMeta } from "./RepositoryTabs";

export interface RepoGroupsDialogProps {
  config: RepoGroupConfig;
  records: RepositoryRecord[];
  repos: RepoInfo[];
  activePath: string | null;
  meta: Record<string, SessionMeta>;
  errors: Record<string, string>;
  busy: boolean;
  onChange: (config: RepoGroupConfig) => void;
  onClose: () => void;
  initialGroupId?: string;
  onOpen: (path: string) => Promise<boolean>;
  onAdd: (groupId: string) => Promise<void>;
  onCloseRepos: (paths: string[]) => Promise<void>;
  onRemove: (paths: string[]) => Promise<void>;
  onRelocate: (path: string) => Promise<void>;
}

type Editor = { kind: "create"; initial: string; value: string }
  | { kind: "rename"; id: string; initial: string; value: string }
  | { kind: "alias"; path: string; initial: string; value: string };
type Menu = { kind: "group"; id: string; x: number; y: number }
  | { kind: "record"; path: string; x: number; y: number };
const ALL_RECORDS = "all-records";

/** 左侧选择是管理器本地筛选；只有打开 / 激活回调会切换主窗口。 */
export default function RepoGroupsDialog(props: RepoGroupsDialogProps) {
  const { config, records } = props;
  const [groupId, setGroupId] = useState(() => props.initialGroupId && groupById(config, props.initialGroupId)
    ? props.initialGroupId : ALL_RECORDS);
  const [query, setQuery] = useState("");
  const [openedOnly, setOpenedOnly] = useState(false);
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moveTo, setMoveTo] = useState(DEFAULT_GROUP_ID);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const operationRef = useRef(false);
  const configRef = useRef(config);
  const propsRef = useRef(props);
  const editorInput = useRef<HTMLInputElement>(null);
  const groupButtons = useRef(new Map<string, HTMLButtonElement>());
  configRef.current = config;
  propsRef.current = props;
  const confirm = useConfirm();
  const locked = props.busy || pending;
  const dirty = editor !== null && editor.value !== editor.initial;
  const close = useDirtyClose(dirty, locked, props.onClose);
  const group = groupById(config, groupId);
  const openPaths = new Set(props.repos.map((repo) => repo.path));
  const members = groupId === ALL_RECORDS ? records : reposInGroup(config, records, groupId);
  const visible = members.filter((record) => (!openedOnly || openPaths.has(record.path)) && repositoryRecordMatches(config, record, query));
  const selectedPaths = visible.filter((record) => selected.has(record.path)).map((record) => record.path);
  const selectedOpened = selectedPaths.filter((path) => openPaths.has(path));
  const focused = visible.find((record) => record.path === focusedPath) ?? visible[0];
  const errors = { ...localErrors, ...props.errors };
  const editorKey = editor?.kind === "alias" ? editor.path : editor?.kind === "rename" ? editor.id : editor?.kind;
  const navIds = [ALL_RECORDS, ...config.groups.map((item) => item.id)];
  const pins = new Set(pinnedGroups(config).map((item) => item.id));

  useEffect(() => {
    if (groupId !== ALL_RECORDS && !groupById(config, groupId)) setGroupId(DEFAULT_GROUP_ID);
    if (!groupById(config, moveTo)) setMoveTo(DEFAULT_GROUP_ID);
  }, [config, groupId, moveTo]);
  useEffect(() => { if (editorKey) editorInput.current?.focus(); }, [editorKey]);
  useEffect(() => {
    const paths = new Set(records.map((record) => record.path));
    setSelected((old) => {
      const next = new Set([...old].filter((path) => paths.has(path)));
      return next.size === old.size ? old : next;
    });
  }, [records]);

  const run = async (action: () => Promise<void>, path?: string) => {
    if (propsRef.current.busy || operationRef.current) return;
    operationRef.current = true;
    setPending(true);
    setMenu(null);
    setMessage("");
    try { await action(); }
    catch (error) {
      const text = String(error);
      setMessage(text);
      if (path) setLocalErrors((old) => ({ ...old, [path]: text }));
    } finally { operationRef.current = false; setPending(false); }
  };
  const openRecord = (path: string) => void run(async () => {
    if (await propsRef.current.onOpen(path)) {
      setLocalErrors((old) => { const next = { ...old }; delete next[path]; return next; });
    } else setLocalErrors((old) => ({ ...old, [path]: "打开失败。请重新定位仓库目录，或移除记录。" }));
  }, path);
  const relocateRecord = (path: string) => void run(async () => {
    await propsRef.current.onRelocate(path);
    setLocalErrors((old) => { const next = { ...old }; delete next[path]; return next; });
  }, path);
  const toggleSelection = (path: string) => setSelected((old) => {
    const next = new Set(old);
    if (next.has(path)) next.delete(path); else next.add(path);
    return next;
  });
  const selectAll = () => setSelected(new Set(visible.map((record) => record.path)));
  const chooseGroup = (id: string) => { setGroupId(id); setSelected(new Set()); setFocusedPath(null); };
  const beginEditor = async (next: Editor) => {
    if (locked) return;
    if (dirty && !await confirm({ title: "放弃未保存的输入？", body: "切换编辑项目会丢弃当前输入；已经保存的分类与别名不受影响。", danger: true, confirmLabel: "放弃输入" })) return;
    setEditor(next);
    setMessage("");
  };
  const saveEditor = () => {
    if (!editor || locked) return;
    const current = configRef.current;
    let next: RepoGroupConfig;
    if (editor.kind === "create") next = createGroup(current, editor.value);
    else if (editor.kind === "rename") {
      if (!groupById(current, editor.id)) { setMessage("分组已不存在，请取消编辑。"); return; }
      next = renameGroup(current, editor.id, editor.value);
    } else {
      if (!propsRef.current.records.some((record) => record.path === editor.path)) { setMessage("仓库记录已不存在，请取消编辑。"); return; }
      next = setRepoAlias(current, editor.path, editor.value);
    }
    if (editor.kind !== "alias" && (next === current || !editor.value.trim())) {
      setMessage("名称不能为空或与现有分组重复；最多可创建 64 个分组。");
      return;
    }
    props.onChange(next);
    if (editor.kind === "create") {
      const created = next.groups.find((item) => !current.groups.some((old) => old.id === item.id));
      if (created) chooseGroup(created.id);
    }
    setEditor(null);
    setMessage("");
  };
  const cancelEditor = async () => {
    if (locked) return;
    if (dirty && !await confirm({ title: "放弃未保存的输入？", body: "当前新分组、重命名或别名输入尚未保存。", danger: true, confirmLabel: "放弃输入" })) return;
    setEditor(null);
    setMessage("");
  };
  const removeGroup = (id: string) => void run(async () => {
    const currentGroup = groupById(configRef.current, id);
    if (!currentGroup || id === DEFAULT_GROUP_ID) return;
    const count = reposInGroup(configRef.current, propsRef.current.records, id).length;
    const ok = await confirm({ title: `删除分组 ${currentGroup.name}？`, body: <p>组内 {count} 条仓库记录将回落到未分组（Default）。记录、别名和打开的页签都会保留，不会删除磁盘文件。</p>, confirmLabel: "删除分组", danger: true });
    if (!ok || propsRef.current.busy) return;
    propsRef.current.onChange(deleteGroup(configRef.current, id));
    if (groupId === id) chooseGroup(DEFAULT_GROUP_ID);
  });
  const moveSelected = () => {
    if (locked || selectedPaths.length === 0) return;
    let next = configRef.current;
    for (const path of selectedPaths) next = setRepoGroup(next, path, moveTo);
    props.onChange(next);
    setSelected(new Set());
  };
  const menuItems: MenuItem[] = menu?.kind === "group" ? (() => {
    const target = groupById(config, menu.id);
    const isDefault = menu.id === DEFAULT_GROUP_ID;
    return [
      { id: "create", label: "创建分组…", disabled: locked, onSelect: () => void beginEditor({ kind: "create", initial: "", value: "" }) },
      { id: "rename", label: "重命名分组…", disabled: locked || !target || isDefault, onSelect: () => target && void beginEditor({ kind: "rename", id: target.id, initial: target.name, value: target.name }) },
      { id: "colors", label: "分组颜色", disabled: locked || !target, children: GROUP_COLOR_PRESETS.map((preset) => ({
        id: preset.value, label: preset.label, color: preset.value, checked: target?.color === preset.value, disabled: locked,
        onSelect: () => { if (!propsRef.current.busy && !operationRef.current) propsRef.current.onChange(setGroupColor(configRef.current, menu.id, preset.value)); },
      })) },
      { id: "pin", label: pins.has(menu.id) ? "取消固定到顶部" : "固定到顶部", checked: pins.has(menu.id), disabled: locked || !target,
        onSelect: () => props.onChange(togglePin(configRef.current, menu.id)) },
      { id: "separator", separator: true },
      { id: "delete", label: "删除分组…", danger: true, disabled: locked || isDefault || !target, onSelect: () => removeGroup(menu.id) },
    ];
  })() : menu?.kind === "record" ? (() => {
    const target = records.find((record) => record.path === menu.path);
    const path = menu.path;
    return [
      { id: "open", label: openPaths.has(path) ? "激活仓库" : "打开仓库", disabled: locked, onSelect: () => openRecord(path) },
      { id: "alias", label: "编辑显示别名…", disabled: locked || !target, onSelect: () => void beginEditor({ kind: "alias", path, initial: config.aliases[path] ?? "", value: config.aliases[path] ?? "" }) },
      { id: "relocate", label: "重新定位目录…", disabled: locked, onSelect: () => relocateRecord(path) },
      { id: "close", label: "关闭页签（保留记录）", disabled: locked || !openPaths.has(path), onSelect: () => void run(() => propsRef.current.onCloseRepos([path])) },
      { id: "separator", separator: true },
      { id: "remove", label: "移除记录…（不删磁盘文件）", danger: true, disabled: locked, onSelect: () => void run(() => propsRef.current.onRemove([path])) },
    ];
  })() : [];

  return <>
    <Dialog title="组管理器" onClose={close} busy={locked} wide resizable sizeKey="repository-manager" minWidth={360} minHeight={360}
      className="repository-manager-dialog" footer={<><span className="repository-manager-footer-hint">方向键浏览 · 空格勾选 · Enter / 双击打开 · Shift+F10 操作</span><button disabled={locked} onClick={close}>关闭</button></>}>
      <div className="repository-manager-layout">
        <aside className="repository-manager-sidebar" aria-label="仓库分组">
          <div className="repository-manager-sidebar-heading">记录与分组</div>
          <div className="repository-manager-groups" role="navigation" aria-label="本地分组筛选">
            {navIds.map((id) => {
              const item = groupById(config, id);
              const name = id === ALL_RECORDS ? "所有记录" : id === DEFAULT_GROUP_ID ? "未分组" : item?.name ?? "";
              const count = id === ALL_RECORDS ? records.length : reposInGroup(config, records, id).length;
              return <button key={id} ref={(element) => { if (element) groupButtons.current.set(id, element); else groupButtons.current.delete(id); }}
                className={`repository-manager-group${groupId === id ? " selected" : ""}`} aria-current={groupId === id ? "true" : undefined}
                tabIndex={groupId === id ? 0 : -1} title={name} onClick={() => chooseGroup(id)}
                onKeyDown={(event) => {
                  const index = navIds.indexOf(id);
                  const next = event.key === "ArrowDown" ? Math.min(navIds.length - 1, index + 1)
                    : event.key === "ArrowUp" ? Math.max(0, index - 1) : event.key === "Home" ? 0 : event.key === "End" ? navIds.length - 1 : null;
                  if (next !== null) { event.preventDefault(); const nextId = navIds[next]; chooseGroup(nextId); groupButtons.current.get(nextId)?.focus(); }
                  else if ((event.key === "F10" && event.shiftKey) || event.key === "ContextMenu") {
                    event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect();
                    setMenu({ kind: "group", id, x: rect.right, y: rect.bottom });
                  }
                }} onContextMenu={(event) => { event.preventDefault(); event.currentTarget.focus(); chooseGroup(id); setMenu({ kind: "group", id, x: event.clientX, y: event.clientY }); }}>
                {item ? <GroupAvatar id={id} name={name} color={item.color} size={23} /> : <span className="repository-manager-all-icon" aria-hidden="true">≡</span>}
                <span className="repository-manager-group-name">{name}</span>{pins.has(id) && <span className="muted" aria-label="已固定">固定</span>}<span className="count-badge">{count}</span>
              </button>;
            })}
          </div>
          <p className="repository-manager-local-note">这里的选择只筛选记录，不改变顶部视图。</p>
        </aside>
        <section className="repository-manager-members" aria-label="成员管理">
          <div className="repository-manager-member-heading">
            <h4>{groupId === ALL_RECORDS ? "所有记录" : groupId === DEFAULT_GROUP_ID ? "未分组" : group?.name}</h4>
            <span className="muted">{visible.length} / {members.length}</span>
            <button disabled={locked} aria-haspopup="menu" onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setMenu({ kind: "group", id: groupId, x: rect.left, y: rect.bottom + 4 }); }}>分组操作 ▾</button>
            <button disabled={locked} onClick={() => void run(() => propsRef.current.onAdd(groupId === ALL_RECORDS ? DEFAULT_GROUP_ID : groupId))}>添加仓库…</button>
          </div>
          <div className="repository-manager-filter">
            <input data-autofocus aria-label="搜索成员" placeholder="搜索别名、名称、路径或分组" value={query} onChange={(event) => { setQuery(event.target.value); setSelected(new Set()); }} />
            <select aria-label="打开状态筛选" value={openedOnly ? "opened" : "all"} onChange={(event) => { setOpenedOnly(event.target.value === "opened"); setSelected(new Set()); }}><option value="all">全部状态</option><option value="opened">仅已打开</option></select>
          </div>
          <div className="repository-manager-selection-bar">
            <label><input type="checkbox" disabled={locked || visible.length === 0} checked={visible.length > 0 && selectedPaths.length === visible.length}
              ref={(element) => { if (element) element.indeterminate = selectedPaths.length > 0 && selectedPaths.length < visible.length; }}
              onChange={(event) => event.target.checked ? selectAll() : setSelected(new Set())} />全选结果</label>
            <span className="muted">已选 {selectedPaths.length}</span>
            <select aria-label="移动到分组" value={moveTo} disabled={locked} onChange={(event) => setMoveTo(event.target.value)}>{config.groups.map((item) => <option key={item.id} value={item.id}>{item.id === DEFAULT_GROUP_ID ? "未分组" : item.name}</option>)}</select>
            <button disabled={locked || selectedPaths.length === 0} onClick={moveSelected}>移动归组</button>
            <button disabled={locked || selectedOpened.length === 0} onClick={() => void run(() => propsRef.current.onCloseRepos(selectedOpened))}>关闭已选页签</button>
            <button className="danger-button" disabled={locked || selectedPaths.length === 0} onClick={() => void run(() => propsRef.current.onRemove(selectedPaths))}>移除已选记录…</button>
          </div>
          <RepositoryRecordList config={config} records={visible} repos={props.repos} activePath={props.activePath} meta={props.meta} errors={errors} busy={locked}
            focusedPath={focusedPath} onFocusPath={setFocusedPath} onOpen={openRecord} selectedPaths={selected}
            onToggleSelection={toggleSelection} onSelectAll={selectAll} onContextMenu={(path, x, y) => setMenu({ kind: "record", path, x, y })}
            emptyMessage={records.length === 0 ? "还没有仓库记录，点击“添加仓库”开始。" : "当前分组或筛选下没有仓库记录。"} />
          <div className="repository-manager-record-actions">
            <span className="repository-manager-focused-name muted" title={focused?.path}>{focused ? displayRepoName(config, focused) : "选中记录以操作"}</span>
            <button disabled={locked || !focused} onClick={() => focused && openRecord(focused.path)}>{focused && openPaths.has(focused.path) ? "激活" : "打开"}</button>
            <button disabled={locked || !focused} onClick={() => focused && void beginEditor({ kind: "alias", path: focused.path, initial: config.aliases[focused.path] ?? "", value: config.aliases[focused.path] ?? "" })}>编辑别名…</button>
            <button disabled={locked || !focused} onClick={() => focused && relocateRecord(focused.path)}>重新定位…</button>
            <button disabled={locked || !focused} aria-haspopup="menu" onClick={(event) => { if (!focused) return; const rect = event.currentTarget.getBoundingClientRect(); setMenu({ kind: "record", path: focused.path, x: rect.left, y: rect.bottom }); }}>更多 ▾</button>
          </div>
          {editor && <form className="repository-manager-editor" onSubmit={(event) => { event.preventDefault(); saveEditor(); }}>
            <label htmlFor="repository-manager-draft">{editor.kind === "create" ? "新分组名称" : editor.kind === "rename" ? `重命名：${groupById(config, editor.id)?.name ?? "已删除分组"}` : `显示别名：${records.find((record) => record.path === editor.path)?.name ?? "仓库"}`}</label>
            <div><input id="repository-manager-draft" ref={editorInput} maxLength={40} disabled={locked} value={editor.value} onChange={(event) => setEditor({ ...editor, value: event.target.value })}
              placeholder={editor.kind === "alias" ? "留空恢复仓库原名" : "分组名称"} /><button type="submit" className="primary" disabled={locked || (editor.kind !== "alias" && !editor.value.trim())}>保存并立即生效</button><button type="button" disabled={locked} onClick={() => void cancelEditor()}>取消编辑</button></div>
            <span className="muted">{editor.kind === "alias" ? "别名仅影响本地显示，不更改仓库目录。输入在点击保存后立即生效。" : "输入在点击保存后立即生效。"}</span>
          </form>}
          <p className="repository-manager-save-note">分类移动、颜色与固定立即保存；分组名称和别名输入需点击保存。关闭页签保留记录；移除记录不删除磁盘文件。</p>
          {message && <div className="repository-manager-inline-error" role="alert">{message}</div>}
        </section>
      </div>
    </Dialog>
    {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} ariaLabel={menu.kind === "group" ? "分组标题操作" : "仓库记录操作"} onClose={() => setMenu(null)} />}
  </>;
}
