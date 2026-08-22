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
  /** ★★**손으로 여러 장 고른 것** (`Ctrl`·`Shift` 클릭). 씬 줄의 컴포넌트 상태였는데,
   *  큰 그림 아래 **삭제 단추**도 이것을 봐야 해서 여기로 올렸다 (사용자 지시 2026-08-22:
   *  *"다중 선택 상태에서 이미지 삭제버튼 누르면 전부 삭제"*). 두 컴포넌트가 형제라
   *  한쪽 상태로는 다른 쪽이 못 본다 (이 스토어가 생긴 것과 같은 사정이다). */
  picked: string[];
  setPicked: (files: string[]) => void;
  /** ★**실제로 걸리는 목록** — 손으로 고른 것에 **지금 보고 있는 장**을 더한다
   *  (사용자 지시 2026-08-22: 하나만 골라도 「그것과 지금 보는 것」 둘이다).
   *  ★아무것도 안 골랐으면 **빈 것**이다 — 그냥 보고 있는 것만으로 「여러 장」이 되면
   *    큰 그림 아래 줄이 하는 말과 겹친다. */
  selected: () => string[];
  focus: (cell: string, file: string | null) => void;
  /** 만들어지는 중인 칸을 고른다 */
  focusPending: (cell: string, id: string) => void;
  clear: () => void;
  /** 탭을 옮긴다 — 떠나는 탭 것을 담고, 가는 탭 것을 되살린다 */
  switchTab: (from: string | undefined, to: string | undefined) => void;
};

const EMPTY: Spot = { cell: "", file: null, pending: null };

export const useSceneFocus = create<S>((set, get) => ({
  ...EMPTY,
  memo: {},
  picked: [],
  setPicked: (files) => set({ picked: files }),
  selected: () => {
    const { picked, file } = get();
    if (!picked.length) return [];
    return file && !picked.includes(file) ? [...picked, file] : [...picked];
  },
  /* ★★**그냥 한 장을 고르면 여러 장 고르기가 풀린다** (사용자 지시 2026-08-22:
     *"다중선택 상태에서 그냥 좌클릭으로 다른 이미지 선택하면 다중선택 해제"*).
     ★푸는 자리를 **이 창구 하나**로 둔다 — 클릭한 자리에서만 풀면 방향키로 장을 넘길 때
       고른 것이 남고, `selected` 가 지나는 장마다 **말없이 불어난다.** */
  focus: (cell, file) => set({ cell, file, pending: null, picked: [] }),
  focusPending: (cell, id) => set({ cell, file: null, pending: id, picked: [] }),
  clear: () => set({ ...EMPTY, picked: [] }),
  switchTab: (from, to) =>
    set((s) => {
      const memo = { ...s.memo };
      if (from) memo[from] = { cell: s.cell, file: s.file, pending: s.pending };
      /* ★가는 탭에 담아 둔 것이 없으면 **빈 자리**로 시작한다 (예전과 같다)
         ★고른 것은 **안 담아 둔다** — 탭을 옮겼다 오면 풀려 있는 것이 맞다 */
      return { memo, picked: [], ...(to ? memo[to] ?? EMPTY : EMPTY) };
    }),
}));
