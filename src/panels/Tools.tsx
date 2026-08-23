import { useUi } from "../store/ui";
import { useI18n } from "../i18n";
import { ExifTool } from "./tools/ExifTool";
import { FileManager } from "./tools/FileManager";
import { ConvertTool } from "./tools/ConvertTool";

/** 보조 도구 — **셋은 서로 다른 일**이다.
 *
 *      파일 관리   워크스페이스 폴더 트리를 그대로   옮기고 지우고
 *      일괄 변환   형식·이름을 한 번에 바꾼다        원본은 그대로
 *      EXIF 리더   남의 그림이 어떻게 만들어졌나     읽기만
 *
 *  ★★차례는 **자주 여는 것이 앞**이다 (사용자 지시 2026-08-23).
 *  ★★「일괄 변환」은 **다시 탭이다** (사용자 지시 2026-08-23). 잠깐 파일 관리 안의 패널로
 *    넣어 봤지만, 목록·트리·변환 설정이 한 화면에 셋이 되어 가로가 모자랐다.
 *    ★넘기는 길은 그대로다 — 파일 관리에서 고른 것을 **「일괄 이름 변환」으로 보낸다**
 *      (`useConvertQueue`). 보내면 이 탭으로 옮겨 온다.
 *  ★EXIF 리더는 **밖에서 떨군 그림**을 받는다 — 워크스페이스 안일 필요가 없다.
 */
const TABS = [
  { id: "files", key: "tools.files" },
  { id: "convert", key: "tools.rename" },
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

      {tab === "files" && <FileManager onConvert={() => setTab("convert")} />}
      {tab === "convert" && <ConvertTool />}
      {tab === "exif" && <ExifTool />}
    </div>
  );
}
