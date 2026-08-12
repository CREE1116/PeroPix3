/** 씬 세트 카드 층으로의 이전 — **사용자 데이터를 건드리는 자리**라 따로 떼어 시험한다.
 *
 *  옛 세트 탭은 씬(`cells`)과 공통 접두(`prefix`)를 **직접** 들었다. 카드 층이 생기면서
 *  그것을 **카드 한 장**으로 감싼다 (사용자 결정 2026-08-11). 감싸기만 하므로 아무것도 잃지
 *  않고, 열면 지금까지와 똑같이 보인다.
 *
 *  ★**씬 번호(`cellSeq`)는 탭에 그대로 둔다.** 카드로 내리면 두 카드의 `c1` 이 같은 결과를
 *    물어 한 카드의 그림이 다른 카드에 나타난다 (결과는 `cell_id` 로만 묶인다 — `takesOf`).
 *  ★**이미 옮긴 탭은 손대지 않는다** — 두 번 감싸면 카드 안에 카드가 생긴다.
 */

/** 옛 **싱글 탭**을 씬 탭으로 — 싱글/멀티 구분이 없어졌다 (사용자 결정 2026-08-11).
 *
 *  ★싱글 탭의 결과 레코드는 `cell`·`cell_id` 가 **없다**(셀이 없는 탭이었으므로).
 *    그냥 씬 하나로 감싸면 `takesOf` 가 그 레코드를 못 찾아 **그림이 통째로 사라져 보인다.**
 *    그래서 옮겨 온 씬에 `fromSingle` 을 박고, `takesOf` 가 그 씬에만 **셀 없는 레코드**를
 *    붙여 준다. 파일은 그대로 두고 화면이 찾아가는 길만 잇는 것이다.
 *  ★새로 만드는 씬에는 이 표식이 없다 — 옛 그림이 새 씬에 달라붙으면 안 된다. */
export function convertSingleTab(tab: OldSetTab): Record<string, unknown> | null {
  if (tab.kind !== "single") return null;
  const { kind: _kind, prompt, ...rest } = tab;
  return {
    ...rest,
    kind: "set",
    prompt,
    cards: [
      {
        id: "k1",
        name: tab.name,
        cells: [{ id: "c1", name: tab.name, blocks: [], fromSingle: true }],
      },
    ],
    cardSeq: 1,
    cellSeq: 2,
  };
}

/** 이전 대상이 되는 옛 탭의 모습 (필요한 필드만) */
type OldSetTab = {
  kind: string;
  name: string;
  cards?: unknown;
  cells?: unknown[];
  prefix?: string;
  [k: string]: unknown;
};

/** 감쌀 것이 있으면 새 탭을, 없으면 `null` (호출부가 `changed` 를 안 세워도 되게) */
export function wrapSetTabInCard(tab: OldSetTab): Record<string, unknown> | null {
  if (tab.kind !== "set") return null;
  if (Array.isArray(tab.cards)) return null; // 이미 옮겼다
  const { cells, prefix, ...rest } = tab;
  return {
    ...rest,
    cards: [
      {
        id: "k1",
        // 카드 이름은 탭 이름을 물려받는다 — 옛 탭은 곧 씬 세트 하나였다
        name: tab.name,
        ...(prefix ? { prefix } : {}),
        cells: Array.isArray(cells) ? cells : [],
      },
    ],
    cardSeq: 1,
  };
}
