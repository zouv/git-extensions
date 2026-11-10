import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import Icon from "./Icon";
import { isTopLayer, popLayer, pushLayer } from "./layerStack";
import { useConfirm } from "./confirmContext";
import { addDirtyDialog, removeDirtyDialog } from "../dialogState";
import { clampDialogSize, loadDialogSize, saveDialogSize } from "./dialogSize";
import type { DialogSize } from "./dialogSize";

interface Props {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  wide?: boolean;
  busy?: boolean;
  /** 有未保存输入时，Esc / 点遮罩 / 关闭按钮先确认，避免静默丢弃草稿。 */
  dirty?: boolean;
  className?: string;
  /** 允许拖拽四条边和四角调整尺寸；配合 sizeKey 跨会话保存。 */
  resizable?: boolean;
  sizeKey?: string;
  minWidth?: number;
  minHeight?: number;
  /** 设置面板等常驻配置界面点击遮罩时不关闭（默认 true）。 */
  closeOnBackdrop?: boolean;
}

const FOCUSABLE = [
  "button:not(:disabled)",
  "input:not(:disabled)",
  "textarea:not(:disabled)",
  "select:not(:disabled)",
  "a[href]",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

type ResizeDirection = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const RESIZE_DIRECTIONS: ResizeDirection[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
const RESIZE_CURSORS: Record<ResizeDirection, string> = {
  n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize",
  ne: "nesw-resize", sw: "nesw-resize", nw: "nwse-resize", se: "nwse-resize",
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function isUsable(element: HTMLElement): boolean {
  if (element.getAttribute("aria-hidden") === "true") return false;
  if (element.hasAttribute("disabled")) return false;
  return element.getClientRects().length > 0;
}

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(isUsable);
}

/** data-autofocus 优先；否则聚焦正文第一个控件，避免落到标题栏的关闭按钮。 */
function initialTarget(root: HTMLElement): HTMLElement {
  const preferred = root.querySelector<HTMLElement>("[data-autofocus]");
  if (preferred && isUsable(preferred)) return preferred;
  const candidates = focusables(root);
  return candidates.find((element) => !element.closest(".modal-header")) ?? candidates[0] ?? root;
}

/** 应用内弹窗：限制焦点、区分顶层浮层、恢复焦点并阻止忙碌时误关闭。 */
export default function Dialog({
  title, children, footer, onClose, wide = false, busy = false, dirty = false, className = "",
  resizable = false, sizeKey, minWidth = 420, minHeight = 300, closeOnBackdrop = true,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const confirm = useConfirm();
  const busyRef = useRef(busy);
  const dirtyRef = useRef(dirty);
  const onCloseRef = useRef(onClose);
  const closingRef = useRef(false);
  const layerRef = useRef<symbol | null>(null);
  const dirtyTokenRef = useRef(Symbol("dialog-dirty"));
  const [size, setSize] = useState<DialogSize | null>(() => {
    if (!resizable || !sizeKey) return null;
    const saved = loadDialogSize(sizeKey);
    return saved ? clampDialogSize(saved, minWidth, minHeight) : null;
  });
  const sizeRef = useRef(size);
  busyRef.current = busy;
  dirtyRef.current = dirty;
  onCloseRef.current = onClose;
  sizeRef.current = size;

  const startResize = useCallback((event: ReactPointerEvent<HTMLDivElement>, direction: ResizeDirection) => {
    if (event.button !== 0) return;
    const modal = ref.current;
    if (!modal) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = modal.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = rect.width;
    const startHeight = rect.height;
    let latest: DialogSize = sizeRef.current ?? { width: startWidth, height: startHeight };
    const move = (moveEvent: PointerEvent) => {
      const width = clamp(
        startWidth + (direction.includes("e") ? moveEvent.clientX - startX : direction.includes("w") ? startX - moveEvent.clientX : 0),
        minWidth, window.innerWidth - 24,
      );
      const height = clamp(
        startHeight + (direction.includes("s") ? moveEvent.clientY - startY : direction.includes("n") ? startY - moveEvent.clientY : 0),
        minHeight, window.innerHeight - 24,
      );
      latest = { width: Math.round(width), height: Math.round(height) };
      setSize(latest);
    };
    const stop = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", stop);
      document.body.classList.remove("dialog-resizing");
      document.body.style.cursor = "";
      if (sizeKey) saveDialogSize(sizeKey, latest);
    };
    document.body.classList.add("dialog-resizing");
    document.body.style.cursor = RESIZE_CURSORS[direction];
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", stop);
  }, [minWidth, minHeight, sizeKey]);

  const requestClose = useCallback(async () => {
    if (busyRef.current || closingRef.current) return;
    if (dirtyRef.current) {
      closingRef.current = true;
      let ok = false;
      try {
        ok = await confirm({
          title: "放弃未保存的修改？",
          body: "当前弹窗里有尚未保存的输入，关闭后会丢失。",
          confirmLabel: "放弃并关闭",
          danger: true,
        });
      } finally {
        closingRef.current = false;
      }
      if (!ok) return;
    }
    onCloseRef.current();
  }, [confirm]);
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;

  // 浮层栈只决定谁处理 Esc / Tab；不随父组件重渲染重建。
  useLayoutEffect(() => {
    const token = pushLayer();
    layerRef.current = token;
    return () => {
      popLayer(token);
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const token = dirtyTokenRef.current;
    if (dirty) addDirtyDialog(token); else removeDirtyDialog(token);
    return () => removeDirtyDialog(token);
  }, [dirty]);

  // 初始聚焦和焦点恢复只在挂载 / 卸载时做一次；busy / dirty 变化不能抢焦点。
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = ref.current;
    if (element) initialTarget(element).focus({ preventScroll: true });
    return () => {
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const token = layerRef.current;
      if (!token || !isTopLayer(token)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        void requestCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const element = ref.current;
      if (!element) return;
      const items = focusables(element);
      if (items.length === 0) {
        event.preventDefault();
        element.focus({ preventScroll: true });
        return;
      }
      const active = document.activeElement as HTMLElement | null;
      if (!active || !element.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? items[items.length - 1] : items[0]).focus();
        return;
      }
      const index = items.indexOf(active);
      if (event.shiftKey && index <= 0) {
        event.preventDefault();
        items[items.length - 1].focus();
      } else if (!event.shiftKey && (index < 0 || index === items.length - 1)) {
        event.preventDefault();
        items[0].focus();
      }
    };
    document.addEventListener("keydown", keydown, true);
    return () => document.removeEventListener("keydown", keydown, true);
  }, []);

  const backdropClose = (event: ReactMouseEvent) => {
    if (!closeOnBackdrop) return;
    if (event.button !== 0) return;
    const token = layerRef.current;
    if (!token || !isTopLayer(token)) return;
    void requestCloseRef.current();
  };

  return (
    <div className="modal-backdrop" onMouseDown={backdropClose}>
      <div
        className={`modal${wide ? " modal-wide" : ""}${resizable ? " modal-resizable" : ""} ${className}`}
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        style={size ? {
          width: size.width,
          height: size.height,
          maxWidth: "calc(100vw - 24px)",
          maxHeight: "calc(100vh - 24px)",
        } : undefined}
      >
        <div className="modal-header">
          <h3 id={titleId}>{title}</h3>
          <button className="icon-button" aria-label="关闭" title="关闭 (Esc)" disabled={busy} onClick={() => void requestCloseRef.current()}><Icon name="close" /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
        {resizable && RESIZE_DIRECTIONS.map((direction) => <div
          key={direction}
          aria-hidden="true"
          className={`modal-resize modal-resize-${direction}`}
          onPointerDown={(event) => startResize(event, direction)}
        />)}
      </div>
    </div>
  );
}
