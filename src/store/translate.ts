import { create } from "zustand";
import { api } from "../lib/backend";

/** 번역 모드 — v2 의 「번역 모드」를 옮겼다 (사용자 지시 2026-08-29: *"v2 에 달려 있던
 *  간단 번역 기능"*). 단추는 `Icon.globe` 다 (v2 의 지구본 이모지 자리).
 *
 *  켜면 프롬프트 칩에 마우스를 올릴 때 번역이 툴팁으로 뜨고(`Chip`), 칩을 클릭하면 그 말로
 *  바뀐다(`BlockBody`). ★방향은 글이 정한다 — 한글이 있으면 ko→en, 없으면 en→ko (v2 의
 *  `containsKorean`). 그래서 한글로 친 칩도 클릭 한 번이면 영어 태그가 된다.
 *
 *  ★v2 처럼 **Esc 나 허공 클릭이면 꺼진다** — 켜 둔 채 잊으면 칩 클릭이 편집이 아니라
 *    치환이 되어 버리므로, 잠깐 켜서 쓰는 것으로 둔다. 저장하지 않는다.
 *  ★번역은 **사이드카**가 한다 (`backend/translate.py`) — Tauri 의 CSP 가 밖으로 나가는
 *    fetch 를 막는다. 캐시는 여기(메모리)와 사이드카 양쪽에 있다. */
type S = {
  on: boolean;
  set: (on: boolean) => void;
};

export const useTranslate = create<S>((set) => ({
  on: false,
  set: (on) => set({ on }),
}));

/** 화면 어디를 눌러도 꺼진다 — 단추·칩·툴팁은 빼고 (v2 와 같다) */
let hooked = false;
function hook() {
  if (hooked) return;
  hooked = true;
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && useTranslate.getState().on)
      useTranslate.getState().set(false);
  });
  document.addEventListener("click", (e) => {
    if (!useTranslate.getState().on) return;
    const el = e.target as HTMLElement | null;
    if (el?.closest?.("[data-translate-toggle], [data-chip], [data-tip-box]"))
      return;
    useTranslate.getState().set(false);
  });
}
useTranslate.subscribe((s) => {
  if (s.on) hook();
});

export const containsKorean = (s: string) => /[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(s);

const cache = new Map<string, string>();

/** 이미 받아 둔 번역 — 없으면 `undefined` (클릭 치환이 기다리지 않고 쓰려고) */
export const peekTranslation = (text: string) => cache.get(text.trim());

/** 태그 하나를 번역한다. 실패는 예외로 올린다 — 부르는 쪽이 알린다. */
export async function translateTag(text: string): Promise<string> {
  const key = text.trim();
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const ko = containsKorean(key);
  const r = await api<{ text: string }>("/api/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: key,
      sl: ko ? "ko" : "en",
      tl: ko ? "en" : "ko",
    }),
  });
  cache.set(key, r.text);
  return r.text;
}
