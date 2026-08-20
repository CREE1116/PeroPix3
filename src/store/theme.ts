import { create } from "zustand";

export type Theme = "light" | "dark" | "system";

const KEY = "peropix.theme";

/** ★★**처음 켜면 어둡다** (사용자 지시 2026-08-20). 고른 적이 없을 때만 이 값이 쓰이고,
 *  설정에서 「시스템」을 고르면 그때부터 OS 를 따른다 (그 선택도 여기 저장된다). */
function load(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {}
  return "dark";
}

/** `system` 이면 data-theme 을 지워 OS 설정(prefers-color-scheme)을 따르게 한다. */
function apply(t: Theme) {
  const root = document.documentElement;
  if (t === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", t);
}

type S = {
  theme: Theme;
  set: (t: Theme) => void;
  toggle: () => void;
};

export const useTheme = create<S>((set, get) => ({
  theme: load(),
  set(t) {
    apply(t);
    try {
      localStorage.setItem(KEY, t);
    } catch {}
    set({ theme: t });
  },
  toggle() {
    // 현재 보이는 상태의 반대로 명시 전환한다 (system → 반대편으로 고정)
    const cur = get().theme;
    const dark =
      cur === "dark" ||
      (cur === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    get().set(dark ? "light" : "dark");
  },
}));

apply(load());
