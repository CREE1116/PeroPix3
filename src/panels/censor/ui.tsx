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

/** 고른 칩. ★★**`border` 를 통째로 준다 — `borderColor` 만 주면 안 된다.**
 *
 *  ★★사용자 지적 2026-08-23 (세 번 밟았다): *"검열 방식을 클릭할 때마다 테두리가 생기고
 *    안 사라짐"*. 포커스 고리인 줄 알고 두 번 헛짚었는데, 실제로 화면에서 계산된 값을 보니
 *    `outline` 은 전부 `none` 이었고 **한 번이라도 골랐던 칩의 `border-color` 가 글자색으로
 *    남아** 있었다.
 *  ★까닭: 아래(`box`)가 `border: 1px solid var(--line)` 이라는 **줄임 속성**을 주는데 여기서
 *    `borderColor` 라는 **낱개 속성**만 덮었다. 선택이 풀릴 때 리액트는 사라진 낱개를
 *    `style.borderColor = ""` 로 지우는데, 그러면 줄임 속성에 실려 있던 색까지 함께 빠져
 *    **`currentColor`(=글자색)로 떨어진다.** `border` 는 안 바뀌었으니 다시 쓰지도 않는다.
 *  ★그래서 켤 때도 끌 때도 **같은 속성 이름**을 쓴다. 이 규칙은 `box` 와 짝을 이루는 다른
 *    칩에도 그대로 적용된다 — 낱개로 덮지 말 것. */
export const on: React.CSSProperties = {
  border: "1px solid var(--accent)",
  background: "var(--accent-bg)",
  color: "var(--ink)",
};

/** 고르는 칩에 **마우스로는 포커스가 가지 않게** 한다. `onMouseDown` 에 건다.
 *
 *  고른 표시(`on`)와 포커스 고리(`button:focus-visible`)가 둘 다 1px 강조색이라, 방금 누른
 *  칩에 고리가 서면 「옛 선택이 안 풀렸다」로 읽힌다. `mousedown` 의 기본 동작을 막으면
 *  포커스가 애초에 안 가므로 그럴 일이 없다 (누른 뒤 `blur()` 로 떼는 것과 달리 순서에
 *  기대지 않는다). 키보드는 그대로다 — `Tab`·`Enter` 는 `mousedown` 을 안 지난다.
 *
 *  ★★**사용자가 본 「안 사라지는 테두리」는 이것이 아니었다** (2026-08-23). 그 증상은
 *    `on` 이 `borderColor` 낱개만 덮은 탓이었고(위 ★★주), 여기를 두 번 고치는 동안
 *    화면은 그대로였다. 실제로 계산된 스타일을 열어 보고서야 `outline` 이 내내 `none` 이고
 *    `border-color` 가 글자색으로 남아 있는 것을 봤다.
 *    ★교훈은 하나다 — **보이는 것을 짐작하지 말고 그 자리에서 값을 읽는다.** */
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
