import { useEffect, useRef } from "react";
import { COLOR_HEX, fmtW, weightLevel, type Tag } from "../lib/blocks";
import { useUi } from "../store/ui";

/** 태그 칩.
 *  - **끌기 = 자리 옮기기** (같은 블록 안에서도, 다른 블록으로도 — `useTagDrag`)
 *  - **Alt + 휠 = 가중치** (0.05 단위, Alt+Shift 로 0.1)
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
  /** 가중치 강조를 켜 두나 (설정) — 끄면 **평범한 칩**으로 보인다 (겹침 표시는 남는다) */
  const hl = useUi((u) => u.weightHl);
  const lv = hl ? weightLevel(tag.w) : 0;

  /** ★★가중치는 **Alt + 휠**이다 (사용자 지시 2026-08-21).
   *
   *  ★맨 휠로 두면 프롬프트를 훑어 내리다 **지나가는 칩의 가중치가 바뀐다** — 바뀐 줄도
   *    모르고 그대로 생성하게 된다 (실제로 그렇게 2.6 이 박혀 초록 노이즈가 나왔다).
   *  ★**네이티브 리스너로 붙인다.** React 의 `onWheel` 은 뿌리에 passive 로 달려서
   *    `preventDefault()` 가 안 먹는다 — 그대로 두면 가중치와 스크롤이 **함께** 일어난다. */
  const ref = useRef<HTMLSpanElement | null>(null);
  const onWeightRef = useRef(onWeight);
  onWeightRef.current = onWeight;
  const wRef = useRef(tag.w);
  wRef.current = tag.w;
  useEffect(() => {
    const el = ref.current;
    if (!el || readOnly) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.altKey) return;      // 맨 휠은 평소대로 스크롤이다
      e.preventDefault();
      const step = e.shiftKey ? 0.1 : 0.05;
      const cur = wRef.current ?? 1;
      const next = Math.round((cur + (e.deltaY < 0 ? step : -step)) * 100) / 100;
      onWeightRef.current(next === 1 ? null : next);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [readOnly]);

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
      ref={ref}
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
      data-tip={readOnly ? tag.t : undefined}
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
        // ★프롬프트를 **읽고 치는 글자**다 — v2 와 같은 14px (`--text-prompt`)
        fontSize: "var(--text-prompt)",
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
