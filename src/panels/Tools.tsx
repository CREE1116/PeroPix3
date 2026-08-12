import { useState } from "react";
import { useI18n } from "../i18n";
import { ExifTool } from "./tools/ExifTool";
import { ConvertTool } from "./tools/ConvertTool";
import { FileManager } from "./tools/FileManager";

/** 보조 도구 — **셋은 서로 다른 일**이다 (사용자 지적 2026-08-05).
 *
 *      EXIF 리더   남의 그림이 어떻게 만들어졌나   읽기만
 *      이름 변환   형식·이름을 바꿔 새 파일로      원본은 그대로
 *      파일 관리   아웃풋 폴더 트리를 그대로       옮기고 지우고
 *
 *  ★앞의 둘은 **밖에서 떨군 그림**을 받는다 — 워크스페이스 안일 필요가 없다.
 *  ★파일 관리를 앞의 둘에 섞지 않는다. 한 번 합쳐 봤더니 "지금 어느 파일을 손보는지"가
 *    사라졌다. 넘기는 길은 한 방향뿐이다 — 파일 관리에서 고른 것을 **이름 변환으로 보낸다.**
 */
const TABS = [
  { id: "exif", key: "tools.exif" },
  { id: "convert", key: "tools.rename" },
  { id: "files", key: "tools.files" },
] as const;

export function Tools() {
  const t = useI18n((s) => s.t);
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("exif");

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

      {tab === "exif" && <ExifTool />}
      {tab === "convert" && <ConvertTool />}
      {tab === "files" && <FileManager onConvert={() => setTab("convert")} />}
    </div>
  );
}
