import { create } from "zustand";
import { api } from "../lib/backend";
import { toast } from "./toast";
import { t } from "../i18n";

/** 자동 업데이트 — **단추 하나**로 끝난다 (사용자 지시 2026-08-26).
 *
 *  ★★**패치인지 전체인지 안 묻는다** (*"유저 입장에서는 「이번엔 전체를 받아야 합니다」라는
 *    문구를 볼 필요가 있음? 그냥 이번 패치는 용량이 좀 많네… 이러고 말 것 같은데"*).
 *    어느 쪽인지는 백엔드가 정하고(`backend/update.py`), 사용자에게는 **받는 양만** 보인다.
 *  ★부팅 때 한 번 조용히 확인하고, 있으면 토스트로 알린다 (v2 와 같은 몸짓).
 *    ★실패는 삼킨다 — 인터넷이 없다고 앱이 시끄러워지면 안 된다.
 *  ★받아 둔 뒤에는 **다시 켜야** 반영된다. 돌고 있는 실행 파일은 덮어쓸 수 없어서,
 *    껍데기가 백엔드를 내리고 파일을 갈아 끼운 뒤 새로 띄운다 (`src-tauri/src/update.rs`).
 *
 *  ★★**어디까지 왔나를 `phase` 하나가 말한다** (사용자 지적 2026-08-26: *"업데이트를 누르면
 *    화면에 아무 변화가 없는데 옵션 모달에 가보면 조용히 다운받고 있음"*). 예전에는
 *    `busy`·`staged` 두 깃발로 갈랐는데, **설치 중**이라는 단계를 담을 자리가 없었고
 *    설정 모달 밖에서는 아무 데도 안 보였다. 단계가 하나면 타이틀바 띠와 설정 칸이
 *    **같은 값을 보고** 그린다 (`app/UpdateStrip`·`app/Settings` 의 `UpdateBox`).
 */
export type UpdateInfo = {
  has_update: boolean;
  building?: boolean;
  current: string;
  latest: string;
  kind?: "patch" | "full";
  size?: number;
  notes?: string;
  url?: string;
};

/** 지금 어느 단계인가 — 화면은 이것만 보고 그린다.
 *  `idle` 아무 일 없음 · `downloading` 받는 중 · `staged` 받아 뒀다 · `applying` 갈아 끼우는 중 */
export type Phase = "idle" | "downloading" | "staged" | "applying";

type S = {
  info: UpdateInfo | null;
  /** 확인 중 (설정에서 누른 경우에만 보인다) */
  checking: boolean;
  phase: Phase;
  done: number;
  total: number;
  setProgress: (done: number, total: number) => void;
  /** 소켓이 물어 온 끝 소식 — 받았으면 `staged`, 취소·실패면 `idle` */
  finish: (ok: boolean, cancelled?: boolean) => void;
  setStaged: (v: boolean) => void;
  /** @param quiet 부팅 때처럼 **조용히** 확인한다 (실패해도 아무 말 안 한다) */
  check: (quiet?: boolean) => Promise<void>;
  start: () => Promise<void>;
  cancel: () => Promise<void>;
  restart: () => Promise<void>;
};

