/** 잡은 것을 **틈 `to`** 로 옮긴 새 목록. 원본은 그대로 둔다 (안 옮겼으면 원본을 그대로 돌려준다).
 *
 *  ★`to` 는 칸 번호가 아니라 **틈 번호**(0..n)다 — `useReorder` 의 `handleProps` 가 그렇게
 *    돌려준다 (`overIdx` 도 같은 규약). 그래서 아래로 옮길 때 한 칸을 뺀다: 뽑아낸 **뒤**의
 *    자리로 세기 때문이다.
 *  ★셈을 **여기 하나**로 둔다 (CLAUDE.md: 복제하면 불일치가 계속 생긴다) — 블록 목록도
 *    캐릭터 목록도 이것을 부른다. 훅과 떼어 둔 것은 셈만 따로 시험할 수 있게 하려는 것이다.
 */
export function moveTo<T>(list: T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length) return list;
  if (to === from || to === from + 1) return list; // 제자리
  const n = list.slice();
  const [x] = n.splice(from, 1);
  n.splice(Math.max(0, Math.min(n.length, to > from ? to - 1 : to)), 0, x);
  return n;
}
