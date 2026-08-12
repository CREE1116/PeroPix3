import { create } from "zustand";
import { en } from "./en";
import { ko } from "./ko";
import { ja } from "./ja";

/** 최소 i18n — 외부 의존성 없이.
 *
 *  ★영어(`en`)가 **기준 로케일이자 폴백**이다. 다른 로케일은 같은 모양을 요구받으므로
 *    키를 빠뜨리면 **컴파일 오류**가 난다 (런타임에 조용히 비지 않는다).
 *  ★번역이 비어 있으면 영어로 떨어진다.
 *  ★첫 실행 언어는 시스템 언어(`navigator.language`)로 정하고, 이후 선택은 저장된다. */

export type Locale = "ko" | "en" | "ja";
export const LOCALES: { id: Locale; label: string }[] = [
  { id: "en", label: "English" },
  { id: "ko", label: "한국어" },
  { id: "ja", label: "日本語" },
];

/** 값은 string 으로 넓히고 **키 구조만** 강제한다.
 *  (`as const` 를 그대로 쓰면 다른 로케일이 한국어 리터럴과 같아야 해서 번역이 불가능해진다) */
type DeepString<T> = { [K in keyof T]: T[K] extends string ? string : DeepString<T[K]> };

/** 기준 로케일의 모양 — 다른 로케일이 이 타입을 만족해야 한다 */
export type Dict = DeepString<typeof en>;

const DICTS: Record<Locale, Dict> = { en, ko, ja };

const KEY = "peropix.locale";

function detect(): Locale {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "ko" || saved === "en" || saved === "ja") return saved;
  } catch {}
  const n = (navigator.language || "").toLowerCase();
  if (n.startsWith("ko")) return "ko";
  if (n.startsWith("ja")) return "ja";
  return "en";
}

/** `a.b.c` 로 중첩 딕셔너리를 판다 */
function dig(d: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], d);
}

/** `{name}` 자리표시자를 채운다 */
function fill(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

type S = {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

/** ★로케일마다 **새 함수**를 만든다. 화면은 대부분 `useI18n((s) => s.t)` 로 구독하는데,
 *  `t` 가 같은 함수로 남아 있으면 로케일을 바꿔도 **다시 그려지지 않는다** — 버튼 글자만
 *  바뀌고 본문은 그대로였다 (사용자 지적 2026-08-04). 정체가 바뀌어야 구독자가 갱신된다. */
const makeT = (locale: Locale): S["t"] => (key, vars) => {
  const cur = dig(DICTS[locale], key);
  const val = typeof cur === "string" && cur ? cur : dig(en, key);
  if (typeof val !== "string") {
    // 키 오타는 조용히 넘기지 않는다 — 화면에 키가 그대로 보인다
    console.warn("[i18n] missing key:", key);
    return key;
  }
  return fill(val, vars);
};

export const useI18n = create<S>((set) => ({
  locale: detect(),
  t: makeT(detect()),
  setLocale(l) {
    try {
      localStorage.setItem(KEY, l);
    } catch {}
    document.documentElement.lang = l;
    set({ locale: l, t: makeT(l) });
  },
}));

/** 컴포넌트 밖(스토어 등)에서 쓰는 단축 */
export const t = (key: string, vars?: Record<string, string | number>) =>
  useI18n.getState().t(key, vars);

document.documentElement.lang = useI18n.getState().locale;
