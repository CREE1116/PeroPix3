/** 캐릭터 배치 좌표 — 격자 스냅 · 자동 자리 배정 · 겹침 판정.
 *
 *  ★공홈 번들에서 그대로 옮긴 것이다 (`_tmp/nai-v5/chunks/1388`, 대조 2026-08-21).
 *    한 자리라도 다르면 같은 시드에서 다른 그림이 나오므로 값을 임의로 다듬지 말 것.
 *      · `snapCenter` ← `$n()`
 *      · `LADDER`·`nextCenter` ← `sw` 와 그것을 훑는 자리 배정 함수
 *      · `crowded` ← `sx()`
 *  ★스냅은 **전송 직전에 백엔드에서도** 한 번 더 걸린다 (`backend/nai.py` 의 `snap_center`).
 *    거기가 정본이고, 여기 것은 화면이 「어느 칸에 있나」를 그리기 위한 같은 계산이다.
 *  ★자유 배치 모델(V5·custom)은 스냅을 **안 한다** — 값이 그대로 나간다.
 */

export type Center = { x: number; y: number };

/** 5×5 격자의 실제 값 — 0/0.25/… 가 아니다 (`docs/nai-web-reference.md` 4절) */
export const CENTER_GRID = [0.1, 0.3, 0.5, 0.7, 0.9];

/** 좌표를 안 정했을 때의 자리 */
export const DEFAULT_CENTER: Center = { x: 0.5, y: 0.5 };

/** 자유 배치에서 「겹쳤다」로 보는 거리. 격자에서는 같은 칸인지로 본다 */
export const OVERLAP = 0.1;

const q = (v: number) => CENTER_GRID[Math.min(4, Math.max(0, Math.floor(5 * v)))];

/** 0~1 좌표를 5×5 격자로 */
export const snapCenter = (c: Center): Center => ({ x: q(c.x), y: q(c.y) });

/** 자리를 채우는 순서 — 가운데 줄을 좌우로 벌리고, 그 뒤 바깥 줄을 중심에서 가까운 순으로.
 *  ★가운데 줄이 앞에 통째로 오는 것이 핵심이다: 두 명이면 좌우로 갈라서 선다. */
export const LADDER: Center[] = [
  ...[0.5, 0.3, 0.7, 0.1, 0.9].map((x) => ({ x, y: 0.5 })),
  ...[0.1, 0.3, 0.7, 0.9]
    .flatMap((y) => CENTER_GRID.map((x) => ({ x, y })))
    .sort(
      (a, b) =>
        Math.hypot(a.x - 0.5, a.y - 0.5) - Math.hypot(b.x - 0.5, b.y - 0.5) ||
        Math.abs(a.y - 0.5) - Math.abs(b.y - 0.5) ||
        a.x - b.x ||
        a.y - b.y,
    ),
];

/** 새로 들어오는 캐릭터의 자리 — 사다리에서 **아직 아무도 없는 첫 칸**을 준다.
 *  스물다섯 칸이 다 차면 한가운데로 겹쳐 놓는다 (공홈도 그렇다). */
export function nextCenter(taken: Center[], freeform: boolean): Center {
  for (const slot of LADDER) {
    const used = taken.some((c) =>
      freeform
        ? Math.hypot(c.x - slot.x, c.y - slot.y) < OVERLAP
        : snapCenter(c).x === slot.x && snapCenter(c).y === slot.y,
    );
    if (!used) return slot;
  }
  return DEFAULT_CENTER;
}

/** 서로 붙어 선 캐릭터들의 인덱스 — 화면이 경고 색을 칠하는 근거 (자유 배치용) */
export function crowded(centers: Center[]): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < centers.length; i++)
    for (let j = i + 1; j < centers.length; j++)
      if (Math.hypot(centers[i].x - centers[j].x, centers[i].y - centers[j].y) < OVERLAP) {
        out.add(i);
        out.add(j);
      }
  return out;
}

/** 화면 좌표 → 0~1. ★소수점 **셋째 자리**에서 반올림한다 (공홈 `g()` 와 같은 자리다) */
export const toCenter = (px: number, py: number, r: DOMRect): Center => ({
  x: Math.round(1000 * Math.min(1, Math.max(0, (px - r.left) / r.width))) / 1000,
  y: Math.round(1000 * Math.min(1, Math.max(0, (py - r.top) / r.height))) / 1000,
});
