/** 창 제어 래퍼.
 *
 *  시스템 타이틀바를 끄면(`decorations: false`) OS 가 주던 것들이 함께 사라진다:
 *  이동·더블클릭 최대화·최소화/최대화/닫기 버튼·가장자리 리사이즈.
 *  전부 여기서 다시 제공한다.
 *
 *  브라우저(vite dev)에서 열었을 땐 Tauri 가 없으므로 조용히 무시한다. */

import { logLine } from "./report";

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
/** ★지금 세로로 늘려 둔 상태인가 — **묻지 않고 아는** 값이다.
 *  가장자리를 끌 때마다 창·모니터를 조회하면(왕복 셋) 크기 조절이 그만큼 늦게 시작한다.
 *  늘려 둔 상태가 아니면 되돌릴 것도 없으므로, 그때는 아무것도 묻지 않고 지나간다. */
let vFitted = false;

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
  /** 창의 **보이지 않는 테두리** 두께 (CSS 픽셀, 위·왼·오른·아래).
   *
   *  ★★가장자리 손잡이를 이만큼 **안쪽으로 물린다** (사용자 지적 2026-08-28: *"커서가
   *    리사이즈 모양으로 변하는 구간이 100이면 아래 50% 정도에서만 더블클릭이 먹는다"*).
   *    윈도우의 크기 조절 테두리는 창 **밖으로 한 겹 더** 나와 있는데, 그 겹은 눈에 안
   *    보이면서 커서를 바꾸고 누름을 먹는다. 로그로 재 보니 화면에는 `y=4` 위로 아무
   *    이벤트도 안 왔다 — 우리 8px 손잡이의 위쪽 절반이 그 겹에 덮여 있었던 것이다.
   *  ★두께는 **껍데기가 잰다** — 화면 배율·테마마다 달라서 셈으로 적으면 또 어긋난다. */
  async frameInset(): Promise<{ top: number; left: number; right: number; bottom: number }> {
    const none = { top: 0, left: 0, right: 0, bottom: 0 };
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const [t, l, r, b] = await invoke<[number, number, number, number]>("frame_inset");
      const s = window.devicePixelRatio || 1;
      return { top: t / s, left: l / s, right: r / s, bottom: b / s };
    } catch {
      return none;   // 브라우저로 열었을 때 (Tauri 가 없다)
    }
  },
  /** 그 화면 좌표의 **픽셀 주인**을 이름으로 (진단용). 껍데기가 `WindowFromPoint` 로 묻는다. */
  async whoAt(x: number, y: number): Promise<string> {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<string>("who_at", { x: Math.round(x), y: Math.round(y) });
    } catch {
      return "";
    }
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
      // ★진단 — 재는 값이 실제로 어떤지 (사용자 지적 2026-08-28: 사용자 창에서만 안 된다)
      logLine(
        "info",
        "창세로",
        `창 y=${pos.y} h=${size.height} x=${pos.x} w=${size.width} · 작업영역 y=${wa.position.y} h=${wa.size.height} · full=${full} back=${JSON.stringify(vFitBack)}`,
      );
      if (full) {
        const back = vFitBack;
        if (!back) {
          logLine("warn", "창세로", "이미 꽉 찼는데 되돌릴 자리가 없어 아무 일도 안 함");
          return;
        }
        /* ★★**되돌릴 자리를 비우지 않는다** (조사 2026-08-28). 비운 직후 창이 다시 꽉 차면
           (위 변을 화면 끝까지 끌면 윈도우가 스스로 세로 최대화를 건다) `noteHeight` 는
           꽉 찬 상태에서 아무것도 안 적으므로 **「늘어났는데 되돌릴 자리는 없음」으로 굳는다.**
           그 상태는 스스로 빠져나올 길이 없어 그 뒤로 더블클릭도 복원도 영영 안 된다.
           적는 것은 `noteHeight` 하나에 맡기고, 여기서는 상태만 내린다. */
        vFitted = false;
        await w.setPosition(new PhysicalPosition(pos.x, back.y));
        await w.setSize(new PhysicalSize(size.width, back.h));
        return;
      }
      vFitBack = { y: pos.y, h: size.height };
      vFitted = true;
      await w.setPosition(new PhysicalPosition(pos.x, wa.position.y));
      await w.setSize(new PhysicalSize(size.width, wa.size.height));
      const after = await w.outerSize();
      logLine("info", "창세로", `늘린 뒤 h=${after.height} (바란 값 ${wa.size.height})`);
    } catch (e) {
      // ★거부되면 **조용히** 아무 일도 안 일어난다 — 그래서 까닭을 남긴다 (위 ★★주)
      logLine("error", "창세로", `실패 — capabilities 의 창 조작 권한을 본다: ${String(e)}`);
      console.error("[window] 세로 최대화 실패", e);
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
      vFitted = full;
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
    // ★늘려 둔 상태가 아니면 **묻지도 않고** 지나간다 (위 `vFitted` 주석) — 끌기가 늦어진다
    if (!vFitted) return;
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
      // ★되돌릴 자리는 비우지 않는다 (바로 위 ★★주) — 적는 것은 `noteHeight` 하나다
      vFitted = false;
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
