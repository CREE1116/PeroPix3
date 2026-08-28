import { useEffect, useRef, useState, type ReactNode } from "react";
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

/** 더블클릭으로 치는 간격 — 윈도우 기본값과 같은 500ms */
const DBL_MS = 500;

function ResizeHandles() {
  /** ★★**더블클릭을 여기서 직접 센다** (`onDoubleClick` 을 안 쓴다).
   *  첫 누름에서 이미 `startResizeDragging` 이 포인터를 가져가므로, 브라우저의 더블클릭
   *  판정이 그 뒤까지 이어진다는 보장이 없다. 누른 자리와 시각만 보면 어긋날 일이 없다. */
  const last = useRef({ dir: "", at: 0 });

  const grab = (dir: ResizeDir) => (e: React.MouseEvent) => {
    // 좌클릭만. 이벤트가 아래로 새면 창 이동과 겹친다.
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    /* ★★위·아래 테두리를 두 번 누르면 **세로로만 화면 끝까지** (`lib/window` 의 ★★주).
       좌우에는 윈도우도 같은 기능을 주지 않으므로 여기서도 없다.
       ★첫 누름은 평소대로 크기 조절을 시작한다 — 움직이지 않고 뗐으므로 크기는 그대로다.
         윈도우의 테두리 더블클릭도 같은 순서로 돈다. */
    const dbl = last.current.dir === dir && e.timeStamp - last.current.at < DBL_MS;
    last.current = { dir, at: dbl ? 0 : e.timeStamp };
    if (dbl && (dir === "North" || dir === "South")) {
      appWindow.fitVertical();
      return;
    }
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
