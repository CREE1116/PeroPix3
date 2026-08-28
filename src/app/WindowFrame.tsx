import { useEffect, useRef, useState, type ReactNode } from "react";
import { appWindow, type ResizeDir } from "../lib/window";
import { logLine } from "../lib/report";

/** 창 가장자리 리사이즈 손잡이.
 *
 *  `decorations: false` 로 두면 OS 의 리사이즈 테두리가 사라지므로 직접 만든다.
 *  최대화 상태에서는 손잡이를 숨긴다 (그 상태에서 끌면 창이 어정쩡하게 복원된다). */
/** 가장자리 두께 — ★★**8px 이다** (사용자 지적 2026-08-28: 로그에 누름이 하나도 안 찍혔다).
 *  5px 은 너무 얇았다. 윈도우는 창 **바깥**에 보이지 않는 테두리를 한 겹 더 두어(`SM_CXSIZEFRAME`
 *  4 + `SM_CXPADDEDBORDER` 4) 실제 잡히는 폭이 8px 안팎인데, 우리는 `decorations:false`·
 *  `shadow:false` 라 그 바깥 겹이 아예 없다 — 창의 첫 픽셀 줄부터가 곧 화면이다.
 *  그래서 같은 8px 을 **안쪽에서** 낸다. 제목줄 단추의 윗머리를 조금 덮는데, 윈도우도 그렇다. */
const EDGE = 8;
const CORNER = 16; // 모서리 판정 크기

