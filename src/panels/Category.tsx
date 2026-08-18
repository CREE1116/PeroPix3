import { useState } from "react";

/** 왼쪽 기둥의 **카테고리** — 이름 한 줄과 그 아래 내용. 이름을 누르면 접힌다.
 *
 *  ★★**접는 방식은 기둥 전체에서 하나다** (사용자 지적 2026-08-16).
 *    위는 카드가 접히고 아래는 타이틀이 접히는 식으로 갈라져 있었다. 이제 층이 둘이다:
 *
 *      카테고리   이름 줄을 누르면 접힌다  ← 이 파일
 *      카드       배너를 누르면 접힌다     ← `blocks/SectionCard`
 *
 *    카테고리 안에 카드가 들어가는 것이라 서로 다투지 않는다.
 *  ★접기 단추·화살표를 두지 않는다 — 누르는 자리는 이름 줄 전체다.
 *
 *  ★묶는 단위는 **페로픽스 v2 의 절 그대로**다 (`index.html` 대조 2026-08-16):
 *    NAI Settings · Generation · Vibe / Character Ref · Base Image · Save Options.
 *    항목마다 접히게 두지 않는다 — 그러면 훑을 수가 없다.
 */

/** 접힘 상태 — 화면 것이라 스토어에 안 넣는다 (대화·워크스페이스와 함께 저장될 값이 아니다) */
const foldState: Record<string, boolean> = {};

export function Category({
  id,
  label,
  right,
  defaultFolded,
  children,
}: {
  /** 접힘을 기억하는 열쇠 */
  id: string;
  label: string;
  /** 이름 줄 오른쪽 — 그 카테고리에 딸린 창구 (예: 블록 저장소) */
  right?: React.ReactNode;
  defaultFolded?: boolean;
  children: React.ReactNode;
}) {
  const [folded, setFolded] = useState(foldState[id] ?? !!defaultFolded);
  const toggle = () => {
    foldState[id] = !folded;
    setFolded(!folded);
  };
  return (
    <div data-category={id} data-folded={folded ? "" : undefined} style={{ marginBottom: "var(--sp-5)" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-2)",
          padding: "0 var(--sp-1) var(--sp-2)",
          fontSize: "var(--text-2xs)",
          fontWeight: "var(--w-semi)",
          color: folded ? "var(--ink-faint)" : "var(--ink-dim)",
        }}
      >
        <span onClick={toggle} style={{ cursor: "pointer", flex: 1, minWidth: 0 }}>
          {label}
        </span>
        {right}
      </div>
      {!folded && children}
    </div>
  );
}
