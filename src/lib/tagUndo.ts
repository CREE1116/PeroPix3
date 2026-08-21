/** 칩 하나를 지운 것을 **되돌린다** (`Ctrl+Z`).
 *
 *  ★★우클릭 한 번에 확인 없이 사라지는 자리라 되돌릴 길이 있어야 한다
 *    (사용자 지시 2026-08-21). 확인 창을 두지 않는 대신 이것이 있는 것이다.
 *
 *  ★**되돌리는 방법을 그때 만들어 담는다** (`() => onChange(이전 블록)`). 칩이 어느 스토어에
 *    사는지(베이스·캐릭터·씬 칸)를 여기서 알 필요가 없다 — 지우는 자리가 이미 그 길을 쥐고
 *    있으므로, 그 길을 그대로 담아 두면 된다.
 *  ★한 걸음짜리가 아니라 **쌓는다** — 여러 개를 잇달아 지우고 하나씩 되돌릴 수 있어야 한다.
 *  ★저장하지 않는다. 화면을 보는 동안만 사는 값이다 (선별 되돌리기와 같은 규약).
 */
const stack: (() => void)[] = [];

/** 너무 오래된 것은 버린다 — 그때의 블록이 이미 다른 것이 됐을 수 있다 */
const MAX = 30;

export function pushTagUndo(undo: () => void) {
  stack.push(undo);
  if (stack.length > MAX) stack.shift();
}

/** 되돌렸으면 `true`. 없으면 `false` — 부르는 쪽이 다음 되돌리기로 넘긴다 */
export function undoTagEdit(): boolean {
  const f = stack.pop();
  if (!f) return false;
  f();
  return true;
}

/** 탭·워크스페이스가 바뀌면 비운다 — 없어진 블록을 되살리려 들면 안 된다 */
export function clearTagUndo() {
  stack.length = 0;
}
