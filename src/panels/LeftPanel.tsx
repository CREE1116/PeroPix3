import { PromptPanel } from "./PromptPanel";
import type { SectionProps } from "./PromptSections";

/** 좌 패널 — **프롬프트 전용**이다.
 *
 *  ★예전에는 여기서 `프롬프트 | 포즈세트` 를 번갈아 봤다 (2026-08-04). 그 토글을 걷어냈다
 *    (사용자 결정 2026-08-11): 씬의 프롬프트가 **씬 칸의 줄 머리 안**으로 갔기 때문이다.
 *    같은 씬이 두 곳에 있으면 이름·자물쇠가 겹치고 "어디서 고쳤나"가 되돌아온다.
 *  ★남은 것은 **탭 전체에 걸리는 것**뿐이다 — 베이스 프롬프트 · 캐릭터 프롬프트.
 */
export function LeftPanel({ onThumb }: SectionProps) {
  return <PromptPanel onThumb={onThumb} />;
}
