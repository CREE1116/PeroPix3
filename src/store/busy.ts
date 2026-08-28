import { create } from "zustand";
import { toast } from "./toast";
import { t } from "../i18n";

/** **파일을 옮기는 동안 조작을 잠근다** (사용자 결정 2026-08-28).
 *
 *  ★★**왜 잠그나** — 이 앱은 워크스페이스 상태(spec)를 **통째로** 저장한다. 옮기는 1~2초
 *    사이에 사용자가 이름을 고치거나 프롬프트를 치면, 서버 응답이 도착할 때 둘 중 하나가
 *    조용히 사라진다 (화면 것을 살리면 옮긴 결과가, 서버 것을 대입하면 방금 친 것이).
 *    그 틈에 방어를 하나씩 붙이던 것을(자동 저장 보류·응답 가드·보던 탭 지키기) **틈 자체를
 *    없애는 쪽**으로 바꾼 것이다. 사용자 말: *"어차피 길어야 2~3초이고 오류 나는 것보다 낫다."*
 *  ★★**잠기는 것은 이 창의 조작뿐이다.** 백엔드는 안 멈춘다 (`backend/server.py` 의 「이벤트
 *    루프에서 하면 안 되는 일」 ★★주) — 돌고 있던 생성·스트리밍·다른 창은 그대로 흐른다.
 *  ★★**막는 것은 시작과 동시**다 (사용자 지적 2026-08-28: *"조작을 할 수 있을 것 같아서
 *    클릭하려는데 갑자기 막힘. 그냥 처음부터 막는 게 나을 듯"*). 늦게 막으면 그 사이의 클릭이
 *    반쯤 먹혀서, 「되는 줄 알았는데 안 되는」 구간이 생긴다.
 *  ★**보이는 것만 늦다.** 덮개는 뜬 순간부터 막지만 **투명하게 시작해** 천천히 짙어진다
 *    (`globals.css` 의 `.busy-veil`). 100ms 만에 끝나는 이동에서는 아무것도 안 보이고,
 *    오래 걸리는 것만 서서히 어두워진다 — 번쩍임 없이 처음부터 막는 방법이다.
 *  ★**반드시 풀린다** — `finally` 로 풀고, 그래도 안 풀리는 경우를 대비해 상한(`LIMIT`)을 둔다.
 *    잠긴 채로 남은 앱은 되돌릴 길이 없다. */

/** 이보다 오래 걸리면 잠금을 푼다 — 작업은 계속되지만 앱을 잠근 채로 두지 않는다 (ms) */
const LIMIT = 30_000;

export const useBusy = create<{ label: string | null; set: (v: string | null) => void }>((set) => ({
  label: null,
  set: (label) => set({ label }),
}));

/** 그 일이 도는 동안 조작을 잠근다. `label` 은 덮개에 적히는 한 줄이다. */
export async function withBusy<T>(label: string, fn: () => Promise<T>): Promise<T> {
  useBusy.getState().set(label);            // ★시작과 동시에 막는다 (위 ★★주)
  const guard = window.setTimeout(() => {
    useBusy.getState().set(null);
    toast(t("busy.tooLong"), "warn");
  }, LIMIT);
  try {
    return await fn();
  } finally {
    window.clearTimeout(guard);
    useBusy.getState().set(null);
  }
}
