import { create } from "zustand";

/** 토스트 — **끝난 일을 알리는 한 줄**. (v2 `showToast`, 10단계)
 *
 *  ★알림창(alert)을 쓰지 않는다: 확인을 누르기 전까지 앱이 멈추고, 생성 중에 뜨면 흐름이 끊긴다.
 *  ★**오류는 토스트로 끝내지 않는다.** 사라지는 글자는 놓치면 다시 볼 수 없어서,
 *    되짚어야 하는 것(생성 실패 등)은 자기 자리에 남는다 (`useGen.error` → 생성 푸터).
 *    여기 오는 것은 "됐다"에 가까운 것들이다.
 */
export type Toast = { id: number; text: string; kind: "ok" | "warn" };

type S = {
  items: Toast[];
  show: (text: string, kind?: Toast["kind"]) => void;
  drop: (id: number) => void;
};

let seq = 1;

export const useToast = create<S>((set, get) => ({
  items: [],
  show(text, kind = "ok") {
    const id = seq++;
    set({ items: [...get().items, { id, text, kind }] });
    setTimeout(() => get().drop(id), 2600);
  },
  drop: (id) => set({ items: get().items.filter((x) => x.id !== id) }),
}));

/** 컴포넌트 밖(스토어·이벤트)에서 부르는 단축 */
export const toast = (text: string, kind?: Toast["kind"]) => useToast.getState().show(text, kind);
