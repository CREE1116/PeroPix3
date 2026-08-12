/** 결과 레코드와 **묶는 규칙** — ★사용자 그림이 화면에서 사라지느냐가 걸린 자리라
 *  앱 의존이 없는 모듈로 떼어 회귀 테스트를 붙였다 (`sceneCards.test.ts`).
 *  `store/workspace.ts` 가 그대로 다시 내보낸다 — 부르는 쪽은 안 바뀐다. */

export type Rec = {
  ts: string;
  file: string;
  tab: string;
  cell: string | null;
  /** ★화면이 결과를 묶는 **진짜 키**. 옛 레코드에는 없다 (append-only JSONL 이라 소급 불가). */
  tab_id?: string | null;
  cell_id?: string | null;
  seed: number;
  /** 이 그림이 **어느 그림에서 나왔나** (강화·업스케일·인페인트의 원본).
   *  ★**묶는 데 쓰지 않는다** — 결과는 언제나 각각 별개의 그림으로 보인다
   *  (사용자 결정 2026-08-13: v2 의 버전 스택 `1/n` 은 작업할 때 오히려 불편하다).
   *  출처 기록일 뿐이므로, 이 값으로 결과를 묶는 코드를 새로 만들지 말 것. */
  enhance_of?: string | null;
  resolved?: unknown;
};

/** 결과를 탭·슬롯에 묶는 **유일한 창구**.
 *
 *  ★폴더명은 사람이 읽을 수 있게 이름을 그대로 쓴다. 그래서 이름을 바꾸면 앞으로 저장될
 *    폴더만 새 이름이 되고, 이미 만든 그림은 옛 폴더에 남는다 — 그건 의도다.
 *    문제였던 것은 **화면**이 이름으로 묶어서, 이름을 고치는 순간 결과가 통째로 사라진 것이다.
 *  ★id 우선·이름 폴백. 옛 레코드(id 없음)도 계속 보여야 한다.
 *  ★판정을 여러 곳에 흩뿌리면 폴백 규칙이 어긋난다 — 고칠 때는 여기만 고친다.
 *
 *  @param cell 슬롯. `null` 은 "셀 없는 것"(싱글 탭), `undefined` 는 "셀을 안 따진다". */
/** 이 탭(·슬롯)의 결과를 고른다 — **화면이 결과를 묶는 유일한 창구**다.
 *
 *  ★레코드에 `tab_id` 가 없으면 이름으로 맞춘다 (id 이전에 만든 레코드 호환). 그런데 그 폴백이
 *    **새 탭에도 걸려서**, 같은 이름(`새 세트`)으로 탭을 만들면 만든 적 없는 그림이 떴다
 *    (사용자 지적 2026-08-04). 새 탭은 `idOnly` 라 폴백을 건너뛴다 — 옛 탭에만 남긴다. */
export function takesOf(
  records: Rec[],
  tab: { id: string; name: string; idOnly?: boolean },
  cell?: { id: string; name: string; fromSingle?: boolean } | null,
): Rec[] {
  return records.filter((r) => {
    if (!r.tab_id && tab.idOnly) return false;
    if (r.tab_id ? r.tab_id !== tab.id : r.tab !== tab.name) return false;
    if (cell === undefined) return true;
    if (cell === null) return r.cell == null;
    // ★옛 싱글 탭에서 옮겨 온 씬은 **셀 없는 레코드**를 받는다 — 그 탭의 그림이 전부 그것이다.
    //   `idOnly` 검사보다 **먼저** 봐야 한다 (그 검사가 셀 없는 레코드를 먼저 걷어낸다).
    if (cell.fromSingle && r.cell_id == null && r.cell == null) return true;
    if (!r.cell_id && tab.idOnly) return false;
    return r.cell_id ? r.cell_id === cell.id : r.cell === cell.name;
  });
}
