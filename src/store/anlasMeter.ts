import { create } from "zustand";
import { useSub } from "./sub";
import { judge, type MeterCond } from "../lib/anlasMeter";

/** 실제로 청구된 Anlas. **잔액 차이로 잰다** (사용자 지시 2026-08-18: "실제 청구 알수있는 방향으로").
 *
 *  까닭과 판정 규칙은 `lib/anlasMeter.ts` 머리에 있다. 여기는 **언제 재고 무엇을 들고
 *  있는가**만 맡는다: 큐에 넣기 직전에 기준선을 적고(`arm`), 배치가 온전히 끝나면
 *  잔액을 다시 물어 뺀다(`settle`).
 *
 *  ★여기는 **재기만 한다.** `lib/anlas.ts` 의 계산식은 건드리지 않는다. 어긋남이 쌓여
 *    확인되면 그때 사용자가 정한다.
 *  ★★**잴 수 없으면 아무 말도 하지 않는다.** 틀린 숫자를 보여 주는 것이 안 보여 주는
 *    것보다 나쁘다.
 */

/** 화면이 읽는 것. 마지막으로 **잴 수 있었던** 배치 하나 */
export type Measured = { est: number; actual: number; match: boolean; cond: MeterCond };

type Armed = { before: number; est: number; cond: MeterCond };

type S = {
  /** 재는 중인 배치. 끝나면 `settle()` 이 소비한다 */
  armed: Armed | null;
  measured: Measured | null;
  arm: (est: number, cond: MeterCond) => void;
  /** 잴 수 없게 됐다 (보내지 못함·취소·일부 실패) */
  disarm: () => void;
  /** 배치가 **성공으로** 끝났다. 잔액을 다시 물어 실제를 낸다 */
  settle: () => Promise<void>;
};

/** ★NAI 잔액이 곧바로 안 바뀔 수 있어 **한 번만** 더 물어본다. 끝없이 재시도하지 않는다 */
const RECHECK_MS = 1500;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** 재는 중에 또 걸리면 앞 배치의 소모가 뒤의 기준선에 섞인다. 그때는 아예 안 잰다 */
let measuring = false;

export const useAnlasMeter = create<S>((set, get) => ({
  armed: null,
  measured: null,

  arm(est, cond) {
    // ★앞 배치의 결과는 여기서 버린다. 새 배치가 도는 동안 옛 숫자를 띄워 두면
    //   그것이 이번 것으로 읽힌다
    set({ measured: null });
    // 잔액을 모르면(토큰 없음·통신 실패) 기준선이 없다. 재지 않는다
    const before = useSub.getState().sub?.anlas;
    if (measuring || typeof before !== "number") {
      set({ armed: null });
      return;
    }
    // ★기준선은 **화면에 보이던 잔액**이다. 여기서 새로 물으면 그 왕복이 생성 버튼을 늦추고,
    //   무엇보다 우리가 방금 보낸 생성 요청과 경쟁해 어느 쪽이 먼저 반영됐는지 알 수 없게 된다.
    //   앱은 배치가 끝날 때마다 잔액을 다시 물으므로(`queue.ts` 의 `job_done`) 이 값은 보통
    //   최신이다. 그 사이 밖에서 충전·소모가 있었다면 이번 회차만 어긋나게 나온다.
    set({ armed: { before, est, cond } });
  },

  disarm: () => set({ armed: null }),

  async settle() {
    const armed = get().armed;
    if (!armed) return;
    set({ armed: null });
    measuring = true;
    try {
      let after = (await useSub.getState().load())?.anlas ?? null;
      // 값이 그대로면 아직 반영 전일 수 있다. **딱 한 번** 더 본다
      if (after === armed.before) {
        await wait(RECHECK_MS);
        after = (await useSub.getState().load())?.anlas ?? after;
      }
      const v = judge(armed.before, after, armed.est);
      if (!v.ok) return; // ★잴 수 없었다. 화면에도 콘솔에도 남기지 않는다
      set({ measured: { est: armed.est, actual: v.actual, match: v.match, cond: armed.cond } });
      const detail = { est: armed.est, actual: v.actual, before: armed.before, after, ...armed.cond };
      if (v.match) console.info("[anlas] 예상과 실제가 같습니다", detail);
      // ★어긋남이 곧 우리가 찾던 정보다. **무엇이 걸려 있었는지**를 함께 찍는다
      else console.warn("[anlas] 예상과 실제가 다릅니다", detail);
    } finally {
      measuring = false;
    }
  },
}));
