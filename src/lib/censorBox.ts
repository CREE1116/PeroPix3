/** 검열 박스 조작의 셈. **순수 함수만** 둔다 (v2 `handleCensorMouseDown/Move` 이식).
 *
 *  ★박스는 **돌아간다.** 그래서 맞았는지 보려면 마우스를 박스 중심 기준으로 **역회전**해
 *    반듯한 사각형과 견줘야 한다. 이 한 가지를 빼먹으면 돌린 박스는 잡히지 않는다.
 *  ★늘릴 때 고정되는 것은 **반대편 모서리의 화면 좌표**다 (`anchor`). 로컬 좌표로 잡으면
 *    돌아간 박스를 늘릴 때 박스가 미끄러진다.
 */
export type Rect = [number, number, number, number];
export type Handle = "nw" | "ne" | "sw" | "se" | "n" | "s" | "w" | "e" | "rotate";

/** 손잡이가 붙는 자리 여덟 + 회전 하나. 그리는 쪽과 잡는 쪽이 같은 목록을 본다 */
export const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

export const CURSORS: Record<Handle, string> = {
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
  nw: "nwse-resize",
  se: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  rotate: "grab",
};

/** 회전 손잡이가 박스 위로 떨어지는 거리 (그림 좌표) */
export const ROTATE_GAP = 25;

export const center = (b: Rect) => ({ x: (b[0] + b[2]) / 2, y: (b[1] + b[3]) / 2 });

