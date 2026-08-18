import { useCallback, useEffect, useRef, useState } from "react";

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
 *    않으므로 우리가 직접 그린다** (ghost 좌표를 돌려준다). 껍데기는 `cards/DragGhost` 하나이고
 *    (자리·층·`pointer-events`), 그 안에 무엇을 그릴지만 부르는 쪽이 정한다.
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

// ── 씬 줄 — 카드를 **가로질러** 옮긴다 ────────────────────────────────

/** 끌고 있는 것이 놓일 자리. `index` 는 **틈 번호**다 (0..n, 위 `useReorder` 규약과 같다) */
export type LaneDrop =
  | { kind: "scene"; cardId: string; index: number }
  | { kind: "card"; index: number };

/** 가장자리 자동 스크롤 — v2 `DRAG_SCROLL_ZONE`·`DRAG_SCROLL_SPEED`·`DRAG_MOVE_THRESHOLD` 그대로 */
const ZONE = 48;
const SPEED = 12;
const THRESHOLD = 4;
/** 경계에서 0, 가장자리 바깥에서 1 — 제곱이라 경계 근처에서 아주 완만하게 붙는다 (v2 `dragScrollRamp`) */
const ramp = (d: number) => {
  const t = Math.max(0, Math.min(1, 1 - d / ZONE));
  return t * t;
};

/** 씬 줄 전체를 한 판으로 보는 순서 바꾸기 — v2 슬롯 드래그 이식 (`index.html:11860-12002`).
 *
 *  ★위의 `useReorder` 는 **한 목록 안**에서만 옮긴다. 3.0 의 씬은 카드에 나뉘어 담겨 있어서
 *    (v2 는 슬롯이 한 줄이라 이 층이 없었다) 카드를 넘어 옮기려면 줄 전체가 한 판이어야 한다.
 *    같은 하나로 **카드 자체의 순서**도 바꾼다 — 잡는 그립만 다르다.
 *  ★자리는 **DOM 을 훑어서** 잡는다 (`[data-scene-card]`·`[data-scene]`). 등록부를 두면
 *    카드 사이를 오갈 때 낡은 칸이 남는다 — 칩 드래그가 `[data-chip]` 을 훑는 것과 같은 이유이고,
 *    **DOM 순서가 곧 씬 순서**라 더 얻을 것도 없다.
 *  ★잔상(`ghost`)은 **커서의 화면 좌표**다 — `DragGhost` 로 그리면 줄이 스크롤되거나
 *    가장자리 자동 스크롤이 돌아도 잔상이 밀리지 않는다.
 *  ★**끼울 자리 표시는 레이아웃을 밀지 않는 것**이 부르는 쪽 몫이다 (CLAUDE.md: 칸 사이에
 *    끼워 넣으면 방금 잰 좌표가 어긋난다). 여기서는 자리만 알려 준다.
 *  ★v2 는 슬롯이 **가로**로 놓여 가로로 굴렸다. 3.0 은 씬도 카드도 **세로**로 쌓이므로
 *    세로로 굴린다. 굴린 뒤에는 칸이 밀렸으므로 자리를 **다시 잡는다** (v2 도 그랬다).
 *  ★`pointerdown` 의 `preventDefault` 는 **전용 그립에서만** 한다 — 그립은 누를 일이 없는
 *    손잡이라 잃을 클릭이 없다 (CLAUDE.md 「잊기 쉬운 것」). */
