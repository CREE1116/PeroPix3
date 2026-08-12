import { create } from "zustand";
import { vibeDefaults } from "../lib/vibeDefaults";
import { useGen } from "./gen";

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
  /** ★타일 인페인트 — 이 베이스 그림이 **워크스페이스 파일**이면 그 경로.
   *  있으면 서버가 그 파일을 열어 **사각형 안만** 잘라 보내고 결과를 그 자리에 되붙인다.
   *  밖에서 떨군 그림에는 없다 (그때는 지금까지의 인페인트 그대로다). */
  baseFrom: { ws: string; file: string } | null;
  /** ★「인페인트+」 — **켜야 타일 경로를 탄다** (사용자 지시 2026-08-13).
   *
   *  끄면 **공홈과 같은 기본 인페인트**다: 그림 전체를 보내고 요청 크기로 그린다.
   *  켜면 사각형 안만 잘라 보내고 결과를 그 자리에 되붙인다 — 원본 해상도가 지켜지고
   *  요청이 1MP 이하라 값이 안 나간다. **기본을 대체하는 것이 아니라 얹는 기능이다.** */
  tilePlus: boolean;
  /** 크롭 사각형 (원본 좌표계). 「인페인트+」를 켜면 칠한 자리에 맞춰 자동으로 잡힌다 */
  tileRect: { x: number; y: number; w: number; h: number } | null;

  setVibeOn: (v: boolean) => void;
  addVibe: (image: string, name: string) => void;
  patchVibe: (i: number, p: Partial<Vibe>) => void;
  removeVibe: (i: number) => void;

  setRefOn: (v: boolean) => void;
  addRef: (r: PreciseRef) => void;
  patchRef: (i: number, p: Partial<PreciseRef>) => void;
  removeRef: (i: number) => void;

  setBase: (image: string, name: string, from?: { ws: string; file: string } | null) => void;
  setTileRect: (r: { x: number; y: number; w: number; h: number } | null) => void;
  setTilePlus: (v: boolean) => void;
  clearBase: () => void;
  patchBase: (p: Partial<Pick<S, "baseMode" | "baseStrength" | "baseInpaintStrength" | "baseNoise" | "baseMask">>) => void;

  /** ★생성 요청에 실을 조각. **단발·큐 두 경로가 같은 것을 쓴다** (하나의 정보에는 하나의 창구) */
  payload: () => Record<string, unknown>;
};

/** v2 제한 그대로 (index.html:18376) */
export const MAX_VIBES = 16;

export const useImageInput = create<S>((set, get) => ({
  vibeOn: false,
  vibes: [],
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
  tilePlus: false,
  tileRect: null,

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

  setRefOn: (v) => set(v ? { refOn: true, vibeOn: false } : { refOn: false }),
  addRef: (r) => set((s) => ({ refs: [...s.refs, r] })),
  patchRef: (i, p) => set((s) => ({ refs: s.refs.map((r, k) => (k === i ? { ...r, ...p } : r)) })),
  removeRef: (i) => set((s) => ({ refs: s.refs.filter((_, k) => k !== i) })),

  setBase: (image, name, from = null) =>
    set({ baseImage: image, baseName: name, baseMask: "", baseFrom: from,
          tileRect: null, tilePlus: false }),
  clearBase: () =>
    set({ baseImage: "", baseName: "", baseMask: "", baseMode: "img2img",
          baseFrom: null, tileRect: null, tilePlus: false }),
  setTileRect: (r) => set({ tileRect: r }),
  setTilePlus: (v) => set({ tilePlus: v, ...(v ? null : { tileRect: null }) }),
  patchBase: (p) => set(p),

  payload() {
    const s = get();
    return {
      vibe_transfer: s.vibeOn ? s.vibes : [],
      precise_references: s.refOn ? s.refs.map((r) => ({
        image: r.image, mode: r.mode, strength: r.strength, fidelity: r.fidelity,
      })) : [],
      base_image: s.baseImage,
      base_mode: s.baseMode,
      base_strength: s.baseStrength,
      base_inpaint_strength: s.baseInpaintStrength,
      base_noise: s.baseNoise,
      // ★마스크는 인페인트일 때만 보낸다 — i2i 로 되돌려 놓고 마스크가 남아 있으면 엉뚱하게 인페인트가 된다
      base_mask: s.baseMode === "inpaint" ? s.baseMask : "",
      // ★「인페인트+」를 **켰을 때만** 타일 경로를 탄다. 끄면 공홈과 같은 기본 인페인트다
      inpaint_from: s.baseMode === "inpaint" && s.tilePlus && s.tileRect ? (s.baseFrom?.file ?? "") : "",
      inpaint_rect: s.baseMode === "inpaint" && s.tilePlus && s.baseFrom ? s.tileRect : null,
    };
  },
}));

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
