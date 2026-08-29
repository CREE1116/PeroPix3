import { create } from "zustand";
import { api } from "../lib/backend";

/** 번역 창 — 프롬프트 라벨 줄의 지구본을 누르면 **작은 떠 있는 창**이 열린다
 *  (사용자 지시 2026-08-29: *"번역모드 누르면 작은 모달 등장. 번역할 문구 입력하면 결과.
 *  한국어·일본어·영어. 닫지 않으면 계속 켜둘 수 있음. 생성 모드 페이지에서만 보임"*).
 *
 *  ★처음에는 v2 처럼 칩 호버·클릭 치환으로 옮겼다가 걷었다 (같은 날) — 칩 방식에서는
 *    그것이 오히려 불편했다. 이제 칩·툴팁·되돌리기는 번역을 모른다.
 *  ★창은 `App` 이 **생성 모드일 때만** 그린다 (`TranslatePanel`). 열림 상태는 여기 남으므로
 *    갤러리에 다녀와도 그대로 열려 있다. 저장하지 않는다 — 껐다 켜면 닫힌 채다.
 *  ★번역은 **사이드카**가 한다 (`backend/translate.py`) — Tauri 의 CSP 가 밖으로 나가는
 *    fetch 를 막는다. 캐시는 여기(메모리)와 사이드카 양쪽에 있다. */
export { LANGS, detectLang, resolveTarget, type Lang } from "../lib/translateLang";
import type { Lang } from "../lib/translateLang";

type S = {
  open: boolean;
  text: string;
  target: Lang;
  setOpen: (open: boolean) => void;
  setText: (text: string) => void;
  setTarget: (target: Lang) => void;
};

export const useTranslate = create<S>((set) => ({
  open: false,
  text: "",
  target: "en",
  setOpen: (open) => set({ open }),
  setText: (text) => set({ text }),
  setTarget: (target) => set({ target }),
}));

const cache = new Map<string, string>();

/** 글을 `target` 으로 번역한다. 원어는 서버가 알아본다(`auto`). 실패는 예외로 올린다. */
export async function translateText(text: string, target: Lang): Promise<string> {
  const key = `${text.trim()}|${target}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const r = await api<{ text: string }>("/api/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: text.trim(), sl: "auto", tl: target }),
  });
  cache.set(key, r.text);
  return r.text;
}
