/** CLI 턴의 **어디까지 받았나** — 끊겼다 붙었을 때 놓친 줄을 되받는 근거.
 *
 *  ★왜 필요한가 (실측 2026-08-15): 예전에는 CLI 가 흘리는 줄을 그냥 쏘고 말았다. 소켓이
 *    잠깐만 끊겨도 그 사이 줄이 영영 사라지는데, 하필 끝을 알리는 `exit` 이 사라지면
 *    화면이 「일하는 중…」에서 **영원히 멈춘다** — 일은 다 끝나 카드까지 만들어졌는데도.
 *    그래서 서버가 줄마다 번호를 붙여 한 턴치를 들고 있고(`genqueue`), 붙을 때 그 번호부터
 *    달라고 한다.
 *
 *  ★스토어에 안 넣는다 — 화면에 그릴 값도, 대화와 함께 저장될 값도 아니다
 *    (`llm.ts` 의 `cliErr` 과 같은 이유).
 *  ★`queue.ts` 와 `llm.ts` 가 **둘 다** 적는다. 서로를 import 하면 고리가 되므로 여기 둔다.
 */

let run = "";
let seq = 0;

/** 이 턴의 번호를 적어 둔다. `/api/cli/run` 의 답과 흘러온 줄, **양쪽 다** 여기로 온다 —
 *  무엇이 먼저 와도 같아지도록 번호가 **바뀔 때만** 다시 센다. */
export function noteCliRun(id: string) {
  if (id && id !== run) {
    run = id;
    seq = 0;
  }
}

/** 이 줄을 화면에 태워야 하나. ★이미 태운 것은 거른다 —
 *  끊겼다 붙으면 복원분과 실시간분이 겹친다 (그림 쪽 `seen` 이 하는 일과 같다). */
export function takeCliSeq(id: string, n: number): boolean {
  if (!id || !n) return true; // 번호가 없는 줄(옛 서버)은 그냥 태운다
  if (id === run && n <= seq) return false;
  noteCliRun(id);
  seq = Math.max(seq, n);
  return true;
}

/** 재연결 때 "여기까지 받았다"를 알리는 값 */
export const cliCursor = () => ({ cli_run: run, cli_seq: seq });
