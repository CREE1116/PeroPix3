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
  lock: s(
    <>
      <rect x="4.5" y="10.5" width="15" height="9.5" rx="2" />
      <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
    </>,
  ),
  /** 잠금 해제 — 고리가 열려 있다 */
  unlock: s(
    <>
      <rect x="4.5" y="10.5" width="15" height="9.5" rx="2" />
      <path d="M8 10.5V7a4 4 0 0 1 7.5-1.9" />
    </>,
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
  pencil: s(<path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8.5 17.5 4 19l1.5-4.5z" />, 12),
  check: s(<path d="M4.5 12.5 9 17l10.5-10" />, 11),
  star: s(<path d={STAR_D} />),
  starOn: f(<path d={STAR_D} />),
  /** 작게 얹는 자리용 (썸네일 배지·탭 닫기) */
  star12: s(<path d={STAR_D} />, 12),
  star12On: f(<path d={STAR_D} />, 12),
  close12: s(<path d="M6 6l12 12M18 6L6 18" />, 12),
  /** 블록 저장소 — 갈피(북마크). 저장소 열기 단추와 「저장소에 넣기」가 같은 모양을 쓴다 */
  bookmark: s(<path d="M6 4h12v16l-6-4.5L6 20z" />, 13),
  /** 생성 — 예전엔 ✦ 글자를 썼다 */
  spark12: s(<path d="M12 3l2.1 5.6L20 11l-5.9 2.4L12 19l-2.1-5.6L4 11l5.9-2.4z" />, 11),
  spark: s(
    <>
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
      <path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
    </>,
  ),
  /** 폴더 — 파일 관리의 트리 */
  folder: s(<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />, 14),
  folderOpen: s(
    <>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V10" />
      <path d="M3 10h18l-2.2 8.4a2 2 0 0 1-1.9 1.6H5.4a2 2 0 0 1-2-1.7z" />
    </>,
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
  chevronUp: s(<path d="M6 15l6-6 6 6" />),
  chevronDown: s(<path d="M6 9l6 6 6-6" />),
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
  brush: s(
    <>
      <path d="M9.5 14.5 19 5a2.1 2.1 0 0 0-3-3l-9.5 9.5" />
      <path d="M6.5 11.5c-1.6.6-2.5 2-2.5 4 0 1.2-.4 2-1 2.6 1 .6 2.2.9 3.5.9 2.6 0 4.5-1.6 4.5-3.9 0-1.7-1.1-3-2.9-3.4z" />
    </>,
  ),
  /** 지우개 — 마스크를 도로 검게 */
  eraser: s(
    <>
      <path d="M8 20H5l-2-2a1.6 1.6 0 0 1 0-2.3L13.4 5.3a1.6 1.6 0 0 1 2.3 0l4 4a1.6 1.6 0 0 1 0 2.3L11.4 20z" />
      <path d="M9 12.5 15.5 19" />
    </>,
  ),
  trash: s(
    <>
      <path d="M4 7h16M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7" />
      <path d="M6.5 7l.8 12a1.6 1.6 0 0 0 1.6 1.5h6.2a1.6 1.6 0 0 0 1.6-1.5l.8-12" />
    </>,
  ),
  /** 반전·되돌리기 */
  refresh: s(
    <>
      <path d="M20 5v5h-5" />
      <path d="M19.4 13a7.6 7.6 0 1 1-1.7-6.4L20 10" />
    </>,
  ),
  settings: s(
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
    </>,
  ),
};
