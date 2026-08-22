/** **되돌리기 로그** — `Ctrl+Z` 가 보는 유일한 자리.
 *
 *  ★★**스택이 하나여야 한다** (사용자 지시 2026-08-22: *"실행취소를 제대로된 전역 로그를
 *    기록하게 만들어 … 컨트롤+z를 했을 때 사용자의 기대는 마지막에 수정한 걸 되돌리는거임."*).
 *    예전에는 스택이 **둘**이었고(칩 지우기 · 그림 선별) 부르는 쪽이 `칩 || 선별` 순서로
 *    물었다. 그래서 방금 그림을 지웠어도 칩 스택에 뭔가 남아 있으면 **칩이 먼저** 되돌아갔다
 *    (사용자 지적: *"카드 삭제하고 되돌리기하면 카드 말고 다른 슬롯에서 지운 이미지가 복구됨"*).
 *
 *  ★**되돌리는 방법을 그때 만들어 담는다** (`() => 이전 상태로`). 무엇이 어느 스토어에 사는지를
 *    여기서 알 필요가 없다 — 바꾸는 자리가 이미 그 길을 쥐고 있으므로 그 길을 담아 두면 된다.
 *  ★**이름을 함께 담는다.** 되돌릴 수 있는 것이 여러 갈래라, 무엇이 되돌아갔는지 말해 주지
 *    않으면 사용자가 화면에서 그것을 찾아 헤맨다.
 *  ★저장하지 않는다. 화면을 보는 동안만 사는 값이다.
 *
 *  ★★**되돌릴 수 없는 일을 하면 비운다** (`clearUndo`). 세트·탭·씬·카드를 지우면 그 안의
 *    것을 되돌릴 방법이 사라지므로, 로그를 그대로 두면 `Ctrl+Z` 가 **엉뚱한 것**을 되살린다.
 *    비워 두면 아무 일도 일어나지 않는다 — 그것이 맞는 결과다.
 */

export type UndoEntry = {
  /** 화면에 알릴 이름 — 이미 옮겨진 문구를 넣는다 */
  label: string;
  run: () => void | Promise<void>;
};

const stack: UndoEntry[] = [];

/** 너무 오래된 것은 버린다 — 그때의 상태가 이미 다른 것이 됐을 수 있다 */
const MAX = 50;

export function pushUndo(label: string, run: () => void | Promise<void>): void {
  stack.push({ label, run });
  if (stack.length > MAX) stack.shift();
}

/** 마지막 것을 되돌린다. 되돌린 것의 **이름**을 주고, 없으면 `null` —
 *  부르는 쪽이 그것으로 알림을 띄우고 키 기본 동작을 막을지 정한다. */
export function undoLast(): string | null {
  const e = stack.pop();
  if (!e) return null;
  void e.run();
  return e.label;
}

export function canUndo(): boolean {
  return stack.length > 0;
}

/** 탭·세트·워크스페이스가 바뀌거나, 되돌릴 수 없는 삭제가 일어나면 비운다 */
export function clearUndo(): void {
  stack.length = 0;
}

/** 지금 로그에 쌓인 이름들 (새것이 뒤) — 판정과 디버깅용 */
export function undoLabels(): string[] {
  return stack.map((e) => e.label);
}
