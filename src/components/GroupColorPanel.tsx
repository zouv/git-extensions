import { useLayoutEffect, useRef } from "react";
import { GROUP_COLOR_PRESETS } from "../repoGroups";
import type { RepoGroupColor } from "../repoGroups";
import Icon from "../ui/Icon";
import { isTopLayer, popLayer, pushLayer } from "../ui/layerStack";

const COLUMNS = 8;

interface Props {
  x: number;
  y: number;
  color: RepoGroupColor;
  groupName?: string;
  onSelect: (color: RepoGroupColor) => void;
  onClose: () => void;
}

/** 分组颜色弹层：8 列预设色板，方向键 / Home / End 移动焦点，选中即时生效。 */
export default function GroupColorPanel({ x, y, color, groupName, onSelect, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const initialIndex = Math.max(0, GROUP_COLOR_PRESETS.findIndex((preset) => preset.value === color));

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const layer = pushLayer();
    const previousFocus = document.activeElement as HTMLElement | null;
    const rect = el.getBoundingClientRect();
    el.style.left = `${Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))}px`;
    el.style.top = `${Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))}px`;
    const swatches = () => [...el.querySelectorAll<HTMLButtonElement>(".group-color-swatch")];
    const initial = swatches();
    initial[Math.min(initialIndex, initial.length - 1)]?.focus({ preventScroll: true });

    const keydown = (event: KeyboardEvent) => {
      if (!isTopLayer(layer)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onCloseRef.current();
        return;
      }
      if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End", "Tab"].includes(event.key)) return;
      const all = swatches();
      if (all.length === 0) return;
      const index = all.indexOf(document.activeElement as HTMLButtonElement);
      const last = all.length - 1;
      const at = index < 0 ? 0 : index;
      const next = event.key === "Home" ? 0
        : event.key === "End" ? last
        : event.key === "ArrowRight" || (event.key === "Tab" && !event.shiftKey) ? (at + 1) % all.length
        : event.key === "ArrowLeft" || (event.key === "Tab" && event.shiftKey) ? (at <= 0 ? last : at - 1)
        : event.key === "ArrowDown" ? Math.min(last, at + COLUMNS)
        : Math.max(0, at - COLUMNS);
      event.preventDefault();
      event.stopImmediatePropagation();
      all[next]?.focus({ preventScroll: true });
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
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [x, y, initialIndex]);

  return (
    <div className="group-color-popover" ref={ref} role="dialog"
      aria-label={groupName ? `分组颜色 · ${groupName}` : "分组颜色"}
      style={{ left: x, top: y }}>
      <div className="group-color-popover-head">
        <span>分组颜色</span>
        {groupName && <span className="group-color-group-name" title={groupName}>{groupName}</span>}
      </div>
      <div className="group-color-grid" role="group" aria-label="预设颜色">
        {GROUP_COLOR_PRESETS.map((preset) => {
          const selected = preset.value === color;
          return (
            <button key={preset.value} type="button"
              className={`group-color-swatch${selected ? " selected" : ""}`}
              style={{ background: preset.value }} title={preset.label} aria-label={preset.label} aria-pressed={selected}
              onClick={() => onSelect(preset.value)}>
              {selected && <Icon name="check" size={12} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
