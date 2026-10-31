import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import Icon from "./Icon";

interface Props {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  wide?: boolean;
  busy?: boolean;
  className?: string;
}

/** 应用内弹窗：限制焦点、恢复焦点并阻止忙碌时误关闭。 */
export default function Dialog({ title, children, footer, onClose, wide = false, busy = false, className = "" }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const initial = el?.querySelector<HTMLElement>("[data-autofocus], input:not(:disabled), textarea:not(:disabled), button:not(:disabled)");
    initial?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (!busy) onClose();
      }
      if (event.key !== "Tab" || !el) return;
      const focusable = [...el.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex='0']")];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown, true);
    return () => {
      document.removeEventListener("keydown", keydown, true);
      previous?.focus();
    };
  }, [busy, onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={() => { if (!busy) onClose(); }}>
      <div className={`modal${wide ? " modal-wide" : ""} ${className}`} ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 id={titleId}>{title}</h3>
          <button className="icon-button" aria-label="关闭" title="关闭 (Esc)" disabled={busy} onClick={onClose}><Icon name="close" /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
