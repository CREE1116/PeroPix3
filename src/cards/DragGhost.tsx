import type { CSSProperties, ReactNode } from "react";

/** 끄는 동안 커서를 따라오는 **잔상의 껍데기**.
 *
 *  ★포인터 드래그에는 브라우저가 만들어 주는 드래그 이미지가 없어 우리가 그린다
 *    (`dragStore.ts`·`useReorder.ts` 머리 주석). 그리는 자리가 넷이라(덱 카드·블록 저장소·
 *    블록 순서·씬 줄) **껍데기는 여기 하나뿐이다** — 두 벌이 되면 생김새가 갈린다.
 *  ★**화면 좌표에 띄운다**(`position: fixed`). 목록이 스크롤되거나 가장자리 자동 스크롤이
 *    돌아도 잔상은 커서에 붙어 있어야 한다.
 *  ★**히트 테스트를 가로채지 않는다**(`pointerEvents: none`). 커서 아래를 잔상이 덮으면
 *    놓을 자리를 고를 수 없다.
 *
 *  안에 무엇을 그릴지는 부르는 쪽이 정한다 — 끌고 있는 것의 모습이라 자리마다 다르다. */
export function DragGhost(p: {
  /** **화면 좌표** — `anchor` 가 무엇을 가리키는지 정한다 */
  x: number;
  y: number;
  /** `cursor`(기본) = 커서 오른쪽 아래에 매단다 (커서가 가리키는 곳을 안 가린다) ·
   *  `center` = 커서 한가운데에 쥔다 (덱 카드) ·
   *  `exact` = 준 자리가 곧 좌상단이다 (잡은 지점을 그대로 지키는 목록 순서 바꾸기) */
  anchor?: "cursor" | "center" | "exact";
  /** 살짝 기울여 들려 있는 것처럼. 0 이면 안 기운다 */
  tilt?: number;
  z?: number;
  opacity?: number;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const { x, y, anchor = "cursor", tilt = -2, z = 900, opacity = 0.92 } = p;
  return (
    <div
      style={{
        position: "fixed",
        left: anchor === "cursor" ? x + 12 : x,
        top: anchor === "cursor" ? y + 8 : y,
        transform: `${anchor === "center" ? "translate(-50%, -50%) " : ""}rotate(${tilt}deg)`,
        zIndex: z,
        pointerEvents: "none",
        opacity,
        boxShadow: "var(--shadow-3)",
        ...p.style,
      }}
    >
      {p.children}
    </div>
  );
}
