import { useI18n } from "../i18n";
import { PanelCollapseButton } from "../components/PanelCollapseButton";

/** 접힌 패널 자리에 남는 36px 레일.
 *  ★완전히 사라지면 어디서 다시 여는지 잃어버린다 (ui-guide.md 5절). */
export function Rail({
  side,
  label,
  onExpand,
  footer,
}: {
  side: "left" | "right";
  label: string;
  onExpand: () => void;
  /** ★접어 둬도 남아야 하는 것 — 생성 버튼이 그렇다 (페로픽스파이와 같다). 레일 맨 아래에 선다 */
  footer?: React.ReactNode;
}) {
  const t = useI18n((s) => s.t);
  return (
    <aside
      style={{
        width: 36,
        flexShrink: 0,
        background: "var(--bg)",
        [side === "left" ? "borderRight" : "borderLeft"]: "1px solid var(--line)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      {/* ★`title` 이다 — `data-tip` 으로 넘기면 버려진다 (`PanelCollapseButton` 의 프롭) */}
      <PanelCollapseButton side={side} collapsed onClick={onExpand} title={t("panel.expand", { name: label })} />
      <div
        style={{
          writingMode: "vertical-rl",
          marginTop: "var(--sp-2)",
          fontSize: "var(--text-2xs)",
          color: "var(--ink-dim)",
          letterSpacing: "0.08em",
          userSelect: "none",
        }}
      >
        {label}
      </div>
      {footer && (
        <>
          <span style={{ flex: 1 }} />
          <div style={{ width: "100%" }}>{footer}</div>
        </>
      )}
    </aside>
  );
}
