import { create } from "zustand";
import { api } from "../lib/backend";
import { t } from "../i18n";
import { toast } from "./toast";

/** 태거 모델 상태 — **앱 전역**이다 (사용자 지적 2026-08-29: 다 받았는데 토스트가 안 떴다).
 *
 *  처음에는 Tagger 탭 컴포넌트가 상태를 들고 폴링했는데, 그러면 탭을 떠나 있는 동안(다른 모드,
 *  다른 도구 탭) 완료를 아무도 못 본다 — 컴포넌트가 내려가면 폴링도 완료 감지도 함께 내려간다.
 *  여기서는 받는 동안 **컴포넌트와 무관하게** 1초마다 묻고, 「받는 중 → 준비됨」으로 넘어가는
 *  순간 토스트를 낸다. 타이틀바 띠(`TaggerStrip`)와 Tagger 탭은 이 값을 읽기만 한다.
 *  ★`st === null` 은 아직 못 물어봤다는 뜻이다. */
export type TaggerStatus = {
  ready: boolean;
  downloading: boolean;
  got: number;
  total: number;
  error: string;
};

type S = {
  st: TaggerStatus | null;
  refresh: () => Promise<TaggerStatus | null>;
  /** 내려받기 시작 — 붙들지 않는다: 시작만 알리고 놓아 준다. 진행은 폴링이 그린다 */
  start: () => Promise<void>;
  /** 받던 것을 그만둔다 — 서버가 조각을 치우고, 상태는 「모델 없음」으로 돌아온다 */
  cancel: () => Promise<void>;
};

let timer: number | null = null;
let wasDownloading = false;

/** 상태가 새로 올 때마다: 폴링을 켜고 끄고, 완료 순간을 한 번 알린다 */
function watch(st: TaggerStatus) {
  if (wasDownloading && !st.downloading && st.ready) toast(t("tagger.dlDone"), "ok");
  wasDownloading = st.downloading;
  if (st.downloading && timer == null) {
    timer = window.setInterval(() => void useTagger.getState().refresh(), 1000);
  } else if (!st.downloading && timer != null) {
    window.clearInterval(timer);
    timer = null;
  }
}

export const useTagger = create<S>((set) => ({
  st: null,
  refresh: async () => {
    try {
      const st = await api<TaggerStatus>("/api/tagger/status");
      set({ st });
      watch(st);
      return st;
    } catch (e) {
      toast(String(e), "warn");
      return null;
    }
  },
  start: async () => {
    await api("/api/tagger/download", { method: "POST" });
    toast(t("tagger.dlStarted"));
    await useTagger.getState().refresh();
  },
  cancel: async () => {
    await api("/api/tagger/cancel", { method: "POST" });
    await useTagger.getState().refresh();
  },
}));

/** 받은 비율 (0~100) — 총량을 모르면 0 */
export const taggerPct = (st: TaggerStatus | null) =>
  st && st.total ? Math.min(100, Math.round((st.got / st.total) * 100)) : 0;
