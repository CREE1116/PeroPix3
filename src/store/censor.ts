import { create } from "zustand";
import { api } from "../lib/backend";

/** 검열 — **찾고, 고르고, 가린다.**
 *
 *  ★찾기와 가리기는 **따로**다 (v2 도 그랬다). 찾은 것을 사람이 손보고 나서 가린다 —
 *    자동으로 바로 가려 버리면 잘못 찾은 것을 되돌릴 수 없다 (원본을 안 건드리니 파일은
 *    남지만, 사용자가 결과를 보기 전에는 무엇이 가려졌는지 모른다).
 *  ★모델은 **앱에 들어 있다** — 받아 오는 절차가 없다 (backend/censor.py 머리 주석).
 */
export type Box = {
  label: string;
  confidence: number;
  box: [number, number, number, number];
  passes_threshold?: boolean;
  /** 사람이 끈 것 — 목록에는 두고 적용에서만 뺀다 */
  off?: boolean;
  /** 사람이 그린 것 */
  manual?: boolean;
};

export type CensorModel = { id: string; file: string; classes: string[]; bytes: number; imgsz: number };

type Source = { workspace?: string; file?: string; rel?: string };

type S = {
  models: CensorModel[];
  model: string | null;
  /** 지금 손보고 있는 그림 (아웃풋 루트 기준) */
  target: string | null;
  size: { w: number; h: number } | null;
  boxes: Box[];
  targets: string[];
  conf: number;
  method: string;
  color: string;
  expand: number;
  feather: number;
  mosaic: number;
  mosaicOpacity: number;
  blur: number;
  busy: boolean;
  error: string | null;
  saved: string | null;

  loadModels: () => Promise<void>;
  /** ★모델마다 **클래스 이름이 다르다** (기본 nipples… / XL nipple·female face…).
   *  바꾸면 대상 목록도 그 모델 것으로 갈아 끼워야 한다 — 안 그러면 아무것도 안 찾는다. */
  setModel: (file: string) => void;
  open: (rel: string) => void;
  detect: () => Promise<void>;
  apply: () => Promise<void>;
  toggleTarget: (label: string) => void;
  toggleBox: (i: number) => void;
  addBox: (b: [number, number, number, number]) => void;
  removeBox: (i: number) => void;
  set: (patch: Partial<S>) => void;
};

const post = <T,>(path: string, body: unknown) =>
  api<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const useCensor = create<S>((set, get) => ({
  models: [],
  model: null,
  target: null,
  size: null,
  boxes: [],
  targets: [],
  conf: 0.25,
  method: "mosaic",
  color: "#000000",
  expand: 0,
  feather: 0,
  mosaic: 12,
  mosaicOpacity: 100,
  blur: 20,
  busy: false,
  error: null,
  saved: null,

  async loadModels() {
    const r = await api<{ models: CensorModel[] }>("/api/censor/models");
    const first = r.models[0];
    set({
      models: r.models,
      model: get().model ?? first?.file ?? null,
      // ★처음엔 **전부** 대상이다. 켜는 것을 잊어 아무것도 안 찾는 일이 없게.
      targets: get().targets.length ? get().targets : (first?.classes ?? []),
    });
  },

  setModel(file) {
    const m = get().models.find((x) => x.file === file);
    set({ model: file, targets: m?.classes ?? [], boxes: [], saved: null, error: null });
  },

  open: (rel) => set({ target: rel, boxes: [], saved: null, error: null }),

  async detect() {
    const { target, model, targets, conf } = get();
    if (!target || get().busy) return;
    set({ busy: true, error: null, saved: null });
    try {
      const r = await post<{ detections: Box[]; width: number; height: number }>("/api/censor/detect", {
        rel: target,
        model,
        targets,
        default_conf: conf,
      });
      set({ boxes: r.detections, size: { w: r.width, h: r.height } });
    } catch (e) {
      set({ error: String(e) });
    } finally {
      set({ busy: false });
    }
  },

  async apply() {
    const s = get();
    if (!s.target || s.busy) return;
    const boxes = s.boxes.filter((b) => !b.off).map((b) => ({ box: b.box }));
    if (!boxes.length) return set({ error: "가릴 곳이 없습니다" });
    set({ busy: true, error: null });
    try {
      const r = await post<{ file: string; name: string }>("/api/censor/apply", {
        rel: s.target,
        boxes,
        method: s.method,
        color: s.color,
        expand: s.expand,
        feather: s.feather,
        mosaic_strength: s.mosaic,
        mosaic_opacity: s.mosaicOpacity,
        blur_strength: s.blur,
      });
      set({ saved: r.name });
    } catch (e) {
      set({ error: String(e) });
    } finally {
      set({ busy: false });
    }
  },

  toggleTarget(label) {
    const t = get().targets;
    set({ targets: t.includes(label) ? t.filter((x) => x !== label) : [...t, label] });
  },

  toggleBox: (i) => set({ boxes: get().boxes.map((b, n) => (n === i ? { ...b, off: !b.off } : b)) }),
  addBox: (box) =>
    set({ boxes: [...get().boxes, { label: "직접", confidence: 1, box, manual: true }] }),
  removeBox: (i) => set({ boxes: get().boxes.filter((_, n) => n !== i) }),
  set: (patch) => set(patch as S),
}));

export type { Source };
