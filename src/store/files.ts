import { create } from "zustand";
import { api } from "../lib/backend";

/** 파일 관리 — **아웃풋 폴더를 그대로** 보여준다 (v2 `파일 관리` 탭).
 *
 *  ★갤러리와 다른 것 하나: 여기는 **워크스페이스를 넘는다.** 아웃풋 루트가 뿌리라
 *    경로도 워크스페이스가 아니라 루트 기준이다 (`backend/files.py` 머리 주석).
 *  ★목록에서 그림을 열지 않는다 — 화면은 썸네일로 그린다.
 */
export type FileNode = { name: string; path: string; count: number; children: FileNode[] };
export type FileItem = { file: string; name: string; bytes: number; mtime: number };
type FilePage = { items: FileItem[]; total: number; page: number; pages: number };

type S = {
  tree: FileNode[];
  rootCount: number;
  folder: string;
  items: FileItem[];
  picked: Set<string>;
  open: Set<string>;
  loading: boolean;
  /** ★쪽 나눠 받는다 (gallery 와 같은 규칙) */
  page: number;
  total: number;
  hasMore: boolean;
  loadTree: () => Promise<void>;
  go: (folder: string) => Promise<void>;
  /** 다음 쪽 — 스크롤이 바닥에 가까워지면 */
  more: () => Promise<void>;
  reload: () => Promise<void>;
  toggleOpen: (path: string) => void;
  pick: (file: string, add: boolean) => void;
  pickAll: () => void;
  clearPick: () => void;
  mkdir: (parent: string, name: string) => Promise<void>;
  rename: (path: string, name: string) => Promise<void>;
  move: (files: string[], dest: string) => Promise<void>;
  remove: (files: string[]) => Promise<void>;
  reveal: (path: string) => Promise<void>;
};

export const useFiles = create<S>((set, get) => ({
  tree: [],
  rootCount: 0,
  folder: "",
  items: [],
  picked: new Set(),
  open: new Set(),
  loading: false,
  page: 1,
  total: 0,
  hasMore: false,

  async loadTree() {
    const r = await api<{ count: number; tree: FileNode[] }>("/api/files/tree");
    set({ tree: r.tree, rootCount: r.count });
    // ★첫 층은 펼쳐 둔다 — 워크스페이스 이름이 첫 층이라 접혀 있으면 빈 화면처럼 보인다
    if (!get().open.size) set({ open: new Set(r.tree.map((n) => n.path)) });
  },

  async go(folder) {
    set({ folder, loading: true, picked: new Set() });
    try {
      const r = await api<FilePage>(`/api/files/list?page=1&folder=${encodeURIComponent(folder)}`);
      set({ items: r.items, page: r.page, total: r.total, hasMore: r.page < r.pages });
    } finally {
      set({ loading: false });
    }
  },

  async more() {
    const { loading, hasMore, page, folder, items } = get();
    if (loading || !hasMore) return;
    set({ loading: true });
    try {
      const r = await api<FilePage>(
        `/api/files/list?page=${page + 1}&folder=${encodeURIComponent(folder)}`,
      );
      const seen = new Set(items.map((i) => i.file));
      set({
        items: [...items, ...r.items.filter((i) => !seen.has(i.file))],
        page: r.page,
        total: r.total,
        hasMore: r.page < r.pages,
      });
    } finally {
      set({ loading: false });
    }
  },

  async reload() {
    await get().loadTree();
    await get().go(get().folder);
  },

  toggleOpen(path) {
    const next = new Set(get().open);
    next.has(path) ? next.delete(path) : next.add(path);
    set({ open: next });
  },

  pick(file, add) {
    const cur = get().picked;
    if (!add) return set({ picked: new Set(cur.has(file) && cur.size === 1 ? [] : [file]) });
    const next = new Set(cur);
    next.has(file) ? next.delete(file) : next.add(file);
    set({ picked: next });
  },

  pickAll() {
    const { items, picked } = get();
    set({ picked: new Set(picked.size === items.length ? [] : items.map((i) => i.file)) });
  },

  clearPick: () => set({ picked: new Set() }),

  async mkdir(parent, name) {
    await api("/api/files/mkdir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: parent, name }),
    });
    await get().loadTree();
  },

  async rename(path, name) {
    await api("/api/files/rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, name }),
    });
    await get().reload();
  },

  async move(files, dest) {
    await api("/api/files/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files, dest }),
    });
    await get().reload();
  },

  async remove(files) {
    await api("/api/files/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files }),
    });
    await get().reload();
  },

  async reveal(path) {
    await api("/api/files/reveal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
  },
}));
