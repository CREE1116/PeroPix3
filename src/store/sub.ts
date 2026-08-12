import { create } from "zustand";
import { api } from "../lib/backend";

/** NAI 구독 상태 — **한 곳에서만 읽는다.**
 *
 *  ★예전에는 App 의 지역 상태였고 생성 푸터에만 내려갔다. 값이 필요한 자리가 늘면서
 *    (업스케일 값 표시) 넘겨줄 길이 없어졌다 — 같은 정보를 두 곳에 두지 않으려고 스토어로 뺀다.
 *  ★티어 3(Opus)이면 무료 구간이 생긴다. 그 판정을 화면마다 다시 쓰지 않게 `opus()` 를 둔다. */

export type Sub = { tier: number; anlas: number };

type S = {
  sub: Sub | null;
  set: (s: Sub | null) => void;
  load: () => Promise<void>;
  /** 티어 3 이상 + 구독중 — 공홈의 무료 판정 조건 */
  opus: () => boolean;
};

export const useSub = create<S>((set, get) => ({
  sub: null,
  set: (s) => set({ sub: s }),
  async load() {
    try {
      set({ sub: await api<Sub>("/api/subscription") });
    } catch {
      // 토큰이 없거나 통신이 안 되면 그냥 모르는 상태로 둔다 (앱은 계속 돈다)
    }
  },
  opus: () => (get().sub?.tier ?? 0) >= 3,
}));
