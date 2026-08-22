import type { GenParams } from "../store/gen";

/** 스타일 카드가 함께 담는 **생성 옵션** — ★담는 기준은 하나다: **프롬프트가 되는가.**
 *
 *  아래 넷은 생성 옵션 칸에 있지만 서버에서 **실제 프롬프트 문자열이 된다** (`backend/nai.py`):
 *
 *      quality_preset   프롬프트 **뒤**에 붙는 태그 (`QUALITY_PRESETS`)
 *      uc_preset        네거티브 **앞**에 붙는 본문 (`UC_PRESETS`)
 *      transparent_bg   퀄리티 접미사 **앞**에 `transparent background`
 *      furry_mode       프롬프트 **맨 앞**에 `fur dataset, `
 *
 *  ★★그래서 이것들이 카드 밖에 남아 있으면 **같은 스타일 카드가 다른 그림을 낸다** —
 *    퀄리티 프리셋을 `none` 으로 두고 만든 스타일을 `standard` 상태에서 꺼내면
 *    없던 퀄리티 태그가 얹힌다 (사용자 지적 2026-08-22).
 *  ★★`steps`·`cfg`·`sampler`·`scheduler`·`cfg_rescale`·`variety_plus` 는 **안 담는다.**
 *    프롬프트에 한 글자도 안 보태고 샘플러에만 들어간다. 담으면 카드 드롭이
 *    「프롬프트를 이 스타일로 바꾼다」에서 「화면 여기저기가 바뀐다」로 성질이 달라진다.
 *  ★★`model` 도 안 담는다. 모델이 바뀌면 Anlas 단가와 쓸 수 있는 기능(Vibe·Precise
 *    Reference)까지 함께 바뀐다 — 스타일보다 위의 선택이다.
 *  ★공홈도 이 넷을 **프롬프트 영역**에 둔다 (`docs/nai-web-reference.md` 2절 —
 *    퀄리티·UC 프리셋·투명 배경, 그리고 anime/furry 스위치).
 *
 *  ★★이 파일은 **스토어를 안 부른다** — 규칙만 둔다. 그래야 회귀 테스트가 값으로 확인한다
 *    (스토어를 부르면 `localStorage` 때문에 node 에서 못 읽는다). 스토어에 읽고 쓰는 것은
 *    쓰는 자리(`panels/PromptSections`)가 한다.
 */
export type StyleOpts = Partial<Pick<GenParams, "quality_preset" | "uc_preset" | "transparent_bg" | "furry_mode">>;

/** ★목록은 **여기 하나**다. 담는 쪽과 거는 쪽이 다른 표를 보면 한쪽만 늘어난다. */
export const STYLE_OPT_KEYS = ["quality_preset", "uc_preset", "transparent_bg", "furry_mode"] as const;

/** 지금 값에서 **카드에 담을 것만** 골라낸다 (덱에 저장할 때) */
export function pickStyleOpts(params: GenParams): StyleOpts {
  const o: StyleOpts = {};
  for (const k of STYLE_OPT_KEYS) (o as Record<string, unknown>)[k] = params[k];
  return o;
}

/** 카드에 담겨 온 것 중 **실제로 바뀌는 것만** 골라낸다 (스타일 카드를 놓았을 때).
 *
 *  ★★**있는 것만 덮는다.** 옛 카드에는 이 값이 아예 없다 — 없는 것을 기본값으로 메우면
 *    사용자가 잡아 둔 프리셋이 카드 하나 놓을 때마다 말없이 되돌아간다
 *    (`lib/metaApply` 가 지키는 것과 같은 규칙).
 *  ★같은 값이면 안 담는다 — 부르는 쪽이 「바뀐 것이 있나」로 알림 여부를 정한다. */
export function styleOptsPatch(cur: StyleOpts, o: StyleOpts | undefined): StyleOpts {
  const patch: StyleOpts = {};
  if (!o) return patch;
  for (const k of STYLE_OPT_KEYS) {
    const v = o[k];
    if (v === undefined || v === cur[k]) continue;
    (patch as Record<string, unknown>)[k] = v;
  }
  return patch;
}
