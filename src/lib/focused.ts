/** Focused Inpainting. 큰 그림에서 **칠한 자리 둘레만 잘라** 고치는 경로.
 *
 *  왜 필요한가: 인페인트는 그림 전체를 보내고 NAI 가 요청 크기로 **줄여서** 그린다.
 *  2048×2048 짜리를 고치면 결과가 896×896 축소본이 되고, 고치지 않은 자리까지 바뀐다
 *  (실측 2026-08-13 · `docs/naia-bgcomp-survey.md` 4절).
 *
 *  무엇을 하나: 사각형 안만 잘라 **1MP 로 키워** 보내고, 돌아온 조각을 원래 크기로 되돌려
 *  그 자리에 되붙인다. 원본 해상도가 그대로 남고, 조각이 작을수록 더 촘촘하게 그려진다.
 *
 *  ★값은 공홈과 같은 것을 쓴다 (번들 실측): 사각형 상한 589,824px · 안쪽 여백 96px ·
 *    요청 크기는 1,048,576px 에 맞춤. 상한이 1MP 가 아니라 589,824 인 이유는 **확대율**이다.
 *    그보다 큰 조각은 1MP 에 맞추면 오히려 줄어들어, Focused 가 하는 일이 없어진다.
 */
import { alignTo64 } from "./align.ts";
import { FREE_PIXELS } from "./baseSize.ts";

export type Rect = { x: number; y: number; w: number; h: number };
export type Size = { width: number; height: number };

/** 사각형 넓이 상한. 768×768. 여기까지가 확대(≥4/3)가 남는 구간이다 */
export const RECT_MAX_PX = 589_824;
/** 사각형 테두리 안쪽 여백. 이 띠는 **문맥으로만** 쓰이고 칠할 수 없다 */
export const SAFE_MARGIN = 96;
/** 가장 작은 사각형. 여백 둘에 칠할 칸 하나 */
export const MIN_RECT = SAFE_MARGIN * 2 + 64;

/** 이 그림에 Focused 가 뜻이 있나. 1MP 이하면 통째로 보내도 안 줄어든다 */
export const canFocus = (iw: number, ih: number) => iw * ih > FREE_PIXELS;

/** 비율 오차를 이만큼까지 봐준다. 넘으면 그림이 눌린 것이 눈에 보인다 */
const AR_TOLERANCE = 0.06;

/** 비율을 지킨 채 **1MP 를 꽉 채우는** 64 배수 크기. 이것이 보내는 크기다.
 *
 *  ★**넓이가 먼저다.** 비율 오차를 먼저 보면 확대가 통째로 사라진다. 실측 2026-08-13:
 *    320×1408 사각형은 그 크기 그대로가 비율 오차 0 이라 1등이 되어 `×1.0` 이 나왔다
 *    (448×1984 는 오차 0.6% 지만 넓이가 두 배다). Focused 는 **키워 보내는 것**이 전부라
 *    그러면 기능이 없는 것과 같다.
 *  ★대신 오차에 천장을 둔다. 천장 안에서 가장 넓은 것, 같으면 오차가 작은 것. */
export function fitToPixels(w: number, h: number, limit = FREE_PIXELS): Size {
  if (w <= 0 || h <= 0) return { width: Math.max(64, w), height: Math.max(64, h) };
  const ar = w / h;
  let best: { err: number; px: number; size: Size } | null = null;
  let loose: { err: number; px: number; size: Size } | null = null;
  for (let cw = 64; cw <= 4096; cw += 64) {
    const ch = alignTo64(cw / ar);
    const px = cw * ch;
    if (px > limit) continue;
    const err = Math.abs(cw / ch - ar) / ar;
    const cand = { err, px, size: { width: cw, height: ch } };
    if (!loose || err < loose.err) loose = cand;
    if (err > AR_TOLERANCE) continue;
    if (!best || px > best.px || (px === best.px && err < best.err)) best = cand;
  }
  return (best ?? loose)?.size ?? { width: w, height: h };
}

/** 사각형을 **보낼 수 있는 모양**으로. 64 배수 · 상한 이하 · 그림 안.
 *  ★잡은 모서리를 기준으로 줄인다 (`anchor`). 없으면 중심을 지킨다. */
export function clampRect(r: Rect, iw: number, ih: number, anchor?: { x: number; y: number }): Rect {
  const maxW = Math.max(64, Math.floor(iw / 64) * 64);
  const maxH = Math.max(64, Math.floor(ih / 64) * 64);
  let w = Math.max(Math.min(MIN_RECT, maxW), Math.min(Math.round(r.w / 64) * 64, maxW));
  let h = Math.max(Math.min(MIN_RECT, maxH), Math.min(Math.round(r.h / 64) * 64, maxH));
  if (w * h > RECT_MAX_PX) {
    const f = Math.sqrt(RECT_MAX_PX / (w * h));
    w = Math.max(64, Math.floor((w * f) / 64) * 64);
    h = Math.max(64, Math.floor((h * f) / 64) * 64);
  }
  const ax = anchor ? anchor.x : r.x + r.w / 2 - w / 2;
  const ay = anchor ? anchor.y : r.y + r.h / 2 - h / 2;
  return {
    x: Math.max(0, Math.min(Math.round(ax), iw - w)),
    y: Math.max(0, Math.min(Math.round(ay), ih - h)),
    w,
    h,
  };
}

/** 켤 때 잡아 주는 사각형. 가운데, 상한만큼 */
export function defaultRect(iw: number, ih: number): Rect {
  const w = Math.min(768, Math.floor(iw / 64) * 64);
  const h = Math.min(768, Math.floor(ih / 64) * 64);
  return clampRect({ x: Math.round(iw / 2 - w / 2), y: Math.round(ih / 2 - h / 2), w, h }, iw, ih);
}

/** 칠할 수 있는 안쪽. 테두리 96px 은 문맥으로만 간다 */
export function innerRect(r: Rect): Rect {
  return { x: r.x + SAFE_MARGIN, y: r.y + SAFE_MARGIN, w: r.w - SAFE_MARGIN * 2, h: r.h - SAFE_MARGIN * 2 };
}

/** 이 사각형을 보내면 어떻게 되나. 요청 크기와 확대율 */
export function focusedPlan(rect: Rect): { req: Size; scale: number } {
  const req = fitToPixels(rect.w, rect.h);
  return { req, scale: req.width / Math.max(1, rect.w) };
}

/** 아무것도 안 칠했을 때 보내는 마스크. **사각형 안쪽 전체**가 흰색이다.
 *
 *  ★공홈도 안 칠하고 보낼 수 있다 (사용자 확인 2026-08-13). 사각형을 놓은 것 자체가
 *    "여기를 다시 그려라"라서, 빈 마스크를 그대로 보내는 대신 안쪽을 채워 보낸다.
 *  ★칠한 것처럼 **미리 보여 주지는 않는다**. 화면에는 칠한 자국만 뜬다. */
export function wholeRectMask(rect: Rect, iw: number, ih: number): string {
  const c = document.createElement("canvas");
  c.width = iw;
  c.height = ih;
  const x = c.getContext("2d")!;
  x.fillStyle = "black";
  x.fillRect(0, 0, iw, ih);
  const i = innerRect(rect);
  x.fillStyle = "white";
  x.fillRect(i.x, i.y, i.w, i.h);
  return c.toDataURL("image/png").split(",")[1];
}
