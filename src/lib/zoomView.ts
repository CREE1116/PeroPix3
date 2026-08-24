/** 큰 그림을 **얼마로 그리고 어디를 보여 줄지** — 계산만 하는 곳 (사용자 지시 2026-08-24:
 *  *"'원본 해상도/꽉차게' 선택 가능하게. 원본이 캔버스보다 크면 드래그해서 볼 수 있게.
 *  %로 화면상의 사이즈 조절도. 이미지가 화면에서 완전히 벗어나지는 않게 제한."*).
 *
 *  ★★**화면을 안 만진다.** 여기 있는 것은 전부 순수 함수라 실제로 돌려 보며 판정할 수 있다
 *    (`zoomView.test.ts`). 끌기·휠·저장은 `panels/Canvas.tsx` 의 몫이다.
 *  ★배율의 뜻: `1` 이 **원본 해상도**(그림 1px = 화면 1px)다. 「꽉차게」는 배율을 사용자가
 *    안 정한 상태이고, 그때 쓰는 값이 `fitScale` 이다.
 */

export type Size = { w: number; h: number };
export type Pan = { x: number; y: number };

export const ZOOM_MIN = 0.05;
export const ZOOM_MAX = 8;
/** 휠 한 칸·단추 한 번이 곱하는 값 — 한 번에 25% 씩 */
const STEP = 1.25;

/** 상자 안에 **다 들어오는** 배율 (`objectFit: contain` 과 같은 값). 작은 그림은 키운다 */
export function fitScale(box: Size, img: Size): number {
  if (!img.w || !img.h || !box.w || !box.h) return 1;
  return Math.min(box.w / img.w, box.h / img.h);
}

export const drawSize = (img: Size, scale: number): Size => ({ w: img.w * scale, h: img.h * scale });

/** 배율 한 칸 — `dir` 이 +1 이면 크게, -1 이면 작게. 한계 밖으로는 안 나간다 */
export function stepZoom(zoom: number, dir: 1 | -1): number {
  const next = dir > 0 ? zoom * STEP : zoom / STEP;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
}

/** 사람이 읽는 % (반올림) */
export const percent = (zoom: number): number => Math.round(zoom * 100);

/** 상자 **한가운데**에 놓았을 때의 자리. 그림이 상자보다 크면 음수가 되고, 그것은
 *  「가운데 부분이 보인다」는 뜻이다.
 *
 *  ★★원본 해상도로 볼 때의 **출발 자리**다 (사용자 지시 2026-08-24). 예전에는 `{0,0}` 에서
 *    시작해서, 작은 그림은 왼쪽 위 구석에 붙고 큰 그림은 왼쪽 위 모서리부터 보였다 —
 *    「꽉차게」는 `contain` 이라 가운데인데 배율을 정하는 순간 그림이 구석으로 튀었다. */
export const centerPan = (box: Size, draw: Size): Pan => ({
  x: (box.w - draw.w) / 2,
  y: (box.h - draw.h) / 2,
});

/** ★★**그림이 상자 밖으로 완전히 나가지 못하게** 붙든다 (사용자 지시 2026-08-24).
 *
 *  한 축에서:
 *    · 그린 크기가 상자보다 **작으면** 움직일 여지가 없다 → 언제나 **가운데**.
 *      ★값이 `0`(왼쪽 위 붙임)이 아니라 `(box - draw) / 2` 다 — 「꽉차게」가 `contain` 으로
 *        가운데에 그리므로, 두 모드가 어긋나지 않으려면 여기도 가운데여야 한다.
 *    · **크면** 그림의 앞 끝은 0 이하, 뒤 끝은 상자 끝 이상이어야 한다 →
 *      `box - draw ≤ 값 ≤ 0`. 그래서 어느 방향으로 끌어도 상자가 늘 그림으로 덮인다.
 *  ★값은 「상자 왼쪽 위에서 본 그림의 왼쪽 위」다 (음수면 왼쪽으로 밀려 있다는 뜻). */
export function clampPan(pan: Pan, box: Size, draw: Size): Pan {
  const one = (v: number, b: number, d: number) =>
    d <= b ? (b - d) / 2 : Math.min(0, Math.max(b - d, v));
  return { x: one(pan.x, box.w, draw.w), y: one(pan.y, box.h, draw.h) };
}

/** 그림이 상자보다 커서 **끌 수 있는가** (한 축이라도 넘치면) */
export const canPan = (box: Size, draw: Size): boolean => draw.w > box.w + 0.5 || draw.h > box.h + 0.5;

/** 배율이 바뀔 때 **상자 한가운데에 있던 지점**을 그대로 붙든다.
 *
 *  ★안 붙들면 확대할 때마다 보고 있던 곳이 왼쪽 위로 흘러간다 — 확대해서 볼 이유가
 *    「거기를 크게 보려고」이므로, 그 지점이 제자리에 있어야 한다. */
export function keepCenter(pan: Pan, box: Size, from: Size, to: Size): Pan {
  if (!from.w || !from.h) return clampPan(pan, box, to);
  const cx = box.w / 2;
  const cy = box.h / 2;
  const next = {
    x: cx - (cx - pan.x) * (to.w / from.w),
    y: cy - (cy - pan.y) * (to.h / from.h),
  };
  return clampPan(next, box, to);
}

/** 「꽉차게」에서 처음 %를 만질 때의 출발 배율 — 지금 보이던 크기 그대로에서 이어진다 */
export const zoomFrom = (box: Size, img: Size, fit: boolean, zoom: number): number =>
  fit ? fitScale(box, img) : zoom;
