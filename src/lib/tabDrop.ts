import { create } from "zustand";

/** 탭을 끌어 **워크스페이스 탭 위**에 올려 둔 상태 (사용자 지시 2026-08-28: *"탭을 끌어다가
 *  다른 워크스페이스에 두면 거기로 옮겨지게"*).
 *
 *  ★두 컴포넌트가 같이 본다 — 끄는 쪽(`CanvasTabs`)이 적고, 받는 쪽(`WorkspaceTabs`)이 읽어
 *    빛난다. 형제라 한쪽 상태로는 다른 쪽이 못 보므로 여기 둔다.
 *  ★탭 차례 바꾸기(`useReorder`)와 **같은 끌기**다 — 손을 뗀 자리가 워크스페이스 탭이면
 *    차례 대신 옮기기가 된다. 끌기를 두 벌 두지 않는다. */
export const useTabDrop = create<{ over: string | null; set: (v: string | null) => void }>((set) => ({
  over: null,
  set: (over) => set({ over }),
}));

/** 그 화면 좌표 밑의 워크스페이스 탭 이름 (없으면 `null`).
 *  ★포인터가 잡혀 있어도(`setPointerCapture`) `elementFromPoint` 는 좌표로 찾으므로 그대로 된다. */
export function wsTabAt(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y)?.closest("[data-ws-tab]");
  return el?.getAttribute("data-ws-tab") ?? null;
}
