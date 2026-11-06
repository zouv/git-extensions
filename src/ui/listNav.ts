import type { KeyboardEvent as ReactKeyboardEvent } from "react";

/** 列表行共用的方向键焦点移动；返回 true 表示按键已被处理。 */
export function moveListFocus(event: ReactKeyboardEvent<HTMLElement>, selector: string): boolean {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return false;
  const container = event.currentTarget.parentElement;
  if (!container) return false;
  const items = [...container.querySelectorAll<HTMLElement>(selector)].filter((element) => element.getClientRects().length > 0);
  if (items.length === 0) return false;
  const index = items.indexOf(event.currentTarget);
  const next = event.key === "Home" ? 0
    : event.key === "End" ? items.length - 1
    : event.key === "ArrowDown" ? (index < 0 ? 0 : Math.min(items.length - 1, index + 1))
    : (index <= 0 ? 0 : index - 1);
  event.preventDefault();
  items[next]?.focus();
  return true;
}
