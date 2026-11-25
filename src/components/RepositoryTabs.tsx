import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent,
} from "react";
import type { RepoInfo } from "../types";
import { DEFAULT_GROUP_ID, displayRepoName, groupById, groupForRepo, visibleGroupIds } from "../repoGroups";
import type { RepoGroup, RepoGroupConfig } from "../repoGroups";
import type { GroupNavMode } from "../settings";
import { insertionIndex, movePath } from "../tabOrder";
import { disambiguateLabels } from "../repoIdentity";
import type { IconName } from "../ui/Icon";
import Icon from "../ui/Icon";
import ContextMenu from "../ui/ContextMenu";
import Dialog from "../ui/Dialog";
import { useDirtyClose } from "../ui/useDirtyClose";
import GroupAvatar from "./GroupAvatar";
import RepoAvatar from "./RepoAvatar";

export interface SessionMeta { busy: boolean; dirty: boolean; conflictCount: number; loading?: boolean; error?: string | null }

interface Props {
  repos: RepoInfo[];
  activePath: string | null;
  meta: Record<string, SessionMeta>;
  repoGroups: RepoGroupConfig;
  /** tab：分组图标显示在页签内；pin：显示独立的 Pin 图标栏。 */
  groupNavMode: GroupNavMode;
  onSetAlias: (path: string, alias: string) => void;
  onSetGroup: (path: string, groupId: string) => void;
  onActivate: (path: string) => void;
  onClose: (path: string) => void;
  onCloseOthers: (path: string) => void;
  onOpen: () => void;
  onOpenRightOf: (path: string) => void;
  onCopyPath: (path: string) => void;
  onReveal: (path: string) => void;
  onReorder: (orderedPaths: string[]) => void;
  /** Tab 模式：只重排某个分组内的页签。 */
  onReorderGroupRepos: (groupId: string, orderedPaths: string[]) => void;
  /** Tab 模式：拖动分组段后重排可见分组。 */
  onReorderGroups: (orderedGroupIds: string[]) => void;
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

interface GroupDragState {
  id: string;
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
  const [groupDragId, setGroupDragId] = useState<string | null>(null);
  const [groupInsertion, setGroupInsertion] = useState<Insertion | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  const [status, setStatus] = useState("");
  const [aliasTarget, setAliasTarget] = useState<RepoInfo | null>(null);
  const [aliasValue, setAliasValue] = useState("");
  const stripRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<string, HTMLDivElement>());
  const dragRef = useRef<DragState | null>(null);
  const insertionRef = useRef<Insertion | null>(null);
  const groupDragRef = useRef<GroupDragState | null>(null);
  const groupInsertionRef = useRef<Insertion | null>(null);
  const suppressClickRef = useRef(false);
  const tabMode = props.groupNavMode === "tab";
  const labels = useMemo(
    () => disambiguateLabels(props.repos, (repo) => displayRepoName(props.repoGroups, repo)),
    [props.repoGroups, props.repos],
  );
  const label = (repo: RepoInfo) => labels[repo.path] ?? displayRepoName(props.repoGroups, repo);
  const aliasDirty = aliasTarget ? aliasValue !== (props.repoGroups.aliases[aliasTarget.path] ?? "") : false;
  const closeAlias = useDirtyClose(aliasDirty, false, () => setAliasTarget(null));

  const groupIds = useMemo(() => visibleGroupIds(props.repoGroups, props.repos), [props.repoGroups, props.repos]);
  const collapsedKey = useMemo(() => [...collapsedGroups].sort().join("\u0000"), [collapsedGroups]);
  const visibleTabRepos = useMemo(
    () => tabMode
      ? props.repos.filter((repo) => !collapsedGroups.has(groupForRepo(props.repoGroups, repo.path)))
      : props.repos,
    [collapsedGroups, props.repoGroups, props.repos, tabMode],
  );
  const activeGroupId = props.activePath ? groupForRepo(props.repoGroups, props.activePath) : null;

