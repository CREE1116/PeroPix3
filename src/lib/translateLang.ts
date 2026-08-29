/** 번역 창의 **말 고르기** — 순수 규칙이라 따로 뒀다 (판정이 곧바로 부른다).
 *  창·스토어는 `store/translate` 에 있다. */
export type Lang = "ko" | "en" | "ja";
export const LANGS: Lang[] = ["en", "ko", "ja"];

/** 글이 무슨 말인가 — 한글이 있으면 ko, 가나·한자가 있으면 ja, 아니면 en 으로 친다.
 *  ★한글이 우선이다: 한국어 글에 한자가 섞일 수 있다. */
export function detectLang(s: string): Lang {
  if (/[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(s)) return "ko";
  if (/[぀-ヿ一-鿿]/.test(s)) return "ja";
  return "en";
}

/** 실제로 갈 목적지 — 고른 말과 **같은 말을 쳤으면** 뒤집는다 (영어면 한국어로, 아니면 영어로).
 *  영어 창을 열어 두고 한국어를 치는 것이 이 창의 주된 쓰임이라, 고른 말이 곧 원문일 때
 *  「그대로」를 돌려주는 것보다 이쪽이 맞다. */
export function resolveTarget(text: string, target: Lang): Lang {
  const src = detectLang(text);
  if (src !== target) return target;
  return target === "en" ? "ko" : "en";
}
