import { useLayoutEffect, useRef } from "react";
import type { IconName } from "./Icon";
import Icon from "./Icon";

export interface MenuItem {
  id: string;
  label?: string;
  icon?: IconName;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  title?: string;
  separator?: boolean;
  onSelect?: () => void;
}

interface Props {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
  ariaLabel?: string;
}

/** 统一右键菜单：视口内定位、焦点循环和完整键盘操作。 */
export default function ContextMenu({ x, y, items, onClose, ariaLabel = "上下文菜单" }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
    const top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();

    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End", "Tab"].includes(event.key)) return;
      const buttons = [...el.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
      if (buttons.length === 0) return;
      event.preventDefault();
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0
        : event.key === "End" ? buttons.length - 1
        : event.key === "ArrowUp" ? (index <= 0 ? buttons.length - 1 : index - 1)
        : (index + 1) % buttons.length;
      buttons[next]?.focus();
    };
    const pointerdown = (event: PointerEvent) => {
      if (!el.contains(event.target as Node)) onClose();
    };
    const close = () => onClose();
    document.addEventListener("keydown", keydown, true);
    document.addEventListener("pointerdown", pointerdown);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("keydown", keydown, true);
      document.removeEventListener("pointerdown", pointerdown);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
    };
  }, [onClose, x, y]);

  return (
    <div className="context-menu" ref={ref} style={{ left: x, top: y }} role="menu" aria-label={ariaLabel} onContextMenu={(e) => e.preventDefault()}>
      {items.map((item) => item.separator ? (
        <div className="menu-separator" role="separator" key={item.id} />
      ) : (
        <button
          type="button"
          role="menuitem"
          className={`context-item${item.danger ? " danger" : ""}`}
          key={item.id}
          disabled={item.disabled}
          title={item.title}
          onClick={() => { onClose(); item.onSelect?.(); }}
        >
          {item.icon && <Icon name={item.icon} />}
          <span>{item.label}</span>
          {item.shortcut && <kbd>{item.shortcut}</kbd>}
        </button>
      ))}
    </div>
  );
}
