import { create } from "zustand";

/** 모드 = 하단 네비의 자리. v2.x 의 모드 전환이 여기로 온다.
 *  싱글·세트는 모드가 아니라 캔버스 탭이므로 여기 없다. */
export type ModeId = "generate" | "gallery" | "censor" | "utility";

export const MODES: { id: ModeId; label: string; color: string }[] = [
  { id: "generate", label: "생성", color: "var(--mode-single)" },
  { id: "gallery", label: "갤러리", color: "var(--mode-gallery)" },
  { id: "censor", label: "자동검열", color: "var(--mode-censor)" },
  { id: "utility", label: "보조 도구", color: "var(--mode-utility)" },
];

const KEY = "peropix.ui";


/** 본문 폰트 — 넷을 번들해 두고 고른다 (styles/fonts.css). 비교해 보려고 넣은 것이다. */
export type FontId = "pretendard" | "spoqa" | "gothic" | "noto";

export const FONTS: { id: FontId; label: string; stack: string }[] = [
  { id: "pretendard", label: "Pretendard", stack: "'Pretendard Variable', Pretendard" },
  { id: "spoqa", label: "Spoqa Han Sans", stack: "'Spoqa Han Sans Neo'" },
  { id: "gothic", label: "Gothic A1", stack: "'Gothic A1'" },
  { id: "noto", label: "Noto Sans KR", stack: "'Noto Sans KR'" },
];

/** 고른 폰트를 `--font-sans` 에 꽂는다. ★폴백은 언제나 뒤에 붙인다 —
 *  번들이 아직 안 실렸을 때 글자가 사라지지 않게. */
export function applyFont(id: FontId) {
  const f = FONTS.find((x) => x.id === id) ?? FONTS[0];
  document.documentElement.style.setProperty(
    "--font-sans",
    `${f.stack}, "Segoe UI", "Malgun Gothic", sans-serif`,
  );
}

type Persisted = {
  leftWidth: number;
  /** AI 채팅 패널 — ★**기본은 접힌 레일**이다 (ui-guide 7절: LLM 은 선택 사항) */
  aiWidth: number;
  aiCollapsed: boolean;
  rightWidth: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  /** 무대에 한 줄로 몇 장을 놓나. ★**1이면 라이트박스**가 된다 — 한 장이 무대를 다 쓴다.
   *  크기 슬라이더를 따로 두지 않는다: 크기는 열 수에서 나온다 (하나의 정보에 하나의 창구). */
  cols: number;
  /** 씬 칸의 칸 크기 3단 (0 작게 · 1 보통 · 2 크게). ★썸네일 슬라이더를 따로 두지 않는다 */
  /** 씬 칸 한 변의 길이(px). ★3단 고정이 아니라 **연속값**이다 (사용자 지시 2026-08-14).
   *  Ctrl+휠로 조절하고, 한 번에 12% 씩 움직인다. */
  laneSize: number;
  /** 씬 줄 머리의 폭(px). 경계를 끌어 바꾼다 */
  laneHeadW: number;
  /** 씬 칸 높이 — 사용자가 손잡이로 정한다 */
  laneHeight: number;
  /** 생성 화면을 끄고 **슬롯만 모아 본다** — 선별 뒤 확인용 (사용자 결정 2026-08-04) */
  curated: boolean;
  /** ★슬롯당 몇 장 만드나 (페로픽스파이 `countPerSlot`). 한 번에 여러 장을 뽑아
   *  고르는 것이 멀티의 본래 쓰임이라, 1장씩 돌리면 같은 일을 여러 번 해야 한다. */
  perSlot: number;
  /** ★큐가 다 끝나면 알린다 — 여러 장을 돌려 놓고 다른 일을 하다 놓치는 것을 막는다 */
  notifyDone: boolean;
  /** ★끝났을 때 **소리로도** 알린다 (v2 `notifySoundOnComplete`). 화면을 안 보고 있을 때 쓴다 */
  notifySound: boolean;
  /** 알림음 크기 1~100 (v2 `notifySoundVolume`, 기본 50) */
  notifyVolume: number;
  font: FontId;
};

const DEFAULTS: Persisted = {
  leftWidth: 380,
  aiWidth: 320,
  aiCollapsed: true,
  rightWidth: 260,
  leftCollapsed: false,
  rightCollapsed: false,
  cols: 4,
  laneSize: 96,
  laneHeadW: 286,
  laneHeight: 302,
  curated: false,
  perSlot: 1,
  notifyDone: true,
  notifySound: false,
  notifyVolume: 50,
  font: "pretendard",
};

/** 한 번에 뽑는 최대 — 큐가 길어지면 취소하기 번거롭다 */
export const PER_SLOT_MAX = 12;
export const COLS_MIN = 1;
export const COLS_MAX = 12;

function load(): Persisted {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {}
  return DEFAULTS;
}

