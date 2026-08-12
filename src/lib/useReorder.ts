import { useCallback, useRef, useState } from "react";

export type GhostPos = {
  /** 화면 좌표 (고스트의 좌상단) */
  x: number;
  y: number;
  w: number;
  h: number;
};

/** 포인터 기반 순서 변경.
 *
 *  ★HTML5 드래그앤드롭을 쓰지 않는다. WebView2 는 OS 파일 드롭 핸들러가 HTML5 드래그를
 *    가로채고(`dragDropEnabled`), 드래그 이미지 캡처 타이밍 같은 함정도 있다.
 *    포인터 이벤트는 환경에 의존하지 않지만, **커서를 따라오는 잔상은 브라우저가 만들어 주지
 *    않으므로 우리가 직접 그린다** (ghost 좌표를 돌려준다).
 *
 *  쓰는 쪽에서:
 *   - 각 행 요소를 `register(i)` 로 등록한다.
 *   - 그립에 `handleProps(i)` 를 편다.
 *   - `dragIdx` 인 행은 흐리게, `overIdx` 자리에 삽입선을, `ghost` 위치에 떠 있는 사본을 그린다. */
export function useReorder(_count: number, onMove: (from: number, to: number) => void) {
  const rows = useRef<(HTMLElement | null)[]>([]);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const [ghost, setGhost] = useState<GhostPos | null>(null);
  const overRef = useRef<number | null>(null);
  /** 잡은 지점이 행 안에서 어디였는지 — 고스트가 커서에 자연스럽게 붙게 */
  const grab = useRef({ dx: 0, dy: 0, w: 0, h: 0 });

  const register = useCallback(
    (i: number) => (el: HTMLElement | null) => {
      rows.current[i] = el;
    },
    [],
  );

  /** 포인터 y 가 어느 틈(0..count)에 있는지 */
  const gapAt = useCallback((y: number) => {
    let gap = 0;
    for (let i = 0; i < rows.current.length; i++) {
      const el = rows.current[i];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      gap = y < r.top + r.height / 2 ? i : i + 1;
      if (y < r.bottom) break;
    }
    return gap;
  }, []);

  const end = useCallback(() => {
    setDragIdx(null);
    setOverIdx(null);
    setGhost(null);
    overRef.current = null;
  }, []);

  const handleProps = useCallback(
    (i: number) => ({
      onPointerDown: (e: React.PointerEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

        const row = rows.current[i];
        const r = row?.getBoundingClientRect();
        if (r) {
          grab.current = { dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width, h: r.height };
          setGhost({ x: r.left, y: r.top, w: r.width, h: r.height });
        }
        setDragIdx(i);
        setOverIdx(i);
        overRef.current = i;
      },
      onPointerMove: (e: React.PointerEvent) => {
        if (dragIdx == null) return;
        const g = gapAt(e.clientY);
        overRef.current = g;
        setOverIdx(g);
        setGhost({
          x: e.clientX - grab.current.dx,
          y: e.clientY - grab.current.dy,
          w: grab.current.w,
          h: grab.current.h,
        });
      },
      onPointerUp: (e: React.PointerEvent) => {
        (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
        const from = dragIdx;
        const to = overRef.current;
        end();
        if (from == null || to == null) return;
        if (to === from || to === from + 1) return; // 제자리
        onMove(from, to);
      },
      onPointerCancel: end,
      style: { cursor: dragIdx === i ? "grabbing" : "grab", touchAction: "none" as const },
    }),
    [dragIdx, gapAt, onMove, end],
  );

  return { register, handleProps, dragIdx, overIdx, ghost };
}
