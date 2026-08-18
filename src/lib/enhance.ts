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

/** 배치에서 **이 원본이 쓸 수 있는 배율로 낮춘다.**
 *
 *  ★공홈에는 배치가 없어 대응 규칙이 없다. v2 가 정한 것을 그대로 옮긴다
 *    (`index.html:24617-24630`): 못 쓰는 배율이면 **건너뛰지 않고** 쓸 수 있는 가장 큰 것으로
 *    내린다. 여러 장을 한 배율로 돌리는 것이 배치라, 크기가 섞여 있으면 반드시 걸린다.
 *  ★배율 목록은 내림차순이므로 `find` 가 곧 "이하 중 가장 큰 것"이다. */
export function clampEnhanceScale(w: number, h: number, scale: number): number {
  const usable = enhanceScaleOptions(w, h);
  if (usable.includes(scale)) return scale;
  return usable.find((s) => s <= scale) ?? 1;
}

/** 강화 이력만 보는 최소 레코드 (`lib/takes.ts` 의 `Rec` 이 이 모양을 만족한다) */
export type EnhanceRec = { file: string; enhance_of?: string | null };

/** 배치 강화의 **대상 고르기** — 고른 것 중 **아직 강화 안 한 것만** 돌린다.
 *
 *  ★뿌리가 하나다: 강화본을 또 강화해도 `enhance_of` 는 뿌리를 가리킨다. 그래서
 *    "이미 강화했나"는 **그 뿌리에 강화 결과가 있나**로 판정한다 (스택이 평평하다).
 *  ★v2 는 버전 스택에서 "지금 원본을 보고 있는 카드"만 대상으로 삼았다
 *    (`index.html:24596`). 3.0 은 스택이 없으므로 같은 뜻을 뿌리로 옮긴 것이다. */
export function enhanceTargets(
  recs: EnhanceRec[],
  files: string[],
): { targets: string[]; skipped: string[] } {
  const rootOf = new Map(recs.map((r) => [r.file, r.enhance_of || r.file]));
  const done = new Set<string>();
  for (const r of recs) if (r.enhance_of) done.add(r.enhance_of);
  const targets: string[] = [];
  const skipped: string[] = [];
  for (const f of files) {
    if (done.has(rootOf.get(f) ?? f)) skipped.push(f);
    else targets.push(f);
  }
  return { targets, skipped };
}
