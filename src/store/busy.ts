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
 *  ★**바로 안 띄운다** (`DELAY`). 파일 몇 장짜리 이동은 눈 깜짝할 새라, 그때마다 덮개가
 *    번쩍이면 그것이 더 거슬린다.
 *  ★**반드시 풀린다** — `finally` 로 풀고, 그래도 안 풀리는 경우를 대비해 상한(`LIMIT`)을 둔다.
 *    잠긴 채로 남은 앱은 되돌릴 길이 없다. */

/** 이만큼 걸릴 때만 덮개를 띄운다 (ms) */
const DELAY = 300;
/** 이보다 오래 걸리면 잠금을 푼다 — 작업은 계속되지만 앱을 잠근 채로 두지 않는다 (ms) */
const LIMIT = 30_000;

export const useBusy = create<{ label: string | null; set: (v: string | null) => void }>((set) => ({
  label: null,
  set: (label) => set({ label }),
}));

/** 그 일이 도는 동안 조작을 잠근다. `label` 은 덮개에 적히는 한 줄이다. */
export async function withBusy<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const show = window.setTimeout(() => useBusy.getState().set(label), DELAY);
  const guard = window.setTimeout(() => {
    useBusy.getState().set(null);
    toast(t("busy.tooLong"), "warn");
  }, LIMIT);
  try {
    return await fn();
  } finally {
    window.clearTimeout(show);
    window.clearTimeout(guard);
    useBusy.getState().set(null);
  }
}