/** 점을 중심 기준으로 **역회전**. 돌아간 박스를 반듯한 사각형처럼 다루려고 */
export function unrotate(px: number, py: number, cx: number, cy: number, angle: number) {
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  const dx = px - cx;
  const dy = py - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

/** 점을 중심 기준으로 돌린다 (역회전의 반대) */
export function rotate(px: number, py: number, cx: number, cy: number, angle: number) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = px - cx;
  const dy = py - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

/** 손잡이 아홉의 자리 (회전 전 로컬 좌표) */
export function handlePoint(b: Rect, h: Handle) {
  const { x: cx, y: cy } = center(b);
  switch (h) {
    case "nw": return { x: b[0], y: b[1] };
    case "ne": return { x: b[2], y: b[1] };
    case "sw": return { x: b[0], y: b[3] };
    case "se": return { x: b[2], y: b[3] };
    case "n": return { x: cx, y: b[1] };
    case "s": return { x: cx, y: b[3] };
    case "w": return { x: b[0], y: cy };
    case "e": return { x: b[2], y: cy };
    case "rotate": return { x: cx, y: b[1] - ROTATE_GAP };
  }
}

/** 어느 박스 안인가. 뒤에 그린 것부터 본다 (위에 있는 것이 먼저 잡힌다) */
export function hitBox(list: { box: Rect; rotation?: number }[], x: number, y: number): number {
  for (let i = list.length - 1; i >= 0; i--) {
    const b = list[i].box;
    const c = center(b);
    const p = unrotate(x, y, c.x, c.y, list[i].rotation ?? 0);
    if (p.x >= b[0] && p.x <= b[2] && p.y >= b[1] && p.y <= b[3]) return i;
  }
  return -1;
}

/** 어느 손잡이인가. ★**보이는 박스만** 본다 (손잡이는 고른 것·가리킨 것에만 그린다) */
export function hitHandle(
  list: { box: Rect; rotation?: number }[],
  x: number,
  y: number,
  tol: number,
  visible: number[],
): { handle: Handle | null; index: number } {
  for (const i of visible) {
    const it = list[i];
    if (!it) continue;
    const c = center(it.box);
    const p = unrotate(x, y, c.x, c.y, it.rotation ?? 0);
    for (const h of ["rotate", ...HANDLES] as Handle[]) {
      const q = handlePoint(it.box, h);
      if (Math.abs(p.x - q.x) < tol && Math.abs(p.y - q.y) < tol) return { handle: h, index: i };
    }
  }
  return { handle: null, index: -1 };
}

/** 잡은 손잡이의 **반대편**을 화면 좌표로 (늘리는 동안 여기가 고정된다) */
export function anchorOf(b: Rect, rotation: number, h: Handle) {
  const map: Record<Exclude<Handle, "rotate">, [number, number]> = {
    nw: [b[2], b[3]],
    ne: [b[0], b[3]],
    sw: [b[2], b[1]],
    se: [b[0], b[1]],
    n: [b[0], b[3]],
    s: [b[2], b[1]],
    w: [b[2], b[1]],
    e: [b[0], b[3]],
  };
  const [ax, ay] = map[h as Exclude<Handle, "rotate">];
  const c = center(b);
  return rotate(ax, ay, c.x, c.y, rotation);
}

/** 늘리기 한 걸음. v2 의 세 갈래를 그대로 옮겼다 (코너 · 변 · 가운데 기준).
 *
 *  `symmetric` 은 Ctrl 을 누른 것. 가운데를 고정하고 양쪽으로 늘린다. */
export function resizeBox(
  orig: Rect,
  rotation: number,
  handle: Exclude<Handle, "rotate">,
  anchor: { x: number; y: number },
  mx: number,
  my: number,
  symmetric: boolean,
): Rect {
  const corner = handle === "nw" || handle === "ne" || handle === "sw" || handle === "se";

  if (symmetric) {
    const c = center(orig);
    const m = unrotate(mx, my, c.x, c.y, rotation);
    if (corner) {
      const dx = Math.abs(m.x - c.x);
      const dy = Math.abs(m.y - c.y);
      return [c.x - dx, c.y - dy, c.x + dx, c.y + dy];
    }
    if (handle === "n" || handle === "s") {
      const dy = Math.abs(m.y - c.y);
      return [orig[0], c.y - dy, orig[2], c.y + dy];
    }
    const dx = Math.abs(m.x - c.x);
    return [c.x - dx, orig[1], c.x + dx, orig[3]];
  }

  if (corner) {
    const wx = (anchor.x + mx) / 2;
    const wy = (anchor.y + my) / 2;
    const a = unrotate(anchor.x, anchor.y, wx, wy, rotation);
    const m = unrotate(mx, my, wx, wy, rotation);
    return [Math.min(a.x, m.x), Math.min(a.y, m.y), Math.max(a.x, m.x), Math.max(a.y, m.y)];
  }

  // 변 손잡이. 마우스의 **한 축만** 쓰고 나머지 축은 원래 길이를 유지한다
  const w = orig[2] - orig[0];
  const h = orig[3] - orig[1];
  const d = unrotate(mx - anchor.x, my - anchor.y, 0, 0, rotation);
  const local =
    handle === "n" ? { x: w, y: d.y }
    : handle === "s" ? { x: -w, y: d.y }
    : handle === "w" ? { x: d.x, y: h }
    : { x: d.x, y: -h };
  const world = rotate(local.x, local.y, 0, 0, rotation);
  const ex = anchor.x + world.x;
  const ey = anchor.y + world.y;
  const wx = (anchor.x + ex) / 2;
  const wy = (anchor.y + ey) / 2;
  const a = unrotate(anchor.x, anchor.y, wx, wy, rotation);
  const m = unrotate(ex, ey, wx, wy, rotation);
  return [Math.min(a.x, m.x), Math.min(a.y, m.y), Math.max(a.x, m.x), Math.max(a.y, m.y)];
}

/** 손잡이로 돌린 각도. ★위쪽 손잡이가 12시를 가리키도록 90도를 더한다 (v2 와 같다) */
export const angleTo = (cx: number, cy: number, x: number, y: number) =>
  Math.atan2(y - cy, x - cx) + Math.PI / 2;

/** 손이 떨린 정도는 박스가 아니다. v2 도 10px 미만은 버린다 */
export const bigEnough = (b: Rect, min = 10) => b[2] - b[0] > min && b[3] - b[1] > min;
