import { create } from "zustand";

/** 확인 창 — **약속(Promise)으로 답을 돌려준다** (10단계).
 *
 *  ★브라우저 `confirm` 을 안 쓰는 이유: 창 밖에서 뜨는 OS 대화상자라 앱의 글꼴·테마·언어와
 *    따로 놀고, Tauri 의 장식 없는 창에서는 **엉뚱한 자리에** 뜬다. 무엇보다 스타일을 못 준다.
 *  ★쓰는 쪽은 `if (await ask(...))` 한 줄이면 된다 — 콜백을 넘기게 하면 호출부가 두 겹이 된다.
 */
type Req = {
  id: number;
  title: string;
  body?: string;
  ok: string;
  cancel: string;
  /** 되돌릴 수 없는 일 — 확인 버튼이 빨갛다 */
  danger?: boolean;
  resolve: (v: boolean) => void;
};

type S = { cur: Req | null; answer: (v: boolean) => void; push: (r: Req) => void };

let seq = 1;

export const useAsk = create<S>((set, get) => ({
  cur: null,
  push: (r) => set({ cur: r }),
  answer(v) {
    const c = get().cur;
    if (!c) return;
    set({ cur: null });
    c.resolve(v);
  },
}));

export function ask(opts: {
  title: string;
  body?: string;
  ok: string;
  cancel: string;
  danger?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    useAsk.getState().push({ id: seq++, ...opts, resolve });
  });
}
