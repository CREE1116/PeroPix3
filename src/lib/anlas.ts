/** Anlas 소모량 — 정본은 `docs/nai-web-reference.md` 9절 (공홈 번들 추출).
 *
 *  ★서버를 부르지 않는다. 순수 계산이라 값이 바뀔 때마다 왕복할 이유가 없다.
 *  ★예전 구현은 `ceil(픽셀/1MP × 20)` 이라는 **근사식**이었다 — 공홈 식이 아니라 실제
 *    청구와 어긋났다. 특히 steps 를 나중에 곱해서 28 을 넘는 순간부터 크게 틀렸다.
 *  ★비용은 **정렬된 해상도**로 세야 한다 (`alignTo64`) — 부르는 쪽에서 정렬해 넘긴다. */
import { alignTo64 } from "./align.ts";

/** 공홈 `getPrice` 상수 */
const C_BASE = 2.951823174884865e-6;
const C_STEP = 5.753298233447344e-7;
/** Opus 무료 판정 상한 (`eg`) */
const FREE_PIXELS = 1048576;
const FREE_STEPS = 28;
/** 한 장이 이 값을 넘으면 공홈은 생성 버튼을 막는다 (`g.dZ`) */
export const MAX_PER_IMAGE = 140;
/** 캐릭터 참조는 **장당** 개당 5 (Opus 무관) */
const REF_PER_IMAGE = 5;
/** vibe 인코딩은 개당 2 **고정** — 해상도와 무관하고 요청당 한 번이다 */
const VIBE_ENCODE = 2;
/** 활성 vibe 가 5개를 넘으면 초과분 개당 +2 (요청당 한 번) */
const VIBE_FREE_SLOTS = 5;

export type CostInput = {
  width: number;
  height: number;
  steps: number;
  /** 티어 3 이상 */
  opus: boolean;
  /** ★**아직 안 구운** 바이브 수. 구워 둔 것은 다시 돈이 들지 않는다 */
  uncachedVibes: number;
  /** 지금 켜져 있는 바이브 수 — 5개 초과분에 요금이 붙는다 */
  activeVibes?: number;
  refCount: number;
  /** i2i 강도. 인페인트면 `inpaintImg2ImgStrength`, 베이스 그림이 없으면 1 */
  strength: number;
  /** 이번에 만들 장 수 */
  count: number;
};

export type Cost = {
  perImage: number;
  total: number;
  free: boolean;
  encoding: number;
  /** ★한 장이 상한을 넘어 공홈이라면 생성이 막히는 상태 */
  overLimit: boolean;
};

/** 업스케일(×4) 값 — 픽셀 수 **구간**으로 정해진다 (공홈 `e0`/`e1`).
 *
 *  ★생성 요금과 **다른 산식**이다 — steps 도 강도도 안 본다.
 *  ★**-1 이면 못 한다.** 공홈은 1024×1024(=1,048,576px)를 넘으면 버튼을 막는다
 *    (공홈은 `-3` 을 쓰지만 우리는 "알 수 없음/불가"를 음수 하나로 통일한다).
 *  ★Opus 무료 구간이 생성(1MP)보다 **좁다** (409,600px = 640×640). */
const UPSCALE_TABLE: [number, number][] = [
  [1048576, 7],
  [786432, 5],
  [524288, 3],
  [409600, 2],
  [262144, 1],
];
export const UPSCALE_MAX_PX = 1048576;
const UPSCALE_FREE_PX = 409600;

export function upscaleCost(width: number, height: number, opus: boolean): number {
  const px = width * height;
  if (px <= UPSCALE_FREE_PX && opus) return 0;
  let cost = -1;
  // ★큰 구간부터 훑으며 덮어써서 **가장 작은** 해당 구간이 남는다 (공홈 루프 그대로)
  for (const [limit, c] of UPSCALE_TABLE) if (px <= limit) cost = c;
  return cost;
}

export function anlasCost(i: CostInput): Cost {
  // ★실제로 나가는 해상도로 센다 — 화면 값이 64 배수가 아니면 청구가 어긋난다
  const px = alignTo64(i.width) * alignTo64(i.height);

  // ★무료 판정에 **vibe·캐릭터 참조는 들어가지 않는다.** 공홈 `eZ()` 에 `!characterRef` 가
  //   있지만 가격 계산부가 그 키를 안 넘겨 늘 undefined 다 — 전송 경로만 채운다.
  //   실측(2026-08-11): Opus·832x1216·28step·참조 1개 = 5. 무료가 살아 있고 참조비만 나간다.
  const free = i.opus && px <= FREE_PIXELS && i.steps <= FREE_STEPS;

  const perSample = Math.ceil(C_BASE * px + C_STEP * px * i.steps);
  // 강도 계수 — 베이스 그림이 있을 때만 걸린다. 바닥은 2 다
  const y = i.strength < 1 ? i.strength : 1;
  const base = free ? 0 : Math.max(Math.ceil(perSample * y), 2);

  // 캐릭터 참조는 **장당** 붙는다 (무료 판정과 무관)
  const perImage = base + REF_PER_IMAGE * Math.max(0, i.refCount);

  // vibe 인코딩·초과 슬롯은 **요청당 한 번**이지 장당이 아니다
  const over = Math.max(0, (i.activeVibes ?? 0) - VIBE_FREE_SLOTS);
  const encoding = Math.max(0, i.uncachedVibes) * VIBE_ENCODE + over * VIBE_ENCODE;

  return {
    perImage,
    total: perImage * i.count + encoding,
    free: perImage === 0 && encoding === 0,
    encoding,
    // ★상한 판정은 **기본 생성비**로 한다 — 번들의 `I > g.dZ ? -3 : I*v` 에서 `I` 가
    //   `max(ceil(per_sample*y), 2)` 이고, 캐릭터 참조비는 거기 안 들어간다.
    overLimit: base > MAX_PER_IMAGE,
  };
}
