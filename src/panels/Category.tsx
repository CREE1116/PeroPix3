import { useEffect, useRef, useState } from "react";
import { flashStyle, useFlash } from "../store/ui";
import { Icon } from "../components/Icon";

/** 왼쪽 기둥의 **카테고리** — 이름 한 줄과 그 아래 내용. 이름을 누르면 접힌다.
 *
 *  ★★**접는 방식은 기둥 전체에서 하나다** (사용자 지적 2026-08-16).
 *    위는 카드가 접히고 아래는 타이틀이 접히는 식으로 갈라져 있었다. 이제 층이 둘이다:
 *
 *      카테고리   이름 줄을 누르면 접힌다  ← 이 파일
 *      카드       배너를 누르면 접힌다     ← `blocks/SectionCard`
 *
 *    카테고리 안에 카드가 들어가는 것이라 서로 다투지 않는다.
 *  ★★층이 눈에 보여야 한다 (사용자 지적 2026-08-19): 이름은 **그 안의 어느 글자보다 크고**
 *    진하고, 앞에 **접힘 화살표**가 선다. 예전에는 12px 흐린 글씨에 화살표도 없어서,
 *    묶는 이름이 아니라 딸린 옵션으로 읽혔고 접히는 줄인 줄도 몰랐다.
 *    ★화살표는 **표시**다 — 누르는 자리는 여전히 이름 줄 전체이고, 따로 단추를 두지 않는다.
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
  flashKey,
  children,
}: {
  /** 접힘을 기억하는 열쇠 */
  id: string;
  label: string;
  /** 이름 줄 오른쪽 — 그 카테고리에 딸린 창구 (예: 블록 저장소) */
  right?: React.ReactNode;
  defaultFolded?: boolean;
  /** ★★밖에서 값이 바뀌면 **펴고 강조한다** (사용자 지시 2026-08-19) — 「설정 불러오기」로
   *  옵션이 통째로 갈리는데 접혀 있으면 무엇이 바뀌었는지 알 수가 없다. */
  flashKey?: string;
  children: React.ReactNode;
}) {
  const [folded, setFolded] = useState(foldState[id] ?? !!defaultFolded);
  const flash = useFlash(flashKey ?? "");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!flash) return;
    if (folded) {
      foldState[id] = false;
      setFolded(false);
    }
    // ★★강조만으로는 못 본다 — **그 자리로 데려간다** (사용자 지적 2026-08-19: 카드가
    //   바뀌는데 아무 신호가 없었다). `nearest` 라 이미 보이면 화면이 안 흔들린다.
    box.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flash]);
  const toggle = () => {
    foldState[id] = !folded;
    setFolded(!folded);
  };
  return (
    <div
      ref={box}
      data-category={id}
      data-folded={folded ? "" : undefined}
      style={{ marginBottom: "var(--sp-5)", ...flashStyle(!!flashKey && flash) }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-2)",
          padding: "0 var(--sp-1) var(--sp-2)",
          /* ★★이름은 **그 안의 무엇보다도 커야 한다** (사용자 지적 2026-08-19).
             12px 였을 때 항목 라벨(13 semi)·카드 이름(13.8 bold)보다 작고 흐려서,
             묶는 이름이 아니라 **더 아래 딸린 옵션**으로 읽혔다. */
          fontSize: "var(--text-lg)",
          fontWeight: "var(--w-bold)",
          color: folded ? "var(--ink-dim)" : "var(--ink)",
        }}
      >
        {/* ★접힌다는 것이 **보여야 한다** (사용자 지적 2026-08-19). 예전에는 화살표를 두지
            않고 "누르는 자리는 이름 줄 전체"로만 뒀는데, 눌러 보기 전에는 접히는 줄인지
            알 길이 없었다. 화살표는 표시일 뿐이고 누르는 자리는 그대로 이름 줄이다. */}
        <span
          onClick={toggle}
          style={{
            cursor: "pointer",
            flex: 1,
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            gap: "var(--sp-2)",
          }}
        >
          <span
            style={{
              display: "grid",
              color: "var(--ink-faint)",
              transform: folded ? "rotate(-90deg)" : undefined,
              transition: "transform 120ms ease",
            }}
          >
            {Icon.chevronDown14}
          </span>
          {label}
        </span>
        {right}
      </div>
      {!folded && children}
    </div>
  );
}
