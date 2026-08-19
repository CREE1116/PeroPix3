import { useDrag } from "./dragStore";
import { DragGhost } from "./DragGhost";
import { artBackground } from "./CardArt";
import { FittedImg } from "./FittedImg";
import { useGen } from "../store/gen";
import { normThumb, thumbUrl } from "../store/prompt";

/** 드래그 중의 화면 두 겹.
 *
 *  ★스포트라이트: 드래그가 시작되면 화면 전체를 어둡게 깔고, **드롭 가능한 곳만** 원래
 *    밝기로 남긴다. 목적지마다 다른 색을 쓰지 않고 흰색으로 통일한다 —
 *    드롭은 즉발적인 행위라 신호가 강해야 하고, 색이 여럿이면 학습 대상이 된다.
 *  ★고스트: 포인터 드래그에는 브라우저가 만들어 주는 드래그 이미지가 없으므로 직접 그린다.
 *    자리·층·투명도는 `DragGhost` 가 갖는다 — 고스트를 그리는 자리가 넷이라 껍데기를 하나로 둔다. */
export function DragLayer() {
  const drag = useDrag((s) => s.drag);
  const pos = useDrag((s) => s.pos);
  if (!drag) return null;

  // ★블록 저장소는 **어둠을 깔지 않는다** — 놓을 자리가 프롬프트 패널 안의 목록들이라,
  //   화면을 덮으면 정작 어디에 놓는지가 안 보인다. 칩 끌기와 같은 작은 고스트만 띄운다.
  if (drag.kind === "blocklib") {
    return (
      <DragGhost
        x={pos.x}
        y={pos.y}
        tilt={0}
        opacity={1}
        z={902}
        style={{
          padding: "2px 9px",
          borderRadius: "var(--r-1)",
          background: "var(--chip-bg)",
          border: "1px solid var(--accent)",
          color: "var(--ink)",
          fontSize: "var(--text-2xs)",
          whiteSpace: "nowrap",
        }}
      >
        {drag.item?.label ?? drag.block?.label}
      </DragGhost>
    );
  }

  return (
    <>
      {/* ★★어둠을 **옅게** 깐다 (사용자 지적 2026-08-19: 놓을 자리가 안 보였다).
          0.78 은 화면을 거의 지워서, 어디에 놓는지도 어느 자리가 받는지도 안 보였다.
          끌고 있다는 것만 알리면 되므로 그 일에 필요한 만큼만 남긴다. */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 30,
          pointerEvents: "none",
          background: "rgba(0,0,0,0.3)",
        }}
      />
      {/* ★잔상은 **커서 오른쪽 아래**에 작게 매단다 (사용자 지시 2026-08-19) —
          커서 한가운데에 쥐고 있으면 정작 가리키는 자리를 자기가 덮는다 */}
      <DragGhost
        x={pos.x}
        y={pos.y}
        tilt={0}
        z={60}
        style={{
          width: 54,
          height: 74,
          borderRadius: 10,
          overflow: "hidden",
          border: "1.5px solid rgba(255,255,255,0.7)",
          boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
          background: "var(--surface)",
        }}
      >
        {drag.img ? (
          // ★커서를 따라오는 그림은 작게 — 크면 뒤의 목적지를 가려 어디에 놓는지 안 보인다
          <img
            src={drag.img.url}
            alt=""
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        ) : (
          <>
            {/* ★덱 카드와 **같은 방식**으로 그린다 — 색 바탕 위에 카드 그림을 얹는다.
                예전엔 색 바탕만 그려서, 그림이 있는 카드를 끌어도 고스트는 단색이었다
                (사용자 지적 2026-08-03). 끌고 있는 것이 무엇인지 알 수 없었다. */}
            <div
              style={{
                height: "62%",
                position: "relative",
                overflow: "hidden",
                background: artBackground(drag.card!.color),
              }}
            >
              {(() => {
                // ★그림이 든 자리가 **드래그 방향마다 다르다** — 덱에서 꺼낼 때(apply)는
                //   카드가 들고 있고, 섹션 배너를 핸드로 저장할 때(save)는 `drag.thumb` 이다.
                //   앞쪽만 보면 배너를 끌 때 고스트가 단색이 된다 (사용자 지적으로 잡았다).
                const fv = normThumb(drag.thumb ?? drag.card!.thumb);
                return fv ? (
                  <FittedImg url={thumbUrl(useGen.getState().base, fv)} w={92} h={78} view={fv.face} />
                ) : null;
              })()}
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: "linear-gradient(180deg, transparent 50%, rgba(0,0,0,0.35))",
                }}
              />
            </div>
            <div
              style={{
                height: "38%",
                padding: "5px 7px",
                fontSize: "0.68rem",
                fontWeight: "var(--w-bold)",
                color: "var(--ink)",
                overflow: "hidden",
              }}
            >
              {drag.card!.name}
            </div>
          </>
        )}
      </DragGhost>
    </>
  );
}
