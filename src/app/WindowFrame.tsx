import { useEffect, useState, type ReactNode } from "react";
import { appWindow, type ResizeDir } from "../lib/window";

/** 창 가장자리 리사이즈 손잡이.
 *
 *  `decorations: false` 로 두면 OS 의 리사이즈 테두리가 사라지므로 직접 만든다.
 *  최대화 상태에서는 손잡이를 숨긴다 (그 상태에서 끌면 창이 어정쩡하게 복원된다). */
const EDGE = 5; // 가장자리 두께
const CORNER = 12; // 모서리 판정 크기

export function WindowFrame({ children }: { children: ReactNode }) {
  const [maxed, setMaxed] = useState(false);

  useEffect(() => {
    let un: (() => void) | undefined;
    (async () => {
      setMaxed(await appWindow.isMaximized());
      un = await appWindow.onResized(async () => setMaxed(await appWindow.isMaximized()));
    })();
    return () => un?.();
  }, []);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>
      {children}
      {!maxed && <ResizeHandles />}
    </div>
  );
}

function ResizeHandles() {
  const grab = (dir: ResizeDir) => (e: React.MouseEvent) => {
    // 좌클릭만. 이벤트가 아래로 새면 창 이동과 겹친다.
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    appWindow.startResize(dir);
  };

  const base: React.CSSProperties = { position: "absolute", zIndex: 999 };

  return (
    <>
      {/* 변 */}
      <div
        onMouseDown={grab("North")}
        style={{ ...base, top: 0, left: CORNER, right: CORNER, height: EDGE, cursor: "ns-resize" }}
      />
      <div
        onMouseDown={grab("South")}
        style={{ ...base, bottom: 0, left: CORNER, right: CORNER, height: EDGE, cursor: "ns-resize" }}
      />
      <div
        onMouseDown={grab("West")}
        style={{ ...base, left: 0, top: CORNER, bottom: CORNER, width: EDGE, cursor: "ew-resize" }}
      />
      <div
        onMouseDown={grab("East")}
        style={{ ...base, right: 0, top: CORNER, bottom: CORNER, width: EDGE, cursor: "ew-resize" }}
      />
      {/* 모서리 */}
      <div
        onMouseDown={grab("NorthWest")}
        style={{ ...base, top: 0, left: 0, width: CORNER, height: CORNER, cursor: "nwse-resize" }}
      />
      <div
        onMouseDown={grab("NorthEast")}
        style={{ ...base, top: 0, right: 0, width: CORNER, height: CORNER, cursor: "nesw-resize" }}
      />
      <div
        onMouseDown={grab("SouthWest")}
        style={{ ...base, bottom: 0, left: 0, width: CORNER, height: CORNER, cursor: "nesw-resize" }}
      />
      <div
        onMouseDown={grab("SouthEast")}
        style={{ ...base, bottom: 0, right: 0, width: CORNER, height: CORNER, cursor: "nwse-resize" }}
      />
    </>
  );
}
