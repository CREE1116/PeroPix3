import { create } from "zustand";
import { api } from "../lib/backend";

/** 갤러리 — 워크스페이스에 쌓인 그림을 훑어 본다.
 *
 *  ★**파일이 정본이다** (schema.md). 서버가 폴더를 훑어 주므로 여기서도 records 를 안 쓴다.
 *    밖에서 넣은 그림도 보이고, records 가 깨져도 갤러리는 멀쩡하다.
 *
 *  ★메타데이터는 **고른 한 장만** 읽는다. 목록 전체를 읽으면 수백 장에서 몇 초가 나간다. */

export type GalleryImage = { file: string; name: string; bytes: number; mtime: number };
export type GalleryFolder = { path: string; count: number };

export type ImageMeta = {
  prompt?: string;
  negative?: string;
  seed?: number;
  steps?: number;
  cfg?: number;
  sampler?: string;
  scheduler?: string;
  width?: number;
  height?: number;
  /** NAI 가 PNG tEXt 에 넣는 **표시용 문자열** ("NovelAI Diffusion V4.5 …") */
  source?: string;
  software?: string;
  /** ★재생성에 쓰는 **모델 id** (`nai-diffusion-4-5-full`). `source` 와 다른 것이다 —
   *  v2 는 `request_type` 이 "PromptGenerateRequest" 같은 내부 타입일 때 무시한다 */
  nai_model?: string;
  smea?: string;
  uc_preset?: string;
  quality_tags?: boolean;
  cfg_rescale?: number;
  variety_plus?: boolean;
  furry_mode?: boolean;
  slot_prompt?: string;
  /** 이 그림이 순수 NAI 출신인가 (PeroPix 확장이 없다) — 적용 시 경고 대상 */
  pure_nai?: boolean;
  characters?: { prompt: string; negative: string; center: { x: number; y: number } | null }[];
  /** ★NAI 가 남긴 바이브 — **인코딩만** 있고 원본 그림은 없다 (다시 굽지 못한다) */
  nai_vibes?: { images: string[]; strengths: number[]; info_extracted: number[] };
  precise_ref_count?: number;
  raw?: Record<string, unknown>;
};

/** 폴더 전체를 뜻하는 값. `null` 은 "아직 안 정함"과 구분이 안 돼 쓰지 않는다. */
export const ALL = "";

type S = {
  folders: GalleryFolder[];
  items: GalleryImage[];
  folder: string;
  /** 크게 보고 메타데이터를 읽을 한 장 */
  focus: string | null;
  meta: ImageMeta | null;
  metaFor: string | null;
  /** 일괄 작업 대상 (여러 장) */
  picked: Set<string>;
  loading: boolean;
  /** ★쪽 나눠 받는다 (v2 `/api/outputs-list`). 한 번에 다 그리면 DOM 이 그만큼 늘어난다 */
  page: number;
  total: number;
  hasMore: boolean;

  load: (ws: string) => Promise<void>;
  /** 다음 쪽 — 스크롤이 바닥에 가까워지면 부른다 */
  more: (ws: string) => Promise<void>;
  setFolder: (ws: string, folder: string) => Promise<void>;
  setFocus: (ws: string, file: string | null) => Promise<void>;
  togglePick: (file: string) => void;
  pickAll: () => void;
  clearPick: () => void;
  remove: (ws: string) => Promise<number>;
  moveTo: (ws: string, dest: string) => Promise<number>;
  /** ★작업 폴더의 그림을 **보관함으로 복사**한다 (원본은 그대로). 생성 옵션은 PNG 가 안고 간다 */
  keep: (ws: string, file: string, folder?: string) => Promise<void>;
};

const q = (s: string) => encodeURIComponent(s);

/** 서버가 쪽으로 끊어 주는 목록의 공통 모양 */
type Page<T> = { images: T[]; total: number; page: number; pages: number };

export const useGallery = create<S>((set, get) => ({
  folders: [],
  items: [],
  folder: ALL,
  focus: null,
  meta: null,
  metaFor: null,
  picked: new Set(),
  loading: false,
  page: 1,
  total: 0,
  hasMore: false,

  async load(ws) {
    if (!ws) return;
    set({ loading: true });
    const f = get().folder;
    const [folders, r] = await Promise.all([
      api<{ folders: GalleryFolder[] }>(`/api/keep/folders`),
      api<Page<GalleryImage>>(`/api/keep/images?page=1${f ? `&folder=${q(f)}` : ""}`),
    ]);
    // ★사라진 파일은 선택에서도 뺀다 — 지운 뒤 목록만 갱신하면 유령이 남는다
    const alive = new Set(r.images.map((i) => i.file));
    const picked = new Set([...get().picked].filter((p) => alive.has(p)));
    const focus = get().focus && alive.has(get().focus!) ? get().focus : null;
    set({
      folders: folders.folders,
      items: r.images,
      picked,
      focus,
      loading: false,
      page: r.page,
      total: r.total,
      hasMore: r.page < r.pages,
    });
  },

  async more(ws) {
    const { loading, hasMore, page, folder, items } = get();
    if (!ws || loading || !hasMore) return;
    set({ loading: true });
    try {
      const r = await api<Page<GalleryImage>>(
        `/api/keep/images?page=${page + 1}${folder ? `&folder=${q(folder)}` : ""}`,
      );
      // ★이어 붙일 때 **중복을 거른다** — 그 사이 새 그림이 들어오면 쪽 경계가 밀린다
      const seen = new Set(items.map((i) => i.file));
      set({
        items: [...items, ...r.images.filter((i) => !seen.has(i.file))],
        page: r.page,
        total: r.total,
        hasMore: r.page < r.pages,
      });
    } finally {
      set({ loading: false });
    }
  },

  async keep(ws, file, folder = "") {
    await api(`/api/keep/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspace: ws, file, folder }),
    });
  },

  async setFolder(ws, folder) {
    set({ folder, picked: new Set() });
    await get().load(ws);
  },

  async setFocus(_ws, file) {
    set({ focus: file });
    if (!file) return set({ meta: null, metaFor: null });
    if (get().metaFor === file) return;
    const r = await api<{ meta: ImageMeta | null }>(
      `/api/keep/meta?file=${q(file)}`,
    );
    // 읽는 사이에 다른 그림으로 옮겼으면 버린다
    if (get().focus === file) set({ meta: r.meta, metaFor: file });
  },

  togglePick(file) {
    const picked = new Set(get().picked);
    picked.has(file) ? picked.delete(file) : picked.add(file);
    set({ picked });
  },
  pickAll: () => set({ picked: new Set(get().items.map((i) => i.file)) }),
  clearPick: () => set({ picked: new Set() }),

  async remove(ws) {
    const files = [...get().picked];
    if (!files.length) return 0;
    const r = await api<{ deleted: string[] }>(`/api/keep/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files }),
    });
    set({ picked: new Set() });
    await get().load(ws);
    return r.deleted.length;
  },

  async moveTo(ws, dest) {
    const files = [...get().picked];
    if (!files.length) return 0;
    const r = await api<{ moved: string[] }>(`/api/keep/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files, dest }),
    });
    set({ picked: new Set() });
    await get().load(ws);
    return r.moved.length;
  },
}));
