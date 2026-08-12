import { create } from "zustand";

export type Theme = "light" | "dark" | "system";

const KEY = "peropix.theme";

function load(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {}
  return "system";
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
