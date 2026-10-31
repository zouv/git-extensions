import { useRef } from "react";

interface Props {
  direction: "vertical" | "horizontal";
  onResize: (delta: number) => void;
  onReset: () => void;
  label: string;
}

export default function SplitHandle({ direction, onResize, onReset, label }: Props) {
  const previous = useRef(0);
  const vertical = direction === "vertical";
  return (
    <div
      className={`split-handle ${direction}`}
      role="separator"
      aria-label={label}
      aria-orientation={vertical ? "vertical" : "horizontal"}
      tabIndex={0}
      onDoubleClick={onReset}
      onPointerDown={(e) => {
        previous.current = vertical ? e.clientX : e.clientY;
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        const position = vertical ? e.clientX : e.clientY;
        onResize(position - previous.current);
        previous.current = position;
      }}
      onKeyDown={(e) => {
        const forward = vertical ? "ArrowRight" : "ArrowDown";
        const backward = vertical ? "ArrowLeft" : "ArrowUp";
        if (e.key !== forward && e.key !== backward) return;
        e.preventDefault();
        const amount = e.shiftKey ? 48 : 16;
        onResize(e.key === forward ? amount : -amount);
      }}
    />
  );
}
