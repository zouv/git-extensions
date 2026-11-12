import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  CSSProperties, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent,
} from "react";
import type { RepoInfo } from "../types";
import { displayRepoName, groupById, groupForRepo } from "../repoGroups";
import type { RepoGroupConfig } from "../repoGroups";
import { insertionIndex, movePath } from "../tabOrder";
import type { IconName } from "../ui/Icon";
import Icon from "../ui/Icon";
import ContextMenu from "../ui/ContextMenu";
import Dialog from "../ui/Dialog";
import { useDirtyClose } from "../ui/useDirtyClose";

export interface SessionMeta { busy: boolean; dirty: boolean; conflictCount: number; loading?: boolean; error?: string | null }

interface Props {
  repos: RepoInfo[];
  activePath: string | null;
  meta: Record<string, SessionMeta>;
  repoGroups: RepoGroupConfig;
  onSetAlias: (path: string, alias: string) => void;
  onActivate: (path: string) => void;
  onClose: (path: string) => void;
  onCloseOthers: (path: string) => void;
  onOpen: () => void;
  onOpenRightOf: (path: string) => void;
  onCopyPath: (path: string) => void;
  onReveal: (path: string) => void;
  onReorder: (orderedPaths: string[]) => void;
  onBlankContextMenu: (x: number, y: number) => void;
}

interface DragState {
  path: string;
  pointerId: number;
  element: HTMLElement;
  startX: number;
  startY: number;
  lastClientX: number;
  dragging: boolean;
}

interface Insertion { index: number; left: number }

const DRAG_THRESHOLD = 6;

