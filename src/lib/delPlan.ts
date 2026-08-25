/** **무엇이 사라지는가** — 지우기 전에 세어 주는 순수 계산 (2026-08-24).
 *
 *  ★★삭제는 **다섯 단계**다 (`docs/agent-actions-design.md` 3-1):
 *
 *      ① 그림 모으기 → ② 묻기 → ③ 그림을 **먼저** 휴지통으로 → ④ 대상 제거
 *      → ⑤ 되돌리기 로그 비우기(`clearUndo`)
 *
 *    예전에는 ①③⑤ 가 **화면 코드에만** 있어서, 스토어 함수(`closeSet`·`removeTab`)를
 *    직접 부르면 그 단계가 통째로 빠졌다. 조수가 그렇게 부르면 *"파일은 남았는데 앱에서
 *    볼 길이 없는 그림"* 이 쌓이고, `Ctrl+Z` 가 **엉뚱한 것**을 되살린다.
 *
 *  ★**묻는 것(②)은 여기 없다.** 창구마다 다르기 때문이다 — 화면은 확인 창(`store/ask`),
 *    조수는 승인 카드(`docs/…` 2-5). 스토어 안에서 `ask()` 를 부르면 조수 경로에서 **둘 다**
 *    뜬다. 그래서 「무엇이 사라지나」(이 파일)와 「실행」(`store/workspace` 의 `removeAt`)만
 *    한 벌로 두고, 묻기는 부르는 쪽이 한다.
 *
 *  ★앱 의존이 없는 순수 함수라 회귀를 붙였다 (`delPlan.test.ts`) — `takes.ts` 와 같은 취급이다.
 */

import { takesOf, type Rec } from "./takes.ts";

/** 지울 대상 — 네 갈래뿐이다 (덱 카드·갤러리 폴더는 다른 저장소라 여기 없다) */
export type DelTarget =
  | { kind: "set"; id: string }
  | { kind: "tab"; id: string }
  | { kind: "scene"; setId: string; cellId: string }
  | { kind: "sceneCard"; setId: string; cardId: string };

/** 못 하는 이유 — 있으면 **실행하지 않는다** */
export type DelBlock = "not_found" | "last_set" | "last_tab";

export type DelPlan = {
  kind: DelTarget["kind"];
  /** 사람이 읽는 이름 — 확인 창·승인 카드의 문구에 그대로 쓴다 */
  name: string;
  /** 함께 휴지통으로 갈 그림 (이미 지운 것은 뺀다) */
  files: string[];
  /** 딸려 사라지는 것의 수 — 탭이면 세트 수, 세트·씬카드면 씬 수 */
  inner: number;
  /** ★★**되돌릴 수 없다** — 실행하면 `clearUndo()` 를 돈다.
   *
   *  자동 승인(2-5)이 이 값을 본다. 지금은 **넷 다 참**이다: 안에 든 씬·프롬프트는
   *  되돌릴 방법이 없고, 그림만 휴지통에서 돌아와 봐야 갈 자리가 없다.
   *  ★그림 자체는 24시간 안에 휴지통에서 꺼낼 수 있다 (3-9) — 「되돌리기」와 다른 길이다. */
  hard: boolean;
  blocked?: DelBlock;
};

/* ── 최소 구조 타입 — 스토어를 끌어오지 않는다 (`takes.ts` 와 같은 방식) ── */
type Cell = { id: string; name: string };
type Card = { id: string; name: string; cells: Cell[] };
type Set_ = { id: string; kind: string; name: string; cards?: Card[]; tabId?: string; idOnly?: boolean };
type Spec_ = { tabs?: { id: string; name: string }[]; sets: Set_[] };

const isSet = (t: Set_ | undefined): t is Set_ & { cards: Card[] } =>
  !!t && t.kind === "set" && Array.isArray(t.cards);

/** 그 세트의 모든 씬 — 카드 순서대로 편다 (`store/workspace` 의 `allCells` 와 같은 규칙) */
const cellsOf = (t: Set_ & { cards: Card[] }): Cell[] => t.cards.flatMap((k) => k.cells);

/** 세트 하나가 들고 있는 그림 전부 */
function filesOfSet(records: Rec[], t: Set_, deleted: (f: string) => boolean): string[] {
  return takesOf(records, { id: t.id, name: t.name, idOnly: t.idOnly }, undefined)
    .filter((r) => !deleted(r.file))
    .map((r) => r.file);
}

/** 무엇이 사라지는지 센다. 대상이 없으면 `blocked: "not_found"` 로 돌려준다 —
 *  ★`null` 을 돌려주지 않는 이유: 부르는 쪽이 "없음"과 "못 함"을 갈라 다뤄야 하는데,
 *    `null` 이면 그 까닭이 사라져 조수에게 줄 오류(2-4)를 만들 수 없다. */
export function planDelete(
  spec: Spec_,
  records: Rec[],
  deleted: (f: string) => boolean,
  target: DelTarget,
): DelPlan {
  const none = (kind: DelTarget["kind"]): DelPlan => ({
    kind, name: "", files: [], inner: 0, hard: true, blocked: "not_found",
  });

  if (target.kind === "tab") {
    const tab = (spec.tabs ?? []).find((c) => c.id === target.id);
    if (!tab) return none("tab");
    const mine = spec.sets.filter((x) => x.kind === "set" && x.tabId === target.id);
    const files = mine.flatMap((t) => filesOfSet(records, t, deleted));
    return {
      kind: "tab", name: tab.name, files, inner: mine.length, hard: true,
      // ★마지막 탭은 지우지 않는다 — 세트가 설 자리가 없어진다 (`removeTab` 의 주석)
      blocked: (spec.tabs ?? []).length <= 1 ? "last_tab" : undefined,
    };
  }

  if (target.kind === "set") {
    const t = spec.sets.find((x) => x.id === target.id);
    if (!isSet(t)) return none("set");
    /* ★★**그 탭의 마지막 세트는 못 닫는다** (`closeSet` 의 ★★주). 안 막으면 탭 줄이
       비고 `neighbour` 가 undefined 라 앱이 죽는다. 세는 단위는 **탭**이다. */
    const siblings = spec.sets.filter((x) => x.kind === "set" && x.tabId === t.tabId);
    return {
      kind: "set", name: t.name, files: filesOfSet(records, t, deleted),
      inner: cellsOf(t).length, hard: true,
      blocked: siblings.length <= 1 ? "last_set" : undefined,
    };
  }

  const t = spec.sets.find((x) => x.id === target.setId);
  if (!isSet(t)) return none(target.kind);

  if (target.kind === "sceneCard") {
    const card = t.cards.find((k) => k.id === target.cardId);
    if (!card) return none("sceneCard");
    const files = card.cells.flatMap((c) =>
      takesOf(records, { id: t.id, name: t.name, idOnly: t.idOnly }, c)
        .filter((r) => !deleted(r.file))
        .map((r) => r.file),
    );
    return { kind: "sceneCard", name: card.name, files, inner: card.cells.length, hard: true };
  }

  const cell = cellsOf(t).find((c) => c.id === target.cellId);
  if (!cell) return none("scene");
  const files = takesOf(records, { id: t.id, name: t.name, idOnly: t.idOnly }, cell)
    .filter((r) => !deleted(r.file))
    .map((r) => r.file);
  return { kind: "scene", name: cell.name, files, inner: 0, hard: true };
}
