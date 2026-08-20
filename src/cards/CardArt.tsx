import type { CardKind } from "../store/cards";
import { BANNER_BG, bannerEmptyFill } from "./banner";

/** 카드 아이콘 — 탭·핸드·덱이 같은 것을 쓴다 (목업 ICONS 그대로). */
const svg = (d: React.ReactNode, size: number) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.45))" }}
  >
    {d}
  </svg>
);

export const cardIcon = (kind: CardKind, size = 20) =>
  ({
    styles: svg(
      <>
        <path d="M12 21a9 9 0 1 1 9-9c0 2-1.5 3-3 3h-2a2 2 0 0 0-2 2c0 1 .5 1.5.5 2.5S13.5 21 12 21z" />
        <circle cx="7.5" cy="10.5" r="1" />
        <circle cx="12" cy="7.5" r="1" />
        <circle cx="16.5" cy="10.5" r="1" />
      </>,
      size,
    ),
    characters: svg(
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c0-4 3.5-6.5 8-6.5s8 2.5 8 6.5" />
      </>,
      size,
    ),
    posesets: svg(
      <>
        <rect x="3.5" y="3.5" width="7" height="7" rx="1" />
        <rect x="13.5" y="3.5" width="7" height="7" rx="1" />
        <rect x="3.5" y="13.5" width="7" height="7" rx="1" />
        <rect x="13.5" y="13.5" width="7" height="7" rx="1" />
      </>,
      size,
    ),
  })[kind];

/** 드롭 존 아이콘.
 *  ★★글자 대신 그림만 쓰던 시절의 것이다 — 지금은 **놓으면 무슨 일이 일어나는지**를
 *    알약으로 적는다 (`cards/DropVeil`, 사용자 지시 2026-08-20). 남은 것은 「빈 자리」의
 *    `+` 하나뿐이고, 그 자리도 그 위에 오면 알약과 같은 문구를 함께 보여 준다. */
export const zoneIcon = {
  /** 추가 */
  add: (size = 22) => svg(<path d="M12 5v14M5 12h14" />, size),
};

/** 카드 일러스트 면 — **배너와 같은 칠**이다 (아래 ★주).
 *  ★실제 앱에서는 이 자리에 사용자의 생성물 썸네일이 들어간다 (thumb). */
export const artBackground = (color: [string, string], thumb?: string | null) =>
  thumb
    ? `linear-gradient(180deg, transparent 55%, rgba(0,0,0,0.4)), url("${thumb}") center/cover`
    /* ★★**배너와 같은 것을 쓴다** (사용자 지적 2026-08-20: *"헤더는 좌상단 끝이 밝은
       스타일임"* → *"커버가 훨씬 밝은거 같아"*). 각도·밝은 쪽·끊는 자리뿐 아니라
       **진하기까지** 같아야 한 식구로 보인다 — 배너의 칠은 어두운 바탕(`BANNER_BG`) 위에
       얹히는 **반투명**이라, 같은 색을 불투명으로 칠하면 커버만 훨씬 밝아진다.
       ★그래서 **어두운 바탕을 함께 깐다** — 부모가 무엇이든 배너와 같은 톤이 나온다
       (덱 카드·드래그 고스트가 같은 이 함수를 쓴다). */
    : `${bannerEmptyFill(color)}, ${BANNER_BG}`;
