import { create } from "zustand";
import { compileBlocks, makeBlock, type Block } from "../lib/blocks";
import { t } from "../i18n";

/** 프롬프트 영역 — NAI 요청 구조 그대로.
 *  ★소유는 워크스페이스다. 여기는 편집 중인 사본이고, 저장은 workspace 스토어가 한다. */

/** 캐릭터 섹션 = NAI 의 `characterPrompts[]` 한 칸.
 *  `ref` 는 어느 카드에서 왔는지의 **출처 표시**다 (schema.md 5절). 동기화하지 않는다 —
 *  과거 생성물의 재현은 records 의 resolved 가 책임진다. */
/** 그림을 어떻게 볼지 — 초점 %(px·py)와 배율 */
export type View = { zoom: number; px: number; py: number };

/** 배너·카드 앞면에 깔리는 그림.
 *  ★**하나의 그림, 여러 개의 보는 방식**이다 (사용자 결정, 2026-08-02).
 *    바이트는 공용 저장소에 하나만 있고(`/api/pin/<tid>`), 배너·카드 앞면·덱 커버가
 *    전부 같은 tid 를 가리킨다. 목적지마다 사본을 따로 굽는 구조로 되돌리지 말 것.
 *  ★배너와 덱 카드 앞면은 비율이 달라 **보는 방식만** 따로 갖는다 (banner·face). */
export type Thumb = {
  /** 고정 썸네일 id — 배너·카드 앞면·덱 커버가 **같은** 그림을 이 하나로 가리킨다.
   *  원본(work/)이 정리돼도 이 그림은 남는다 (서버 thumbs.py 참조). */
  tid: string;
  banner: View;
  face: View;
};

// 인물 사진은 위쪽이 얼굴이라 가운데보다 조금 위를 기본으로 본다
export const defaultView = (): View => ({ zoom: 1, px: 50, py: 35 });

/** 저장된 값을 Thumb 으로 — 평평한 {zoom,px,py} 한 벌만 있는 것도 읽는다 (덱 커버가 그렇다).
 *
 *  ★`tid` 가 없으면 null 이다. 옛 형식({ws,file} · {card})은 서버가 뜰 때 한 번
 *    이전해 준다(backend/migrate_thumbs.py) — 프론트에 옛 경로를 남겨 두지 않는다. */
export function normThumb(t: unknown): Thumb | null {
  if (!t || typeof t !== "object") return null;
  const o = t as Record<string, unknown> & Partial<Thumb>;
  if (typeof o.tid !== "string" || !o.tid) return null;
  const flat =
    typeof o.zoom === "number"
      ? { zoom: o.zoom as number, px: (o.px as number) ?? 50, py: (o.py as number) ?? 35 }
      : null;
  const banner = (o.banner as View) ?? flat ?? defaultView();
  const face = (o.face as View) ?? flat ?? banner;
  return { tid: o.tid, banner, face };
}

/** 고정 썸네일의 주소 — **한 군데서만 만든다.**
 *  ★tid 가 내용에서 나오므로 그림이 바뀌면 주소도 바뀐다. 판 번호(rev)를 붙이지 않는다. */
export const thumbUrl = (base: string, t: Thumb): string => `${base}/api/pin/${t.tid}`;

/** 카드가 들고 있는 그림을 섹션 배너로 — 카드를 꽂으면 그림도 따라온다.
 *  ★같은 tid 를 가리킬 뿐이라 바이트가 복사되지 않는다. */
export const thumbFromCard = (view?: unknown): Thumb | null => normThumb(view ?? null);

export type Char = {
  id: string;
  ref: string | null;
  name: string;
  color: [string, string];
  thumb: Thumb | null;
  prompt: Block[];
  uc: Block[];
  on: boolean;
  /** 순차 생성 더미. **맨 앞이 다음 차례**이고, 생성이 끝나면 현재 인물이 맨 뒤로 간다. */
  stack: { ref: string | null; name: string; color: [string, string] }[];
};

/** 편집 대상 지정 — "base" 는 공통, 그 외는 캐릭터 id */
export type AreaId = "base" | "baseUc";