type S = Persisted & {
  mode: ModeId;
  setMode: (m: ModeId) => void;
  setLaneSize: (n: number) => void;
  setLaneHeadW: (n: number) => void;
  setLaneHeight: (n: number) => void;
  setLeftWidth: (w: number) => void;
  setAiWidth: (w: number) => void;
  toggleAi: () => void;
  setRightWidth: (w: number) => void;
  setCols: (n: number) => void;
  setCurated: (v: boolean) => void;
  setPerSlot: (n: number) => void;
  setNotifyDone: (v: boolean) => void;
  setNotifySound: (v: boolean) => void;
  setNotifyVolume: (v: number) => void;
  setFont: (f: FontId) => void;
  toggleLeft: () => void;
  toggleRight: () => void;
  /** 방금 바뀐 자리들 — 키를 담아 두고 잠깐 뒤 스스로 지운다 */
  flashes: string[];
  /** ★**바꿨으면 보여 준다.** 접힌 패널을 펴고 그 자리를 잠깐 강조한다 (사용자 지시 2026-08-13).
   *  말없이 값만 바뀌면 사용자는 자기가 고른 것을 잃은 줄 안다. */
  reveal: (side: "left" | "right", key: string) => void;
  /** 드래그가 끝났을 때만 저장한다 — 매 프레임 localStorage 를 때리지 않는다. */
  commitLayout: () => void;
};

/** 씬 칸 한 변의 한계.
 *
 *  ★위쪽은 **썸네일 해상도**가 정한다 (사용자 지시 2026-08-14). 썸네일은 긴 변 512px 로
 *    굽는다(`backend/thumbs.py MAX_SIDE`). 그보다 크게 키우면 늘려 그리게 되어 흐려진다.
 *    원본으로 갈아 끼우는 길도 만들어 봤지만 쓰지 않기로 했다 (스크롤할 때마다 큰 파일을
 *    받게 되어, 보이는 칸만 그리는 최적화와 정면으로 부딪힌다). */
export const LANE_MIN = 40;
export const LANE_MAX = 256;
/** 씬 줄 머리(그 씬의 프롬프트) 폭의 한계 */
export const HEAD_MIN = 150;
export const HEAD_MAX = 560;

export const useUi = create<S>((set, get) => ({
  ...load(),
  mode: "generate",
  setMode: (m) => set({ mode: m }),
  setLaneSize: (n) => set({ laneSize: Math.min(LANE_MAX, Math.max(LANE_MIN, Math.round(n))) }),
  setLaneHeadW: (n) => set({ laneHeadW: Math.min(HEAD_MAX, Math.max(HEAD_MIN, Math.round(n))) }),
  setLaneHeight: (n) => set({ laneHeight: Math.max(84, Math.round(n)) }),
  setLeftWidth: (w) => set({ leftWidth: w }),
  setAiWidth: (w) => set({ aiWidth: w }),
  toggleAi: () => {
    set({ aiCollapsed: !get().aiCollapsed });
    get().commitLayout();
  },
  setRightWidth: (w) => set({ rightWidth: w }),
  setCols: (n) => {
    set({ cols: Math.min(COLS_MAX, Math.max(COLS_MIN, Math.round(n))) });
    get().commitLayout();
  },
  setCurated: (v) => set({ curated: v }),
  setNotifyDone: (v) => {
    set({ notifyDone: v });
    get().commitLayout();
  },
  setNotifySound: (v) => {
    set({ notifySound: v });
    get().commitLayout();
  },
  setNotifyVolume: (v) => {
    set({ notifyVolume: Math.min(100, Math.max(1, Math.round(v))) });
    get().commitLayout();
  },
  setPerSlot: (n) => {
    set({ perSlot: Math.min(PER_SLOT_MAX, Math.max(1, Math.round(n))) });
    get().commitLayout();
  },
  setFont: (f) => {
    applyFont(f);
    set({ font: f });
    get().commitLayout();
  },
  toggleLeft: () => {
    set({ leftCollapsed: !get().leftCollapsed });
    get().commitLayout();
  },
  toggleRight: () => {
    set({ rightCollapsed: !get().rightCollapsed });
    get().commitLayout();
  },
  flashes: [],
  reveal: (side, key) => {
    const patch = side === "left" ? { leftCollapsed: false } : { rightCollapsed: false };
    set({ ...patch, flashes: [...new Set([...get().flashes, key])] });
    get().commitLayout();
    // ★스스로 꺼진다 — 강조가 남아 있으면 다음에 바뀐 것과 구별이 안 된다
    setTimeout(() => set({ flashes: get().flashes.filter((k) => k !== key) }), 2200);
  },
  commitLayout: () => {
    const { leftWidth, rightWidth, leftCollapsed, rightCollapsed, cols, laneSize, laneHeadW, laneHeight, font, aiWidth, aiCollapsed } =
      get();
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify({
          leftWidth,
          rightWidth,
          leftCollapsed,
          rightCollapsed,
          cols,
          laneSize,
          laneHeadW,
          laneHeight,
          font,
          aiWidth,
          aiCollapsed,
        }),
      );
    } catch {}
  },
}));

/** 방금 바뀐 자리인가 — 강조 스타일을 붙일 때 쓴다.
 *  ★모양은 한 곳에서만 정한다 (`flashStyle`) — 자리마다 다르게 강조하면 학습 대상이 된다. */
export const useFlash = (key: string) => useUi((s) => s.flashes.includes(key));

/** 강조 — 액센트 테두리 + 옅은 바탕. 레이아웃을 밀지 않도록 **outline** 을 쓴다 */
export const flashStyle = (on: boolean): React.CSSProperties =>
  on
    ? {
        outline: "2px solid var(--accent)",
        outlineOffset: 3,
        borderRadius: "var(--r-2)",
        background: "var(--accent-bg)",
        transition: "outline-color 0.2s, background 0.2s",
      }
    : {};
