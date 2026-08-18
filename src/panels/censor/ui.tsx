/** 검열 화면이 나눠 쓰는 조각. **모양은 한 곳에서만 정한다.**
 *  파일이 셋으로 갈리면서 같은 상자를 세 번 그리게 되는 것을 막는다. */

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

export const num: React.CSSProperties = {
  width: 28,
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
  fontSize: "var(--text-2xs)",
  color: "var(--ink-soft)",
};

export const Sec = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
    <span style={{ fontSize: "var(--text-xs)", fontWeight: "var(--w-semi)", color: "var(--ink-soft)" }}>{label}</span>
    {children}
  </div>
);

export const Line = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
    <span style={{ width: 52, flexShrink: 0, fontSize: "var(--text-2xs)", color: "var(--ink-faint)" }}>{label}</span>
    {children}
  </div>
);

export const Hint = ({ children }: { children: React.ReactNode }) => (
  <span style={{ fontSize: "var(--text-2xs)", color: "var(--ink-faint)", lineHeight: "var(--lh-normal)" }}>
    {children}
  </span>
);