export const useUpdate = create<S>((set, get) => ({
  info: null,
  checking: false,
  phase: "idle",
  done: 0,
  total: 0,
  setProgress: (done, total) => set({ done, total }),
  finish: (ok, cancelled) => {
    /* ★★**두 번 와도 한 번만 매듭짓는다.** 끝났다는 소식이 둘이다 — 소켓(`update_staged`)과
       요청의 답(`start` 의 ★★주). 어느 쪽이 먼저 와도 되고, 뒤에 온 것은 여기서 조용히
       돌아간다. 안 그러면 토스트가 두 번 뜬다. */
    if (get().phase !== "downloading") return;
    set({ phase: ok ? "staged" : "idle", done: 0, total: 0 });
    if (!ok && !cancelled) toast(t("update.failed"), "warn");
    /* ★★**다 받으면 한 번 더 알린다** (사용자 지시 2026-08-26: *"모달을 꺼도 설치 다되면
       토스트 한 번 더 띄워서 재시작 할 수 있게"*). 받는 동안 설정을 열어 두라고 요구할 수는
       없으니, 끝났다는 소식은 **모달 밖으로** 나와야 한다. 단추까지 붙여 그 자리에서 끝낸다. */
    if (ok)
      toast(t("update.ready"), "ok", {
        label: t("update.restart"),
        run: () => void useUpdate.getState().restart(),
      });
  },
  setStaged: (v) => set({ phase: v ? "staged" : "idle" }),

  async check(quiet = false) {
    if (!quiet) set({ checking: true });
    /** ★★**왜 못 봤는지 함께 낸다** (사용자 지적 2026-08-26: *"업데이트가 없는 건지
     *  오류난 건지 모르겠음"*). 붉은 줄에 「확인하지 못했습니다」만 뜨면 최신이라는 뜻인지
     *  고장인지 갈리지 않는다. 까닭은 백엔드가 준다 (`GitHub 404` 처럼). */
    const fail = (why?: string) => {
      if (quiet) return;
      toast(why ? t("update.failedWhy", { why }) : t("update.failed"), "warn");
    };
    try {
      const r = await api<UpdateInfo & { ok: boolean; error?: string }>("/api/update/check");
      if (!r.ok) {
        fail(r.error);
        return;
      }
      set({ info: r });
      /* ★알리는 것은 **새 판이 실제로 받을 수 있을 때**뿐이다 (빌드 중이면 아직 자산이 없다).
         ★★토스트에 **단추를 함께 붙인다** — v2 는 *"Settings 에서 바로 적용하세요"* 라고
           일러 주기만 해서, 알림을 보고도 설정을 찾아 들어가야 했다. 여기서 바로 누른다.
         ★받는 양을 함께 적는다 (패치냐 전체냐를 말하는 대신 숫자만 보인다). */
      if (quiet && r.has_update && !r.building)
        toast(t("update.found", { v: r.latest, size: mb(r.size ?? 0) }), "ok", {
          label: t("update.now"),
          run: () => void get().start(),
        });
      if (!quiet && !r.has_update) toast(t("update.latest"));
    } catch (e) {
      fail(String(e));
    } finally {
      if (!quiet) set({ checking: false });
    }
  },

  async start() {
    if (get().phase !== "idle") return;
    /* ★★**누르면 설정의 업데이트 칸을 연다** (사용자 지시 2026-08-26: *"그냥 지금
       업데이트하기 하면 모달을 띄우는 게 나을듯. 거기서 보라고"*). 알림을 눌렀는데 아무
       변화가 없으면 안 눌린 줄 안다 — 누른 결과가 곧바로 보여야 한다.
       ★모달을 닫아도 괜찮다: 타이틀바 띠가 진행을 잇고, 다 받으면 토스트가 다시 부른다. */
    const { useUi } = await import("./ui");
    useUi.getState().openSettings("general");
    set({ phase: "downloading", done: 0, total: get().info?.size ?? 0 });
    try {
      const r = await api<{ ok: boolean; error?: string }>("/api/update/stage", { method: "POST" });
      /* 끝났다는 소식은 소켓이 물어 온다 (`update_staged`). 다만 **답이 곧 그 소식이기도 하다** —
         이 요청은 다 받을 때까지 기다렸다가 돌아오기 때문이다.
         ★★소켓이 못 오면(끊겼거나 놓쳤거나) 화면이 「받는 중」에서 영영 멈춘다
           (사용자 지적 2026-08-27: *"다 받은 후에 텍스트가 안 바뀜"*). 답으로도 매듭짓는다 —
           소켓이 이미 처리했으면 단계가 `downloading` 이 아니라 여기서 아무 일도 안 한다. */
      if (get().phase === "downloading") {
        if (r.ok) get().finish(true);
        else {
          toast(r.error || t("update.failed"), "warn");
          set({ phase: "idle" });
        }
      }
    } catch (e) {
      toast(String(e), "warn");
      set({ phase: "idle" });
    }
  },

  /** 받다 말고 그만둔다 (사용자 지적 2026-08-26: *"무조건 끝까지 받아야함"*).
   *  ★치우기는 백엔드가 한다 — 받던 쪽이 제 자국을 안다 (`backend/update.py` 의 `clear`). */
  async cancel() {
    if (get().phase !== "downloading") return;
    try {
      await api("/api/update/cancel", { method: "POST" });
    } catch {
      /* 못 끊었어도 화면은 되돌린다 — 소켓의 끝 소식이 곧 온다 */
    }
    set({ phase: "idle", done: 0, total: 0 });
  },

  /** 갈아 끼우고 다시 켠다. ★여기서 돌아오지 않는다 — 껍데기가 앱을 끄기 때문이다.
   *  그래서 **누른 순간 「설치 중」으로 바꿔 둔다** (사용자 지적 2026-08-26:
   *  *"다운 받은 후 설치중 프로그레스가 없음"*). 실패했을 때만 되돌린다. */
  async restart() {
    if (get().phase === "applying") return;
    /* ★★**그림을 만드는 중이면 먼저 묻는다** (사용자 결정 2026-08-26).
       다시 켜기는 사이드카를 **즉시** 죽인다. 그러면 돌고 있던 생성이 통째로 사라지는데,
       NAI 에는 이미 요청이 갔으므로 **Anlas 는 나간 뒤**다. 되돌릴 방법이 없어서 묻는다.
       ★큐를 대신 세우지 않는다 — 기다릴지 버릴지는 사용자가 정할 일이다. */
    const { useQueue } = await import("./queue");
    if (useQueue.getState().phase === "running") {
      const { ask } = await import("./ask");
      const go = await ask({
        title: t("update.restartBusy"),
        body: t("update.restartBusyBody"),
        ok: t("update.restart"),
        cancel: t("common.cancel"),
        danger: true,
      });
      if (!go) return;
    }
    set({ phase: "applying" });
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("apply_update");
    } catch (e) {
      toast(String(e), "warn");
      set({ phase: "staged" });
    }
  },
}));

/** 받는 양을 사람이 읽는 꼴로 — ★소수 한 자리까지만 (숫자가 널뛰면 읽기 어렵다) */
export const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)}MB`;