export default function RepositoryTabs(props: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number; repo: RepoInfo } | null>(null);
  const [listMenu, setListMenu] = useState<{ x: number; y: number } | null>(null);
  const [overflowing, setOverflowing] = useState(false);
  const listButtonRef = useRef<HTMLButtonElement>(null);
  const visiblePaths = props.repos.map((repo) => repo.path).join("\u0000");
  const [dragPath, setDragPath] = useState<string | null>(null);
  const [insertion, setInsertion] = useState<Insertion | null>(null);
  const [status, setStatus] = useState("");
  const [aliasTarget, setAliasTarget] = useState<RepoInfo | null>(null);
  const [aliasValue, setAliasValue] = useState("");
  const stripRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<string, HTMLDivElement>());
  const dragRef = useRef<DragState | null>(null);
  const insertionRef = useRef<Insertion | null>(null);
  const suppressClickRef = useRef(false);
  const label = (repo: RepoInfo) => displayRepoName(props.repoGroups, repo);
  const aliasDirty = aliasTarget ? aliasValue !== (props.repoGroups.aliases[aliasTarget.path] ?? "") : false;
  const closeAlias = useDirtyClose(aliasDirty, false, () => setAliasTarget(null));

  // 仅对页签滚动容器调整横向偏移；捕获/排序期间不与边缘滚动争抢。
  const revealActive = useCallback(() => {
    if (dragRef.current) return;
    const scroll = scrollRef.current;
    const tab = props.activePath ? tabRefs.current.get(props.activePath) : undefined;
    if (!scroll || !tab) return;
    const viewport = scroll.getBoundingClientRect();
    const rect = tab.getBoundingClientRect();
    if (rect.left < viewport.left) scroll.scrollLeft += rect.left - viewport.left;
    else if (rect.right > viewport.right) scroll.scrollLeft += rect.right - viewport.right;
  }, [props.activePath]);

  useLayoutEffect(() => { revealActive(); }, [revealActive, visiblePaths, dragPath]);

  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    const list = listRef.current;
    if (!scroll || !list) return;
    const update = () => {
      setOverflowing(scroll.scrollWidth > scroll.clientWidth + 1);
      revealActive();
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(scroll);
    observer.observe(list);
    return () => observer.disconnect();
  }, [revealActive, visiblePaths]);

  const updateInsertion = useCallback((clientX: number) => {
    const drag = dragRef.current;
    const list = listRef.current;
    if (!drag || !list) return;
    const others = [...list.querySelectorAll<HTMLElement>(".repository-tab")]
      .filter((element) => element.dataset.repoPath !== drag.path);
    const rects = others.map((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, width: rect.width };
    });
    const index = insertionIndex(rects, clientX);
    const last = others[others.length - 1];
    const left = others.length === 0 ? 0
      : index < others.length ? others[index].offsetLeft - 1
      : last.offsetLeft + last.offsetWidth - 1;
    const next = { index, left: Math.max(0, left) };
    if (insertionRef.current?.index === next.index && insertionRef.current.left === next.left) return;
    insertionRef.current = next;
    setInsertion(next);
  }, []);

  const clearDrag = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    insertionRef.current = null;
    setInsertion(null);
    setDragPath(null);
    if (drag?.element.hasPointerCapture(drag.pointerId)) drag.element.releasePointerCapture(drag.pointerId);
  }, []);

  const cancelDrag = useCallback((announce: boolean) => {
    const wasDragging = dragRef.current?.dragging ?? false;
    clearDrag();
    if (!wasDragging) return;
    suppressClickRef.current = true;
    window.setTimeout(() => { suppressClickRef.current = false; }, 0);
    if (announce) setStatus("拖动已取消，页签保持原顺序。");
  }, [clearDrag]);

  // Escape 取消排序；拖动只在指针释放时提交，取消不会留下半完成状态。
  useEffect(() => {
    if (!dragPath) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      cancelDrag(true);
    };
    document.addEventListener("keydown", keydown, true);
    return () => document.removeEventListener("keydown", keydown, true);
  }, [dragPath, cancelDrag]);

  // 指针靠近页签栏左右边缘时只调整滚动偏移，并由新的几何重新计算插入位置。
  useEffect(() => {
    if (!dragPath) return;
    let frame = 0;
    const tick = () => {
      const drag = dragRef.current;
      const scroll = scrollRef.current;
      if (drag?.dragging && scroll) {
        const rect = scroll.getBoundingClientRect();
        const direction = drag.lastClientX < rect.left + 24 ? -1 : drag.lastClientX > rect.right - 24 ? 1 : 0;
        if (direction !== 0) {
          scroll.scrollLeft += direction * 8;
          updateInsertion(drag.lastClientX);
        }
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [dragPath, updateInsertion]);

  // 结构变化（例如拖拽中的页签被其它操作关闭）时取消拖动。
  useEffect(() => {
    const drag = dragRef.current;
    if (drag && !props.repos.some((repo) => repo.path === drag.path)) cancelDrag(false);
  }, [props.repos, cancelDrag]);

  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>, repo: RepoInfo) => {
    if (event.button !== 0 || !event.isPrimary || dragRef.current) return;
    if ((event.target as HTMLElement).closest(".tab-close")) return;
    const element = event.currentTarget;
    dragRef.current = {
      path: repo.path, pointerId: event.pointerId, element,
      startX: event.clientX, startY: event.clientY, lastClientX: event.clientX, dragging: false,
    };
    element.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.lastClientX = event.clientX;
    if (!drag.dragging) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < DRAG_THRESHOLD) return;
      drag.dragging = true;
      setDragPath(drag.path);
      setStatus("正在移动页签；按 Escape 取消。");
    }
    event.preventDefault();
    updateInsertion(event.clientX);
  };

  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const at = insertionRef.current;
    const wasDragging = drag.dragging;
    const rect = stripRef.current?.getBoundingClientRect();
    const inside = !!rect
      && event.clientX >= rect.left && event.clientX <= rect.right
      && event.clientY >= rect.top && event.clientY <= rect.bottom;
    if (!wasDragging) { clearDrag(); return; }
    suppressClickRef.current = true;
    window.setTimeout(() => { suppressClickRef.current = false; }, 0);
    if (inside && at) {
      const ordered = movePath(props.repos.map((repo) => repo.path), drag.path, at.index);
      props.onReorder(ordered);
      setStatus(`已将页签移动到第 ${ordered.indexOf(drag.path) + 1} 个位置。`);
    } else {
      setStatus("已在页签栏外释放，排序被取消。");
    }
    clearDrag();
  };

  const tabKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>, repo: RepoInfo) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      props.onActivate(repo.path);
      return;
    }
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      setMenu({ x: rect.left + 8, y: rect.bottom, repo });
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || props.repos.length < 2) return;
    event.preventDefault();
    const index = props.repos.findIndex((item) => item.path === repo.path);
    if (index < 0) return;
    const nextIndex = event.key === "Home" ? 0
      : event.key === "End" ? props.repos.length - 1
      : (index + (event.key === "ArrowLeft" ? -1 : 1) + props.repos.length) % props.repos.length;
    const next = props.repos[nextIndex];
    if (!next) return;
    props.onActivate(next.path);
    tabRefs.current.get(next.path)?.focus();
  };

  const blankContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest(".repository-tab, .repository-add, .repository-tab-overflow")) return;
    event.preventDefault();
    event.stopPropagation();
    props.onBlankContextMenu(event.clientX, event.clientY);
  };

  const wheelTabs = (event: ReactWheelEvent<HTMLDivElement>) => {
    const scroll = scrollRef.current;
    if (!scroll || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    scroll.scrollLeft += event.deltaY;
  };

  return (
    <div
      className={`repository-tabs${dragPath ? " dragging" : ""}`}
      ref={stripRef}
      onContextMenu={blankContextMenu}
    >
      <div className="repository-tab-scroll" ref={scrollRef} onWheel={wheelTabs}>
        <div className="repository-tab-list" role="tablist" aria-label="打开的仓库" ref={listRef}>
          {props.repos.map((repo) => {
            const state = props.meta[repo.path];
            const group = groupById(props.repoGroups, groupForRepo(props.repoGroups, repo.path))!;
            const style = { "--repo-group-color": group.color } as CSSProperties;
            const pathTitle = props.repoGroups.aliases[repo.path] ? `${label(repo)}（${repo.path}）` : repo.path;
            return (
              <div
                className={`repository-tab${repo.path === props.activePath ? " active" : ""}${dragPath === repo.path ? " dragging" : ""}`}
                key={repo.path}
                ref={(element) => {
                  if (element) tabRefs.current.set(repo.path, element);
                  else tabRefs.current.delete(repo.path);
                }}
                data-repo-path={repo.path}
                role="tab"
                aria-selected={repo.path === props.activePath}
                tabIndex={repo.path === props.activePath ? 0 : -1}
                title={`${pathTitle} · 分组：${group.name}`}
                style={style}
                onPointerDown={(event) => beginDrag(event, repo)}
                onPointerMove={moveDrag}
                onPointerUp={finishDrag}
                onPointerCancel={(event) => { if (dragRef.current?.pointerId === event.pointerId) cancelDrag(false); }}
                onLostPointerCapture={(event) => { if (dragRef.current?.pointerId === event.pointerId) cancelDrag(false); }}
                onMouseDown={(event) => { if (event.button === 1) event.preventDefault(); }}
                onAuxClick={(event) => { if (event.button === 1) props.onClose(repo.path); }}
                onClick={() => { if (!suppressClickRef.current) props.onActivate(repo.path); }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  event.currentTarget.focus();
                  setMenu({ x: event.clientX, y: event.clientY, repo });
                }}
                onKeyDown={(event) => tabKeyDown(event, repo)}
              >
                <Icon name="folder" />
                <span className="repository-tab-name">{label(repo)}</span>
                {state?.busy || state?.loading ? <span className="spinner" aria-label={state?.busy ? "操作中" : "正在加载"} /> : state?.conflictCount ? <span className="tab-badge conflict">{state.conflictCount}</span> : state?.dirty ? <span className="dirty-dot" title="有未保存草稿" /> : state?.error ? <span className="tab-error" title={state.error} aria-label="读取失败"><Icon name="warning" size={12} /></span> : null}
                <button
                  className="tab-close"
                  aria-label={`关闭 ${label(repo)}`}
                  title={state?.busy ? "操作进行中，暂不能关闭" : "关闭仓库"}
                  disabled={state?.busy}
                  tabIndex={repo.path === props.activePath && !state?.busy ? 0 : -1}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => { event.stopPropagation(); props.onClose(repo.path); }}
                >
                  <Icon name="close" size={13} />
                </button>
              </div>
            );
          })}
          {insertion && <div className="tab-insertion-line" style={{ left: insertion.left }} aria-hidden="true" />}
        </div>
      </div>
      <button className="icon-button repository-add" title="打开仓库 (Ctrl+O)" aria-label="打开仓库" onClick={props.onOpen}><Icon name="plus" /></button>
      {overflowing && <button
        ref={listButtonRef} type="button" className="icon-button repository-tab-overflow"
        title="当前视图的仓库页签列表" aria-label="当前视图的仓库页签列表" aria-haspopup="menu" aria-expanded={!!listMenu}
        onPointerDown={(event) => { if (listMenu) event.stopPropagation(); }}
        onClick={() => {
          if (listMenu) { setListMenu(null); return; }
          const rect = listButtonRef.current?.getBoundingClientRect();
          if (rect) setListMenu({ x: rect.left, y: rect.bottom + 2 });
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown") return;
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          setListMenu({ x: rect.left, y: rect.bottom + 2 });
        }}
      ><Icon name="chevron-down" size={15} /></button>}
      <div className="repository-tab-blank" data-tauri-drag-region aria-hidden="true" />
      {listMenu && <ContextMenu x={listMenu.x} y={listMenu.y} ariaLabel="当前视图的仓库页签" onClose={() => setListMenu(null)} items={props.repos.map((repo) => ({
        id: repo.path, label: label(repo), title: repo.path, icon: "folder", checked: props.activePath === repo.path,
        color: groupById(props.repoGroups, groupForRepo(props.repoGroups, repo.path))?.color,
        onSelect: () => { props.onActivate(repo.path); tabRefs.current.get(repo.path)?.focus({ preventScroll: true }); },
      }))} />}
      <span className="sr-only" role="status" aria-live="polite">{status}</span>
      {menu && <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={[
        { id: "close", label: "关闭", icon: "close" as IconName, shortcut: menu.repo.path === props.activePath ? "Ctrl+W" : undefined, disabled: props.meta[menu.repo.path]?.busy, title: props.meta[menu.repo.path]?.busy ? "操作进行中" : undefined, onSelect: () => props.onClose(menu.repo.path) },
        { id: "close-others", label: "关闭其它", disabled: props.repos.length < 2, onSelect: () => props.onCloseOthers(menu.repo.path) },
        { id: "sep-order", separator: true },
        { id: "open-right", label: "在右侧打开仓库…", icon: "plus" as IconName, onSelect: () => props.onOpenRightOf(menu.repo.path) },
        { id: "sep-edit", separator: true },
        { id: "alias", label: "设置页签显示名…", icon: "edit" as IconName, onSelect: () => { setAliasValue(props.repoGroups.aliases[menu.repo.path] ?? ""); setAliasTarget(menu.repo); } },
        { id: "copy", label: "复制路径", icon: "copy" as IconName, onSelect: () => props.onCopyPath(menu.repo.path) },
        { id: "reveal", label: "在文件管理器中显示", icon: "external" as IconName, onSelect: () => props.onReveal(menu.repo.path) },
      ]} />}
      {aliasTarget && (
        <Dialog
          title={`设置页签显示名 · ${aliasTarget.name}`}
          onClose={closeAlias}
          footer={<>
            <button onClick={closeAlias}>取消</button>
            <button disabled={!props.repoGroups.aliases[aliasTarget.path]} onClick={() => { props.onSetAlias(aliasTarget.path, ""); setAliasTarget(null); }}>恢复仓库名</button>
            <button className="primary" onClick={() => { props.onSetAlias(aliasTarget.path, aliasValue); setAliasTarget(null); }}>保存</button>
          </>}
        >
          <div className="branch-create">
            <input
              data-autofocus
              placeholder="页签显示名（空 = 仓库名）"
              value={aliasValue}
              onChange={(e) => setAliasValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { props.onSetAlias(aliasTarget.path, aliasValue); setAliasTarget(null); }
                if (e.key === "Escape") setAliasTarget(null);
              }}
            />
          </div>
          <p className="panel-hint">别名只改变页签显示，不影响仓库路径与 Git 操作。</p>
        </Dialog>
      )}
    </div>
  );
}
