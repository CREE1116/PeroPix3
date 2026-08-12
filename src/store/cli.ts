import { create } from "zustand";
import { api } from "../lib/backend";

/** 로컬 에이전트 CLI — **사용자가 이미 내고 있는 구독을 그대로 쓴다.**
 *
 *  ★탐지는 **공짜**다 (PATH + 툴체인 폴더 스캔). 켤 때마다 불러도 된다.
 *  ★"깔려 있다"와 "몰 수 있다"는 다르다 — 목록에는 다 보이되 `drivable` 인 것만 고를 수 있다.
 *    스트림 파싱이 지금은 클로드 코드 하나뿐이라서다.
 *  ★로그인 여부는 **돌려 봐야 안다.** 그래서 「연결 시험」은 사용자가 누를 때만 돈다
 *    (돈이 든다 — 실측 $0.15). 자동으로 돌리지 않는다. */

export type CliItem = {
  id: string;
  label: string;
  installed: boolean;
  path: string | null;
  drivable: boolean;
};

const KEY = "peropix.engine";
/** ★CLI 도 모델·추론 강도를 고른다 (사용자 지적 2026-08-08 — API 쪽에만 있었다).
 *  `claude --model <별칭|전체이름>` · `claude --effort <단계>` 를 그대로 넘긴다.
 *
 *  ★**언제나 넘긴다 — 기본은 `sonnet` · `high`** (사용자 결정 2026-08-08).
 *    예전엔 "안 넘기면 CLI 기본값"이라는 선택지를 뒀는데, 그 값은 사용자가 **자기 쓰려고**
 *    맞춰 둔 전역 설정(`~/.claude/settings.json`)이라 이 앱의 조수 일과는 상관이 없다
 *    (실제로 `opus[1m]`·`max` 였다 — 카드 정리에 그것을 쓸 이유가 없다).
 *    같은 바이너리·같은 계정을 쓰되 **용도는 갈라야** 해서, 여기서 정하고 사용자가 바꾼다. */
const CLI_MODEL_DEFAULT = "sonnet";
const CLI_EFFORT_DEFAULT = "high";
const MODEL_KEY = "peropix.cliModel";
const EFFORT_KEY = "peropix.cliEffort";
/** `claude --help` 가 적어 둔 단계 (실측 2026-08-08) */
export const CLI_EFFORTS = ["max", "xhigh", "high", "medium", "low"];
/** 도움말이 예로 든 별칭. ★목록 밖 이름은 「직접 입력」으로 넣는다 */
export const CLI_MODELS = ["opus", "sonnet"];
const readStr = (k: string) => {
  try {
    return localStorage.getItem(k) ?? "";
  } catch {
    return "";
  }
};
const writeStr = (k: string, v: string) => {
  try {
    if (v) localStorage.setItem(k, v);
    else localStorage.removeItem(k);
  } catch {
    /* 저장 못 해도 이번 실행에는 그대로 돈다 */
  }
};

type S = {
  /** 어느 엔진으로 대화하나 — API 키(BYOK) 또는 로컬 CLI */
  engine: "api" | "cli";
  /** `--model` 로 넘길 값 (언제나 넘긴다) */
  model: string;
  /** `--effort` 로 넘길 값 (언제나 넘긴다) */
  effort: string;
  setModel: (v: string) => void;
  setEffort: (v: string) => void;
  items: CliItem[];
  scanning: boolean;
  /** 고른 CLI 의 실행 파일 경로 */
  exe: string | null;
  setEngine: (e: "api" | "cli") => void;
  detect: () => Promise<void>;
  pick: (id: string) => void;
  /** 지금 고른 것이 실제로 돌 수 있는 상태인가 */
  ready: () => boolean;
};

/** ★기본은 **CLI** 다 (사용자 결정 2026-08-08). 구독으로 도는 쪽이라 처음 켠 사람이
 *  키 없이 바로 쓸 수 있고, 토큰 요금도 안 나온다. API 는 골라야 켜진다. */
const load = (): "api" | "cli" => {
  try {
    return localStorage.getItem(KEY) === "api" ? "api" : "cli";
  } catch {
    return "cli";
  }
};

export const useCli = create<S>((set, get) => ({
  engine: load(),
  model: readStr(MODEL_KEY) || CLI_MODEL_DEFAULT,
  effort: readStr(EFFORT_KEY) || CLI_EFFORT_DEFAULT,
  setModel(v) {
    writeStr(MODEL_KEY, v);
    set({ model: v });
  },
  setEffort(v) {
    writeStr(EFFORT_KEY, v);
    set({ effort: v });
  },
  items: [],
  scanning: false,
  exe: null,

  setEngine(e) {
    try {
      localStorage.setItem(KEY, e);
    } catch {}
    set({ engine: e });
    if (e === "cli" && !get().items.length) void get().detect();
  },

  async detect() {
    set({ scanning: true });
    try {
      const r = await api<{ items: CliItem[] }>("/api/cli/detect");
      const items = r.items ?? [];
      // 아직 안 골랐으면 **몰 수 있는 것 중 깔린 첫 번째**를 잡아 준다
      const cur = get().exe;
      const auto = items.find((x) => x.drivable && x.installed);
      set({ items, exe: cur ?? auto?.path ?? null });
    } catch {
      set({ items: [] });
    } finally {
      set({ scanning: false });
    }
  },

  pick(id) {
    const it = get().items.find((x) => x.id === id);
    if (it?.installed && it.drivable) set({ exe: it.path });
  },

  ready: () => !!get().exe,
}));
