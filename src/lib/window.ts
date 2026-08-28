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

/** 세로로 늘리기 전의 자리 — 두 번째 더블클릭이 여기로 되돌린다 */
let vFitBack: { y: number; h: number } | null = null;

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
  /** 창 제목 — 화면에는 안 보이지만 **작업 표시줄과 Alt+Tab** 에 뜬다.
   *  큐 완료 알림이 이걸 쓴다 (`lib/titleNotify.ts`). */
  async setTitle(title: string) {
    (await win())?.setTitle(title);
  },
  async isMaximized(): Promise<boolean> {
    const w = await win();
    return w ? await w.isMaximized() : false;
  },
  async startResize(dir: ResizeDir) {
    (await win())?.startResizeDragging(dir as never);
  },
  /** ★★**위·아래 테두리 더블클릭 = 세로로만 화면 끝까지** (사용자 지적 2026-08-28:
   *  *"윈도우 앱들은 다 기본으로 되는데 우린 안 된다"*).
   *
   *  시스템 타이틀바를 끄면 창에 **비클라이언트 영역이 없어져**, 윈도우가 그 자리에서
   *  해 주던 일(`WM_NCLBUTTONDBLCLK` → 세로 최대화)이 통째로 사라진다. 가장자리 손잡이를
   *  우리가 그린 것처럼 이것도 우리가 해야 한다.
   *  ★**세로뿐이다.** 윈도우가 이 동작을 주는 것은 위·아래 테두리이고, 좌우 테두리에는
   *    같은 기능이 없다 (MS 문서·Windows 11 설정 항목 「세로로 창 최대화」).
   *  ★작업 표시줄을 덮지 않도록 **작업 영역**(`workArea`)까지만 늘린다.
   *  ★한 번 더 하면 되돌린다 — 윈도우도 그렇다. */
  async fitVertical() {
    const w = await win();
    if (!w) return;
    const { currentMonitor } = await import("@tauri-apps/api/window");
    const { PhysicalPosition, PhysicalSize } = await import("@tauri-apps/api/dpi");
    const m = await currentMonitor();
    if (!m) return;
    const pos = await w.outerPosition();
    const size = await w.outerSize();
    const wa = m.workArea;
    // ★두 값 다 물리 픽셀이라 그대로 견준다 (화면 배율을 거치지 않는다)
    const full =
      Math.abs(pos.y - wa.position.y) <= 2 && Math.abs(size.height - wa.size.height) <= 2;
    if (full) {
      const back = vFitBack;
      if (!back) return; // 손으로 이미 꽉 채워 둔 창 — 되돌릴 자리가 없다
      vFitBack = null;
      await w.setPosition(new PhysicalPosition(pos.x, back.y));
      await w.setSize(new PhysicalSize(size.width, back.h));
      return;
    }
    vFitBack = { y: pos.y, h: size.height };
    await w.setPosition(new PhysicalPosition(pos.x, wa.position.y));
    await w.setSize(new PhysicalSize(size.width, wa.size.height));
  },
  /** 최대화 상태가 바뀔 때마다 콜백. 정리 함수를 돌려준다. */
  async onResized(cb: () => void): Promise<() => void> {
    const w = await win();
    if (!w) return () => {};
    const un = await w.onResized(cb);
    return un;
  },
};
