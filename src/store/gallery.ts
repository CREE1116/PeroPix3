import { create } from "zustand";
import { api, type TrashEntry } from "../lib/backend";
import { t } from "../i18n";
import { toast, undoToast } from "./toast";

/** 갤러리 — 워크스페이스에 쌓인 그림을 훑어 본다.
 *
 *  ★**파일이 정본이다** (schema.md). 서버가 폴더를 훑어 주므로 여기서도 records 를 안 쓴다.
 *    밖에서 넣은 그림도 보이고, records 가 깨져도 갤러리는 멀쩡하다.
 *
 *  ★메타데이터는 **고른 한 장만** 읽는다. 목록 전체를 읽으면 수백 장에서 몇 초가 나간다. */

/** ★칸 이름은 **서버가 주는 그대로**다 (`size`). 예전엔 `bytes` 로 적어 두고 서버는
 *  `size` 를 줘서 값이 언제나 undefined 였다 (`docs/v2-port-audit.md` F절). */
export type GalleryImage = { file: string; name: string; size: number; mtime: number };
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
  quality_preset?: string;
  /** 자동 투명 배경 (V5) — 서버가 접미사에서 떼어 낸 값이다 */
  transparent_bg?: boolean;
  cfg_rescale?: number;
  variety_plus?: boolean;
  furry_mode?: boolean;
  slot_prompt?: string;
  /** 이 그림이 순수 NAI 출신인가 (PeroPix 확장이 없다) — 적용 시 경고 대상 */
  pure_nai?: boolean;
  characters?: { prompt: string; negative: string; center: { x: number; y: number } | null }[];
  /** 그 그림이 캐릭터 좌표를 **쓰고 있었는가** (`v4_prompt.use_coords`).
   *  자리만 되살리면 NAI 가 무시하므로 이 값이 함께 있어야 같은 그림이 나온다. */
  use_coords?: boolean;
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
  /** ★별표 — **보관함이 든다** (`/api/keep/stars`). 워크스페이스에 매달지 말 것:
   *  갤러리는 워크스페이스를 넘는 화면이라, 매달면 작업을 바꾸는 순간 같은 그림의
   *  별표가 달라진다 (`docs/v2-port-audit.md` A4). */
  starred: Set<string>;
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
  isStarred: (file: string) => boolean;
  toggleStar: (file: string) => Promise<void>;
  remove: (ws: string) => Promise<number>;
  /** @param only 끌어다 놓은 파일들 (없으면 고른 것 전부) */
  moveTo: (ws: string, dest: string, only?: string[]) => Promise<number>;
  /** ★작업 폴더의 그림을 **보관함으로 복사**한다 (원본은 그대로). 생성 옵션은 PNG 가 안고 간다.
   *  ★이미 보관돼 있으면 **무른다** — 두 번 눌러 사본이 둘 생기지 않는다 (`removed`).
   *  ★★`toggle: false` 면 무르지 않는다 — **끌어다 놓기**가 쓴다 (놓았는데 사라지면 안 된다).
   *    이미 있으면 그대로 두고 `existed` 로 알린다. */
  keep: (
    ws: string,
    file: string,
    folder?: string,
    toggle?: boolean,
  ) => Promise<{ file: string; removed: boolean; existed?: boolean }>;
  /** 보관함 안에 하위 폴더를 만든다 (앱 안에서 정리할 유일한 창구) */
  newFolder: (ws: string, name: string) => Promise<void>;
  /** ★빈 폴더만 지운다 — 그림째 지우는 창구는 두지 않는다 */
  dropFolder: (ws: string, name: string) => Promise<void>;
  rename: (ws: string, file: string, name: string) => Promise<string>;
  /** 탐색기에서 연다. 비우면 보관함 뿌리 */
  reveal: (path?: string) => Promise<void>;
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
  starred: new Set(),
  loading: false,
  page: 1,
  total: 0,
  hasMore: false,

  async load(ws) {
    if (!ws) return;
    set({ loading: true });
    const f = get().folder;
    const [folders, r, s] = await Promise.all([
      api<{ folders: GalleryFolder[] }>(`/api/keep/folders`),
      api<Page<GalleryImage>>(`/api/keep/images?page=1${f ? `&folder=${q(f)}` : ""}`),
      api<{ starred: string[] }>(`/api/keep/stars`),
    ]);
    // ★사라진 파일은 선택에서도 뺀다 — 지운 뒤 목록만 갱신하면 유령이 남는다
    const alive = new Set(r.images.map((i) => i.file));
    const picked = new Set([...get().picked].filter((p) => alive.has(p)));
    const focus = get().focus && alive.has(get().focus!) ? get().focus : null;
    set({
      folders: folders.folders,
      items: r.images,
      picked,
      // ★별표는 **목록에 없는 것도 그대로 둔다** — 다른 폴더를 보고 있을 뿐이다
      starred: new Set(s.starred),
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

  async keep(ws, file, folder = "", toggle = true) {
    return await api<{ file: string; removed: boolean; existed?: boolean }>(`/api/keep/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspace: ws, file, folder, toggle }),
    });
  },

  isStarred: (file) => get().starred.has(file),

  async toggleStar(file) {
    const on = !get().starred.has(file);
    // 눌린 것이 바로 보여야 한다 — 서버 답을 기다리지 않고 켜 두고, 답이 오면 맞춘다
    const now = new Set(get().starred);
    on ? now.add(file) : now.delete(file);
    set({ starred: now });
    const r = await api<{ starred: string[] }>(`/api/keep/star`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file, on }),
    });
    set({ starred: new Set(r.starred) });
  },

  async newFolder(ws, name) {
    await api(`/api/keep/folder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    await get().load(ws);
  },

  async dropFolder(ws, name) {
    await api(`/api/keep/folder/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    // 보고 있던 폴더를 지웠으면 전체로 돌아간다 (없는 폴더를 계속 부르지 않게)
    if (get().folder === name) return void (await get().setFolder(ws, ALL));
    await get().load(ws);
  },

  async rename(ws, file, name) {
    const r = await api<{ file: string }>(`/api/keep/rename`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file, name }),
    });
    // ★보고 있던 그림이면 새 이름으로 따라간다 — 안 그러면 크게 보기가 없는 파일을 가리킨다
    const following = get().focus === file;
    if (following) set({ focus: r.file, meta: null, metaFor: null });
    await get().load(ws);
    if (following) await get().setFocus(ws, r.file);
    return r.file;
  },

  async reveal(path = "") {
    await api(`/api/keep/reveal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
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

  /** ★보관함의 삭제도 **휴지통을 거친다** (사용자 결정 2026-08-18, v2-port-audit D7).
   *  ★별표·「이 그림은 어디서 왔나」까지 함께 되돌린다 — 되살렸는데 별표가 빠져 있으면
   *    반쪽짜리 되돌리기다 (`backend/keep.py` `restore`). */
  async remove(ws) {
    const files = [...get().picked];
    if (!files.length) return 0;
    const r = await api<{
      deleted: string[];
      trashed: TrashEntry[];
      starred: string[];
      sources: Record<string, string>;
    }>(`/api/keep/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files }),
    });
    set({ picked: new Set() });
    await get().load(ws);
    if (r.trashed?.length)
      undoToast(t("common.trashed", { n: r.trashed.length }), t("common.undo"), async () => {
        await api(`/api/keep/restore`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entries: r.trashed, starred: r.starred, sources: r.sources }),
        });
        await get().load(ws);
        toast(t("common.restored"));
      });
    return r.deleted.length;
  },

  async moveTo(ws, dest, only) {
    // ★끌어다 놓은 것이 있으면 **그것**이다 (고른 것 무시) — 끌기와 선택은 다른 뜻이다
    const files = only?.length ? only : [...get().picked];
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
