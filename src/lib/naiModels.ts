/** 모델 목록과 **능력표** — 화면이 「이 모델에서 되는 것만」 보이게 하는 근거.
 *
 *  정본은 `docs/nai-web-reference.md` 의 「NAI Diffusion V5」 절이고, 공홈 번들의
 *  `PE(model)` 에서 우리가 실제로 쓰는 항목만 추린 것이다 (2026-08-21 전수 대조).
 *
 *  ★★**모델 분기를 이 파일 밖에서 새로 만들지 말 것.** V5 가 오면서 「바이브 되나 ·
 *    스케줄러 고를 수 있나 · Variety+ 되나」가 전부 갈라졌다. 화면 여기저기에
 *    `model.includes("4-5")` 같은 검사를 흩어 두면 하나를 빠뜨렸을 때 **컨트롤은 보이는데
 *    보내지지는 않는** 상태가 된다 — 사용자는 켰다고 믿고 결과만 다르게 나온다.
 *
 *  ★★서버 쪽 사본은 `backend/nai.py` 의 `MODEL_CAPS` 다. 언어가 달라 한 벌로 못 두는 대신
 *    **`backend/test_caps_parity.py` 가 두 파일을 대조**한다 — 한쪽만 고치면 판정이 깨진다.
 */

export type ModelCaps = {
  /** Vibe Transfer */
  vibe: boolean;
  /** Precise Reference (`director_reference_*`) */
  char_ref: boolean;
  /** 스케줄러를 고를 수 있나 — 거짓이면 서버가 karras 로 덮어쓴다 */
  noise_schedule: boolean;
  cfg_rescale: boolean;
  /** Variety+ (`skip_cfg_above_sigma`) */
  cfg_delay: boolean;
  /** 투명 배경 */
  transparency: boolean;
  /** Enhance 가 프롬프트에 `-2::upscaled, blurry::` 를 끼우나 */
  enhance_prompt_add: boolean;
  /** 따옴표 → `teXt:` 자동 조립이 걸리나 (공홈 `PE().text`).
   *  ★★**V5 전용이 아니다** — V4.0·V4.5·V5 모두 참이고 V3 이하만 거짓이다.
   *  ★조립은 서버가 한다 (`backend/naitext.py`) — 화면은 안내 문구에만 쓴다. */
  text: boolean;
  /** 캐릭터 좌표를 격자 밖에 둘 수 있나 */
  freeform_position: boolean;
  max_characters: number;
  cfg_delay_sigma: number;
  /** Opus 무료 생성이 유한한가 (잔량이 바닥나면 과금된다) */
  opus_usage_limit: boolean;
  /** Anlas 배율 — ★V5 는 같은 해상도·스텝에서 V4.5 의 1.5배다 */
  anlas_multiplier: number;
  /** 고를 수 있는 퀄리티 프리셋 id — **순서가 곧 드롭다운 순서**이고 마지막은 언제나 none.
   *  ★본문(접미사)은 서버 표에만 있다 (`backend/nai.py` `QUALITY_PRESETS`) —
   *    화면은 고를 목록만 알면 되고, 프롬프트를 만드는 것은 서버 한 곳이다. */
  quality_presets: string[];
};

const V45: ModelCaps = {
  vibe: true,
  char_ref: true,
  noise_schedule: true,
  cfg_rescale: true,
  cfg_delay: true,
  transparency: false,
  enhance_prompt_add: true,
  text: true,
  freeform_position: false,
  max_characters: 6,
  cfg_delay_sigma: 58,
  opus_usage_limit: false,
  anlas_multiplier: 1,
  quality_presets: ["standard", "none"],
};

/** ★★V5 에서 **꺼진 것들**. 공홈 FAQ: 바이브·정밀 참조는 "post-launch additions" 다. */
const V5: ModelCaps = {
  ...V45,
  vibe: false,
  char_ref: false,
  noise_schedule: false,
  cfg_delay: false,
  transparency: true,
  freeform_position: true,
  max_characters: 32,
  opus_usage_limit: true,
  anlas_multiplier: 1.5,
  // ★V5·custom 만 `light` 가 있다 ("very aesthetic, amazing quality, no text")
  quality_presets: ["standard", "light", "none"],
};

/** 인페인트 모델 → 원본 (표 조회용). ★`INPAINT_MODEL` 을 뒤집어 쓰면 안 된다 — 일대일이 아니다 */
const BASE_MODEL: Record<string, string> = {
  "nai-diffusion-5-full-inpainting": "nai-diffusion-5-full",
  "nai-diffusion-5-curated-inpainting": "nai-diffusion-5-curated",
  "nai-diffusion-4-5-full-inpainting": "nai-diffusion-4-5-full",
  "nai-diffusion-4-5-curated-inpainting": "nai-diffusion-4-5-curated",
  "nai-diffusion-4-full-inpainting": "nai-diffusion-4-full",
  "nai-diffusion-4-curated-inpainting": "nai-diffusion-4-curated-preview",
};

export const MODEL_CAPS: Record<string, ModelCaps> = {
  "nai-diffusion-5-full": V5,
  "nai-diffusion-5-curated": V5,
  "nai-diffusion-4-5-full": V45,
  "nai-diffusion-4-5-curated": V45,
};

/** ★모르는 모델(= 목록에서 뺀 V4.0 계열)의 능력. 공홈의 V4.0 행 그대로다 */
export const CAPS_FALLBACK: ModelCaps = {
  ...V45,
  char_ref: false,
  enhance_prompt_add: false,
  cfg_delay_sigma: 19,
};

export const baseModel = (model: string): string => BASE_MODEL[model] ?? model;

/** 그 모델의 능력. 인페인트 모델도 원본으로 되돌려 조회한다. */
export const caps = (model: string): ModelCaps => MODEL_CAPS[baseModel(model)] ?? CAPS_FALLBACK;

/** ★**V4.5 계열과 V5 계열을 제공한다.**
 *
 *  ★V4.0 은 뺐다 (사용자 결정 2026-08-12). 옛 워크스페이스가 V4.0 id 를 들고 있으면
 *    목록에 없어 빈칸으로 보이므로 화면이 기본값으로 되돌린다 — 조용히 다른 표로
 *    생성되는 것보다 낫다.
 *  ★목록 순서가 곧 드롭다운 순서다. 공홈은 V5 를 「New」로 맨 위에 둔다. */
export const MODELS: [string, string][] = [
  ["nai-diffusion-5-full", "V5 Full"],
  ["nai-diffusion-5-curated", "V5 Curated"],
  ["nai-diffusion-4-5-full", "V4.5 Full"],
  ["nai-diffusion-4-5-curated", "V4.5 Curated"],
];
