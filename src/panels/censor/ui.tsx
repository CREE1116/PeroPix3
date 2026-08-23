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

/** 고르는 칩을 **마우스로** 누르면 포커스를 놓는다.
 *
 *  ★★사용자 지적 2026-08-23: *"검열방식을 선택할때마다 테두리가 생기는데 다른걸 선택해도
 *    안사라짐"*. 고른 표시(`on`)와 포커스 고리(`button:focus-visible`)가 **둘 다 1px 강조색**
 *    이라, 방금 누른 단추에 고리가 남으면 「옛 선택이 안 풀렸다」로 읽힌다.
 *    ★검열 화면에는 `1 2 3` 단축키가 있어서, 키를 한 번 누른 뒤로는 브라우저가 키보드
 *      조작 중으로 보고 **마우스 클릭에도** 고리를 그린다 (그래서 이 화면에서만 두드러진다).
 *  ★**키보드는 안 건드린다** — `detail === 0` 이면 Enter·Space 로 누른 것이라 고리를 남긴다.
 *    (그때는 고리가 「지금 여기 있다」는 유일한 표시다.) */
export const dropFocus = (e: React.MouseEvent) => {
  if (e.detail > 0) (e.currentTarget as HTMLElement).blur();
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
