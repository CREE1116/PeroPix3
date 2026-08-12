import { useI18n } from "../i18n";
import { useEffect, useRef, useState } from "react";

/** 패널 폭 조절 손잡이.
 *  드래그 중에는 상태만 바꾸고, 손을 뗐을 때 한 번만 저장한다(onCommit). */
export function ResizeHandle({
  width,
  setWidth,
  onCommit,
  min = 240,
  max = 640,
  side = "left",
}: {
  width: number;
  setWidth: (w: number) => void;
  onCommit?: () => void;
  min?: number;
  max?: number;
  /** left = 손잡이 왼쪽에 패널이 있음 / right = 오른쪽에 있음 */
  side?: "left" | "right";
}) {
  const t = useI18n((s) => s.t);
  const [dragging, setDragging] = useState(false);
  const start = useRef({ x: 0, w: 0 });

  useEffect(() => {
    if (!dragging) return;
    const move = (e: MouseEvent) => {
      const dx = e.clientX - start.current.x;
      const next = side === "left" ? start.current.w + dx : start.current.w - dx;
      setWidth(Math.max(min, Math.min(max, next)));
    };
    const up = () => {
      setDragging(false);
      onCommit?.();
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    // 드래그 중 텍스트 선택·커서 깜빡임 방지
    const prev = document.body.style.cursor;
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.style.cursor = prev;
      document.body.style.userSelect = "";
    };
  }, [dragging, min, max, onCommit, setWidth, side]);

  return (
    <div
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        start.current = { x: e.clientX, w: width };
        setDragging(true);
      }}
      title={t("panel.resizeHint")}
      style={{
        flex: "0 0 5px",
        cursor: "ew-resize",
        background: dragging ? "var(--accent)" : "transparent",
        transition: dragging ? undefined : "background 0.12s",
      }}
      onMouseEnter={(e) => {
        if (!dragging) e.currentTarget.style.background = "var(--accent-line)";
      }}
      onMouseLeave={(e) => {
        if (!dragging) e.currentTarget.style.background = "transparent";
      }}
    />
  );
}
