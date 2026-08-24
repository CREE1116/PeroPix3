import type { RefObject } from "react";

/** 드롭 자리의 **공통 표시** — 강조 방식은 앱 전체에서 하나다 (사용자 지시 2026-08-20:
 *  *"강조 스타일이 전부 다름. 통일시켜야해. 씬 세트 양식이 제일 나아보임"*).
 *
 *  규칙 셋:
 *    1. **영역이 밝아진다** — 끌기 중에는 화면에 어둠이 깔리고(`DragLayer`), 받는 영역만
 *       그 위로 올라온다. 올리는 것은 부르는 쪽의 몫이고 **카드가 아니라 영역**이다.
 *    2. **포인터가 올라오면 물든다** — 강조색 겹이 그 자리를 덮는다.
 *    3. **무슨 일이 일어나는지 적는다** — 알약 한 줄. 놓기 전에 결과를 알 수 있어야 한다.
 *
 *  ★입력을 먹지 않는다(`pointerEvents: none`). 받는 판정은 **사각형**이라
 *    (`useDropZone` 의 `rect`) 겹을 덮어도 드롭에 지장이 없다.
 *  ★**카드 위에 뜬다.** 받는 칸의 *바탕*을 칠하면 그 위의 카드가 덮어 안 보인다
 *    (사용자 지적 2026-08-20: 씬 세트 드롭이 기존 카드에 가려졌다).
 *  ★부모에 `position: relative` 가 있어야 한다.
 *
 *  @param innerRef 이 겹이 곧 드롭존일 때 (카드 한 장의 일부만 받는 자리 등)
 */
export function DropVeil({
  innerRef,
  over,
  label,
  name,
  top,
  height,
}: {
  innerRef?: RefObject<HTMLDivElement | null>;
  over: boolean;
  label: string;
  /** 조작 테스트가 잡는 손잡이 */
  name?: string;
  /** 카드 한 장을 **여러 자리로 나눌 때** — 안 주면 카드 전체다 (캐릭터 카드의 스택·교체).
   *  ★나눈 자리에는 **경계선**이 함께 생긴다. 어디까지가 어느 자리인지 안 보이면
   *    반씩 나뉜 카드가 그냥 한 장으로 보인다. */
  top?: string;
  height?: string;
}) {
  const split = top !== undefined || height !== undefined;
  return (
    <div
      ref={innerRef}
      data-drop-veil={name ?? ""}
      data-over={over ? "" : undefined}
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: top ?? 0,
        ...(split ? { height: height ?? "100%" } : { bottom: 0 }),
        zIndex: 32,
        pointerEvents: "none",
        display: "grid",
        placeItems: "center",
        background: over ? "color-mix(in srgb, var(--accent) 26%, transparent)" : "transparent",
        /* ★나뉜 자리의 **윗변에 금**을 긋는다 (맨 위 자리는 카드 테두리가 그 일을 한다).
           금이 없으면 반씩 나뉜 카드가 한 장으로 보여 어디에 놓는지 모른다. */
        borderTop: split && top && top !== "0" ? "1px dashed var(--accent)" : undefined,
        transition: "background 90ms",
      }}
    >
      {over && (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--sp-2)",
            padding: "var(--sp-2) var(--sp-4)",
            borderRadius: 999,
            background: "var(--accent)",
            color: "var(--accent-on)",
            fontSize: "var(--text-xs)",
            fontWeight: "var(--w-semi)",
            whiteSpace: "nowrap",
            boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
          }}
        >
          {label}
        </span>
      )}
    </div>
  );
}
