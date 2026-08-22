import { newestFirst, takesOfScene, type Rec } from "./takes";
import { allCells, useWs } from "../store/workspace";
import { usePreviews, withPreviews } from "../store/previews";
import { useSceneFocus } from "../store/sceneFocus";

/** 씬 칸에 **보이는 그대로**의 장 목록과, 그 위를 오가는 규칙.
 *
 *  ★★창구를 하나로 둔 이유: 같은 규칙을 두 곳이 쓴다 — 씬 줄의 `Del` 키와 프리뷰의
 *    **삭제 단추**다. 나눠 적어 두었더니 키로 지우면 옆 장으로 넘어가는데 단추로 지우면
 *    아무것도 안 골라진 상태가 됐다 (사용자 지적 2026-08-21).
 *  ★목록은 화면과 **같아야** 한다 — 지운 것 빼기, 최신이 앞.
 *    하나라도 다르면 「다음 장」이 화면에 없는 장을 가리킨다.
 */
export function visibleTakes(cellId: string): Rec[] {
  const ws = useWs.getState();
  const tab = ws.spec?.tabs.find((x) => x.id === ws.spec?.activeTab);
  if (tab?.kind !== "set" || !cellId) return [];
  const cell = allCells(tab).find((c) => c.id === cellId);
  if (!cell) return [];
  const all = withPreviews(ws.records, ws.current, usePreviews.getState().items);
  return takesOfScene(all, tab, allCells(tab), cell)
    .filter((r) => !ws.isDeleted(r.file))
    .sort(newestFirst);
}

/** 한 장 옆으로 (`d = +1` 오른쪽 · `-1` 왼쪽). 끝에서는 **머문다** — 감싸지 않는다.
 *
 *  ★줄은 **최신이 왼쪽**이다. 그래서 오른쪽이 「그 다음으로 옛것」이다.
 *  ★감싸지 않는 이유: 방향키로 훑을 때 끝에서 반대편으로 튀면 지금 어디인지를 잃는다. */
export function stepTake(d: 1 | -1): boolean {
  const { cell, file } = useSceneFocus.getState();
  if (!cell || !file) return false;
  const list = visibleTakes(cell);
  const at = list.findIndex((r) => r.file === file);
  if (at < 0) return false;
  const next = list[at + d];
  if (!next) return false;
  /* ★방향키는 고른 것을 **안 푼다** — 푸는 것은 「그냥 좌클릭」과 `Esc` 뿐이다
     (사용자 지시 2026-08-22). 고른 목록이 그 자체로 정본이라, 훑고 지나가도 안 불어난다. */
  useSceneFocus.getState().focus(cell, next.file);
  return true;
}

/** 이 장(들)을 지우면 **어디로 갈지** — 오른쪽(그 다음으로 옛것) → 없으면 왼쪽 → 없으면 `null`.
 *
 *  ★★**지우기 전에** 부른다. 지운 뒤에 부르면 그 장이 목록에서 빠져 자리를 잃는다 —
 *    지금은 `deleteFiles` 가 비동기라 뒤에 불러도 우연히 맞지만, 그 우연에 기대지 않는다.
 *  ★지우는 것은 부르는 쪽이 한다 — 여기는 **어디로 갈지**만 정한다.
 *  ★여러 장을 지울 때는 **함께 사라지는 것을 건너뛴다.** 안 그러면 방금 지운 장을 가리켜
 *    큰 자리가 텅 빈다 (한 장짜리와 같은 결함이 여러 장에서 되살아난다). */
export function pickAfterRemoving(cellId: string, file: string | string[]): string | null {
  const gone = new Set(Array.isArray(file) ? file : [file]);
  const list = visibleTakes(cellId);
  const at = list.findIndex((r) => gone.has(r.file));
  if (at < 0) return null;
  for (let i = at + 1; i < list.length; i++) if (!gone.has(list[i].file)) return list[i].file;
  for (let i = at - 1; i >= 0; i--) if (!gone.has(list[i].file)) return list[i].file;
  return null;
}

/** 고른 것을 **휴지통으로** 보낸다 — 여러 장 고른 상태면 **전부**, 아니면 보고 있는 한 장.
 *
 *  ★★창구가 하나여야 한다: `Del` 키와 큰 그림 아래 **삭제 단추**가 같은 일을 한다.
 *    나눠 적었더니 키로 지우면 옆 장으로 넘어가는데 단추로 지우면 아무것도 안 골라진
 *    상태가 됐다 (사용자 지적 2026-08-21). 이번에 「여러 장 지우기」가 늘면서 갈라질 자리가
 *    하나 더 생겼으므로 아예 여기로 모은다 (사용자 지시 2026-08-22).
 *  ★**고른 것을 먼저 푼다.** 지워진 파일을 고른 채로 두면 그 뒤의 `Ctrl+Z` 로 되살아나기
 *    전까지 없는 파일을 가리킨다.
 *  @returns 실제로 보낸 파일 (없으면 빈 배열) */
export function removeTakes(): string[] {
  const f = useSceneFocus.getState();
  // ★고른 것이 있으면 **그것 전부**, 없으면 지금 보고 있는 한 장
  const target = f.picked.length ? [...f.picked] : f.file ? [f.file] : [];
  if (!target.length) return [];
  const next = pickAfterRemoving(f.cell, target);   // ★지우기 **전에** 정한다
  useSceneFocus.getState().setPicked([]);           // ★없어진 파일을 고른 채로 두지 않는다
  void useWs.getState().deleteFiles(target);
  useSceneFocus.getState().focus(f.cell, next);
  return target;
}
