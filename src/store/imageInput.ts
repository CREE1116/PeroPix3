import { create } from "zustand";
import { vibeDefaults } from "../lib/vibeDefaults";
import { canFocus, defaultRect, wholeRectMask } from "../lib/focused";
import { sizeForBase } from "../lib/baseSize";
import { toast } from "./toast";
import { useSceneFocus } from "./sceneFocus";
import { pausePromptSave, usePrompt } from "./prompt";
import { t } from "../i18n";
import { useGen } from "./gen";
import { api } from "../lib/backend";

/** 이미지 입력 — Vibe Transfer · Precise Reference · 베이스 이미지(i2i·인페인트).
 *
 *  ★**v2 원문을 옮긴 것이다** (`docs/v2-port-plan.md` 5단계 — 재구현 금지 구간).
 *    백엔드는 이미 v2 와 필드 단위로 일치한다(`test_payload_vs_v2.py` 14케이스). 여기서 할 일은
 *    **그 백엔드가 받는 모양 그대로** 만들어 주는 것뿐이다 (`backend/nai.py` 의 `GenRequest`).
 *
 *  ★그림(base64)은 **저장하지 않는다.** v2도 그랬다 (`saveAppSettings` 가 image 를 뺀다) —
 *    바이브 한 장이 수 MB라 localStorage 가 터진다. 앱을 다시 켜면 목록은 비어 있다.
 */

export type Vibe = {
  /** 원본 그림 (base64, 접두어 없음) */
  image: string;
  name: string;
  /** 0.01~1. ★바뀌면 인코딩을 다시 구워야 한다 (유료) — `vibe.reuse_ok` 가 판정한다 */
  info_extracted: number;
  strength: number;
  /** 구워 둔 인코딩. 서버가 채워 돌려준다 */
  encoded?: string;
  encoded_model?: string;
  encoded_info_extracted?: number;
};

export type PreciseRef = {
  /** ★캔버스로 이미 다듬은 그림 (1472² · 1536×1024 · 1024×1536 중 하나, 검은 레터박스) */
  image: string;
  /** 미리보기용 원본 */
  preview: string;
  name: string;
  mode: "character&style" | "character" | "style";
  strength: number;
  /** ★UI 값이 뒤집혀 나간다 — 서버가 `secondary = 1 - fidelity` 로 보낸다 */
  fidelity: number;
};

export type BaseMode = "img2img" | "inpaint";

