import { useToast } from "../store/toast";

/** 토스트 자리 — **오른쪽 아래**. 생성 푸터(왼쪽 아래)·모드바와 겹치지 않는 유일한 구석이다. */
export function Toasts() {
  const items = useToast((s) => s.items);
  if (!items.length) return null;
  return (
    <div
      data-toasts
      style={{
        position: "fixed",
        right: 16,
        bottom: 64,
        zIndex: 95,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: 6,
        pointerEvents: "none",
      }}
    >
      {items.map((x) => (
        <div
          key={x.id}
          data-toast={x.kind}
          style={{
            background: x.kind === "warn" ? "var(--err)" : "var(--panel)",
            color: x.kind === "warn" ? "#fff" : "var(--ink)",
            border: `1px solid ${x.kind === "warn" ? "var(--err)" : "var(--line)"}`,
            borderRadius: "var(--r-2)",
            boxShadow: "0 6px 18px rgba(0,0,0,0.28)",
            padding: "var(--sp-2) var(--sp-4)",
            fontSize: "var(--text-2xs)",
            maxWidth: 340,
          }}
        >
          {x.text}
        </div>
      ))}
    </div>
  );
}
