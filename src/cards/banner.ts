/** 배너(카드 그림 자리)의 생김새 — **한 곳에서만 정한다.**
 *
 *  같은 모양이 세 곳에 나온다: 섹션 배너(`SectionCard`) · 위치 잡는 창의 미리보기
 *  (`ThumbDialog`) · 드래그 고스트(`DragLayer`). 값을 나눠 두면 **미리보기에서 잡은 위치와
 *  실물이 달라진다** — 실제로 그렇게 어긋나 있었다 (사용자 지적 2026-08-03).
 *
 *  ★**감쇠(gradient)로 녹이지 않고 잘라낸다.** 감쇠는 끝점에서 기울기가 갑자기 0이 되어
 *    꺾임이 선으로 보였다 (실측: 마지막 3px 가 -8,-5,-11 로 떨어지다 정지). 자른 자리는
 *    그 자체가 의도된 모서리라 그 문제가 없다. 후보 비교는 `design/banner-variants.html` 의 G 안.
 *
 *  ★그림 자리 오른쪽은 `BANNER_BG` 가 **끝까지 이어진다.** 패널을 넓혀도 그림은 안 늘어나고
 *    단색만 늘어나야 하기 때문이다.
 */

/** 그림 자리 폭 (목업 `.bimg`). 패널을 넓혀도 고정이다. */
export const BANNER_IMG_W = 240;

/** 배너 바탕 — 그림 오른쪽으로 이어지는 단색 */
export const BANNER_BG = "#05070a";

/** 계단의 위치. 두 값이 곧 생김새다 — 여기만 바꾸면 세 곳이 함께 바뀐다. */
const CUT_A = "63%"; // 중간 단이 시작하는 곳
const CUT_B = "84%"; // 잘리는 곳
const ANGLE = "112deg";

/** 그림을 자르는 마스크 */
export const BANNER_CUT = `linear-gradient(${ANGLE}, #000 0 ${CUT_B}, transparent ${CUT_B})`;

/** 잘리기 전 구간을 한 번 어둡게 눕혀 '단'을 만든다 */
export const BANNER_STEP =
  `linear-gradient(${ANGLE}, transparent 0 ${CUT_A},` +
  ` rgba(5,7,10,0.55) ${CUT_A} ${CUT_B}, transparent ${CUT_B})`;

/** 그림이 없을 때 — 같은 실루엣에 카드 색만. 두 상태가 이어져 보이게 한다. */
export const bannerEmptyFill = (gradient: [string, string]) =>
  `linear-gradient(118deg, ${gradient[1]}59, ${gradient[0]}33 78%)`;
