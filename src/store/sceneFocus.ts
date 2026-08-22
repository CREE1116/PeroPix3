import { create } from "zustand";

/** 지금 보고 있는 씬과 장 — ★**프리뷰와 씬 칸이 서로 다른 컴포넌트**라 둘이 함께 보는 값을
 *  컴포넌트 상태로는 들 수 없다 (`slotSel` 이 같은 이유로 생겼다).
 *
 *  저장하지 않는다 — 이 화면을 보는 동안만 사는 값이다.
 *  ★★**탭마다 따로 기억한다** (사용자 지시 2026-08-22). 예전에는 탭을 옮기면 비웠는데,
 *    돌아왔을 때 보던 장을 다시 찾아 눌러야 했다. 이제 떠날 때 그 탭 몫으로 담아 두고
 *    돌아오면 그대로 되살린다 (`switchTab`).
 */
type Spot = {
  /** 고른 씬의 id (없으면 "") */
  cell: string;
  /** 고른 장의 파일 (없으면 null — 프리뷰는 안내만 띄운다) */
  file: string | null;
  /** ★**아직 만들어지는 중인 칸**을 골랐다 (큐 항목 id). 그때 `file` 은 null 이고
   *  프리뷰는 **빈 화면**이다 — 파일이 없으니 할 수 있는 일도 없다 (`SceneActions` 가 빠진다). */
  pending: string | null;
};

type S = Spot & {
  /** 탭 id → 그 탭에서 마지막으로 보던 자리 */
  memo: Record<string, Spot>;
  focus: (cell: string, file: string | null) => void;
  /** 만들어지는 중인 칸을 고른다 */
  focusPending: (cell: string, id: string) => void;
  clear: () => void;
  /** 탭을 옮긴다 — 떠나는 탭 것을 담고, 가는 탭 것을 되살린다 */
  switchTab: (from: string | undefined, to: string | undefined) => void;
};

const EMPTY: Spot = { cell: "", file: null, pending: null };

export const useSceneFocus = create<S>((set) => ({
  ...EMPTY,
  memo: {},
  focus: (cell, file) => set({ cell, file, pending: null }),
  focusPending: (cell, id) => set({ cell, file: null, pending: id }),
  clear: () => set({ ...EMPTY }),
  switchTab: (from, to) =>
    set((s) => {
      const memo = { ...s.memo };
      if (from) memo[from] = { cell: s.cell, file: s.file, pending: s.pending };
      /* ★가는 탭에 담아 둔 것이 없으면 **빈 자리**로 시작한다 (예전과 같다) */
      return { memo, ...(to ? memo[to] ?? EMPTY : EMPTY) };
    }),
}));
