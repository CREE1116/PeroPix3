/** 창 제어 래퍼.
 *
 *  시스템 타이틀바를 끄면(`decorations: false`) OS 가 주던 것들이 함께 사라진다:
 *  이동·더블클릭 최대화·최소화/최대화/닫기 버튼·가장자리 리사이즈.
 *  전부 여기서 다시 제공한다.
 *
 *  브라우저(vite dev)에서 열었을 땐 Tauri 가 없으므로 조용히 무시한다. */

export type ResizeDir =
  | "North"
  | "NorthEast"
  | "East"
  | "SouthEast"
  | "South"
  | "SouthWest"
  | "West"
  | "NorthWest";

async function win() {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    return getCurrentWindow();
  } catch {
    return null;
  }
}

export const appWindow = {
  async minimize() {
    (await win())?.minimize();
  },
  async toggleMaximize() {
    (await win())?.toggleMaximize();
  },
  async close() {
    (await win())?.close();
  },
  async isMaximized(): Promise<boolean> {
    const w = await win();
    return w ? await w.isMaximized() : false;
  },
  async startResize(dir: ResizeDir) {
    (await win())?.startResizeDragging(dir as never);
  },
  /** 최대화 상태가 바뀔 때마다 콜백. 정리 함수를 돌려준다. */
  async onResized(cb: () => void): Promise<() => void> {
    const w = await win();
    if (!w) return () => {};
    const un = await w.onResized(cb);
    return un;
  },
};
