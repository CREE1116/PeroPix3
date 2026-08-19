import { useState, type ReactNode, type PointerEvent } from "react";
import { Icon } from "../components/Icon";
import { dragSourceStyle } from "../cards/dragStore";
import { FittedImg } from "../cards/FittedImg";
import { BANNER_BG, BANNER_CUT, BANNER_IMG_W, BANNER_STEP, bannerEmptyFill } from "../cards/banner";

/** 카드형 섹션 — **가로 배너가 곧 영역 구분선**이다 (목업 구조 그대로).
 *
 *  배너는 스타일·캐릭터 카드가 꽂히는 자리다. 카드의 그라데이션과 이름을 그대로 쓰며,
 *  실제 앱에서는 이 자리에 사용자의 생성물 썸네일이 들어간다.
 *  배너를 끌어 우하단 핸드에 넣으면 덱에 저장된다(역드래그) — 그래서 포인터 핸들러를 받는다. */
export function SectionCard({
  name,
  sub,
  gradient,
  accent,
  dim,
  outline,
  overlay,
  onRename,
  bannerActions,
  hoverLift,
  thumb,
  zone,
  folded,
  onFold,
  onBannerPointerDown,
  innerRef,
  children,
}: {
  name: string;
  sub: string;
  gradient: [string, string];
  /** 카드 종류 색 — 섹션 테두리에 옅게 반영된다 */
  accent?: string;
  /** 꺼진 섹션 — 컴파일에서 빠진다는 것을 흐림으로 보인다 */
  dim?: boolean;
  /** 드롭 강조: 1단계 = 점선(놓을 수 있다), 2단계 = 실선(지금 떼면 여기) */
  outline?: "none" | "dashed" | "solid";
  /** **카드 전체**를 덮는 겹침 층 (드롭 존). 배너가 아니라 섹션 높이 전부를 받는다 */
  overlay?: ReactNode;
  /** ★이름을 **카드 안에서** 고친다 (사용자 지시 2026-08-19) — 시스템 `prompt()` 창을 쓰지
   *  않는다. 주면 이름을 두 번 눌러 그 자리에서 고칠 수 있고, 배너에 연필 단추가 선다. */
  onRename?: (v: string) => void;
  /** 배너 우측 버튼 (켜기·삭제 등) */
  bannerActions?: ReactNode;
  /** 배너를 끌 수 있음을 알리는 살짝 떠오름 */
  hoverLift?: boolean;
  /** 배너에 꽂아 둔 생성물 (없으면 그라데이션) */
  thumb?: { url: string; zoom: number; px: number; py: number } | null;
  /** 드롭 존 이름 — 핸드·캔버스와 같은 `data-zone` 규약이다. 조작 테스트가 잡는 지점이기도 하다 */
  zone?: string;
  /** 접힌 카드 — 배너만 남고 본문(탭·블록)이 빠진다. 카드가 여럿일 때 목록처럼 훑기 위한 것 */
  folded?: boolean;
  onFold?: () => void;
  onBannerPointerDown?: (e: PointerEvent) => void;
  innerRef?: (el: HTMLDivElement | null) => void;
  children: ReactNode;
}) {
  const [hover, setHover] = useState(false);
  /** 이름을 그 자리에서 고치는 중 — `null` 이면 아니다 */
  const [editing, setEditing] = useState<string | null>(null);
  const lifted = outline && outline !== "none";
  return (
    <div
      ref={innerRef}
      data-zone={zone}
      style={{
        position: "relative",
        marginBottom: "var(--sp-5)",
        border: `1px solid ${accent ? `color-mix(in srgb, ${accent} 45%, var(--line))` : "var(--line)"}`,
        borderRadius: "var(--r-4)",
        background: "var(--surface)",
        overflow: "hidden",
        opacity: dim ? 0.45 : 1,
        ...(lifted
          ? {
              zIndex: 31,
              outline: `3px ${outline} #fff`,
              outlineOffset: 2,
              boxShadow: "0 0 0 8px rgba(0,0,0,0.78)",
              filter: outline === "solid" ? "brightness(1.15)" : undefined,
            }
          : {}),
      }}
    >
      {/* 배너 */}
      <div
        onPointerDown={onBannerPointerDown}
        // ★역드래그가 없는 카드는 평범한 클릭으로 접는다 (있으면 `onTap` 이 받는다)
        onClick={onBannerPointerDown ? undefined : onFold}
        onMouseEnter={() => hoverLift && setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          position: "relative",
          height: 56,
          cursor: onBannerPointerDown ? "grab" : onFold ? "pointer" : "default",
          // ★살짝 떠오르게 해서 "끌 수 있다"를 알린다. 크게 움직이면 목록이 출렁인다
          transform: hover ? "translateY(-2px)" : undefined,
          boxShadow: hover ? "0 4px 12px rgba(0,0,0,0.28)" : undefined,
          transition: "transform 0.14s ease, box-shadow 0.14s ease",
          overflow: "hidden",
          // ★바탕은 **언제나 같은 단색**이다. 그림 자리 오른쪽은 이 색이 끝까지 이어지므로
          //   패널을 넓혀도 그림이 늘어나지 않고 단색만 늘어난다.
          background: BANNER_BG,
          ...(onBannerPointerDown ? dragSourceStyle : null),
        }}
      >
        {/* 그림 자리 — ★폭 240px 고정 (목업 .bimg). 패널을 넓혀도 여기는 안 늘어난다.
            ★**빈 상태에도 이 상자를 그린다** — 그림만 빠진 같은 실루엣이어야 두 상태가
              이어져 보인다 (사용자 지적 2026-08-03: 빈 배너가 전혀 다른 그림이었다). */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: BANNER_IMG_W,
            overflow: "hidden",
            pointerEvents: "none",
            // ★계단 컷 (design/banner-variants.html 의 G 안). 감쇠로 녹이지 않고 **잘라낸다** —
            //   감쇠는 끝점에서 기울기가 끊겨 선으로 보였다(실측). 자른 자리는 그 자체가
            //   의도된 모서리라 그 문제가 없고, 오른쪽은 순수 단색이 이어진다.
            maskImage: BANNER_CUT,
            WebkitMaskImage: BANNER_CUT,
            // 그림이 없으면 같은 실루엣에 카드 색만 — 종류를 알리는 자리이기도 하다
            background: thumb ? undefined : bannerEmptyFill(gradient),
          }}
        >
          {thumb && <FittedImg url={thumb.url} w={BANNER_IMG_W} h={56} view={thumb} />}
          {/* 중간 단 — 잘리기 전 구간을 한 번 어둡게 눕혀 계단을 만든다 */}
          <div style={{ position: "absolute", inset: 0, background: BANNER_STEP }} />
        </div>
        {/* 하단 스크림 — 일러스트가 화려해도 텍스트가 읽히게 */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            background: "linear-gradient(180deg, rgba(0,0,0,0) 30%, rgba(0,0,0,0.58) 100%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 11,
            bottom: 6,
            zIndex: 1,
            display: "flex",
            alignItems: "baseline",
            gap: "var(--sp-3)",
            color: "#fff",
            textShadow: "0 1px 5px rgba(0,0,0,0.55)",
          }}
        >
          {editing !== null ? (
            <input
              autoFocus
              data-card-rename
              value={editing}
              onChange={(e) => setEditing(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onBlur={() => {
                if (editing.trim()) onRename?.(editing.trim());
                setEditing(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") setEditing(null);
              }}
              style={{
                width: 130,
                background: "rgba(0,0,0,0.45)",
                border: "1px solid rgba(255,255,255,0.5)",
                borderRadius: "var(--r-1)",
                padding: "0 4px",
                color: "#fff",
                fontSize: "0.86rem",
                fontWeight: "var(--w-bold)",
              }}
            />
          ) : (
            <b
              onDoubleClick={onRename && ((e) => { e.stopPropagation(); setEditing(name); })}
              style={{ fontSize: "0.86rem", fontWeight: "var(--w-bold)", cursor: onRename ? "text" : undefined }}
            >
              {name}
            </b>
          )}
          <span
            style={{
              fontSize: "0.6rem",
              fontWeight: "var(--w-medium)",
              opacity: 0.85,
              letterSpacing: "0.08em",
            }}
          >
            {sub}
          </span>
        </div>
        {(bannerActions || onRename) && (
          <div
            style={{
              position: "absolute",
              right: 8,
              bottom: 6,
              zIndex: 2,
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            {bannerActions}
            {/* ★이름 고치기는 **카드가 스스로** 단다 — 섹션마다 따로 만들면 어디는 있고
                어디는 없는 상태가 된다 (스타일 카드에는 아예 없었다) */}
            {onRename && (
              <button
                data-card-rename-btn
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  setEditing(name);
                }}
                style={{
                  display: "grid",
                  placeItems: "center",
                  width: 20,
                  height: 20,
                  borderRadius: 5,
                  background: "rgba(0,0,0,0.4)",
                  color: "#fff",
                }}
              >
                {Icon.pencil}
              </button>
            )}
          </div>
        )}
        {/* ★★접기에는 **아무 표시도 두지 않는다** (사용자 지시 2026-08-16).
            머리를 누르면 접힌다. 화살표는 단추가 아니어도 단추처럼 보여서 뺐다 —
            접혔는지는 몸통이 있고 없고로 안다.
            ★클릭과 끌기는 `useDragSource` 가 가른다: 4px 문턱을 안 넘고 떼면 `onTap`,
              넘으면 덱으로 저장하는 역드래그다 (그쪽 주석). */}
      </div>

      {/* 내용 — 접으면 배너만 남는다 */}
      {!folded && (
        <div
          style={{
            padding: "var(--sp-2) 9px 9px",
            display: "flex",
            flexDirection: "column",
            gap: "var(--sp-2)",
          }}
        >
          {children}
        </div>
      )}

      {/* ★드롭 존은 배너가 아니라 **카드 전체**를 덮는다 — 위/아래 반씩 나눠 받으려면
          기준이 카드 높이여야 한다. 배너(56px) 안을 나누면 판정 영역이 손톱만 해진다 */}
      {overlay}
    </div>
  );
}
