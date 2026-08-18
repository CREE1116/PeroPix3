import { create } from "zustand";
import { api } from "../lib/backend";
import { EMPTY_POOLS, parseWildcardDoc, type Pools } from "../lib/wildcards";

/** 와일드카드 정의 문서. 앱에 하나뿐이다 (v2 `loadWildcards`·`saveWildcards` 이식 2026-08-18).
 *
 *  ★**편집 중인 글과 저장된 글을 가른다.** 생성이 뽑는 것은 언제나 `pools`(= 저장된 글)이고,
 *    미리보기가 쓰는 것은 `draft` 다. 그래야 저장하기 전에 시험해 볼 수 있다
 *    (v2 의 `runWildcardPreview` 가 편집기 내용을 그 자리에서 파싱한 이유).
 *  ★블록 저장소·카드와 같은 **공용** 저장소다. 워크스페이스를 안 가린다.
 *  ★문서가 곧 정본이라 **편집 창구는 이 모달 하나**다. 풀 목록은 보여 주기만 하고,
 *    누르면 문서의 그 줄로 데려간다.
 */

type S = {
  /** 저장된 글 */
  content: string;
  /** 편집 중인 글 (모달을 닫으면 저장된 글로 되돌아간다) */
  draft: string;
  /** 저장된 글에서 파싱한 풀. **생성이 읽는 것은 이것뿐이다** */
  pools: Pools;
  loaded: boolean;
  open: boolean;
  /** 저장 직후 잠깐 뜨는 표시 */
  justSaved: boolean;

  load: () => Promise<void>;
  setDraft: (v: string) => void;
  setOpen: (v: boolean) => void;
  /** 편집 중인 글이 저장된 글과 다른가 (닫을 때 물어보는 근거) */
  dirty: () => boolean;
  save: () => Promise<void>;
};

let savedTimer: ReturnType<typeof setTimeout> | null = null;

export const useWildcards = create<S>((set, get) => ({
  content: "",
  draft: "",
  pools: EMPTY_POOLS,
  loaded: false,
  open: false,
  justSaved: false,

  async load() {
    const r = await api<{ content: string }>("/api/wildcards");
    const content = r.content ?? "";
    // ★**고치던 글만** 지킨다. 손대지 않은 초안은 새로 읽은 것으로 갈아 끼운다.
    //   부팅 읽기가 끝나기 전에 모달을 열면 초안이 빈 채로 굳고, 그대로 저장하면
    //   문서가 통째로 날아간다 (열려 있다는 이유로 안 덮으면 그렇게 된다).
    const dirty = get().draft !== get().content;
    set({
      content,
      pools: parseWildcardDoc(content),
      loaded: true,
      ...(dirty ? {} : { draft: content }),
    });
  },

  setDraft: (v) => set({ draft: v }),

  setOpen(v) {
    // 열 때 저장된 글에서 초안을 다시 뜬다 (지난번에 버린 편집이 남아 있지 않게)
    set(v ? { open: true, draft: get().content, justSaved: false } : { open: false });
    if (v && !get().loaded) void get().load();
  },

  dirty: () => get().draft !== get().content,

  async save() {
    const content = get().draft;
    await api("/api/wildcards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    // ★저장한 뒤에야 `pools` 가 바뀐다. 생성이 쓰는 값이라 초안으로 흔들리면 안 된다
    set({ content, pools: parseWildcardDoc(content), justSaved: true });
    if (savedTimer) clearTimeout(savedTimer);
    savedTimer = setTimeout(() => set({ justSaved: false }), 1500);
  },
}));

/** 지금 뽑을 수 있는 풀. 스토어 밖(생성 파이프라인)에서 쓰는 단축 */
export const wildcardPools = (): Pools => useWildcards.getState().pools;