export function WindowFrame({ children }: { children: ReactNode }) {
  const [maxed, setMaxed] = useState(false);

  useEffect(() => {
    let un: (() => void) | undefined;
    let t: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      setMaxed(await appWindow.isMaximized());
      un = await appWindow.onResized(async () => {
        setMaxed(await appWindow.isMaximized());
        /* ★★**크기가 멎으면 그 자리를 적어 둔다** (`lib/window` 의 `noteHeight`).
           안 적어 두면 창이 이미 꽉 찬 높이일 때 더블클릭이 되돌릴 자리를 못 찾아
           **아무 일도 안 한다.** ★끄는 동안 수십 번 오므로 멎은 뒤에 한 번만 부른다. */
        clearTimeout(t);
        t = setTimeout(() => void appWindow.noteHeight(), 300);
      });
    })();
    return () => {
      clearTimeout(t);
      un?.();
    };
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
/** 이만큼 움직여야 「끄는 것」으로 본다 */
const DRAG_PX = 3;

function ResizeHandles() {
  /** ★★**더블클릭을 여기서 직접 센다** (`onDoubleClick` 을 안 쓴다).
   *  OS 크기 조절이 시작되면 포인터가 그쪽으로 넘어가, 브라우저의 더블클릭 판정이 그 뒤까지
   *  이어진다는 보장이 없다. 누른 자리와 시각만 보면 어긋날 일이 없다. */
  const last = useRef({ dir: "", at: 0 });

  /* ★진단 — 이 판이 화면에 올라와 있는지, 두 번째 누름이 오는지를 로그로 남긴다
     (사용자 지적 2026-08-28: QA 인스턴스에서는 되는데 사용자 창에서만 안 된다). */
  useEffect(() => {
    logLine("info", "창테두리", `손잡이 준비 (두께 ${EDGE}px)`);
    /* ★★**화면이 창의 어디부터인가** (사용자 지적 2026-08-28: 위쪽 절반이 죽어 있다).
       껍데기에 창틀 판정이 안 오고 화면에도 누름이 안 오는 구간이 있다 — 그 구간이
       **웹뷰 밖**인지를 재려면 창과 화면의 자리를 견주어야 한다. */
    logLine(
      "info",
      "창자리",
      `창 y=${window.screenY} 높이=${window.outerHeight} · 화면 높이=${window.innerHeight}` +
        ` · 배율=${window.devicePixelRatio}`,
    );
    /* ★맨 윗줄에 실제로 포인터가 오는가 — 오는 값 중 **가장 작은 y** 를 한 번 남긴다.
       테두리를 훑는 동안 4 아래가 한 번도 안 오면 그 픽셀은 화면의 것이 아니다. */
    let minY = 999;
    const seen = (e: PointerEvent) => {
      if (e.clientY >= minY || e.clientY > 12) return;
      minY = e.clientY;
      logLine("info", "창테두리", `포인터가 닿은 가장 위 = y=${Math.round(e.clientY)}`);
    };
    document.addEventListener("pointermove", seen, true);
    /* ★★창 위쪽을 눌렀는데 **손잡이가 아닌 것**이 받았으면 그것도 적는다.
       손잡이가 떠 있는데 누름이 한 번도 안 온다면 자리를 못 맞히고 있다는 뜻이라,
       **무엇이 대신 받았는지**를 알아야 두께를 얼마나 늘릴지가 정해진다. */
    const near = (e: MouseEvent) => {
      if (e.clientY > 28) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest("[data-resize-edge]")) return;
      /* ★★손잡이가 아닌 것이 받았으면 **무엇이 얼마만큼 덮고 있는지**까지 남긴다
         (사용자 지적 2026-08-28: *"커서가 바뀌는 구간이 100이면 아래 50%에서만 먹는다"*).
         창틀 판정(`WM_NCHITTEST`)이 껍데기에 한 번도 안 오는 것을 확인했으므로, 그 죽은
         구간은 **화면 안**에 있다. 무엇이 위에 깔려 있는지가 곧 답이다. */
      logLine(
        "info",
        "창테두리",
        `빗나감 y=${Math.round(e.clientY)} 대상=${el?.tagName ?? "?"}` +
          `${el?.getAttribute?.("data-resize-edge") ? "(손잡이?!)" : ""}` +
          ` 끌기영역=${!!el?.closest("[data-tauri-drag-region]")}` +
          ` 그자리것=${document.elementFromPoint(e.clientX, e.clientY)?.tagName ?? "?"}`,
      );
    };
    document.addEventListener("mousedown", near, true);
    return () => {
      document.removeEventListener("mousedown", near, true);
      document.removeEventListener("pointermove", seen, true);
    };
  }, []);

  const grab = (dir: ResizeDir) => (e: React.MouseEvent) => {
    // 좌클릭만. 이벤트가 아래로 새면 창 이동과 겹친다.
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    /* ★★위·아래 테두리를 두 번 누르면 **세로로만 화면 끝까지** (`lib/window` 의 ★★주).
       좌우에는 윈도우도 같은 기능을 주지 않으므로 여기서도 없다. */
    const now = performance.now();
    const dbl = last.current.dir === dir && now - last.current.at < DBL_MS;
    const dt = last.current.dir === dir ? Math.round(now - last.current.at) : -1;
    logLine("info", "창테두리", `${dir} 누름 y=${Math.round(e.clientY)} dt=${dt}ms dbl=${dbl}`);
    last.current = { dir, at: dbl ? 0 : now };
    if (dbl) {
      if (dir === "North" || dir === "South") appWindow.fitVertical();
      return;
    }

    /* ★★★**누르는 것만으로는 크기 조절을 시작하지 않는다 — 움직여야 시작한다**
       (사용자 지적 2026-08-28: *"엄청 많이 시도했는데 중간에 딱 한 번 되고 그 외에는 다 안 됨"*).
       앞 판은 첫 누름에서 곧장 `startResizeDragging` 을 불렀다. 그러면 **OS 가 크기 조절
       모드로 들어가 마우스를 통째로 가져가서**, 두 번째 누름이 우리에게 오지 않거나 뗀
       자취가 끊긴다. 그래서 더블클릭이 열 번에 한 번쯤만 잡혔다.
       문턱을 두면 **두 번 누르는 동안에는 OS 모드에 아예 안 들어가므로** 두 누름이 다
       우리에게 온다. 끌기는 3px 만 움직이면 그때부터 평소와 같다 — OS 는 크기 조절을
       시작할 때 그 변을 커서에 맞추므로, 3px 늦게 시작해도 눈에 띄는 차이가 없다. */
    const x0 = e.clientX;
    const y0 = e.clientY;
    const stop = () => {
      document.removeEventListener("mousemove", move, true);
      document.removeEventListener("mouseup", stop, true);
    };
    function move(m: MouseEvent) {
      if (Math.abs(m.clientX - x0) < DRAG_PX && Math.abs(m.clientY - y0) < DRAG_PX) return;
      stop();
      void (async () => {
        // ★세로로 늘려 둔 창을 손으로 다시 조절하면 **반대쪽 변이 원래 자리로** 돌아간다
        if (dir === "North" || dir === "South") await appWindow.unfitFor(dir);
        appWindow.startResize(dir);
      })();
    }
    document.addEventListener("mousemove", move, true);
    document.addEventListener("mouseup", stop, true);
  };

  const base: React.CSSProperties = { position: "absolute", zIndex: 999 };

  return (
    <>
      {/* 변 */}
      <div
        onMouseDown={grab("North")}
        data-resize-edge="North"
        style={{ ...base, top: 0, left: CORNER, right: CORNER, height: EDGE, cursor: "ns-resize" }}
      />
      <div
        onMouseDown={grab("South")}
        data-resize-edge="South"
        style={{ ...base, bottom: 0, left: CORNER, right: CORNER, height: EDGE, cursor: "ns-resize" }}
      />
      <div
        onMouseDown={grab("West")}
        data-resize-edge="West"
        style={{ ...base, left: 0, top: CORNER, bottom: CORNER, width: EDGE, cursor: "ew-resize" }}
      />
      <div
        onMouseDown={grab("East")}
        data-resize-edge="East"
        style={{ ...base, right: 0, top: CORNER, bottom: CORNER, width: EDGE, cursor: "ew-resize" }}
      />
      {/* 모서리 */}
      <div
        onMouseDown={grab("NorthWest")}
        data-resize-edge="NorthWest"
        style={{ ...base, top: 0, left: 0, width: CORNER, height: CORNER, cursor: "nwse-resize" }}
      />
      <div
        onMouseDown={grab("NorthEast")}
        data-resize-edge="NorthEast"
        style={{ ...base, top: 0, right: 0, width: CORNER, height: CORNER, cursor: "nesw-resize" }}
      />
      <div
        onMouseDown={grab("SouthWest")}
        data-resize-edge="SouthWest"
        style={{ ...base, bottom: 0, left: 0, width: CORNER, height: CORNER, cursor: "nesw-resize" }}
      />
      <div
        onMouseDown={grab("SouthEast")}
        data-resize-edge="SouthEast"
        style={{ ...base, bottom: 0, right: 0, width: CORNER, height: CORNER, cursor: "nwse-resize" }}
      />
    </>
  );
}
