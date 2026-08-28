import { useEffect } from "react";
import { useBusy } from "../store/busy";

/** 파일을 옮기는 동안 화면을 덮어 **조작을 막는다** (`store/busy` 의 ★★주).
 *
 *  ★★**키보드까지 막는다.** 덮개는 마우스만 막는다 — 방향키로 씬을 넘기거나 Ctrl+Z 를 누르면
 *    그 사이에도 상태가 바뀐다. 잡는 자리는 **캡처 단계**라 아래 화면이 받기 전에 끊긴다.
 *  ★**맨 위에 선다** — 확인 창(`AskDialog`)·툴팁보다 위다. 잠긴 동안에는 그 위에 뜰 것이 없다.
 *  ★움직임을 줄이라는 설정이면 도는 대신 흐리게만 (`globals.css` 의 `.busy-spin`). */
export function BusyOverlay() {
  const label = useBusy((s) => s.label);

  useEffect(() => {
    if (!label) return;
    const eat = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", eat, true);
    return () => window.removeEventListener("keydown", eat, true);
  }, [label]);

  if (!label) return null;
  return (
    <div
      data-busy
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9500,
        display: "grid",
        placeItems: "center",
        gap: "var(--sp-4)",
        background: "rgba(0,0,0,0.45)",
        // ★기본값이 `auto` 지만 **적어 둔다** — 이 한 줄이 곧 「조작을 막는다」는 뜻이다
        pointerEvents: "auto",
        cursor: "progress",
        userSelect: "none",
      }}
    >
      <div style={{ display: "grid", placeItems: "center", gap: "var(--sp-4)" }}>
        <div
          className="busy-spin"
          style={{
            width: 34,
            height: 34,
            borderRadius: "50%",
            border: "3px solid rgba(255,255,255,0.25)",
            borderTopColor: "var(--accent)",
          }}
        />
        <div style={{ color: "#fff", fontSize: "var(--text-xs)", textShadow: "0 1px 3px rgba(0,0,0,0.8)" }}>
          {label}
        </div>
      </div>
    </div>
  );
}