type S = {
  vibeOn: boolean;
  vibes: Vibe[];
  /** ★강도 정규화 — 공홈에도 같은 토글이 있다 (기본 켜짐, `docs/nai-web-reference.md` 8절).
   *  켜져 있고 2장 이상이며 강도 합이 1을 넘으면 각 값을 합으로 나눠 보낸다.
   *  ★그 문서가 "정규화는 사용자 토글이다. 하드코딩하지 말 것"이라고 못 박은 항목이다. */
  normalizeVibe: boolean;
  refOn: boolean;
  refs: PreciseRef[];

  /** 베이스 이미지 (base64). 있으면 i2i, 마스크까지 있으면 인페인트 */
  baseImage: string;
  baseName: string;
  baseMode: BaseMode;
  baseStrength: number;
  /** ★인페인트 강도는 **별개 슬라이더**다 (`docs/nai-web-reference.md` 7절).
   *  기본 1 이고, 1 이면 마스크 영역을 완전히 새로 그린다. img2img 강도(`baseStrength`)는
   *  인페인트에서도 `strength` 로 따로 나간다 — 한 값으로 합치지 말 것. */
  baseInpaintStrength: number;
  baseNoise: number;
  baseMask: string;
  /** ★Focused Inpainting. 이 베이스 그림이 **워크스페이스 파일**이면 그 경로.
   *  있으면 서버가 그 파일을 열어 **사각형 안만** 잘라 보내고 결과를 그 자리에 되붙인다.
   *  밖에서 떨군 그림에는 없다 (그때는 지금까지의 인페인트 그대로다). */
  baseFrom: { ws: string; file: string } | null;
  /** 베이스 그림의 실제 크기. 사각형·최종 해상도가 전부 이 값을 기준으로 잡힌다 */
  baseSize: { w: number; h: number } | null;
  /** ★Focused Inpainting 을 켰나 (`lib/focused.ts`).
   *
   *  끄면 **공홈과 같은 기본 인페인트**다: 그림 전체를 보내고 요청 크기로 그린다 (줄어든다).
   *  켜면 사각형 안만 잘라 1MP 로 키워 보내고 결과를 원래 크기로 되돌려 되붙인다.
   *  ★1MP 를 넘는 그림에서 **저절로 켜진다**. 그 그림은 켜지 않으면 결과가 줄어든다. */
  focused: boolean;
  /** 크롭 사각형 (원본 좌표계) */
  tileRect: { x: number; y: number; w: number; h: number } | null;
  /** 지금 마스크를 칠하는 중인가. 켜면 캔버스 자리가 마스크 편집으로 바뀐다 */
  editing: boolean;
  /** 고치는 그림이 있던 **씬 칸**. 결과를 그 옆에 붙이려고 들고 있는다 (`queueInpaint`) */
  originCell: { id: string } | null;

  setVibeOn: (v: boolean) => void;
  setNormalizeVibe: (v: boolean) => void;
  addVibe: (image: string, name: string) => void;
  patchVibe: (i: number, p: Partial<Vibe>) => void;
  removeVibe: (i: number) => void;
  /** 목록을 통째로 갈아 끼운다 (그림 메타데이터에서 되살릴 때) */
  setVibes: (v: Vibe[]) => void;
  /** 서버에 구워 둔 인코딩이 있는지 물어 `encoded` 를 맞춘다 (`/api/vibe-cache/check`) */
  syncVibeCache: () => Promise<void>;
  /** 비용 계산에 쓰는 강도 계수 (`docs/nai-web-reference.md` 9절) */
  costStrength: () => number;
  /** 지금 **마스크를 실어 보내는가** — 공홈은 인페인트면 바이브 비용을 통째로 뺀다 (9절) */
  costInpaint: () => boolean;

  setRefOn: (v: boolean) => void;
  addRef: (r: PreciseRef) => void;
  patchRef: (i: number, p: Partial<PreciseRef>) => void;
  removeRef: (i: number) => void;

  setBase: (image: string, name: string, from?: { ws: string; file: string } | null) => void;
  setTileRect: (r: { x: number; y: number; w: number; h: number } | null) => void;
  setFocused: (v: boolean) => void;
  /** 마스크 칠하기로 들어간다. 큰 그림이면 Focused 를 켜 주고 알린다 */
  startEdit: () => void;
  endEdit: () => void;
  clearBase: () => void;
  patchBase: (p: Partial<Pick<S, "baseMode" | "baseStrength" | "baseInpaintStrength" | "baseNoise" | "baseMask">>) => void;

  /** ★생성 요청에 실을 조각. **단발·큐 두 경로가 같은 것을 쓴다** (하나의 정보에는 하나의 창구) */
  payload: () => Record<string, unknown>;
};

/** v2 제한 그대로 (index.html:18376) */
export const MAX_VIBES = 16;

/** 베이스 그림 크기를 재는 중인 약속. `startEdit` 이 그 뒤에 자동 켜기를 판단한다 */
let measuring: Promise<void> | null = null;

/** 캐시 조회 회차. 늦게 온 답이 새 목록을 덮지 않게 한다 */
let syncSeq = 0;

/** ★인페인트는 **씬 프롬프트의 사본**을 편집한다 (사용자 결정 2026-08-13).
 *
 *  구조는 같아야 한다: 같은 왼쪽 패널에서 블록·캐릭터·UC 를 그대로 고친다. 다만 거기서
 *  고친 것이 **씬 카드에 남으면 안 된다** (얼굴 고치려고 프롬프트를 줄였는데 그 씬이
 *  통째로 바뀌는 사고). 그래서 들어갈 때 씬 것을 치워 두고 사본을 얹는다.
 *  ★사본은 나가도 남는다. 마스크와 한 짝이라, 여러 번 돌릴 때 그대로 이어져야 한다. */
type PromptSnap = ReturnType<typeof usePrompt.getState>["snapshot"] extends () => infer R ? R : never;
let sceneStash: PromptSnap | null = null;
let inpaintPrompt: PromptSnap | null = null;

