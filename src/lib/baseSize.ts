/** 베이스 그림을 넣을 때 **해상도를 맞춘다**.
 *
 *  ★공홈 규칙을 그대로 베끼지 않는다 (사용자 결정 2026-08-13). 공홈은 「1216 / 896 상자」에
 *    떨어뜨리는데, 그 규칙이 **비율을 뭉갠다.** 실측으로 확인했다:
 *
 *      800×3200 (1:4) 을 넣으면  →  공홈은 **512×512**  (원이 타원이 된다)
 *                                   우리는  512×2048 (1:4 그대로, 1MP 딱)
 *
 *    431개 크기로 훑어 본 결과 — 공홈 규칙은 55%(238건)에서 값이 붙고 99건에서 비율이 3%
 *    넘게 어긋난다(최대 3,952%). 우리 규칙은 값 0건, 비율 오차 최대 6%(아주 작은 그림뿐).
 *  ★못 그려서가 아니다. NAI 는 1:40(64×2560)도 그려 준다 — API 로 직접 확인했다.
 *
 *  규칙: **비율을 지키며 1MP(공짜 구간) 안에서 가장 알맞은 64 배수 크기.**
 *   - 이미 64 배수이고 1MP 이하면 손대지 않는다.
 *   - 후보(64 배수)를 훑어 **비율 오차가 가장 작은 것**을 고르고, 같으면 원본 면적에 가까운 것.
 *   - 키우는 것은 512 까지만 — 64 격자가 성겨서 작은 그림은 조금 키워야 비율이 산다
 *     (151×122 를 원본 이하로만 맞추면 64×64 로 뭉개진다).
 */
import { alignTo64 } from "./align.ts";

/** Opus 무료 구간 — 여기 안에 있으면 값이 안 나간다 */
export const FREE_PIXELS = 1_048_576;
/** 작은 그림을 키워도 되는 한도 (NAI 의 가장 작은 표준 크기) */
const GROW_TO = 512;

export type Size = { width: number; height: number };

/** 이 그림을 넣었을 때 쓸 해상도. **언제나 값을 돌려준다** (못 정하면 null).
 *
 *  ★"지금 설정과 같은가"는 **부르는 쪽이 본다.** 예전에는 같으면 null 을 돌려줬는데,
 *    그러면 null 이 「안 바꿔도 된다」와 「손댈 수 없다」 두 뜻을 겸해서, 부르는 쪽이
 *    원본 크기를 그대로 쓰는 사고가 났다 (회귀가 잡았다). */
export function sizeForBase(iw: number, ih: number): Size | null {
  if (!iw || !ih) return null;
  // 이미 64 배수 + 공짜 구간이면 그대로 쓴다 (가장 좋은 값이 이미 손에 있다)
  if (iw % 64 === 0 && ih % 64 === 0 && iw * ih <= FREE_PIXELS) {
    return { width: iw, height: ih };
  }

  const ar = iw / ih;
  const target = Math.min(iw * ih, FREE_PIXELS);
  const maxW = Math.max(iw, GROW_TO);
  const maxH = Math.max(ih, GROW_TO);
  let best: { err: number; gap: number; size: Size } | null = null;

  for (let w = 64; w <= 4096; w += 64) {
    const h = alignTo64(w / ar);
    const px = w * h;
    if (px > FREE_PIXELS || w > maxW || h > maxH) continue;
    // ★비율이 먼저다 — 면적을 키우려다 그림이 눌리면 아무 소용이 없다
    const err = Math.round((Math.abs(w / h - ar) / ar) * 1000) / 1000;
    const gap = Math.abs(px - target);
    if (!best || err < best.err || (err === best.err && gap < best.gap)) {
      best = { err, gap, size: { width: w, height: h } };
    }
  }
  return best ? best.size : null;
}
