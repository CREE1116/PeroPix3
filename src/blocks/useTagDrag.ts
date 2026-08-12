import { useCallback, useRef, useState } from "react";

/** 태그 칩 하나가 놓일 자리 — 몇 번째 블록의 몇 번째 칸인가.
 *  `index === -1` 은 **그 블록의 끝**이다 (접힌 블록에 떨어뜨렸을 때). */
export type Spot = { block: number; index: number };

/** 칩을 끌어 자리를 옮긴다 — 같은 블록 안에서도, **다른 블록으로도**.
 *
 *  ★블록 순서 변경(`useReorder`)과 같은 포인터 방식이다. 이유도 같다 — WebView2 가
 *    HTML5 드래그를 파일 드롭으로 가로챈다.
 *  ★칩 위치는 **끌고 있는 동안 실시간으로 잰다**. 삽입 표시가 레이아웃을 밀지 않도록
 *    화면 좌표에 떠 있는 막대로 그리므로, 재는 값이 흔들리지 않는다.
 *  ★칩 목록은 등록부를 두지 않고 `[data-chip]` 로 훑는다 — 칩은 지웠다 만들었다 하는
 *    것이라 등록부를 두면 오래된 칸이 남는다. DOM 순서가 곧 칩 순서다. */
export function useTagDrag(onMove: (from: Spot, to: Spot) => void) {
  const rows = useRef<(HTMLElement | null)[]>([]);
  const start = useRef<{ from: Spot; label: string; x: number; y: number } | null>(null);
  const overRef = useRef<Spot | null>(null);
  /** 방금 끌기가 끝났나 — 끌고 난 뒤의 클릭이 "텍스트로 편집"을 열지 않게 */
  const endedAt = useRef(-1e9);

  const [from, setFrom] = useState<Spot | null>(null);
  const [label, setLabel] = useState("");
  /** 끼울 자리에 세우는 막대 (화면 좌표) */
  const [bar, setBar] = useState<{ x: number; y: number; h: number } | null>(null);
  /** 접힌 블록이 받을 때 — 막대 대신 그 줄 전체를 두른다 */
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);

  const regRow = useCallback(
    (i: number) => (el: HTMLElement | null) => {
      rows.current[i] = el;
    },
    [],
  );

  /** 포인터 아래의 자리. 칩이 행 우선으로 놓이므로 **앞선 칩의 수**가 곧 끼울 자리다. */
  const spotAt = useCallback((x: number, y: number) => {
    let bi = -1;
    let best = 24; // 블록 사이 틈(DropLine)만큼은 가까운 줄로 쳐 준다
    for (let i = 0; i < rows.current.length; i++) {
      const el = rows.current[i];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (y >= r.top && y <= r.bottom) {
        bi = i;
        best = 0;
        break;
      }
      const d = y < r.top ? r.top - y : y - r.bottom;
      if (d < best) {
        best = d;
        bi = i;
      }
    }
    if (bi < 0) return null;

    const row = rows.current[bi]!;
    const chips = Array.from(row.querySelectorAll<HTMLElement>("[data-chip]"));
    const area = row.querySelector<HTMLElement>("[data-chips]");

    // 접힌 블록 — 칩이 아예 안 그려져 있다. 통째로 받아 **끝에** 붙인다
    if (!area) {
      const r = row.getBoundingClientRect();
      return {
        spot: { block: bi, index: -1 },
        box: { x: r.left, y: r.top, w: r.width, h: r.height },
      };
    }

    let idx = 0;
    let mark: DOMRect | null = null;
    for (const el of chips) {
      const r = el.getBoundingClientRect();
      // 윗줄에 있으면 무조건 앞 · 같은 줄이면 가운데를 넘겼을 때만 앞
      if (y > r.bottom || (y >= r.top && x > r.left + r.width / 2)) idx++;
    }
    if (chips.length) mark = chips[Math.min(idx, chips.length - 1)].getBoundingClientRect();

    const a = area.getBoundingClientRect();
    const at = mark
      ? { x: idx < chips.length ? mark.left - 2 : mark.right + 1, y: mark.top, h: mark.height }
      : { x: a.left, y: a.top, h: Math.max(14, Math.min(20, a.height)) };
    return { spot: { block: bi, index: idx }, bar: at };
  }, []);

  const reset = useCallback(() => {
    start.current = null;
    overRef.current = null;
    setFrom(null);
    setBar(null);
    setBox(null);
    setGhost(null);
  }, []);

  const handle = useCallback(
    (block: number, index: number, tagLabel: string) => ({
      onPointerDown: (e: React.PointerEvent) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        start.current = { from: { block, index }, label: tagLabel, x: e.clientX, y: e.clientY };
      },
      onPointerMove: (e: React.PointerEvent) => {
        const s = start.current;
        if (!s) return;
        // ★몇 픽셀 움직이기 전에는 끌기로 치지 않는다 — 칩을 그냥 누르면 텍스트 편집이 열린다
        if (!from) {
          if (Math.abs(e.clientX - s.x) + Math.abs(e.clientY - s.y) < 5) return;
          setFrom(s.from);
          setLabel(s.label);
        }
        const hit = spotAt(e.clientX, e.clientY);
        overRef.current = hit?.spot ?? null;
        setBar(hit?.bar ?? null);
        setBox(hit?.box ?? null);
        setGhost({ x: e.clientX + 10, y: e.clientY + 12 });
      },
      onPointerUp: (e: React.PointerEvent) => {
        (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
        const s = start.current;
        const to = overRef.current;
        const active = from != null;
        reset();
        if (!active) return;
        endedAt.current = performance.now();
        if (s && to) onMove(s.from, to);
      },
      onPointerCancel: reset,
      style: { cursor: "grab", touchAction: "none" as const },
    }),
    [from, spotAt, onMove, reset],
  );

  return {
    regRow,
    handle,
    from,
    label,
    bar,
    box,
    ghost,
    /** 끌고 난 직후의 클릭인가 (텍스트 편집이 딸려 열리는 것을 막는다) */
    justDragged: () => performance.now() - endedAt.current < 250,
  };
}
