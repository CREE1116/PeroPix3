import { create } from "zustand";
import { api } from "../lib/backend";

/** NAI 구독 상태 — **한 곳에서만 읽는다.**
 *
 *  ★예전에는 App 의 지역 상태였고 생성 푸터에만 내려갔다. 값이 필요한 자리가 늘면서
 *    (업스케일 값 표시) 넘겨줄 길이 없어졌다 — 같은 정보를 두 곳에 두지 않으려고 스토어로 뺀다.
 *  ★티어 3(Opus)이면 무료 구간이 생긴다. 그 판정을 화면마다 다시 쓰지 않게 `opus()` 를 둔다. */

/** Opus 무료 생성 잔량 (공홈 `subscription.usage`). ★V5 부터 무료가 유한하다 */
export type OpusUsage = {
  /** 남은 비율 0~100 */
  percent: number;
  /** 1% 회복까지 남은 **초** */
  timeUntilNextPercent: number;
  /** 다 쓰고 더 쓴 상태 — ★이러면 무료가 **꺼진다** */
  isNegative: boolean;
};

export type Sub = { tier: number; anlas: number; usage?: OpusUsage | null };

type S = {
  sub: Sub | null;
  set: (s: Sub | null) => void;
  /** ★**받아 온 값을 그대로 돌려준다.** 스토어를 다시 읽으면, 같은 순간에 도는 다른
   *  `load()` 가 나중에 덮어써서 **내가 물어본 답이 아닌 것**을 읽게 된다
   *  (`queue.ts` 는 `job_done` 마다 부른다). 실제 청구를 재는 쪽이 이 값을 쓴다. */
  load: () => Promise<Sub | null>;
  /** 티어 3 이상 + 구독중 — 공홈의 무료 판정 조건 */
  opus: () => boolean;
};

export const useSub = create<S>((set, get) => ({
  sub: null,
  set: (s) => set({ sub: s }),
  async load() {
    try {
      const s = await api<Sub>("/api/subscription");
      set({ sub: s });
      return s;
    } catch {
      // 토큰이 없거나 통신이 안 되면 그냥 모르는 상태로 둔다 (앱은 계속 돈다)
      return null;
    }
  },
  opus: () => (get().sub?.tier ?? 0) >= 3,
}));