type S = {
  base: Block[];
  baseUc: Block[];
  style: { ref: string | null; name: string; color: [string, string]; thumb: Thumb | null };
  /** ★스타일 카드를 **쓰고 있는가** (사용자 지시 2026-08-19).
   *
   *  끄면 카드가 화면에서 빠지고 **베이스 프롬프트·UC 도 안 나간다** (`compiled`) —
   *  화면에 없는 것이 조용히 실려 나가면 안 된다. 캐릭터를 지우는 것과 같은 뜻이다.
   *  ★값이 없으면(옛 워크스페이스) **켜진 것**이다. */
  styleOn: boolean;
  chars: Char[];
  /** 지금 보고 있는 섹션의 Prompt/UC 탭 — 섹션마다 따로 기억한다 */
  tabs: Record<string, "p" | "u">;
  /** 접어 둔 섹션 — **보기 상태**라 탭과 같이 세션에 저장하지 않는다 */
  folded: Record<string, boolean>;

  setTab: (section: string, t: "p" | "u") => void;
  toggleFold: (section: string) => void;
  update: (area: AreaId, fn: (blocks: Block[]) => Block[]) => void;
  updateChar: (id: string, area: "prompt" | "uc", fn: (blocks: Block[]) => Block[]) => void;

  setStyle: (s: { ref: string | null; name: string; color: [string, string]; base?: Block[]; uc?: Block[]; thumb?: Thumb | null }) => void;
  /** 생성물을 배너에 꽂는다. section 은 "base" 또는 캐릭터 id */
  setThumb: (section: string, thumb: Thumb | null) => void;
  addChar: (c: Partial<Char>) => string;
  swapChar: (id: string, c: Partial<Char>) => void;
  stackChar: (id: string, c: { ref: string | null; name: string; color: [string, string] }) => void;
  /** 스택에서 한 장 빼기 · 한 장을 맨 앞으로 (사용자 지시 2026-08-19) */
  dropStack: (id: string, at: number) => void;
  frontStack: (id: string, at: number) => void;
  removeChar: (id: string) => void;
  renameChar: (id: string, name: string) => void;
  toggleChar: (id: string) => void;
  /** 생성 한 장이 끝났을 때 스택을 한 칸 돌린다 — 현재 인물이 맨 뒤로 */
  rotateStack: (id: string) => void;

  /** 저장된 spec 을 그대로 받는다 — 구버전 세션에는 style·chars·thumb 이 없다 */
  load: (p: {
    base?: Block[];
    baseUc?: Block[];
    style?: { ref: string | null; name: string; color: [string, string]; thumb?: Thumb | null };
    styleOn?: boolean;
    chars?: Char[];
  }) => void;
  setStyleOn: (v: boolean) => void;
  snapshot: () => Pick<S, "base" | "baseUc" | "style" | "styleOn" | "chars">;
  compiled: () => {
    prompt: string;
    uc: string;
    /** ★`id` 를 함께 낸다 — 씬 프롬프트 목적지가 캐릭터 id 로 가리킨다 (`SceneLane` 의 선택기).
     *  서버는 모르는 키를 무시하므로 그대로 실어 보내도 된다. */
    chars: { id: string; prompt: string; uc: string }[];
  };
};

export const DEFAULT_STYLE_COLOR: [string, string] = ["#b57a2a", "#d8a34f"];
export const CHAR_COLORS: [string, string][] = [
  ["#5b3d87", "#9b6dd6"],
  ["#14655e", "#2aa198"],
  ["#7a2f4a", "#c96a8a"],
  ["#2a4f8f", "#6a97d8"],
];

export const defaultBase = (): Block[] => [
  makeBlock(t("block.defaults.count"), ["1girl", "solo"]),
  makeBlock(t("block.defaults.scene"), ["outdoors", "sunny day"], { open: true }),
  makeBlock(t("block.defaults.quality"), ["best quality", "very aesthetic"], { color: "amber" }),
];

export const defaultUc = (): Block[] => [
  makeBlock(t("block.defaults.base"), ["lowres", "bad anatomy"], { color: "red" }),
];

/** 저장 예약 — 순환 참조를 피하려 workspace 스토어가 여기에 자기 저장 함수를 꽂는다. */
let onEditRaw: (() => void) | null = null;
const onEdit = () => onEditRaw?.();
export const setPromptSaver = (fn: () => void) => {
  onEditRaw = fn;
};

const newId = () => "ch_" + Math.random().toString(36).slice(2, 8);

