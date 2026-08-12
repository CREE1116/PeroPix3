/** 베이스 그림을 넣을 때 **해상도를 맞춘다** — 공홈 이식 (`chunks/3811` 의 등록 훅).
 *
 *  ★공홈은 그림을 넣으면 해상도 값을 **자동으로 채워 준다.** 잠그지 않는다 —
 *    채워 놓기만 하고 사용자가 그 뒤에 바꿀 수 있다. (v2 는 원본 크기를 넣고 칸을
 *    잠갔는데, 그건 v2 의 선택이고 공홈과 다르다.)
 *  ★3.0 에는 이 단계가 통째로 없었다. 그래서 2048×2048 그림을 832×1216 설정에 넣으면
 *    전송 직전 리샘플이 **비율을 무시하고 늘려** 그림이 눌렸다 (실측 2026-08-13).
 *
 *  번들 원문의 판정을 그대로 옮긴다:
 *
 *      가로가 길면 세로 기준으로 눕혀 계산하고, 끝에 되돌린다
 *      지금 설정과 비율이 같고 그림이 설정보다 작으면  →  손대지 않는다
 *      64 배수이고 픽셀이 상한 이하                    →  그 크기 그대로
 *      아니면 1216 / 896 상자에 비율을 맞춰 넣는다     →  둘 다 안 되면 512×512
 */
import { alignTo64 } from "./align.ts";

/** 그림을 그대로 쓸 수 있는 픽셀 상한 (공홈 `xM`). 이보다 크면 상자에 맞춰 줄인다 */
export const MAX_INGEST_PX = 3_145_728;
/** 상자 — 세로 기준 1216, 가로 기준 896 (SD 계열이면 768/512 지만 우리는 V4.5 뿐이다) */
const BOX_LONG = 1216;
const BOX_SHORT = 896;

export type Size = { width: number; height: number };

/** 이 그림을 넣었을 때 해상도를 무엇으로 바꿀까. **null 이면 손대지 않는다.** */
export function sizeForBase(iw: number, ih: number, cur: Size): Size | null {
  if (!iw || !ih) return null;
  let e = iw;
  let a = ih;
  const o = iw / ih;
  // 가로가 길면 눕혀서 계산한다 (상자는 세로 기준으로 쓰여 있다)
  if (o > 1) {
    const t = e;
    e = a;
    a = t;
  }
  const n = e / a;

  // ★비율이 이미 같고 그림이 지금 설정 안에 들어가면 **그대로 둔다** (공홈 조건 그대로)
  if (cur.width / cur.height === o && e <= cur.width && a <= cur.height) return null;

  if (e % 64 === 0 && a % 64 === 0 && e * a <= MAX_INGEST_PX) {
    // 그 크기 그대로 쓴다
  } else {
    const s = alignTo64(BOX_LONG * n);
    const o2 = alignTo64(BOX_SHORT / n);
    if (Math.abs(s / BOX_LONG - n) < Math.abs(BOX_SHORT / o2 - n) && s * BOX_LONG <= MAX_INGEST_PX) {
      e = s;
      a = BOX_LONG;
    } else if (BOX_SHORT * o2 <= MAX_INGEST_PX) {
      e = BOX_SHORT;
      a = o2;
    } else {
      e = 512;
      a = 512;
    }
  }

  if (o > 1) {
    const t = e;
    e = a;
    a = t;
  }
  return { width: e, height: a };
}
