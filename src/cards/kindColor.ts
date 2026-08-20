import type { CardKind } from "../store/cards";

/** 카드 배경색 — **종류마다 하나다** (사용자 결정 2026-08-20).
 *
 *  ★★예전에는 **이름을 해시해** 팔레트에서 골랐다. 그래서 같은 종류인데 카드마다 색이
 *    달랐고, 새 씬 세트는 이름이 늘 「새 세트」라 **언제나 같은 색**이 나오면서
 *    "왜 기본 씬 세트만 다른 색이지?" 가 됐다 (사용자 지적 2026-08-20).
 *  ★색은 **무엇인지**를 말하는 자리다 — 스타일인가 캐릭터인가 씬 세트인가.
 *    카드 하나하나를 가르는 것은 **사용자가 넣은 그림**이 한다
 *    (*"바꾸고싶으면 유저가 직접 다른 이미지를 넣으면 됨"*).
 *  ★이름을 고쳐도 색이 안 바뀐다 — 해시 시절에는 이름만 고쳐도 카드 색이 뒤집혔다. */
export const KIND_COLOR: Record<CardKind, [string, string]> = {
  styles: ["#b57a2a", "#d8a34f"],
  characters: ["#5b3d87", "#9b6dd6"],
  posesets: ["#14655e", "#2aa198"],
};

export const kindColor = (kind: CardKind): [string, string] => KIND_COLOR[kind];
