/** **지운 뒤 어디로 갈까** — 목록에서 하나가 빠졌을 때 고를 자리.
 *
 *  ★★규칙은 **뒤를 먼저, 없으면 앞**이다. 사람이 목록을 훑는 방향이 그쪽이라, 지운 자리에
 *    다음 것이 올라오는 편이 「하나 지웠다」로 읽힌다 (앞으로 튀면 되감긴 것처럼 보인다).
 *  ★★**지우기 전에** 부른다. 지운 뒤에 부르면 그 항목이 이미 목록에서 빠져 자리를 잃는다.
 *  ★여러 개를 지울 때는 **함께 사라지는 것을 건너뛴다** — 안 그러면 방금 지운 것을 가리켜
 *    화면이 텅 빈다.
 *  ★규칙이 한 곳에 있어야 한다 (2026-08-25): 씬 줄과 갤러리가 **같게** 굴어야 하는데,
 *    자리마다 따로 적었더니 한쪽은 옆으로 넘어가고 한쪽은 아무것도 안 고른 상태가 됐다.
 */
export function nextAfter(list: string[], gone: string | string[]): string | null {
  const out = new Set(Array.isArray(gone) ? gone : [gone]);
  const at = list.findIndex((x) => out.has(x));
  if (at < 0) return null;
  for (let i = at + 1; i < list.length; i++) if (!out.has(list[i])) return list[i];
  for (let i = at - 1; i >= 0; i--) if (!out.has(list[i])) return list[i];
  return null;
}
