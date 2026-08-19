import { useI18n } from "../i18n";
import { COLOR_HEX, fmtW, weightLevel, type Tag } from "../lib/blocks";

/** 태그 칩.
 *  - **끌기 = 자리 옮기기** (같은 블록 안에서도, 다른 블록으로도 — `useTagDrag`)
 *  - 휠 = 가중치 (0.05 단위, Shift 로 0.1)
 *  - **휠 클릭(가운데 버튼) = 가중치 초기화(1)**
 *  - 우클릭 = 삭제
 *  - ★가중치 강조 수준에 따라 칩 색이 변한다 */
export function Chip({
  tag,
  dup,
  dragProps,
  dragging,
  onWeight,
  onRemove,
  readOnly,
}: {
  tag: Tag;
  dup?: boolean;
  /** 보여 주기만 하는 자리 (블록 저장소의 펼친 내용) — 휠·우클릭이 안 먹는다.
   *  ★고치는 창구는 **프롬프트 쪽 하나**다. 저장소에서도 고치게 하면 어디서 고쳤나가 된다 */
  readOnly?: boolean;
  /** 끌기 손잡이 — 칩 전체가 손잡이다 */
  dragProps?: React.HTMLAttributes<HTMLSpanElement> & { style?: React.CSSProperties };
  dragging?: boolean;
  onWeight: (w: number | null) => void;
  onRemove: () => void;
}) {
  const t = useI18n((s) => s.t);
  const lv = weightLevel(tag.w);

  // 강조 수준 → 배경·테두리 세기. 음수는 붉은 계열로 갈린다.
  const tone =
    lv === 0
      ? { bg: "var(--chip-bg)", bd: "var(--line)", fg: "var(--ink)" }
      : lv > 0
        ? {
            bg: `color-mix(in srgb, var(--accent) ${lv === 2 ? 22 : 12}%, var(--chip-bg))`,
            bd: `color-mix(in srgb, var(--accent) ${lv === 2 ? 70 : 40}%, var(--line))`,
            fg: "var(--ink)",
          }
        : {
            bg: `color-mix(in srgb, var(--minus) ${lv === -2 ? 20 : 10}%, var(--chip-bg))`,
            bd: `color-mix(in srgb, var(--minus) ${lv === -2 ? 65 : 35}%, var(--line))`,
            fg: "var(--ink)",
          };

  return (
    <span
      data-chip
      {...dragProps}
      onWheel={(e) => {
        if (readOnly) return;
        e.preventDefault();
        const step = e.shiftKey ? 0.1 : 0.05;
        const cur = tag.w ?? 1;
        const next = Math.round((cur + (e.deltaY < 0 ? step : -step)) * 100) / 100;
        onWeight(next === 1 ? null : next);
      }}
      onMouseDown={(e) => {
        // 가운데 버튼의 브라우저 기본 동작(자동 스크롤)을 막는다
        if (e.button === 1) e.preventDefault();
      }}
      onAuxClick={(e) => {
        if (readOnly || e.button !== 1) return;
        e.preventDefault();
        onWeight(null); // 가중치 초기화
      }}
      onContextMenu={(e) => {
        if (readOnly) return;
        e.preventDefault();
        onRemove();
      }}
      data-tip={readOnly ? tag.t : t("block.chipHint")}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        maxWidth: "100%",
        padding: "1px 7px",
        borderRadius: "var(--r-1)",
        background: tone.bg,
        border: `1px solid ${dup ? "var(--warn)" : tone.bd}`,
        color: tone.fg,
        fontSize: "var(--text-2xs)",
        cursor: "default",
        userSelect: "none",
        // 끌고 있는 칩은 자리만 지키고 흐려진다 (고스트가 커서를 따라간다)
        opacity: dragging ? 0.3 : 1,
        ...(dragProps?.style ?? {}),
      }}
    >
      {tag.w != null && (
        <b
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "0.92em",
            color: tag.w < 0 ? "var(--minus)" : "var(--accent)",
          }}
        >
          {fmtW(tag.w)}
        </b>
      )}
      <span
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          maxWidth: "22em",
        }}
      >
        {tag.t}
      </span>
    </span>
  );
}

export const colorHex = (c: string | null) => (c ? COLOR_HEX[c] : "var(--line)");
