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
   *  ★한 번 더 하면 되돌린다 — 윈도우도 그렇다.
   *
   *  ★★**창을 옮기고 늘리는 데에는 권한이 따로 필요하다** (사용자 지적 2026-08-28: *"안 되는데?"*).
   *    `core:default` 에 든 것은 **읽는 것뿐**이다 (`outerPosition`·`outerSize`·`currentMonitor`).
   *    쓰는 둘(`set-position`·`set-size`)은 `src-tauri/capabilities/default.json` 에 직접
   *    적어야 하고, 없으면 호출이 **조용히 거부되어 아무 일도 안 일어난다.**
   *    ★그래서 아래에서 잡아 콘솔에 남긴다. 배선은 `lib/windowPerms.test.ts` 가 지킨다. */
  async fitVertical() {
    try {
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
    } catch (e) {
      // ★거부되면 **조용히** 아무 일도 안 일어난다 — 그래서 까닭을 남긴다 (위 ★★주)
      console.error("[window] 세로 최대화 실패 — capabilities 의 창 조작 권한을 본다", e);
    }
  },
  /** ★★**늘리기 전 자리는 늘 갱신해 둔다** — 크기가 바뀔 때마다 부른다.
   *
   *  예전에는 `fitVertical` 이 늘리는 그 순간에만 적어 뒀다. 그래서 **창이 이미 꽉 찬
   *  높이일 때**(손으로 그렇게 맞춰 뒀거나, 윈도우가 위쪽 가장자리로 끌어 붙여 놨을 때)
   *  되돌릴 자리가 없어 **더블클릭이 아무 일도 안 했다.** 눈에는 「안 먹는다」로만 보인다.
   *  ★꽉 찬 상태에서는 적지 않는다 — 그것을 적으면 되돌릴 자리가 곧 지금 자리가 된다. */
  async noteHeight() {
    try {
      const w = await win();
      if (!w) return;
      const { currentMonitor } = await import("@tauri-apps/api/window");
      const m = await currentMonitor();
      if (!m) return;
      const pos = await w.outerPosition();
      const size = await w.outerSize();
      const wa = m.workArea;
      const full =
        Math.abs(pos.y - wa.position.y) <= 2 && Math.abs(size.height - wa.size.height) <= 2;
      if (!full) vFitBack = { y: pos.y, h: size.height };
    } catch {
      /* 자리를 못 적어도 하던 일에는 지장이 없다 */
    }
  },
  /** ★★**손으로 크기를 조절하면 세로 최대화가 풀린다** (사용자 지적 2026-08-28:
   *  *"확장됐을 때 수동으로 크기 줄이면 원래 아래 부분이 기존 위치로 돌아가는데, 이건
   *  안 돌아감"*).
   *
   *  세로로 늘린 상태에서 한쪽 변을 잡아 끌면, **반대쪽 변은 늘리기 전 자리로** 돌아가야
   *  한다 — 늘린 것은 「잠깐 맞춰 둔 상태」이지 그 창의 크기가 아니기 때문이다.
   *  ★위 변을 끌면 아래 변을, 아래 변을 끌면 위 변을 되돌린다.
   *  ★크기 조절을 **시작하기 직전에** 부른다. 되돌린 뒤 OS 가 그 변을 커서에 맞춘다.
   *  ★늘려 둔 상태가 아니면 아무 일도 안 한다. */
  async unfitFor(dir: "North" | "South") {
    try {
      const w = await win();
      const back = vFitBack;
      if (!w || !back) return;
      const { currentMonitor } = await import("@tauri-apps/api/window");
      const { PhysicalPosition, PhysicalSize } = await import("@tauri-apps/api/dpi");
      const m = await currentMonitor();
      if (!m) return;
      const pos = await w.outerPosition();
      const size = await w.outerSize();
      const wa = m.workArea;
      const fitted =
        Math.abs(pos.y - wa.position.y) <= 2 && Math.abs(size.height - wa.size.height) <= 2;
      if (!fitted) return;
      vFitBack = null;
      if (dir === "North") {
        // 아래 변을 원래 자리로 — 위 변은 지금 자리에 둔 채 높이만 줄인다
        const h = back.y + back.h - pos.y;
        if (h > 0) await w.setSize(new PhysicalSize(size.width, h));
      } else {
        // 위 변을 원래 자리로 — 아래 변은 지금 자리를 지킨다
        const h = pos.y + size.height - back.y;
        if (h > 0) {
          await w.setPosition(new PhysicalPosition(pos.x, back.y));
          await w.setSize(new PhysicalSize(size.width, h));
        }
      }
    } catch (e) {
      console.error("[window] 세로 최대화 풀기 실패", e);
    }
  },
  /** 최대화 상태가 바뀔 때마다 콜백. 정리 함수를 돌려준다. */
  async onResized(cb: () => void): Promise<() => void> {
    const w = await win();
    if (!w) return () => {};
    const un = await w.onResized(cb);
    return un;
  },
};
