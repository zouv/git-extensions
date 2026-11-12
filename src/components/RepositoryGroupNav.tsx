import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  DEFAULT_GROUP_ID, isGroupSelected, pinnedGroups, reorderPinned,
  selectAllOpen, selectGroup, toggleActiveGroup, togglePin,
} from "../repoGroups";
import type { RepoGroup, RepoGroupConfig } from "../repoGroups";
import { insertionIndex, movePath } from "../tabOrder";
import ContextMenu from "../ui/ContextMenu";
import type { MenuItem } from "../ui/ContextMenu";
import Icon from "../ui/Icon";
import GroupAvatar from "./GroupAvatar";

interface Props {
  config: RepoGroupConfig;
  onChange: (next: RepoGroupConfig) => void;
  onManage: (groupId?: string) => void;
}

interface DragState {
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

/** 保留组入口与 Pin 图标的多选切换；固定顺序不改变管理器中的组顺序。 */
export default function RepositoryGroupNav({ config, onChange, onManage }: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [insertion, setInsertion] = useState<Insertion | null>(null);
  const [status, setStatus] = useState("");
  const stripRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const insertionRef = useRef<Insertion | null>(null);
  const suppressClickRef = useRef(false);
  const latest = useRef({ config, onChange, onManage });
  latest.current = { config, onChange, onManage };
  const pinned = pinnedGroups(config);
  const numberedPins = config.pinnedGroupIds.filter((id) => id !== DEFAULT_GROUP_ID);
  const openAt = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    setMenu({ x: rect.left, y: rect.bottom + 2 });
  };
  const toggleGroup = (id: string) => {
    const state = latest.current;
    state.onChange(toggleActiveGroup(state.config, id));
  };
  const pinShortcut = (group: RepoGroup): string | undefined => {
    if (group.id === DEFAULT_GROUP_ID) return "Alt+0";
    const at = numberedPins.indexOf(group.id);
    return at >= 0 && at < 9 ? `Alt+${at + 1}` : undefined;
  };
  const reorder = (fromId: string, targetId: string) => {
    const state = latest.current;
    const ids = pinnedGroups(state.config).map((group) => group.id);
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0 || from === to) return;
    ids.splice(from, 1);
    ids.splice(to, 0, fromId);
    state.onChange(reorderPinned(state.config, ids));
  };

  const updateInsertion = useCallback((clientX: number) => {
    const drag = dragRef.current;
    const strip = stripRef.current;
    if (!drag || !strip) return;
    const others = [...strip.querySelectorAll<HTMLElement>(".title-pin")]
      .filter((element) => element.dataset.groupId !== drag.id);
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
    setDragId(null);
    if (drag?.element.hasPointerCapture(drag.pointerId)) drag.element.releasePointerCapture(drag.pointerId);
  }, []);

  const cancelDrag = useCallback((announce: boolean) => {
    const wasDragging = dragRef.current?.dragging ?? false;
    clearDrag();
    if (!wasDragging) return;
    suppressClickRef.current = true;
    window.setTimeout(() => { suppressClickRef.current = false; }, 0);
    if (announce) setStatus("拖动已取消，固定组保持原顺序。");
  }, [clearDrag]);

  // Escape 取消排序；拖动只在指针释放时提交，取消不会留下半完成状态。
  useEffect(() => {
    if (!dragId) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      cancelDrag(true);
    };
    document.addEventListener("keydown", keydown, true);
    return () => document.removeEventListener("keydown", keydown, true);
  }, [dragId, cancelDrag]);

  // 指针靠近固定图标栏左右边缘时滚动，并由新的几何重新计算插入位置。
  useEffect(() => {
    if (!dragId) return;
    let frame = 0;
    const tick = () => {
      const drag = dragRef.current;
      const strip = stripRef.current;
      if (drag?.dragging && strip) {
        const rect = strip.getBoundingClientRect();
        const direction = drag.lastClientX < rect.left + 24 ? -1 : drag.lastClientX > rect.right - 24 ? 1 : 0;
        if (direction !== 0) {
          strip.scrollLeft += direction * 8;
          updateInsertion(drag.lastClientX);
        }
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [dragId, updateInsertion]);

  // 固定列表被其它操作改变时取消拖动，避免把旧下标写回去。
  const pinnedKey = config.pinnedGroupIds.join("\u0000");
  useEffect(() => {
    if (dragRef.current && !config.pinnedGroupIds.includes(dragRef.current.id)) cancelDrag(false);
  }, [pinnedKey, config.pinnedGroupIds, cancelDrag]);

  const beginDrag = (event: ReactPointerEvent<HTMLButtonElement>, group: RepoGroup) => {
    if (event.button !== 0 || !event.isPrimary || dragRef.current) return;
    const element = event.currentTarget;
    dragRef.current = {
      id: group.id, pointerId: event.pointerId, element,
      startX: event.clientX, startY: event.clientY, lastClientX: event.clientX, dragging: false,
    };
    element.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.lastClientX = event.clientX;
    if (!drag.dragging) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < DRAG_THRESHOLD) return;
      drag.dragging = true;
      setDragId(drag.id);
      setStatus("正在移动固定组；按 Escape 取消。");
    }
    event.preventDefault();
    updateInsertion(event.clientX);
  };

  const finishDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
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
      const state = latest.current;
      const ordered = movePath(state.config.pinnedGroupIds, drag.id, at.index);
      state.onChange(reorderPinned(state.config, ordered));
      setStatus(`已将固定组移动到第 ${ordered.indexOf(drag.id) + 1} 个位置。`);
    } else {
      setStatus("拖动已取消，固定组保持原顺序。");
    }
    clearDrag();
  };

  const groupItems = (): MenuItem[] => latest.current.config.groups.map((group) => {
    const state = latest.current;
    return {
      id: `view-${group.id}`, label: group.name, color: group.color,
      checked: isGroupSelected(state.config, group.id), keepOpen: true,
      shortcut: pinShortcut(group),
      onSelect: () => toggleGroup(group.id),
      trailingAction: {
        icon: "pin", label: state.config.pinnedGroupIds.includes(group.id) ? `取消 Pin 分组 ${group.name}` : `Pin 分组 ${group.name} 到顶部栏`,
        checked: state.config.pinnedGroupIds.includes(group.id),
        keepOpen: true,
        onSelect: () => { const live = latest.current; live.onChange(togglePin(live.config, group.id)); },
      },
    };
  });
  const menuItems: MenuItem[] = [
    { id: "all-open", label: "全部打开", checked: config.view.kind === "all-open", keepOpen: true,
      title: "显示全部已打开仓库，不会批量打开未打开的记录",
      onSelect: () => {
        const state = latest.current;
        state.onChange(state.config.view.kind === "all-open"
          ? selectGroup(state.config, DEFAULT_GROUP_ID) : selectAllOpen(state.config));
      } },
    { id: "sep-groups", separator: true },
    ...groupItems(),
    { id: "sep-manage", separator: true },
    { id: "manage", label: "组管理器…", icon: "settings", onSelect: () => latest.current.onManage() },
  ];

  return (
    <div className="title-group-cluster repository-group-nav" role="navigation" aria-label="仓库分组">
      <button type="button" className={`icon-button title-group-button${config.view.kind !== "all-open" ? " has-group" : ""}`}
        title="仓库页签分组（可多选）" aria-label="仓库页签分组" aria-haspopup="menu" aria-expanded={!!menu}
        onPointerDown={(event) => { if (menu) event.stopPropagation(); }}
        onClick={(event) => { if (menu) setMenu(null); else openAt(event.currentTarget); }}
        onKeyDown={(event) => { if (event.key === "ArrowDown") { event.preventDefault(); openAt(event.currentTarget); } }}>
        <Icon name="group" size={17} />
      </button>
      {pinned.length > 0 && <div className="title-pinned" ref={stripRef} role="group" aria-label="已 Pin 的仓库页签分组（拖动或 Alt+方向键排序）">
        {pinned.map((group) => (
          <button key={group.id} type="button" data-group-id={group.id}
            className={`title-pin${isGroupSelected(config, group.id) ? " active" : ""}${dragId === group.id ? " dragging" : ""}`}
            title={`${group.name}${pinShortcut(group) ? `（${pinShortcut(group)}）` : ""}（左键切换显示，右键分组菜单，可拖拽排序）`}
            aria-label={`分组 ${group.name}`} aria-pressed={isGroupSelected(config, group.id)}
            onPointerDown={(event) => beginDrag(event, group)}
            onPointerMove={moveDrag}
            onPointerUp={finishDrag}
            onPointerCancel={(event) => { if (dragRef.current?.pointerId === event.pointerId) cancelDrag(false); }}
            onLostPointerCapture={(event) => { if (dragRef.current?.pointerId === event.pointerId) cancelDrag(false); }}
            onClick={() => { if (!suppressClickRef.current) toggleGroup(group.id); }}
            onContextMenu={(event) => { event.preventDefault(); event.currentTarget.focus(); openAt(event.currentTarget); }}
            onKeyDown={(event) => {
              if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
                event.preventDefault(); openAt(event.currentTarget);
              }
              if (!event.altKey || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
              const at = config.pinnedGroupIds.indexOf(group.id);
              const target = config.pinnedGroupIds[at + (event.key === "ArrowLeft" ? -1 : 1)];
              if (target) { event.preventDefault(); reorder(group.id, target); }
            }}>
            <GroupAvatar id={group.id} name={group.name} color={group.color} size={22} active={isGroupSelected(config, group.id)} />
          </button>
        ))}
        {insertion && <span className="title-pin-insertion" style={{ left: insertion.left }} aria-hidden="true" />}
      </div>}
      <span className="sr-only" role="status">{status}</span>
      {menu && <ContextMenu x={menu.x} y={menu.y} ariaLabel="仓库页签分组" items={menuItems} onClose={() => setMenu(null)} />}
    </div>
  );
}
