/** NAI 의 64 정렬 — 정본은 `docs/nai-web-reference.md` 3절 (공홈 `K()`).
 *
 *  ★**가까운 쪽 반올림이다** (올림 아님). 동률이면 큰 쪽. 0 이하면 64.
 *    번들 원본: `n=Math.floor(r/t)*t, i=Math.ceil(r/t)*t, o = r-n < i-r ? n : i`
 *  ★공통 전송 구간에서 걸리므로 txt2img 뿐 아니라 **Enhance·img2img·인페인트 전부**
 *    여기를 지난다. 화면과 서버(`nai.align64`)가 **같은 식**이어야 표시 해상도·Anlas 가
 *    실제 청구와 맞는다.
 *  ★스토어가 아니라 여기 있는 이유: 노드에서 회귀를 돌리려면 zustand 의존이 없어야 한다. */
export const alignTo64 = (v: number): number => {
  const lo = Math.floor(v / 64) * 64;
  const hi = Math.ceil(v / 64) * 64;
  const r = v - lo < hi - v ? lo : hi;
  return r <= 0 ? 64 : r;
};
