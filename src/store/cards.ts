import { create } from "zustand";
import { api, type TrashEntry } from "../lib/backend";
import type { Block } from "../lib/blocks";
import { slotBlocks } from "./workspace";
import { t } from "../i18n";
import { toast, undoToast } from "./toast";

/** 카드 = 재사용하는 프롬프트 묶음. **워크스페이스 밖의 공용 저장소**다 (schema.md 1절).
 *  워크스페이스가 가르는 것은 작업 상태와 생성 이미지뿐이라, 어느 워크스페이스에서
 *  만든 카드든 전부에서 보인다. */

export type CardKind = "styles" | "characters" | "posesets";

/** 카드 그림의 보는 방식 — 배너용과 덱 앞면용이 따로다 (비율이 다르다).
 *  바이트는 공용 고정 썸네일 저장소에 하나 있고, `tid` 로 가리킨다 (`/api/pin/<tid>`). */
export type View = { zoom: number; px: number; py: number };
/** ★`tid` 는 그림 내용에서 나온다 — 다른 그림을 걸면 tid 가, 따라서 주소가 달라진다.
 *  예전의 판 번호(`rev`)는 그래서 필요 없어졌다: "위치를 안 바꾸고 그림만 갈아 끼웠더니
 *  브라우저가 옛 그림을 계속 쓰더라"는 실사용 결함이 구조적으로 불가능하다. */
export type ThumbView = { tid: string; banner?: View; face?: View } & Partial<View>;

type Common = {
  id: string;
  name: string;
  color: [string, string];
  thumb?: ThumbView | null;
  updatedAt?: string;
  /** ★서브탭(폴더). 빈 값이 뿌리다 (사용자 지시 2026-08-19).
   *  **같은 종류·같은 폴더 안에서 이름이 겹칠 수 없다** — 폴더가 다르면 겹쳐도 된다. */
  folder?: string;
};
export type StyleCard = Common & { base: Block[]; uc: Block[] };
export type CharCard = Common & { prompt: Block[]; uc: Block[] };
/** 포즈세트 카드 — 칸마다 **블록 목록**을 든다 (슬롯과 같은 자료형, 2026-08-07).
 *  ★옛 카드는 `tags` 문자열을 들고 있다. `load()` 가 읽을 때 한 번 옮긴다. */
export type PoseCard = Common & { cells: { name: string; blocks: Block[] }[] };
export type AnyCard = StyleCard | CharCard | PoseCard;

type S = {
  styles: StyleCard[];
  characters: CharCard[];
  posesets: PoseCard[];
  /** 덱 커버 — 종류당 하나. 그림은 tid 로 가리키는 공용 고정 썸네일이다 */
  loaded: boolean;
  load: () => Promise<void>;
  save: (kind: CardKind, card: Partial<AnyCard> & { name: string }) => Promise<AnyCard>;
  remove: (kind: CardKind, id: string) => Promise<void>;
};

/** 카드 배경색 — 저장된 색이 없으면 이름에서 안정적으로 뽑는다.
 *  ★무작위로 하지 않는다: 같은 카드가 열 때마다 다른 색이면 카드로 기억할 수 없다. */
const PALETTE: [string, string][] = [
  ["#b57a2a", "#d8a34f"],
  ["#5b3d87", "#9b6dd6"],
  ["#14655e", "#2aa198"],
  ["#7a2f4a", "#c96a8a"],
  ["#2a4f8f", "#6a97d8"],
  ["#1d7a5e", "#58a86c"],
];

export function colorOf(name: string): [string, string] {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

const hydrate = <T extends { name: string; color?: [string, string] }>(c: T) => ({
  ...c,
  color: c.color ?? colorOf(c.name),
});

export const useCards = create<S>((set, get) => ({
  styles: [],
  characters: [],
  posesets: [],
  loaded: false,

  async load() {
    const r = await api<
      Record<CardKind, AnyCard[]>
    >("/api/cards");
    set({
      styles: (r.styles ?? []).map(hydrate) as StyleCard[],
      characters: (r.characters ?? []).map(hydrate) as CharCard[],
      // ★옛 포즈세트 카드(문자열 태그)를 블록으로 — 읽을 때 한 번만
      posesets: (r.posesets ?? []).map((c) => {
        const p = hydrate(c) as PoseCard;
        return { ...p, cells: (p.cells ?? []).map((x) => ({ name: x.name, blocks: slotBlocks(x) })) };
      }) as PoseCard[],
      loaded: true,
    });
  },

  /** ★★카드의 **신원은 이름**이다 (사용자 지시 2026-08-19).
   *
   *  같은 폴더 안에 같은 이름을 둘 수 없다:
   *    · **새로 추가**하다 겹치면 뒤에 `(1)`·`(2)` 를 붙여 **새 카드로** 넣는다.
   *    · **이름을 고치다** 겹치면 **거절한다** — 자동으로 딴 이름을 붙이면 사용자가
   *      고친 이름과 다른 것이 저장돼, 무엇이 바뀌었는지 알 수 없다.
   *  ★판정은 여기 한 곳이다. 부르는 자리마다 검사하면 규칙이 갈린다. */
  async save(kind, card) {
    const list = get()[kind] as AnyCard[];
    const folder = card.folder ?? "";
    const editing = !!card.id && list.some((c) => c.id === card.id);
    const taken = (n: string) =>
      list.some((c) => c.id !== card.id && (c.folder ?? "") === folder && c.name === n);
    if (editing && taken(card.name)) {
      toast(t("cards.nameTaken", { name: card.name }), "warn");
      throw new Error("name taken");
    }
    if (!editing && taken(card.name)) {
      let i = 1;
      while (taken(`${card.name} (${i})`)) i++;
      card = { ...card, name: `${card.name} (${i})` };
    }
    const r = await api<{ card: AnyCard }>(`/api/cards/${kind}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ card: { ...card, folder, color: card.color ?? colorOf(card.name) } }),
    });
    const saved = hydrate(r.card) as AnyCard;
    // 같은 id 가 있으면 갈아 끼우고 없으면 맨 앞에 (목록은 최근 갱신 순)
    const cur = get()[kind] as AnyCard[];
    const next = cur.some((x) => x.id === saved.id)
      ? cur.map((x) => (x.id === saved.id ? saved : x))
      : [saved, ...cur];
    set({ [kind]: next } as unknown as Pick<S, CardKind>);
    return saved;
  },

  /** ★카드 삭제도 **휴지통을 거친다** (사용자 결정 2026-08-18, v2-port-audit D7) —
   *  사람이 지은 캐릭터·그림체라 잘못 눌렀을 때 되돌릴 길이 있어야 한다. */
  async remove(kind, id) {
    const r = await api<{ trashed: TrashEntry[] }>(`/api/cards/${kind}/${id}`, { method: "DELETE" });
    set({ [kind]: (get()[kind] as AnyCard[]).filter((x) => x.id !== id) } as unknown as Pick<
      S,
      CardKind
    >);
    if (r.trashed?.length)
      undoToast(t("common.trashed", { n: 1 }), t("common.undo"), async () => {
        await api("/api/cards/restore", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entries: r.trashed }),
        });
        await get().load();
        toast(t("common.restored"));
      });
  },
}));