export const usePrompt = create<S>((set, get) => ({
  base: defaultBase(),
  baseUc: defaultUc(),
  style: { ref: null, name: t("prompt.defaultStyleName"), color: DEFAULT_STYLE_COLOR, thumb: null },
  styleOn: true,
  chars: [],
  tabs: {},
  folded: {},

  setTab: (section, tab) => set({ tabs: { ...get().tabs, [section]: tab } }),

  toggleFold: (section) =>
    set({ folded: { ...get().folded, [section]: !get().folded[section] } }),

  update: (area, fn) => {
    set({ [area]: fn(get()[area]) } as Pick<S, AreaId>);
    onEdit();
  },

  updateChar: (id, area, fn) => {
    set({
      chars: get().chars.map((c) => (c.id === id ? { ...c, [area]: fn(c[area]) } : c)),
    });
    onEdit();
  },

  setStyle: (s) => {
    // 스타일 카드는 **Base 블록까지** 교체한다 — 그림체가 곧 공통 프롬프트다
    set({
      style: { ref: s.ref, name: s.name, color: s.color, thumb: s.thumb ?? null },
      ...(s.base ? { base: s.base } : {}),
      ...(s.uc ? { baseUc: s.uc } : {}),
    });
    onEdit();
  },

  setThumb(section, thumb) {
    if (section === "base") set({ style: { ...get().style, thumb } });
    else set({ chars: get().chars.map((c) => (c.id === section ? { ...c, thumb } : c)) });
    onEdit();
  },

  addChar(c) {
    const chars = get().chars;
    const id = c.id ?? newId();
    set({
      chars: [
        ...chars,
        {
          id,
          ref: c.ref ?? null,
          name: c.name ?? "",
          color: c.color ?? CHAR_COLORS[chars.length % CHAR_COLORS.length],
          thumb: c.thumb ?? null,
          prompt: c.prompt ?? [],
          uc: c.uc ?? [],
          on: c.on ?? true,
          stack: c.stack ?? [],
        },
      ],
    });
    onEdit();
    return id;
  },

  swapChar(id, c) {
    set({
      chars: get().chars.map((x) =>
        x.id === id
          ? {
              ...x,
              ref: c.ref ?? null,
              name: c.name ?? x.name,
              color: c.color ?? x.color,
              thumb: c.thumb ?? null,
              prompt: c.prompt ?? x.prompt,
              uc: c.uc ?? x.uc,
            }
          : x,
      ),
    });
    onEdit();
  },

  stackChar(id, c) {
    set({
      chars: get().chars.map((x) => (x.id === id ? { ...x, stack: [...x.stack, c] } : x)),
    });
    onEdit();
  },

  removeChar(id) {
    set({ chars: get().chars.filter((c) => c.id !== id) });
    onEdit();
  },

  renameChar(id, name) {
    set({ chars: get().chars.map((c) => (c.id === id ? { ...c, name } : c)) });
    onEdit();
  },

  toggleChar(id) {
    set({ chars: get().chars.map((c) => (c.id === id ? { ...c, on: !c.on } : c)) });
    onEdit();
  },

  /** 스택에서 한 장을 뺀다 (사용자 지시 2026-08-19) */
  dropStack(id, at) {
    set({
      chars: get().chars.map((c) =>
        c.id === id ? { ...c, stack: c.stack.filter((_, k) => k !== at) } : c,
      ),
    });
    onEdit();
  },

  /** 스택의 한 장을 **맨 앞(지금 인물)으로**.
   *
   *  ★★**자리를 맞바꾼다** (사용자 지시 2026-08-19) — 지금 인물이 그 카드가 있던 자리로 간다.
   *    한 칸씩 밀어 돌리면(`rotateStack`) 나머지 순서가 통째로 흔들려, 「이 카드를 앞으로」가
   *    아니라 「한 바퀴 돌리기」가 된다. */
  frontStack(id, at) {
    set({
      chars: get().chars.map((c) => {
        const pick = c.id === id ? c.stack[at] : undefined;
        if (!pick) return c;
        return {
          ...c,
          ref: pick.ref,
          name: pick.name,
          color: pick.color,
          stack: c.stack.map((x, k) =>
            k === at ? { ref: c.ref, name: c.name, color: c.color } : x,
          ),
        };
      }),
    });
    onEdit();
  },

  rotateStack(id) {
    set({
      chars: get().chars.map((c) => {
        if (c.id !== id || !c.stack.length) return c;
        const [next, ...rest] = c.stack;
        // 지금 인물은 맨 뒤로 — 블록은 스택에 담지 않으므로 이름·색만 순환한다
        return {
          ...c,
          ref: next.ref,
          name: next.name,
          color: next.color,
          stack: [...rest, { ref: c.ref, name: c.name, color: c.color }],
        };
      }),
    });
    onEdit();
  },

  load: (p) =>
    set({
      base: p.base?.length ? p.base : defaultBase(),
      baseUc: p.baseUc?.length ? p.baseUc : defaultUc(),
      style: p.style
        ? { ...p.style, thumb: normThumb(p.style.thumb) }
        : { ref: null, name: t("prompt.defaultStyleName"), color: DEFAULT_STYLE_COLOR, thumb: null },
      // ★값이 없으면 켜진 것이다 — 옛 워크스페이스가 스타일 카드를 잃으면 안 된다
      styleOn: p.styleOn !== false,
      chars: (p.chars ?? []).map((c) => ({ ...c, thumb: normThumb(c.thumb) })),
      tabs: {},
      folded: {},
    }),

  snapshot: () => ({
    base: get().base,
    baseUc: get().baseUc,
    style: get().style,
    styleOn: get().styleOn,
    chars: get().chars,
  }),

  /** 스타일 카드를 빼거나 되돌린다 (사용자 지시 2026-08-19).
   *  ★블록은 **지우지 않는다** — 되돌리면 적어 둔 것이 그대로 있어야 한다. 나가는 것만 막는다. */
  setStyleOn(v) {
    set({ styleOn: v });
    onEdit();
  },

  compiled: () => ({
    // ★스타일 카드를 뺐으면 **베이스도 UC 도 안 나간다** — 화면에 없는 것이 실려 나가면 안 된다
    prompt: get().styleOn ? compileBlocks(get().base) : "",
    uc: get().styleOn ? compileBlocks(get().baseUc) : "",
    chars: get()
      .chars.filter((c) => c.on)
      .map((c) => ({ id: c.id, prompt: compileBlocks(c.prompt), uc: compileBlocks(c.uc) })),
  }),
}));

/** UC 에 실제 내용이 있는가 — 탭을 빨갛게 표시하는 판정 (v2.x 동작 계승) */
export const ucHasContent = (blocks: Block[]) =>
  blocks.some((b) => b.on && b.tags.some((x) => x.t.trim()));
