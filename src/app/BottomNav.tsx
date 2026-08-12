import { useI18n } from "../i18n";
import { MODES, useUi } from "../store/ui";

/** 하단 네비 = v2.x 의 모드 전환 자리 (ui-guide.md 6절).
 *  모드마다 고유색이 있고, 활성 모드는 상단에 1.5px 색 선이 그어진다.
 *  ★모드 버튼은 **가운데**에 선다 (사용자 지시 2026-08-04) — 왼쪽 끝에 붙어 있으면
 *    좌 패널의 것처럼 보였다. 양옆은 같은 폭을 잡아 두어 가운데가 흔들리지 않는다.
 *  ★남은 Anlas 는 여기 없다 — 생성 푸터 하나로 모았다 (`GenerateFooter`). */
export function BottomNav({ right }: { right?: React.ReactNode }) {
  const t = useI18n((s) => s.t);
  const mode = useUi((s) => s.mode);
  const setMode = useUi((s) => s.setMode);

  return (
    <nav
      style={{
        height: 48,
        flexShrink: 0,
        display: "flex",
        alignItems: "stretch",
        background: "var(--bg)",
        borderTop: "1px solid var(--line)",
        padding: "0 var(--sp-3)",
      }}
    >
      {/* 왼쪽 저울추 — 오른쪽 상태 표시와 같은 자리를 비워 두어야 버튼 묶음이 정가운데에 선다 */}
      <span style={{ flex: 1 }} />
      {MODES.map((m) => {
        const on = m.id === mode;
        return (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              padding: "0 var(--sp-7)",
              fontSize: "var(--text-md)",
              fontWeight: on ? 600 : 400,
              color: on ? "var(--ink)" : "var(--ink-dim)",
              borderRight: "1px solid var(--line-soft)",
            }}
          >
            {t(`mode.${m.id}`)}
            {on && (
              <span
                style={{
                  position: "absolute",
                  top: -1,
                  left: 8,
                  right: 8,
                  height: 1.5,
                  background: m.color,
                  borderRadius: 1,
                }}
              />
            )}
          </button>
        );
      })}
      <span style={{ flex: 1, display: "flex", justifyContent: "flex-end", alignItems: "center" }}>
        {right}
      </span>
    </nav>
  );
}
