import { useLayoutEffect, useRef, useState } from "react";
import type { IconName } from "./Icon";
import Icon from "./Icon";
import { isTopLayer, popLayer, pushLayer } from "./layerStack";

export interface MenuTrailingAction {
  icon: IconName;
  label: string;
  checked: boolean;
  disabled?: boolean;
  keepOpen?: boolean;
  onSelect: () => void;
}

export interface MenuItem {
  id: string;
  label?: string;
  icon?: IconName;
  color?: string;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  checked?: boolean;
  title?: string;
  separator?: boolean;
  /** 多选类菜单保持打开，便于连续切换多个项目。 */
  keepOpen?: boolean;
  /** 子菜单；仅 Repository > Git maintenance 使用。 */
  children?: MenuItem[];
  trailingAction?: MenuTrailingAction;
  onSelect?: () => void;
}

interface Props {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
  ariaLabel?: string;
}

/** 统一右键菜单：视口内定位、焦点循环、关闭后恢复触发元素焦点。 */
export default function ContextMenu({ x, y, items, onClose, ariaLabel = "上下文菜单" }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [submenu, setSubmenu] = useState<{ item: MenuItem; x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const layer = pushLayer();
    const previousFocus = document.activeElement as HTMLElement | null;
    const rect = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
    const top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();

    const keydown = (event: KeyboardEvent) => {
      if (!isTopLayer(layer)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onCloseRef.current();
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End", "Tab"].includes(event.key)) return;
      const buttons = [...el.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
      if (buttons.length === 0) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0
        : event.key === "End" ? buttons.length - 1
        : (event.key === "ArrowUp" || (event.key === "Tab" && event.shiftKey)) ? (index <= 0 ? buttons.length - 1 : index - 1)
        : (index < 0 ? 0 : (index + 1) % buttons.length);
      buttons[next]?.focus();
    };
    const pointerdown = (event: PointerEvent) => {
      if (!isTopLayer(layer)) return;
      if (!el.contains(event.target as Node)) onCloseRef.current();
    };
    const close = () => onCloseRef.current();
    document.addEventListener("keydown", keydown, true);
    document.addEventListener("pointerdown", pointerdown);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    return () => {
      popLayer(layer);
      document.removeEventListener("keydown", keydown, true);
      document.removeEventListener("pointerdown", pointerdown);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [x, y]);

  return (
    <div className="context-menu" ref={ref} style={{ left: x, top: y }} role="menu" aria-label={ariaLabel} onContextMenu={(e) => e.preventDefault()}>
      {items.map((item) => {
        if (item.separator) return <div className="menu-separator" role="separator" key={item.id} />;
        const main = (
          <button
            type="button"
            role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
            aria-checked={item.checked === undefined ? undefined : item.checked}
            className={`context-item${item.danger ? " danger" : ""}`}
            key={item.id}
            disabled={item.disabled}
            title={item.title}
            aria-haspopup={item.children ? "menu" : undefined}
            onClick={(event) => {
              if (item.children) {
                const rect = event.currentTarget.getBoundingClientRect();
                setSubmenu({ item, x: rect.right + 2, y: rect.top });
                return;
              }
              if (!item.keepOpen) onClose();
              item.onSelect?.();
            }}
          >
            {item.checked !== undefined && <span className="menu-check">{item.checked ? <Icon name="check" size={14} /> : null}</span>}
            {item.color && <span className="menu-color" style={{ background: item.color }} aria-hidden="true" />}
            {item.icon && <Icon name={item.icon} />}
            <span>{item.label}</span>
            {item.shortcut && <kbd>{item.shortcut}</kbd>}
            {item.children && <Icon name="chevron-right" size={13} />}
          </button>
        );
        if (!item.trailingAction) return main;
        const action = item.trailingAction;
        return (
          <div className="context-item-row" role="none" key={item.id}>
            {main}
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={action.checked}
              aria-label={action.label}
              className={`context-item-action${action.checked ? " checked" : ""}`}
              disabled={action.disabled}
              title={action.label}
              onClick={() => { if (!action.keepOpen) onClose(); action.onSelect(); }}
            >
              <Icon name={action.icon} size={14} />
            </button>
          </div>
        );
      })}
      {submenu && <ContextMenu
        x={submenu.x}
        y={submenu.y}
        items={submenu.item.children ?? []}
        ariaLabel={submenu.item.label ?? "子菜单"}
        onClose={() => { setSubmenu(null); onCloseRef.current(); }}
      />}
    </div>
  );
}
