import type { CardKind } from "../store/cards";

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

/** 드롭 존 아이콘 — 존이 무엇을 하는지 **글자 대신 그림**으로 말한다 (사용자 요청).
 *  글자는 세 로케일로 길이가 제각각이라 좁은 존에서 줄바꿈이 나고, 훑을 때 읽어야 한다. */
export const zoneIcon = {
  /** 스택: 카드가 겹쳐 쌓인 모양 */
  stack: (size = 22) =>
    svg(
      <>
        <rect x="7" y="9.5" width="13" height="11" rx="2" />
        <path d="M5.5 16.5V7a2 2 0 0 1 2-2h9" />
        <path d="M4 13.5V4.5" opacity="0.55" />
      </>,
      size,
    ),
  /** 교체: 화살표 둘이 앞뒤로 도는 모양 */
  swap: (size = 22) =>
    svg(
      <>
        <path d="M4 9h13l-3-3" />
        <path d="M20 15H7l3 3" />
      </>,
      size,
    ),
  /** 추가 */
  add: (size = 22) => svg(<path d="M12 5v14M5 12h14" />, size),
};

/** 카드 일러스트 면 — 그라데이션 + 우상단 하이라이트.
 *  ★실제 앱에서는 이 자리에 사용자의 생성물 썸네일이 들어간다 (thumb). */
export const artBackground = (color: [string, string], thumb?: string | null) =>
  thumb
    ? `linear-gradient(180deg, transparent 55%, rgba(0,0,0,0.4)), url("${thumb}") center/cover`
    : `radial-gradient(90px 70px at 70% 30%, rgba(255,255,255,0.35), transparent 70%),` +
      ` linear-gradient(140deg, ${color[0]}, ${color[1]})`;