export function useLaneReorder({
  scrollRef,
  onMoveScene,
  onMoveCard,
}: {
  /** 세로로 굴릴 스크롤 상자 (씬 줄) */
  scrollRef: React.RefObject<HTMLElement | null>;
  onMoveScene: (cellId: string, toCardId: string, toIndex: number) => void;
  onMoveCard: (cardId: string, toIndex: number) => void;
}) {
  const [drag, setDrag] = useState<{ kind: "scene" | "card"; id: string } | null>(null);
  const [drop, setDrop] = useState<LaneDrop | null>(null);
  /** 커서를 따라가는 잔상의 자리 (화면 좌표) — 브라우저가 안 그려 주므로 부르는 쪽이 그린다 */
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ kind: "scene" | "card"; id: string } | null>(null);
  const dropRef = useRef<LaneDrop | null>(null);
  const from = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);
  const at = useRef({ x: 0, y: 0 });
  const raf = useRef(0);

  /** 지금 커서 높이가 어느 틈인가 */
  const hit = useCallback(
    (kind: "scene" | "card", y: number): LaneDrop | null => {
      const root = scrollRef.current;
      if (!root) return null;
      const cards = [...root.querySelectorAll<HTMLElement>("[data-scene-card]")];
      if (!cards.length) return null;

      if (kind === "card") {
        let i = cards.length;
        for (let k = 0; k < cards.length; k++) {
          const r = cards[k].getBoundingClientRect();
          if (y < r.top + r.height / 2) {
            i = k;
            break;
          }
        }
        return { kind: "card", index: i };
      }

      // 어느 카드 위인가 — 마지막 카드보다 아래면 그 카드다
      let card = cards[cards.length - 1];
      for (const c of cards) {
        if (y < c.getBoundingClientRect().bottom) {
          card = c;
          break;
        }
      }
      const id = card.dataset.sceneCard ?? "";
      const rows = [...card.querySelectorAll<HTMLElement>("[data-scene]")];
      // ★접힌 카드에는 줄이 안 그려져 자리를 고를 수 없다 — **그 카드의 끝**에 붙인다
      //   (접힌 블록에 칩을 떨궜을 때와 같은 규칙, CLAUDE.md)
      if (!rows.length) return { kind: "scene", cardId: id, index: -1 };
      let i = rows.length;
      for (let k = 0; k < rows.length; k++) {
        const r = rows[k].getBoundingClientRect();
        if (y < r.top + r.height / 2) {
          i = k;
          break;
        }
      }
      return { kind: "scene", cardId: id, index: i };
    },
    [scrollRef],
  );

  const track = useCallback(
    (y: number) => {
      const d = dragRef.current;
      if (!d) return;
      const next = hit(d.kind, y);
      dropRef.current = next;
      setDrop(next);
    },
    [hit],
  );

  const loop = useCallback(
    function step() {
      raf.current = 0;
      const root = scrollRef.current;
      if (!root || !dragRef.current) return;
      const r = root.getBoundingClientRect();
      const max = root.scrollHeight - root.clientHeight;
      const top = at.current.y - r.top;
      const bottom = r.bottom - at.current.y;
      let d = 0;
      if (top < ZONE && root.scrollTop > 0) d = -SPEED * ramp(top);
      else if (bottom < ZONE && root.scrollTop < max) d = SPEED * ramp(bottom);
      if (d) {
        root.scrollTop += d;
        // 굴리면 칸이 밀리므로 놓일 자리도 다시 잡아야 따라온다 (v2 `startDragAutoScroll`)
        track(at.current.y);
      }
      raf.current = requestAnimationFrame(step);
    },
    [scrollRef, track],
  );

  const finish = useCallback(() => {
    if (raf.current) {
      cancelAnimationFrame(raf.current);
      raf.current = 0;
    }
    const d = dragRef.current;
    const target = dropRef.current;
    const did = moved.current;
    dragRef.current = null;
    dropRef.current = null;
    from.current = null;
    moved.current = false;
    setDrag(null);
    setDrop(null);
    setGhost(null);
    // ★잡기만 하고 놓으면 순서가 그대로여야 한다 (v2 `dragMoved`)
    if (!did || !d || !target) return;
    if (d.kind === "card" && target.kind === "card") onMoveCard(d.id, target.index);
    if (d.kind === "scene" && target.kind === "scene") onMoveScene(d.id, target.cardId, target.index);
  }, [onMoveCard, onMoveScene]);

  useEffect(
    () => () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    },
    [],
  );

  /** 그립에 펴 넣는다 — 씬이면 씬 id, 카드면 카드 id */
  const gripProps = useCallback(
    (kind: "scene" | "card", id: string) => ({
      onPointerDown: (e: React.PointerEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();
        // ★줄을 잡아 끄는 가로 스크롤(`SceneLane` 의 pan)로 새어 나가지 않게 막는다
        e.stopPropagation();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        dragRef.current = { kind, id };
        dropRef.current = null;
        from.current = { x: e.clientX, y: e.clientY };
        at.current = { x: e.clientX, y: e.clientY };
        moved.current = false;
        setDrag({ kind, id });
      },
      onPointerMove: (e: React.PointerEvent) => {
        if (!dragRef.current) return;
        at.current = { x: e.clientX, y: e.clientY };
        if (!moved.current) {
          const d = Math.abs(e.clientX - (from.current?.x ?? 0)) + Math.abs(e.clientY - (from.current?.y ?? 0));
          // ★실제로 끌기 전에는 자리도 스크롤도 안 건드린다 (v2 `DRAG_MOVE_THRESHOLD`)
          if (d < THRESHOLD) return;
          moved.current = true;
          if (!raf.current) raf.current = requestAnimationFrame(loop);
        }
        setGhost({ x: e.clientX, y: e.clientY });
        track(e.clientY);
      },
      onPointerUp: (e: React.PointerEvent) => {
        try {
          (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        } catch {
          /* 이미 놓쳤으면 그냥 간다 */
        }
        finish();
      },
      onPointerCancel: finish,
      style: { cursor: "grab", touchAction: "none" as const },
    }),
    [finish, loop, track],
  );

  return { drag, drop, ghost, gripProps };
}
