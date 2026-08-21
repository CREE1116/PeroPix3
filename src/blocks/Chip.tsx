import { useEffect, useLayoutEffect, useRef, useState } from "react";
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

  /** ★★**돌리는 동안에는 칩의 폭을 얼린다** (사용자 지적 2026-08-21).
   *
   *  가중치 배지는 글자 수가 계속 바뀐다 (`1.05` → `1.1` → 1 이 되면 아예 사라진다).
   *  칩이 그때마다 넓어졌다 좁아지면 **줄바꿈이 다시 계산돼 칩이 다음 줄로 밀리고**,
   *  커서 밑에 칩이 없어진 순간부터 휠이 패널 스크롤로 가 버린다 — 가중치를 맞추다
   *  화면이 통째로 굴러간다.
   *  ★그래서 폭을 재서 붙들어 둔다. 칩 안에서만 글자가 움직이고 줄은 안 바뀐다.
   *    1 이 되어도 배지를 지우지 않는다 — 지우면 칩 안이 한 번 더 출렁인다.
   *  ★★재는 때는 **첫 눈금을 적용한 뒤**다. 가중치가 없던 칩은 배지가 새로 생기면서
   *    한 번 넓어지는데, 그 전 폭으로 얼리면 그만큼 태그 이름이 말줄임으로 잘린다.
   *    적용한 뒤에 재면 배지가 이미 든 폭이라 글자가 안 잘린다 (`useLayoutEffect`).
   *    ★그래서 **첫 눈금에서만** 줄이 한 번 다시 잡힐 수 있다. 두 번째 눈금부터는 고정이다 —
   *      귀찮은 것은 돌리는 내내 튀는 쪽이지 시작할 때 한 번이 아니다.
   *  ★★배지에 **자리를 미리 비워 두지 말 것** (사용자 지적 2026-08-22) — `minWidth` 로 넉넉히
   *    잡았더니 숫자 왼쪽에 빈칸이 크게 남고, 그것이 고정 풀릴 때에야 사라져 **반응이 느린
   *    것처럼** 보였다. 겉폭이 이미 고정이라 배지 폭은 줄바꿈과 무관하다.
   *  ★푸는 때는 **커서가 칩을 벗어날 때**다 (사용자 지시). 안 벗어난 채로 손을 떼는 경우가
   *    있어 마지막 휠에서 조금 지나면 스스로도 푼다.
   *  ★긴 태그는 이 동안 말줄임으로 잘릴 수 있다 — 폭이 고정되고 배지가 자리를 차지해서다.
   *    놓으면 곧바로 돌아온다. 줄이 튀는 것보다 낫다고 봤다. */
  const [pin, setPin] = useState<number | null>(null);
  const pinning = useRef(false);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const release = () => {
    if (idle.current) clearTimeout(idle.current);
    idle.current = null;
    pinning.current = false;
    setPin(null);
  };
  useEffect(() => () => { if (idle.current) clearTimeout(idle.current); }, []);
  /** 첫 눈금이 그려진 **직후**의 폭으로 얼린다 — 배지가 이미 들어간 폭이다 */
  useLayoutEffect(() => {
    if (pinning.current && pin == null && ref.current) setPin(ref.current.getBoundingClientRect().width);
  });

  useEffect(() => {
    const el = ref.current;
    if (!el || readOnly) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.altKey) return;      // 맨 휠은 평소대로 스크롤이다
      e.preventDefault();
      pinning.current = true;    // 폭은 **적용한 뒤** `useLayoutEffect` 가 잰다
      if (idle.current) clearTimeout(idle.current);
      idle.current = setTimeout(release, 900);
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
      onPointerLeave={pin != null ? release : undefined}
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
        // ★얼린 폭은 **맨 마지막**이다 — 끌기 쪽 스타일이 덮으면 다시 줄이 튄다
        ...(pin != null ? { width: pin, flexShrink: 0 } : null),
      }}
    >
      {(tag.w != null || pin != null) && (
        <b
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "0.92em",
            color: (tag.w ?? 1) < 0 ? "var(--minus)" : "var(--accent)",
            /* ★★자리를 **미리 비워 두지 말 것** (사용자 지적 2026-08-22).
               `minWidth: 5ch` + 우측 정렬로 넉넉히 잡았더니 숫자 왼쪽에 빈칸이 크게 남고,
               그 빈칸이 고정이 풀릴 때(1초 뒤)에야 사라져 **반응이 느린 것처럼** 보였다.
               칩의 겉폭은 이미 얼려 두었으므로(`pin`) 줄바꿈은 배지 폭과 무관하다 —
               배지는 제 글자만큼만 차지하면 된다. */
            ...(pin != null ? { flexShrink: 0 } : null),
          }}
        >
          {/* ★★돌리는 동안은 **자릿수를 고정**한다 (`1.10`·`1.00`) — `fmtW` 는 끝의 0 을
              떼어 내서 `1.05`→`1.1`→`1` 로 글자 수가 오락가락하고, 겉폭이 고정이라
              그만큼 칩 안에 빈칸이 남는다 (실측 2026-08-22: 최대 22px). 두 자리로 붙들면
              부호가 바뀔 때 말고는 폭이 안 변한다. 놓으면 곧바로 원래 표기로 돌아온다. */}
          {pin != null ? (tag.w ?? 1).toFixed(2) : fmtW(tag.w!)}
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