export const useImageInput = create<S>((set, get) => ({
  vibeOn: false,
  vibes: [],
  normalizeVibe: true,
  refOn: false,
  refs: [],
  baseImage: "",
  baseName: "",
  baseMode: "img2img",
  baseStrength: 0.7,
  baseInpaintStrength: 1,
  baseNoise: 0,
  baseMask: "",
  baseFrom: null,
  baseSize: null,
  focused: false,
  tileRect: null,
  editing: false,
  originCell: null,

  // ★바이브와 레퍼런스는 **동시에 못 쓴다** (NAI 제약, v2 index.html:18366). 켜면 다른 쪽을 끈다
  setVibeOn: (v) => set(v ? { vibeOn: true, refOn: false } : { vibeOn: false }),
  addVibe: (image, name) =>
    set((s) =>
      s.vibes.length >= MAX_VIBES
        ? s
        : {
            // ★기본값은 **모델마다 다르다** (`lib/vibeDefaults.ts` — 공홈 `rp()`).
            //   1.0 으로 박아 두면 우리 기본 모델(V4.5 Full)에서 공홈과 다른 인코딩이 구워진다.
            vibes: [
              ...s.vibes,
              (() => {
                const d = vibeDefaults(useGen.getState().params.model);
                return { image, name, info_extracted: d.infoExtracted, strength: d.strength };
              })(),
            ],
          },
    ),
  patchVibe: (i, p) =>
    set((s) => ({ vibes: s.vibes.map((v, k) => (k === i ? { ...v, ...p } : v)) })),
  removeVibe: (i) => set((s) => ({ vibes: s.vibes.filter((_, k) => k !== i) })),
  setVibes: (v) => set({ vibes: v.slice(0, MAX_VIBES) }),
  setNormalizeVibe: (v) => set({ normalizeVibe: v }),

  async syncVibeCache() {
    // ★판정은 **서버 하나**가 한다 (`backend/vibe.reuse_ok`·`cache_key`). 여기서 다시
    //   비교하지 말 것 — 두 벌이 되면 화면은 공짜라고 하는데 실제로는 Anlas 가 나간다.
    //   큰 인코딩은 올리지 않고 "들고 있는가 + 어느 모델·info 로 구웠나"만 보낸다.
    const items = get().vibes;
    if (!items.length) return;
    const model = useGen.getState().params.model;
    const tag = ++syncSeq;
    try {
      const r = await api<{ items: { keep: boolean; encoded?: string | null;
                                     encoded_model?: string | null;
                                     encoded_info_extracted?: number | null }[] }>(
        "/api/vibe-cache/check",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            items: items.map((v) => ({
              image: v.image,
              info_extracted: v.info_extracted,
              has_encoded: !!v.encoded,
              encoded_model: v.encoded_model ?? null,
              encoded_info_extracted: v.encoded_info_extracted ?? null,
            })),
          }),
        },
      );
      // ★늦게 도착한 답은 버린다 — 그 사이 목록이 바뀌었으면 자리가 어긋난다
      if (tag !== syncSeq) return;
      const now = get().vibes;
      if (now.length !== items.length || now.some((v, i) => v.image !== items[i].image)) return;
      set({
        vibes: now.map((v, i) => {
          const a = r.items[i];
          if (!a || a.keep) return v;
          if (a.encoded)
            return { ...v, encoded: a.encoded, encoded_model: a.encoded_model ?? model,
                     encoded_info_extracted: a.encoded_info_extracted ?? v.info_extracted };
          // 들고 있던 인코딩이 지금 모델·info 에 안 맞고 캐시에도 없다 — 다시 구워야 한다
          if (!v.encoded) return v;
          return { ...v, encoded: undefined, encoded_model: undefined,
                   encoded_info_extracted: undefined };
        }),
      });
    } catch {
      // 물어보지 못한 것은 **모르는 것**이다. 들고 있는 값을 건드리지 않는다
    }
  },

  costStrength() {
    // ★`y = mask ? (inpaintImg2ImgStrength ?? 1) : (image ? strength : 1)` (9절).
    //   ★인페인트는 **칠하는 동안에만** 베이스가 실린다 (`payload()` 와 같은 규칙) —
    //     나간 상태에서 인페인트 강도로 세면 실제로 안 나가는 값으로 값을 매기게 된다.
    const s = get();
    if (s.baseMode === "inpaint") return s.editing && s.baseImage ? s.baseInpaintStrength : 1;
    return s.baseImage ? s.baseStrength : 1;
  },

  costInpaint() {
    // ★`costStrength` 의 인페인트 갈래와 **같은 조건**이다 — 마스크가 실리는 때가 곧
    //   인페인트다 (`payload()`: 나간 상태에서는 베이스도 마스크도 안 싣는다).
    //   갈라 적으면 강도는 인페인트로 세면서 바이브는 아닌 것으로 세는 상태가 생긴다
    const s = get();
    return s.baseMode === "inpaint" && s.editing && !!s.baseImage;
  },

  setRefOn: (v) => set(v ? { refOn: true, vibeOn: false } : { refOn: false }),
  addRef: (r) => set((s) => ({ refs: [...s.refs, r] })),
  patchRef: (i, p) => set((s) => ({ refs: s.refs.map((r, k) => (k === i ? { ...r, ...p } : r)) })),
  removeRef: (i) => set((s) => ({ refs: s.refs.filter((_, k) => k !== i) })),

  setBase: (image, name, from = null) => {
    // 대상이 바뀌면 인페인트 프롬프트 사본도 버린다 (다른 그림의 프롬프트다)
    inpaintPrompt = null;
    set({ baseImage: image, baseName: name, baseMask: "", baseFrom: from,
          baseSize: null, tileRect: null, focused: false, editing: false, originCell: null });
    // ★크기는 **여기서 한 번만** 잰다. 사각형·최종 해상도·자동 켜기가 전부 이 값을 본다.
    //   부르는 쪽마다 따로 재게 하면 어느 값이 진짜인지 갈린다.
    measuring = new Promise<void>((done) => {
      const im = new Image();
      im.onload = () => {
        if (get().baseImage === image) set({ baseSize: { w: im.naturalWidth, h: im.naturalHeight } });
        done();
      };
      im.onerror = () => done();
      im.src = "data:image/png;base64," + image;
    });
  },
  clearBase: () =>
    set({ baseImage: "", baseName: "", baseMask: "", baseMode: "img2img", baseFrom: null,
          baseSize: null, tileRect: null, focused: false, editing: false, originCell: null }),
  setTileRect: (r) => set({ tileRect: r }),

  setFocused: (v) => {
    const s = get();
    const size = s.baseSize;
    if (v && !size) return;
    set({
      focused: v,
      tileRect: v ? (s.tileRect ?? defaultRect(size!.w, size!.h)) : null,
    });
    // ★최종 해상도를 따라 바꾼다. 켜면 **원본 크기 그대로**(되붙이므로), 끄면 그림 전체를
    //   보내는 크기다. 값이 남아 있으면 끈 채로 눌렀을 때 3MP 짜리 요청이 나간다.
    if (v && size) useGen.setState({ params: { ...useGen.getState().params, width: size.w, height: size.h } });
    else if (size) {
      const next = sizeForBase(size.w, size.h);
      if (next) useGen.setState({ params: { ...useGen.getState().params, ...next } });
    }
  },

  startEdit: () => {
    if (!get().baseImage) return;
    // ★어느 씬 칸의 그림인지 **여기서** 잡아 둔다. 결과가 그 자리에 붙어야 화면에 보인다
    const cell = useSceneFocus.getState().cell;
    set({ editing: true, baseMode: "inpaint", originCell: cell ? { id: cell } : null });
    // 씬 프롬프트를 치워 두고 인페인트 사본을 얹는다 (없으면 씬 것을 복사해 시작)
    const p = usePrompt.getState();
    sceneStash = p.snapshot();
    pausePromptSave(true);
    p.load(inpaintPrompt ?? sceneStash);
    // ★큰 그림은 켜 두고 알린다. 끈 채로 보내면 결과가 통째로 줄어드는 그림이다.
    //   크기를 아직 재는 중일 수 있어 그 뒤에 판단한다 (`measuring`)
    void (measuring ?? Promise.resolve()).then(() => {
      const s = get();
      if (!s.editing || s.focused || !s.baseFrom || !s.baseSize) return;
      if (!canFocus(s.baseSize.w, s.baseSize.h)) return;
      s.setFocused(true);
      toast(t("focus.auto"));
    });
  },
  endEdit: () => {
    if (!get().editing) return;
    // 사본을 들고 나가고 씬 프롬프트를 되돌린다
    const p = usePrompt.getState();
    inpaintPrompt = p.snapshot();
    if (sceneStash) p.load(sceneStash);
    sceneStash = null;
    pausePromptSave(false);
    set({ editing: false });
  },

  patchBase: (p) => {
    // ★이어 그리기로 돌아가면 Focused 를 끈다. 켜져 있는 동안 해상도 칸은 **원본 크기**라,
    //   그대로 i2i 로 나가면 3MP 를 넘어 NAI 가 거절한다 (2048² = 4.2MP)
    if (p.baseMode === "img2img" && get().focused) get().setFocused(false);
    set(p);
  },

  payload() {
    const s = get();
    // ★인페인트는 **칠하는 동안에만** 존재한다 (사용자 지적 2026-08-13).
    //   나간 뒤에도 베이스가 남아 있으면, 슬롯 전체를 도는 「생성」이 인페인트로 나가
    //   5슬롯에 5장이 만들어진다. 나간 상태에서는 베이스를 아예 안 싣는다.
    if (s.baseMode === "inpaint" && !s.editing) {
      return {
        vibe_transfer: s.vibeOn ? s.vibes : [],
        precise_references: s.refOn ? s.refs.map((r) => ({
          image: r.image, mode: r.mode, strength: r.strength, fidelity: r.fidelity,
        })) : [],
        normalize_reference_strength: s.normalizeVibe,
        base_image: "", base_mode: "img2img", base_strength: s.baseStrength,
        base_inpaint_strength: s.baseInpaintStrength, base_noise: s.baseNoise,
        base_mask: "", inpaint_from: "", inpaint_rect: null,
      };
    }
    const focusing = s.baseMode === "inpaint" && s.focused && !!s.tileRect && !!s.baseFrom;
    // ★아무것도 안 칠했으면 **사각형 안쪽 전체**를 보낸다 (공홈과 같다). 화면에 미리 칠해
    //   보여 주지 않으므로 마스크는 비어 있고, 보낼 때 여기서 만든다.
    const mask =
      focusing && !s.baseMask && s.baseSize
        ? wholeRectMask(s.tileRect!, s.baseSize.w, s.baseSize.h)
        : s.baseMask;
    return {
      vibe_transfer: s.vibeOn ? s.vibes : [],
      precise_references: s.refOn ? s.refs.map((r) => ({
        image: r.image, mode: r.mode, strength: r.strength, fidelity: r.fidelity,
      })) : [],
      // ★사용자 토글이다 (8절). 꺼 두면 합이 1을 넘어도 값을 그대로 보낸다
      normalize_reference_strength: s.normalizeVibe,
      base_image: s.baseImage,
      base_mode: s.baseMode,
      base_strength: s.baseStrength,
      base_inpaint_strength: s.baseInpaintStrength,
      base_noise: s.baseNoise,
      // ★마스크는 인페인트일 때만 보낸다 — i2i 로 되돌려 놓고 마스크가 남아 있으면 엉뚱하게 인페인트가 된다
      base_mask: s.baseMode === "inpaint" ? mask : "",
      // ★Focused 를 **켰을 때만** 잘라 보낸다. 끄면 공홈과 같은 기본 인페인트다
      inpaint_from: focusing ? (s.baseFrom?.file ?? "") : "",
      inpaint_rect: focusing ? s.tileRect : null,
    };
  },
}));

