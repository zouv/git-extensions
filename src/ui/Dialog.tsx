import { useCallback, useEffect, useId, useLayoutEffect, useRef } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import Icon from "./Icon";
import { isTopLayer, popLayer, pushLayer } from "./layerStack";
import { useConfirm } from "./confirmContext";
import { addDirtyDialog, removeDirtyDialog } from "../dialogState";

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
}

const FOCUSABLE = [
  "button:not(:disabled)",
  "input:not(:disabled)",
  "textarea:not(:disabled)",
  "select:not(:disabled)",
  "a[href]",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

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
export default function Dialog({ title, children, footer, onClose, wide = false, busy = false, dirty = false, className = "" }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const confirm = useConfirm();
  const busyRef = useRef(busy);
  const dirtyRef = useRef(dirty);
  const onCloseRef = useRef(onClose);
  const closingRef = useRef(false);
  const layerRef = useRef<symbol | null>(null);
  const dirtyTokenRef = useRef(Symbol("dialog-dirty"));
  busyRef.current = busy;
  dirtyRef.current = dirty;
  onCloseRef.current = onClose;

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
    if (event.button !== 0) return;
    const token = layerRef.current;
    if (!token || !isTopLayer(token)) return;
    void requestCloseRef.current();
  };

  return (
    <div className="modal-backdrop" onMouseDown={backdropClose}>
      <div className={`modal${wide ? " modal-wide" : ""} ${className}`} ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 id={titleId}>{title}</h3>
          <button className="icon-button" aria-label="关闭" title="关闭 (Esc)" disabled={busy} onClick={() => void requestCloseRef.current()}><Icon name="close" /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
