/** Enhance 의 배율·목표 해상도 — 정본은 `docs/nai-web-reference.md` 6절 (공홈 번들 추출).
 *
 *  ★**원본을 미리 확대하지 않는다.** 저장된 원본을 그대로 보내고 width/height 만 키운다 —
 *    미리 확대하면 리샘플 커널이 달라 시작 latent 가 어긋난다. (예전 구현이 그랬다)
 *  ★배율은 1.5배 고정이 아니다. 원본 크기에 따라 쓸 수 있는 것만 뜬다. */
import { alignTo64 } from "./align.ts";

/** 총 픽셀 상한 (공홈 `ep`) */
export const ENHANCE_MAX_PIXELS = 3145728;
const STRIDE = 64;

/** 이 원본에 쓸 수 있는 배율 — **내림차순**이다 (첫 값이 기본 선택).
 *
 *  ★832×1216 · 1216×832 는 예외로 1.5 를 허용한다. 1.5배가 64 로 안 떨어지지만
 *    (1248·1824) 전송 직전 64 정렬이 받아 주기 때문이다. */
export function enhanceScaleOptions(w: number, h: number): number[] {
  if ((w === 832 && h === 1216) || (w === 1216 && h === 832)) return [1.5, 1];
  return [2, 1.5, 1].filter(
    (s) => w * s * h * s <= ENHANCE_MAX_PIXELS && (w * s) % STRIDE === 0 && (h * s) % STRIDE === 0,
  );
}

/** 목표 해상도 = `align64(floor(원본 × 배율))`.
 *
 *  ★해상도 프리셋 목록으로 스냅하지 않는다. 정렬은 **가까운 쪽 반올림**이라
 *    1216×832 ×1.5 는 1824×1248 이 아니라 **1856×1280** 으로 나간다 (공홈 출력 PNG 로 확인).
 *  ★화면이 이 값을 보여 주지 않으면 표시 해상도·Anlas 가 실제 청구와 어긋난다. */
export function enhanceTargetSize(w: number, h: number, scale: number): [number, number] {
  return [alignTo64(Math.floor(w * scale)), alignTo64(Math.floor(h * scale))];
}