  // 激活的仓库来自其它入口（Alt+数字 / 溢出菜单 / Ctrl+数字）时，自动展开其所在分组；
  // 用户主动收起活动分组时 activeGroupId 不变，不会被这里重新展开。
  useEffect(() => {
    if (!tabMode || !activeGroupId) return;
    setCollapsedGroups((prev) => {
      if (!prev.has(activeGroupId)) return prev;
      const next = new Set(prev);
      next.delete(activeGroupId);
      return next;
    });
  }, [activeGroupId, tabMode]);

  // 仅对页签滚动容器调整横向偏移；捕获/排序期间不与边缘滚动争抢。
  const revealActive = useCallback(() => {
    if (dragRef.current || groupDragRef.current) return;
    const scroll = scrollRef.current;
    const tab = props.activePath ? tabRefs.current.get(props.activePath) : undefined;
    if (!scroll || !tab) return;
    const viewport = scroll.getBoundingClientRect();
    const rect = tab.getBoundingClientRect();
    if (rect.left < viewport.left) scroll.scrollLeft += rect.left - viewport.left;
    else if (rect.right > viewport.right) scroll.scrollLeft += rect.right - viewport.right;
  }, [props.activePath]);

  useLayoutEffect(() => { revealActive(); }, [revealActive, visiblePaths, dragPath, collapsedKey]);

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
  }, [revealActive, visiblePaths, collapsedKey]);

  const updateInsertion = useCallback((clientX: number) => {
    const drag = dragRef.current;
    const list = listRef.current;
    if (!drag || !list) return;
    const dragGroupId = tabMode ? groupForRepo(props.repoGroups, drag.path) : null;
    const listRect = list.getBoundingClientRect();
    const others = [...list.querySelectorAll<HTMLElement>(".repository-tab")]
      .filter((element) => element.dataset.repoPath !== drag.path
        && (!dragGroupId || element.dataset.groupId === dragGroupId));
    const rects = others.map((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, width: rect.width };
    });
    const index = insertionIndex(rects, clientX);
    const left = others.length === 0 ? 0
      : index < others.length ? others[index].getBoundingClientRect().left - listRect.left - 1
      : others[others.length - 1].getBoundingClientRect().right - listRect.left - 1;
    const next = { index, left: Math.max(0, left) };
    if (insertionRef.current?.index === next.index && insertionRef.current.left === next.left) return;
    insertionRef.current = next;
    setInsertion(next);
  }, [props.repoGroups, tabMode]);

  const updateGroupInsertion = useCallback((clientX: number) => {
    const drag = groupDragRef.current;
    const list = listRef.current;
    if (!drag || !list) return;
    const listRect = list.getBoundingClientRect();
    const others = [...list.querySelectorAll<HTMLElement>(".tab-group")]
      .filter((element) => element.dataset.groupId !== drag.id);
    const rects = others.map((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, width: rect.width };
    });
    const index = insertionIndex(rects, clientX);
    const left = others.length === 0 ? 0
      : index < others.length ? others[index].getBoundingClientRect().left - listRect.left - 1
      : others[others.length - 1].getBoundingClientRect().right - listRect.left - 1;
    const next = { index, left: Math.max(0, left) };
    if (groupInsertionRef.current?.index === next.index && groupInsertionRef.current.left === next.left) return;
    groupInsertionRef.current = next;
    setGroupInsertion(next);
  }, []);

  const clearDrag = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    insertionRef.current = null;
    setInsertion(null);
    setDragPath(null);
    if (drag?.element.hasPointerCapture(drag.pointerId)) drag.element.releasePointerCapture(drag.pointerId);
  }, []);

  const clearGroupDrag = useCallback(() => {
    const drag = groupDragRef.current;
    groupDragRef.current = null;
    groupInsertionRef.current = null;
    setGroupInsertion(null);
    setGroupDragId(null);
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

  const cancelGroupDrag = useCallback((announce: boolean) => {
    const wasDragging = groupDragRef.current?.dragging ?? false;
    clearGroupDrag();
    if (!wasDragging) return;
    suppressClickRef.current = true;
    window.setTimeout(() => { suppressClickRef.current = false; }, 0);
    if (announce) setStatus("拖动已取消，分组保持原顺序。");
  }, [clearGroupDrag]);

  // Escape 取消排序；拖动只在指针释放时提交，取消不会留下半完成状态。
  useEffect(() => {
    if (!dragPath && !groupDragId) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (dragPath) cancelDrag(true);
      else cancelGroupDrag(true);
    };
    document.addEventListener("keydown", keydown, true);
    return () => document.removeEventListener("keydown", keydown, true);
  }, [dragPath, groupDragId, cancelDrag, cancelGroupDrag]);

  // 指针靠近页签栏左右边缘时只调整滚动偏移，并由新的几何重新计算插入位置。
  useEffect(() => {
    if (!dragPath && !groupDragId) return;
    let frame = 0;
    const tick = () => {
      const scroll = scrollRef.current;
      if (scroll) {
        const drag = dragRef.current;
        const groupDrag = groupDragRef.current;
        const lastClientX = drag?.lastClientX ?? groupDrag?.lastClientX;
        const dragging = drag?.dragging || groupDrag?.dragging;
        if (dragging && lastClientX !== undefined) {
          const rect = scroll.getBoundingClientRect();
          const direction = lastClientX < rect.left + 24 ? -1 : lastClientX > rect.right - 24 ? 1 : 0;
          if (direction !== 0) {
            scroll.scrollLeft += direction * 8;
            if (drag) updateInsertion(lastClientX);
            else updateGroupInsertion(lastClientX);
          }
        }
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [dragPath, groupDragId, updateGroupInsertion, updateInsertion]);

  // 结构变化（例如拖拽中的页签 / 分组被其它操作关闭）时取消拖动。
  useEffect(() => {
    const drag = dragRef.current;
    if (drag && !props.repos.some((repo) => repo.path === drag.path)) cancelDrag(false);
  }, [props.repos, cancelDrag]);

  useEffect(() => {
    if (groupDragRef.current && !groupIds.includes(groupDragRef.current.id)) cancelGroupDrag(false);
  }, [groupIds, cancelGroupDrag]);

  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>, repo: RepoInfo) => {
    if (event.button !== 0 || !event.isPrimary || dragRef.current || groupDragRef.current) return;
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
      if (tabMode) {
        const groupId = groupForRepo(props.repoGroups, drag.path);
        const groupPaths = props.repos
          .filter((repo) => groupForRepo(props.repoGroups, repo.path) === groupId)
          .map((repo) => repo.path);
        const ordered = movePath(groupPaths, drag.path, at.index);
        props.onReorderGroupRepos(groupId, ordered);
        setStatus(`已将页签移动到分组内的第 ${ordered.indexOf(drag.path) + 1} 个位置。`);
      } else {
        const ordered = movePath(props.repos.map((repo) => repo.path), drag.path, at.index);
        props.onReorder(ordered);
        setStatus(`已将页签移动到第 ${ordered.indexOf(drag.path) + 1} 个位置。`);
      }
    } else {
      setStatus("已在页签栏外释放，排序被取消。");
    }
    clearDrag();
  };

  const beginGroupDrag = (event: ReactPointerEvent<HTMLButtonElement>, group: RepoGroup) => {
    if (event.button !== 0 || !event.isPrimary || groupDragRef.current || dragRef.current) return;
    event.stopPropagation();
    const element = event.currentTarget;
    groupDragRef.current = {
      id: group.id, pointerId: event.pointerId, element,
      startX: event.clientX, startY: event.clientY, lastClientX: event.clientX, dragging: false,
    };
    element.setPointerCapture(event.pointerId);
  };

  const moveGroupDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = groupDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.lastClientX = event.clientX;
    if (!drag.dragging) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < DRAG_THRESHOLD) return;
      drag.dragging = true;
      setGroupDragId(drag.id);
      setStatus("正在移动分组；按 Escape 取消。");
    }
    event.preventDefault();
    updateGroupInsertion(event.clientX);
  };

  const finishGroupDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = groupDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const at = groupInsertionRef.current;
    const wasDragging = drag.dragging;
    const rect = stripRef.current?.getBoundingClientRect();
    const inside = !!rect
      && event.clientX >= rect.left && event.clientX <= rect.right
      && event.clientY >= rect.top && event.clientY <= rect.bottom;
    if (!wasDragging) { clearGroupDrag(); return; }
    suppressClickRef.current = true;
    window.setTimeout(() => { suppressClickRef.current = false; }, 0);
    if (inside && at) {
      const ordered = movePath(groupIds, drag.id, at.index);
      props.onReorderGroups(ordered);
      setStatus(`已将分组移动到第 ${ordered.indexOf(drag.id) + 1} 个位置。`);
    } else {
      setStatus("已在页签栏外释放，分组排序被取消。");
    }
    clearGroupDrag();
  };

  const toggleGroup = useCallback((groupId: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

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
    // Tab 模式下收起分组的页签不渲染，键盘只在展开的页签间移动。
    const navigable = visibleTabRepos;
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || navigable.length < 2) return;
    event.preventDefault();
    const index = navigable.findIndex((item) => item.path === repo.path);
    if (index < 0) return;
    const nextIndex = event.key === "Home" ? 0
      : event.key === "End" ? navigable.length - 1
      : (index + (event.key === "ArrowLeft" ? -1 : 1) + navigable.length) % navigable.length;
    const next = navigable[nextIndex];
    if (!next) return;
    props.onActivate(next.path);
    tabRefs.current.get(next.path)?.focus();
  };

  const blankContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest(".repository-tab, .tab-group-pill, .repository-add, .repository-tab-overflow")) return;
    event.preventDefault();
    event.stopPropagation();
    props.onBlankContextMenu(event.clientX, event.clientY);
  };

  const wheelTabs = (event: ReactWheelEvent<HTMLDivElement>) => {
    const scroll = scrollRef.current;
    if (!scroll || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    scroll.scrollLeft += event.deltaY;
  };

  const activateFromList = (repo: RepoInfo) => {
    if (tabMode) {
      const groupId = groupForRepo(props.repoGroups, repo.path);
      setCollapsedGroups((prev) => {
        if (!prev.has(groupId)) return prev;
        const next = new Set(prev);
        next.delete(groupId);
        return next;
      });
    }
    props.onActivate(repo.path);
    window.requestAnimationFrame(() => tabRefs.current.get(repo.path)?.focus({ preventScroll: true }));
  };

  const renderTab = (repo: RepoInfo, group: RepoGroup) => {
    const state = props.meta[repo.path];
    const style = { "--repo-group-color": group.color } as CSSProperties;
    const displayName = displayRepoName(props.repoGroups, repo);
    const pathTitle = props.repoGroups.aliases[repo.path] ? `${displayName}（${repo.path}）` : repo.path;
    return (
      <div
        className={`repository-tab${repo.path === props.activePath ? " active" : ""}${dragPath === repo.path ? " dragging" : ""}`}
        key={repo.path}
        ref={(element) => {
          if (element) tabRefs.current.set(repo.path, element);
          else tabRefs.current.delete(repo.path);
        }}
        data-repo-path={repo.path}
        data-group-id={group.id}
        role="tab"
        aria-selected={repo.path === props.activePath}
        tabIndex={repo.path === props.activePath ? 0 : -1}
        title={`${pathTitle} · 分组：${group.name} · 分支：${repo.headBranch ?? "detached HEAD"}`}
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
        <span className="repository-tab-icon">
          {state?.busy || state?.loading
            ? <span className="spinner" aria-label={state?.busy ? "操作中" : "正在加载"} />
            : <RepoAvatar path={repo.path} name={displayName} />}
        </span>
        <span className="repository-tab-name">{label(repo)}</span>
        {state?.conflictCount ? <span className="tab-badge conflict">{state.conflictCount}</span> : state?.dirty ? <span className="dirty-dot" title="有未保存草稿" /> : state?.error ? <span className="tab-error" title={state.error} aria-label="读取失败"><Icon name="warning" size={12} /></span> : null}
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
  };

  return (
    <div
      className={`repository-tabs${tabMode ? " group-nav-tab" : " group-nav-pin"}${dragPath || groupDragId ? " dragging" : ""}${overflowing ? " overflowing" : ""}`}
      ref={stripRef}
      onContextMenu={blankContextMenu}
    >
      <div className="repository-tab-scroll" ref={scrollRef} onWheel={wheelTabs}>
        <div className="repository-tab-list" role="tablist" aria-label="打开的仓库" ref={listRef}>
          {tabMode ? groupIds.map((groupId) => {
            const group = groupById(props.repoGroups, groupId);
            if (!group) return null;
            const groupRepos = props.repos.filter((repo) => groupForRepo(props.repoGroups, repo.path) === groupId);
            const collapsed = collapsedGroups.has(groupId);
            return (
              <div className={`tab-group${groupDragId === groupId ? " dragging" : ""}${collapsed ? " collapsed" : ""}`} key={groupId} data-group-id={groupId} role="presentation" style={{ "--repo-group-color": group.color } as CSSProperties}>
                <button
                  type="button"
                  className={`tab-group-pill${groupDragId === groupId ? " dragging" : ""}`}
                  aria-expanded={!collapsed}
                  aria-label={`分组 ${group.name}，${collapsed ? "已收起，点击展开" : "已展开，点击收起"}`}
                  title={`${group.name}（${collapsed ? "点击展开" : "点击收起"}；可拖拽排序）`}
                  onPointerDown={(event) => beginGroupDrag(event, group)}
                  onPointerMove={moveGroupDrag}
                  onPointerUp={finishGroupDrag}
                  onPointerCancel={(event) => { if (groupDragRef.current?.pointerId === event.pointerId) cancelGroupDrag(false); }}
                  onLostPointerCapture={(event) => { if (groupDragRef.current?.pointerId === event.pointerId) cancelGroupDrag(false); }}
                  onClick={() => { if (!suppressClickRef.current) toggleGroup(groupId); }}
                  onKeyDown={(event) => {
                    if (!event.altKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
                    const at = groupIds.indexOf(groupId);
                    const target = at + (event.key === "ArrowLeft" ? -1 : 1);
                    if (at < 0 || target < 0 || target >= groupIds.length) return;
                    event.preventDefault();
                    props.onReorderGroups(movePath(groupIds, groupId, target));
                    setStatus(`已将分组 ${group.name} 向${event.key === "ArrowLeft" ? "左" : "右"}移动。`);
                  }}
                >
                  <GroupAvatar id={group.id} name={group.name} color={group.color} badge={group.badge} size={22} />
                </button>
                {!collapsed && groupRepos.map((repo) => renderTab(repo, group))}
              </div>
            );
          }) : props.repos.map((repo) => {
            const group = groupById(props.repoGroups, groupForRepo(props.repoGroups, repo.path))!;
            return renderTab(repo, group);
          })}
          {insertion && <div className="tab-insertion-line" style={{ left: insertion.left }} aria-hidden="true" />}
          {groupInsertion && <div className="tab-group-insertion-line" style={{ left: groupInsertion.left }} aria-hidden="true" />}
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
        onSelect: () => activateFromList(repo),
      }))} />}
      <span className="sr-only" role="status" aria-live="polite">{status}</span>
      {menu && <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={[
        { id: "close", label: "关闭", icon: "close" as IconName, shortcut: menu.repo.path === props.activePath ? "Ctrl+W" : undefined, disabled: props.meta[menu.repo.path]?.busy, title: props.meta[menu.repo.path]?.busy ? "操作进行中" : undefined, onSelect: () => props.onClose(menu.repo.path) },
        { id: "close-others", label: "关闭其它", disabled: props.repos.length < 2, onSelect: () => props.onCloseOthers(menu.repo.path) },
        { id: "sep-order", separator: true },
        { id: "open-right", label: "在右侧打开仓库…", icon: "plus" as IconName, onSelect: () => props.onOpenRightOf(menu.repo.path) },
        { id: "sep-edit", separator: true },
        { id: "group", label: "移动到分组", icon: "group" as IconName, children: props.repoGroups.groups.map((group) => ({
          id: `group-${group.id}`,
          label: group.id === DEFAULT_GROUP_ID ? "未分组" : group.name,
          color: group.color,
          checked: groupForRepo(props.repoGroups, menu.repo.path) === group.id,
          onSelect: () => props.onSetGroup(menu.repo.path, group.id),
        })) },
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
