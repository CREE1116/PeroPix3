/** 검열 화면이 나눠 쓰는 조각. **모양은 한 곳에서만 정한다.**
 *  파일이 셋으로 갈리면서 같은 상자를 세 번 그리게 되는 것을 막는다. */

import { Help } from "../../components/Tip";

export const card: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: "var(--r-3)",
};

export const box: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: "var(--r-2)",
  padding: "3px var(--sp-3)",
  fontSize: "var(--text-2xs)",
  color: "var(--ink-soft)",
};

export const on: React.CSSProperties = {
  borderColor: "var(--accent)",
  background: "var(--accent-bg)",
  color: "var(--ink)",
};

/** 고르는 칩에 **마우스로는 포커스가 가지 않게** 한다. `onMouseDown` 에 건다.
 *
 *  ★★사용자 지적 2026-08-23: *"검열 방식을 선택할 때마다 테두리가 생기는데 다른 걸 선택해도
 *    안 사라짐"*. 고른 표시(`on`)와 포커스 고리(`button:focus-visible`)가 **둘 다 1px 강조색**
 *    이라, 방금 누른 단추에 고리가 남으면 「옛 선택이 안 풀렸다」로 읽힌다.
 *    ★검열 화면에는 `1 2 3` 단축키가 있어서, 키를 한 번 누른 뒤로는 브라우저가 키보드
 *      조작 중으로 보고 **마우스 클릭에도** 고리를 그린다 (그래서 이 화면에서만 두드러진다).
 *
 *  ★★**누른 뒤에 `blur()` 로 떼지 않는다** (그 방식으로 한 번 고쳤는데 사용자 화면에서는
 *    여전히 남았다, 2026-08-23). 떼는 것은 이미 포커스가 간 다음이라, 그 사이에 무엇이든
 *    다시 잡으면 고리가 그대로 선다. `mousedown` 의 기본 동작을 막으면 **포커스가 애초에
 *    가지 않으므로** 떼고 말고 할 것이 없다 — 순서에 기대지 않는다.
 *  ★키보드는 그대로다. `Tab` 으로 오거나 `Enter`·`Space` 로 누르는 길은 `mousedown` 을
 *    지나지 않으므로 고리가 남는다 (그때는 고리가 「지금 여기 있다」는 유일한 표시다). */
export const dropFocus = (e: React.MouseEvent) => {
  e.preventDefault();
};

export const num: React.CSSProperties = {
  width: 28,
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
  fontSize: "var(--text-2xs)",
  color: "var(--ink-soft)",
};

/** ★설명은 **라벨 옆 `?`** 로만 나온다 (사용자 지시 2026-08-19) — 화면에 펼쳐 두지 않는다 */
export const Sec = ({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
    <span style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", fontSize: "var(--text-xs)", fontWeight: "var(--w-semi)", color: "var(--ink-soft)" }}>
      {label}
      {help && <Help tip={help} />}
    </span>
    {children}
  </div>
);

export const Line = ({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) => (
  <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
    <span style={{ width: 52, flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 3, fontSize: "var(--text-2xs)", color: "var(--ink-faint)" }}>
      {label}
      {help && <Help tip={help} />}
    </span>
    {children}
  </div>
);

/** ★남은 쓰임은 **지금 상태를 말하는 줄**뿐이다 (「모델을 고르면 …」처럼 비어 있을 때).
 *  값이 무엇을 하는지 설명하는 것은 `Sec` 의 `help` 로 옮겼다 (사용자 지시 2026-08-19). */
export const Hint = ({ children }: { children: React.ReactNode }) => (
  <span style={{ fontSize: "var(--text-2xs)", color: "var(--ink-faint)", lineHeight: "var(--lh-normal)" }}>
    {children}
  </span>
);
