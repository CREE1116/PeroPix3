import { useUi } from "../store/ui";
import { useI18n } from "../i18n";
import { ExifTool } from "./tools/ExifTool";
import { FileManager } from "./tools/FileManager";

/** 보조 도구 — **둘은 서로 다른 일**이다.
 *
 *      파일 관리   워크스페이스 폴더 트리를 그대로   옮기고 지우고 **이름을 바꾼다**
 *      EXIF 리더   남의 그림이 어떻게 만들어졌나     읽기만
 *
 *  ★★**이름 변환은 탭이 아니다** (사용자 지시 2026-08-23). 파일 관리에서 고른 뒤
 *    「일괄 이름 변환」을 누르면 **그 자리에 패널로 열린다.** 예전에는 탭이 따로 있어
 *    고른 것을 옆 탭으로 보내고, 화면이 통째로 바뀌어 "무엇을 고른 것이었나"가 끊겼다.
 *  ★EXIF 리더는 **밖에서 떨군 그림**을 받는다 — 워크스페이스 안일 필요가 없다.
 */
/** ★차례는 **파일 관리 → EXIF 리더** (사용자 지시 2026-08-23). 자주 여는 것이 앞이다.
 *  ★「이름 변환」 탭은 없다 — **파일 관리 안**으로 들어갔다 (고른 것을 그 자리에서 바꾼다). */
const TABS = [
  { id: "files", key: "tools.files" },
  { id: "exif", key: "tools.exif" },
] as const;

export function Tools() {
  const t = useI18n((s) => s.t);
  /** 어느 도구를 보고 있나 — ★**저장되는 작업 상태**다 (`useUi.view.tab`) */
  type ToolId = (typeof TABS)[number]["id"];
  const tab = useUi((u) => (u.view.tab["tools"] as ToolId | undefined) ?? "files");
  const setTab = (k: ToolId) => useUi.getState().setView("tab", "tools", k as never);

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "var(--sp-4)", gap: "var(--sp-4)" }}>
      {/* 밑줄 탭 — 캔버스 상단과 같은 어법 (칩을 쓰지 않는다) */}
      <div style={{ display: "flex", gap: "var(--sp-5)", borderBottom: "1px solid var(--line)", flexShrink: 0 }}>
        {TABS.map((x) => {
          const on = tab === x.id;
          return (
            <button
              key={x.id}
              data-tool-tab={x.id}
              onClick={() => setTab(x.id)}
              style={{
                padding: "0 2px var(--sp-2)",
                marginBottom: -1,
                fontSize: "var(--text-sm)",
                fontWeight: on ? "var(--w-semi)" : "var(--w-norm)",
                color: on ? "var(--ink)" : "var(--ink-faint)",
                borderBottom: `2px solid ${on ? "var(--accent)" : "transparent"}`,
              }}
            >
              {t(x.key)}
            </button>
          );
        })}
      </div>

      {tab === "files" && <FileManager />}
      {tab === "exif" && <ExifTool />}
    </div>
  );
}
