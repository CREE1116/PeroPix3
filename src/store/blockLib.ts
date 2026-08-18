import { create } from "zustand";
import { api } from "../lib/backend";
import { newId, type Block, type BlockColor, type Tag } from "../lib/blocks";
import { t } from "../i18n";
import { toast, undoToast } from "./toast";

/** 블록 저장소 — 블록 하나를 이름·분류와 함께 보관했다가 다시 꺼낸다.
 *
 *  ★카드와 같은 **공용** 저장소다 (`cards.ts` 머리 참조) — 워크스페이스를 안 가린다.
 *    목업 `peropix-block-editor.html` 의 「블록 저장소」가 정본이다.
 *  ★목업에 있던 **블록 가중치(`w`)는 안 옮긴다.** 가중치는 태그에만 둔다는 결정이
 *    이미 있다 (`lib/blocks.ts` 머리). 저장소가 그걸 되살리면 두 벌이 된다. */

export type LibItem = {
  id: string;
  /** 분류 — 서랍에서 묶이는 단위. 비면 「미분류」로 묶인다 */
  cat: string;
  label: string;
  color: BlockColor;
  tags: Tag[];
  updatedAt?: string;
};

type S = {
  items: LibItem[];
  loaded: boolean;
  /** 서랍이 열려 있나 — **보기 상태**라 저장하지 않는다 (카드 접기와 같은 취급) */
  open: boolean;
  /** 검색어 — 이름과 태그 양쪽을 본다 */
  query: string;
  /** 방금 들어온 항목 — 서랍에서 **펼친 채로** 보여 준다 (어디로 갔는지 눈에 보이게) */
  justAdded: string | null;

  load: () => Promise<void>;
  setOpen: (v: boolean) => void;
  setQuery: (q: string) => void;
  save: (item: Omit<LibItem, "id"> & { id?: string }) => Promise<LibItem>;
  /** 프롬프트에서 끌어온 블록을 그 분류에 넣는다 (드롭 한 번으로 끝난다) */
  drop: (b: Block, cat: string) => Promise<LibItem>;
  remove: (id: string) => Promise<void>;
};

export const useBlockLib = create<S>((set, get) => ({
  items: [],
  loaded: false,
  open: false,
  query: "",
  justAdded: null,

  async load() {
    const r = await api<{ items: LibItem[] }>("/api/blocks");
    set({ items: r.items ?? [], loaded: true });
  },

  setOpen(v) {
    set({ open: v });
    if (v && !get().loaded) void get().load();
  },

  setQuery(q) {
    set({ query: q });
  },

  async drop(b, cat) {
    const it = await get().save({ ...blockToItem(b), cat });
    // ★넣은 것을 **펼친 채로** 띄운다 — 어디로 들어갔는지 보이지 않으면 넣은 줄 모른다
    set({ justAdded: it.id });
    return it;
  },

  async save(item) {
    const r = await api<{ item: LibItem }>("/api/blocks", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item }),
    });
    const items = get().items.slice();
    const i = items.findIndex((x) => x.id === r.item.id);
    if (i >= 0) items[i] = r.item;
    else items.unshift(r.item);
    set({ items });
    return r.item;
  },

  /** ★지운 것은 **되돌릴 수 있어야 한다** (사용자 결정 2026-08-18, v2-port-audit D7).
   *
   *  ★다른 창구처럼 휴지통(`backend/trash.py`)을 쓰지 않는다 — 저장소가 **파일 하나 안의
   *    목록**이라 옮길 파일이 없다 (`backend/blocklib.py` 머리 주석). 대신 지운 항목을
   *    그대로 들고 있다가 `save` 로 **id 째 되돌린다** — 같은 id 로 저장하면 제자리로 간다. */
  async remove(id) {
    const gone = get().items.find((x) => x.id === id);
    await api(`/api/blocks/${id}`, { method: "DELETE" });
    set({ items: get().items.filter((x) => x.id !== id) });
    if (gone)
      undoToast(t("common.removed"), t("common.undo"), async () => {
        await get().save(gone);
        toast(t("common.restored"));
      });
  },
}));

/** 저장소 항목 → 새 블록 (**사본**이다 — 꺼내 쓴 뒤 고쳐도 저장소는 안 바뀐다).
 *  ★접힌 채로 들어온다. 꺼내 쓰는 것은 이미 완성된 묶음이라 펼쳐 보일 이유가 없다. */
export function itemToBlock(it: LibItem): Block {
  return {
    id: newId(),
    label: it.label,
    color: it.color ?? null,
    on: true,
    open: false,
    tags: it.tags.map((t) => ({ ...t })),
  };
}

/** 블록 → 저장소 항목의 초안. ★`extra`(이 탭에서만 사는 블록)는 표식을 안 물려준다 —
 *  저장소에서 꺼내면 어느 자리에나 들어가는 평범한 블록이다. */
export function blockToItem(b: Block): Omit<LibItem, "id"> {
  return { cat: "", label: b.label, color: b.color, tags: b.tags.map((t) => ({ ...t })) };
}

/** 분류별로 묶고, 검색어로 거른다 — 이름과 태그 양쪽을 본다.
 *  ★검색 중에는 접힘을 무시하고 전부 펼친다 (목업 규칙). */
export function grouped(items: LibItem[], query: string): [string, LibItem[]][] {
  const q = query.trim().toLowerCase();
  const hit = (it: LibItem) =>
    !q ||
    it.label.toLowerCase().includes(q) ||
    it.tags.some((t) => t.t.toLowerCase().includes(q));
  const out: [string, LibItem[]][] = [];
  for (const it of items.filter(hit)) {
    const cat = it.cat?.trim() || "";
    const row = out.find(([c]) => c === cat);
    if (row) row[1].push(it);
    else out.push([cat, [it]]);
  }
  return out;
}
