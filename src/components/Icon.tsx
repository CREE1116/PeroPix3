/** SVG 아이콘 — 이모지·기호 문자를 쓰지 않는다 (CLAUDE.md ★절).
 *  전부 currentColor 를 따르므로 주변 글자색을 상속한다. */

const s = (d: React.ReactNode, size = 16, extra?: React.SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...extra}
  >
    {d}
  </svg>
);

/** 채워진 아이콘 (별표처럼 켜짐/꺼짐이 있는 것) */
const f = (d: React.ReactNode, size = 16) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" stroke="none">
    {d}
  </svg>
);

const STAR_D = "M12 3.6l2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8z";

export const Icon = {
  /** 잠금 — 슬롯을 생성에서 뺀다 */
  /** 잠금 — **v2 와 같은 모양**(`ICONS.lock`) */
  lock: s(
    <>
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </>,
  ),
  /** 잠금 해제 — 고리가 열려 있다 */
  /** 잠금 해제 — **v2 와 같은 모양**(`ICONS.unlock`) */
  unlock: s(
    <>
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 9.9-1" />
    </>,
  ),
  /** 복사 — 겹친 종이 두 장 (`복제`와 달리 **글자를 클립보드로**) */
  /** 복사 — **v2 와 같은 모양**(`ICONS.clipboard`) */
  copy: s(
    <>
      <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    </>,
    13,
  ),
  /** 복제 */
  duplicate: s(
    <>
      <rect x="3" y="7" width="12" height="14" rx="2" />
      <path d="M10 7V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" />
    </>,
  ),
  plus: s(<path d="M12 5v14M5 12h14" />),
  /** 태그를 그 자리에서 고칠 수 있다는 표시 (목차 행) */
  /** 편집(연필) — **v2 와 같은 모양**(`ICONS.pencil`) */
  pencil: s(
    <>
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </>,
    12,
  ),
  check: s(<path d="M4.5 12.5 9 17l10.5-10" />, 11),
  star: s(<path d={STAR_D} />),
  starOn: f(<path d={STAR_D} />),
  /** 작게 얹는 자리용 (글자 옆 배지·버튼 안) */
  star12: s(<path d={STAR_D} />, 12),
  star12On: f(<path d={STAR_D} />, 12),
  /** ★**썸네일 위에 얹는 자리** — 12px 은 그림 위에서 너무 작아 눈에 안 들어온다
   *  (사용자 지시 2026-08-18). 크기가 다른 자리는 크기별 항목을 따로 둔다 (CLAUDE.md). */
  star18: s(<path d={STAR_D} />, 18),
  star18On: f(<path d={STAR_D} />, 18),
  close12: s(<path d="M6 6l12 12M18 6L6 18" />, 12),
  /** 갤러리(보관함) — **v2 의 갤러리 모드 아이콘**이다 (`ICONS.images`).
   *  ★v2 에서 「갤러리에 저장」은 별표였지만, 우리는 별표가 **거르는 장치**로 따로 있어
   *    같은 모양을 못 쓴다 (사용자 지적 2026-08-19: 보관이 블록 저장소와 같아 보였다). */
  images: s(
    <>
      <path d="M18 22H4a2 2 0 0 1-2-2V6" />
      <path d="m22 13-1.3-1.3a2.41 2.41 0 0 0-3.41 0L11 18" />
      <circle cx="12" cy="8" r="2" />
      <rect width="16" height="16" x="6" y="2" rx="2" />
    </>,
    14,
  ),
  /** 와일드카드 — **v2 와 같은 모양**(`ICONS.cards`). 주사위는 시드 뽑기가 쓴다 */
  cards: s(
    <>
      <rect width="14" height="19" x="5" y="2.5" rx="2" />
      <path d="M12 8.5v7" />
      <path d="m9 13.5 6-3" />
      <path d="m9 10.5 6 3" />
    </>,
    14,
  ),
  /** 블록 저장소 — 갈피(북마크). v2 도 「프롬프트 프리셋」에 같은 모양을 쓴다 */
  bookmark: s(<path d="M6 4h12v16l-6-4.5L6 20z" />, 13),
  /** 생성 — 예전엔 ✦ 글자를 썼다 */
  spark12: s(<path d="M12 3l2.1 5.6L20 11l-5.9 2.4L12 19l-2.1-5.6L4 11l5.9-2.4z" />, 11),
  /** 주사위 — 시드를 그 자리에서 새로 뽑는다.
   *  ★눈이 **다섯**이다 (사용자 지적 2026-08-19: 네 귀퉁이만 찍으면 주사위로 안 읽힌다). */
  dice: s(
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3.5" />
      <circle cx="8.5" cy="8.5" r="1.35" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="8.5" r="1.35" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.35" fill="currentColor" stroke="none" />
      <circle cx="8.5" cy="15.5" r="1.35" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="15.5" r="1.35" fill="currentColor" stroke="none" />
    </>,
  ),
  /** 켜짐 — 블록의 `◉`. ★이 모양을 **잠금에도 같이 쓴다** (사용자 지시 2026-08-16) */
  dotOn: s(
    <>
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="3.4" fill="currentColor" stroke="none" />
    </>,
  ),
  /** 꺼짐 — 블록의 `○` */
  dotOff: s(<circle cx="12" cy="12" r="7" />),
  /** 강화 — **v2 와 같은 모양**(`ICONS.sparkles`) */
  spark: s(
    <path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0L14.06 8.5A2 2 0 0 0 15.5 9.94l6.14 1.58a.5.5 0 0 1 0 .96L15.5 14.06a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z" />,
  ),
  /** 폴더 — 파일 관리의 트리 */
  /** 폴더 — **v2 와 같은 모양**(`ICONS.folder`) */
  folder: s(<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />, 14),
  /** 열린 폴더 — **v2 와 같은 모양**(`ICONS.folderOpen`) */
  folderOpen: s(
    <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />,
    14,
  ),
  /** 순서 바꾸기 손잡이 — ★앱은 여기에 `⠿` **글자**를 쓰고 있었다. 「아이콘은 언제나 SVG」
   *  (CLAUDE.md) 에 어긋나므로 SVG 로 옮긴다. 보이는 것은 같다. */
  grip: f(
    <>
      <circle cx="9" cy="6" r="1.3" />
      <circle cx="15" cy="6" r="1.3" />
      <circle cx="9" cy="12" r="1.3" />
      <circle cx="15" cy="12" r="1.3" />
      <circle cx="9" cy="18" r="1.3" />
      <circle cx="15" cy="18" r="1.3" />
    </>,
    13,
  ),
  /** 썸네일 격자 보기 — 파일 관리의 보기 전환 */
  /** 썸네일 격자 보기 — **v2 와 같은 모양**(`ICONS.grid`) */
  grid: s(
    <>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M3 9h18" />
      <path d="M3 15h18" />
      <path d="M9 3v18" />
      <path d="M15 3v18" />
    </>,
    14,
  ),
  /** 목록 보기 — 이름·크기·수정일 */
  list: s(
    <>
      <path d="M4 6.5h16M4 12h16M4 17.5h16" />
    </>,
    14,
  ),
  /** 더 보기(⋮) — 폴더 행의 작은 메뉴. v2 는 `⋮` **글자**를 썼다 */
  dots: f(
    <>
      <circle cx="12" cy="5.5" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="12" cy="18.5" r="1.5" />
    </>,
    14,
  ),
  /** 바깥 주소로 나간다 — 기본 브라우저가 연다 */
  external: s(
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4l-8.5 8.5" />
      <path d="M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" />
    </>,
    13,
  ),
  chevronUp: s(<path d="M6 15l6-6 6 6" />),
  chevronDown: s(<path d="M6 9l6 6 6-6" />),
  /** 카테고리 이름 줄용 — 15px 글줄 옆에 서므로 아이콘은 한 치수 작다 */
  chevronDown14: s(<path d="M6 9l6 6 6-6" />, 14),
  chevronRight: s(<path d="M9 6l6 6-6 6" />),
  chevronLeft: s(<path d="M15 6l-6 6 6 6" />),
  /** 접기/펼치기 전체 */
  collapseAll: s(<><path d="M7 9l5-5 5 5" /><path d="M7 15l5 5 5-5" /></>),
  minimize: s(<path d="M5 12h14" />),
  maximize: s(<rect x="5" y="5" width="14" height="14" rx="1.5" />),
  restore: s(
    <>
      <rect x="4" y="8" width="12" height="12" rx="1.5" />
      <path d="M8 8V5.5A1.5 1.5 0 0 1 9.5 4h9A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H16" />
    </>,
  ),
  close: s(
    <>
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </>,
  ),
  chevL: s(<path d="M15 5l-7 7 7 7" />),
  chevR: s(<path d="M9 5l7 7-7 7" />),
  sun: s(
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>,
  ),
  moon: s(<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.6 6.6 0 0 0 10.5 10.5z" />),
  /** 마스크 브러시 */
  /** 마스크 브러시 — **v2 와 같은 모양**(`ICONS.brush`) */
  brush: s(
    <>
      <path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08" />
      <path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z" />
    </>,
  ),
  /** 지우개 — 마스크를 도로 검게 */
  /** 지우개 — **v2 와 같은 모양**(`ICONS.eraser`) */
  eraser: s(
    <>
      <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
      <path d="M22 21H7" />
      <path d="m5 11 9 9" />
    </>,
  ),
  /** 휴지통 — **v2 와 같은 모양**(`ICONS.trash`) */
  trash: s(
    <>
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M10 11v6M14 11v6" />
    </>,
  ),
  /** 작은 새로고침 — 생성 푸터의 Anlas 잔액 줄처럼 12px 글자 옆에 서는 자리 */
  refresh12: s(
    <>
      <path d="M20 5v5h-5" />
      <path d="M19.4 13a7.6 7.6 0 1 1-1.7-6.4L20 10" />
    </>,
    12,
  ),
  /** 도움말 — 라벨 옆의 `?` (`components/Tip` 의 `Help`). ★글자 「?」가 아니라 SVG 다 */
  help: s(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.7 9.3a2.4 2.4 0 1 1 3.2 2.3c-.7.3-1 .9-1 1.6v.3" />
      <circle cx="11.9" cy="16.8" r="1" fill="currentColor" stroke="none" />
    </>,
    14,
  ),
  /** 되돌리기 — 왼쪽으로 굽은 화살표 (마스크 편집의 Ctrl+Z) */
  undo: s(
    <>
      <path d="M4 9h11a5 5 0 0 1 0 10h-6" />
      <path d="M8 5L4 9l4 4" />
    </>,
    14,
  ),
  /** 반전·되돌리기 */
  refresh: s(
    <>
      <path d="M20 5v5h-5" />
      <path d="M19.4 13a7.6 7.6 0 1 1-1.7-6.4L20 10" />
    </>,
  ),
  /** 찾기 — 검열의 「전체 검열」처럼 훑는 일 */
  search: s(
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.4 15.4 20 20" />
    </>,
  ),
  /** 저장 (디스켓) */
  /** 저장 — **v2 와 같은 모양**(`ICONS.save`) */
  save: s(
    <>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </>,
  ),
  /** 새 폴더 */
  /** 새 폴더 — **v2 와 같은 모양**(`ICONS.folderPlus`) */
  folderPlus: s(
    <>
      <path d="M12 10v6" />
      <path d="M9 13h6" />
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </>,
    14,
  ),
  /** 고르기 도구 — 화살표 커서 */
  cursor: s(<path d="M5 3l7.5 17 2.2-6.8L21.5 11z" />),
  settings: s(
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
    </>,
  ),
};
