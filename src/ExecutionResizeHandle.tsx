import { useRef } from "react";

export default function ExecutionResizeHandle({
  height,
  onResize,
}: {
  height: number;
  onResize: (height: number) => void;
}) {
  const drag = useRef<{ y: number; height: number } | null>(null);
  const clamp = (value: number, element: HTMLElement) => {
    const available = element.parentElement?.parentElement?.clientHeight ?? 700;
    return Math.round(Math.max(180, Math.min(value, 1200, available - 300)));
  };
  return (
    <div
      className="execution-resize"
      role="separator"
      aria-label="Resize execution panel"
      aria-orientation="horizontal"
      aria-valuemin={180}
      aria-valuemax={1200}
      aria-valuenow={height}
      tabIndex={0}
      title="Drag to resize. Use arrow keys for smaller adjustments."
      onPointerDown={(event) => {
        drag.current = { y: event.clientY, height };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (drag.current)
          onResize(
            clamp(
              drag.current.height + drag.current.y - event.clientY,
              event.currentTarget,
            ),
          );
      }}
      onPointerUp={(event) => {
        drag.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onKeyDown={(event) => {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        onResize(
          clamp(
            height + (event.key === "ArrowUp" ? 30 : -30),
            event.currentTarget,
          ),
        );
      }}
    >
      <span />
    </div>
  );
}
