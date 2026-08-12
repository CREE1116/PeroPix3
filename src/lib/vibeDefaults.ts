/** Vibe 를 새로 얹을 때의 기본값 — 정본은 `docs/nai-web-reference.md` 8절 (공홈 `rp()`).
 *
 *  ★**모델마다 다르다.** 번들 원본:
 *      case V4.5 Full / V4.5 Full Inpainting -> { strength: .6, information_extracted: .7 }
 *      default                               -> { strength: .6, information_extracted: 1 }
 *  ★1.0 으로 박아 두면 우리 기본 모델(V4.5 Full)에서 공홈과 **다른 인코딩**이 구워진다.
 *    인코딩은 개당 2 Anlas 라, 나중에 값을 고치면 다시 굽는 돈이 든다. */
const IE_07 = new Set(["nai-diffusion-4-5-full", "nai-diffusion-4-5-full-inpainting"]);

export function vibeDefaults(model: string): { strength: number; infoExtracted: number } {
  return { strength: 0.6, infoExtracted: IE_07.has(model) ? 0.7 : 1 };
}