/** 바이브 한 장을 목록 끝에 **값까지 갖춘 채로** 붙인다.
 *
 *  ★`addVibe` 는 꽉 차면 조용히 아무것도 안 한다. 그 뒤에 「길이 − 1」을 고치면 엉뚱한
 *    항목이 바뀌므로 여기서 먼저 막고 결과를 돌려준다. 캐시 뷰어와 `.naiv4vibe` 임포트가
 *    같은 길을 쓴다 — 넣는 창구가 여럿이 되면 켬/끔 처리가 갈린다. */
export function pushVibe(v: Vibe): boolean {
  const s = useImageInput.getState();
  if (s.vibes.length >= MAX_VIBES) return false;
  // ★Vibe 와 Precise Reference 는 함께 못 쓴다 — 켜면 다른 쪽이 꺼진다 (v2 와 같다)
  s.setVibeOn(true);
  s.addVibe(v.image, v.name);
  const i = useImageInput.getState().vibes.length - 1;
  s.patchVibe(i, {
    strength: v.strength,
    info_extracted: v.info_extracted,
    encoded: v.encoded,
    encoded_model: v.encoded_model,
    encoded_info_extracted: v.encoded_info_extracted,
  });
  return true;
}

/** 파일 → base64 (접두어 없음). v2 `fileToBase64` (index.html:18400) 와 같다 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

/** ★Precise Reference 는 **보내기 전에 캔버스로 다듬는다** — NAI 웹과 같은 결과를 얻으려면
 *  세 가지 판(1472² · 1536×1024 · 1024×1536) 중 하나에 비율을 지켜 얹고 남는 자리는 검게 채운다
 *  (v2 `processPreciseReferenceImage`, index.html:18497). 서버가 아니라 **여기서** 해야 한다. */
export function processReference(base64: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const [tw, th] =
        img.width > img.height ? [1536, 1024] : img.width < img.height ? [1024, 1536] : [1472, 1472];
      const c = document.createElement("canvas");
      c.width = tw;
      c.height = th;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, tw, th);
      const scale = Math.min(tw / img.width, th / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.drawImage(img, (tw - w) / 2, (th - h) / 2, w, h);
      resolve(c.toDataURL("image/png").split(",")[1]);
    };
    img.onerror = () => reject(new Error("그림을 읽지 못했습니다"));
    img.src = base64.startsWith("data:") ? base64 : "data:image/png;base64," + base64;
  });
}
