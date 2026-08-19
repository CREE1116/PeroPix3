/** 실제로 청구된 Anlas 를 **잔액 차이로 재는** 규칙. 순수 함수만 둔다.
 *  값을 물어 오고 화면에 내는 것은 `store/anlasMeter.ts` 다.
 *
 *  왜 재나: 화면에 뜨는 비용은 `lib/anlas.ts` 가 낸 **예상값**인데, 공홈 웹 클라이언트가
 *  자기 안에서 어긋나 있어(요금 표시 경로는 `characterRef` 를 안 넘기고 생성 경로는 넘긴다.
 *  `docs/nai-web-reference.md` 9절 · 감사 D12·D13) **번들만으로는 예상이 맞는지 알 수 없다.**
 *  남은 길은 실측뿐이다. 배치 직전 잔액을 적어 두고, 끝나면 다시 물어 뺀다.
 */

/** 이 배치에 무엇이 걸려 있었나. **어긋났을 때 콘솔에 함께 찍는다.**
 *  그래야 "어느 조건에서 어긋나는가"를 사용자가 알려 줄 수 있다. */
export type MeterCond = {
  width: number;
  height: number;
  steps: number;
  /** 티어 3 이상 (무료 구간 판정의 전제) */
  opus: boolean;
  /** 캐릭터 참조 수. 감사 D12 가 걸려 있는 자리다 */
  refs: number;
  /** 켜져 있는 바이브 수 */
  vibes: number;
  inpaint: boolean;
  count: number;
  /** 어느 창구가 걸었나. 강도 계수·해상도 규칙이 달라 조건을 가를 때 필요하다 */
  /** ★인페인트는 여기 없다 — 「생성」이 만든다 (2026-08-19). 자기 실행 버튼이 없어졌다 */
  from: "generate" | "enhance";
};

/** 판정 결과. **`ok: false` 면 화면에도 콘솔에도 아무것도 내지 않는다.** */
export type Verdict =
  | { ok: false; why: "unknown" | "increased" }
  | { ok: true; actual: number; match: boolean };

/** 잔액 둘과 예상값으로 판정한다.
 *
 *  ★`increased`(잔액이 늘었다)는 충전이거나 우리가 모르는 환급이다. 그 배치가 얼마를
 *    썼는지 알 방법이 없으므로 **잴 수 없는 것**으로 둔다.
 *  ★반대로 다른 창에서 함께 생성해 **더 줄어든** 경우는 가려낼 수단이 없다. 그때는
 *    어긋남으로 뜬다. 이 값을 "언제나 맞는 실측"으로 읽으면 안 되는 까닭이 그것이다. */
export function judge(before: number | null, after: number | null, est: number): Verdict {
  if (!Number.isFinite(before as number) || !Number.isFinite(after as number))
    return { ok: false, why: "unknown" };
  const actual = (before as number) - (after as number);
  if (actual < 0) return { ok: false, why: "increased" };
  return { ok: true, actual, match: actual === est };
}
