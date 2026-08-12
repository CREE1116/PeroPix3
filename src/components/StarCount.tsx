import { Icon } from "./Icon";
import { useI18n } from "../i18n";

/** "N장 · ★M" 줄.
 *
 *  ★별 표식은 **SVG 아이콘**이라 번역 문자열 안에 넣을 수 없다 (이모지·기호 문자 금지, ui-guide.md).
 *    그래서 문자열은 숫자만 담고, 아이콘은 여기서 붙인다. */
export function StarCount({ n, s }: { n: number; s: number }) {
  const tr = useI18n((st) => st.t);
  return (
    <>
      {tr("canvas.countTakes", { n })}
      <span style={{ opacity: 0.45 }}>·</span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 1, color: "var(--warn)" }}>
        {Icon.star12On}
        {s}
      </span>
    </>
  );
}
