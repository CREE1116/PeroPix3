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

type S = {
  info: UpdateInfo | null;
  /** 확인 중 (설정에서 누른 경우에만 보인다) */
  checking: boolean;
  /** 받는 중 */
  busy: boolean;
  done: number;
  total: number;
  /** 받아서 쌓아 뒀다 — 다시 켜면 적용된다 */
  staged: boolean;
  setProgress: (done: number, total: number) => void;
  setStaged: (v: boolean) => void;
  /** @param quiet 부팅 때처럼 **조용히** 확인한다 (실패해도 아무 말 안 한다) */
  check: (quiet?: boolean) => Promise<void>;
  start: () => Promise<void>;
  restart: () => Promise<void>;
};

export const useUpdate = create<S>((set, get) => ({
  info: null,
  checking: false,
  busy: false,
  done: 0,
  total: 0,
  staged: false,
  setProgress: (done, total) => set({ done, total }),
  setStaged: (v) => set({ staged: v, busy: false }),

  async check(quiet = false) {
    if (!quiet) set({ checking: true });
    try {
      const r = await api<UpdateInfo & { ok: boolean; error?: string }>("/api/update/check");
      if (!r.ok) {
        if (!quiet) toast(t("update.failed"), "warn");
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
    } catch {
      if (!quiet) toast(t("update.failed"), "warn");
    } finally {
      if (!quiet) set({ checking: false });
    }
  },

  async start() {
    if (get().busy) return;
    set({ busy: true, done: 0, total: get().info?.size ?? 0 });
    try {
      const r = await api<{ ok: boolean; error?: string }>("/api/update/stage", { method: "POST" });
      if (!r.ok) {
        toast(r.error || t("update.failed"), "warn");
        set({ busy: false });
      }
      // 끝났다는 소식은 소켓이 물어 온다 (`update_staged`) — 여기서 끄지 않는다
    } catch (e) {
      toast(String(e), "warn");
      set({ busy: false });
    }
  },

  async restart() {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("apply_update");
    } catch (e) {
      toast(String(e), "warn");
    }
  },
}));

/** 받는 양을 사람이 읽는 꼴로 — ★소수 한 자리까지만 (숫자가 널뛰면 읽기 어렵다) */
export const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)}MB`;
