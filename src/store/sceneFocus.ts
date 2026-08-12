import { create } from "zustand";

/** 지금 보고 있는 씬과 장 — ★**프리뷰와 씬 칸이 서로 다른 컴포넌트**라 둘이 함께 보는 값을
 *  컴포넌트 상태로는 들 수 없다 (`slotSel` 이 같은 이유로 생겼다).
 *
 *  저장하지 않는다 — 이 화면을 보는 동안만 사는 값이다. 탭을 옮기면 씬 칸이 비운다. */
type S = {
  /** 고른 씬의 id (없으면 "") */
  cell: string;
  /** 고른 장의 파일 (없으면 null — 프리뷰는 안내만 띄운다) */
  file: string | null;
  focus: (cell: string, file: string | null) => void;
  clear: () => void;
};

export const useSceneFocus = create<S>((set) => ({
  cell: "",
  file: null,
  focus: (cell, file) => set({ cell, file }),
  clear: () => set({ cell: "", file: null }),
}));
