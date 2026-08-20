import { create } from "zustand";
import { compileBlocks } from "../lib/blocks";
import { api, backendUrl } from "../lib/backend";
import { usePrompt } from "./prompt";
import { allCells, allScenes, useWs } from "./workspace";
import { localTs } from "../lib/takes";
import { useQueue } from "./queue";
import { useImageInput } from "./imageInput";
import { useUi } from "./ui";
import { sizeForBase } from "../lib/baseSize";
import { toast } from "./toast";
import { t } from "../i18n";

// 시드 규칙은 `lib/seedRounds.ts` 하나뿐이다 (거기 머리 주석)
import { randomSeed, rounds, type SeedMode } from "../lib/seedRounds";
// ★와일드카드 추첨은 **장 하나마다** 돈다 (`lib/wildcards.ts` 머리 주석).
//   요청을 만들 때 한 번만 풀면 한 배치가 통째로 같은 태그로 나온다. 기능이 조용히 사라진다.
import { resolveShot } from "../lib/wildcards";
import { wildcardPools } from "./wildcards";
export { randomSeed, rounds, SEED_MODES, type SeedMode } from "../lib/seedRounds";

export type GenParams = {
  model: string;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
  seed: number;
  /** NAI 의 Guidance Rescale. 0~1 */
  cfg_rescale: number;
  uc_preset: string;
  quality_tags: boolean;
  variety_plus: boolean;
  /** 프롬프트 앞에 `fur dataset, ` 를 붙인다 */
  furry_mode: boolean;
  /** 저장 포맷 — png | jpg | webp */
  save_format: string;
  /** JPG/WebP 품질 (1~100) */
  jpg_quality: number;
  /** ★켜면 알파 LSB 스테가노그래피까지 지운다 (backend/meta.strip) */
  strip_metadata: boolean;
  /** ★끄면 **파일로 안 남기고 미리보기만** 한다 (v2 `auto_save`).
   *  마음에 드는 것만 골라 저장하고 싶을 때 쓴다. 끈 동안 만든 것은 **기록에도 안 남는다** —
   *  그래서 씬 칸·갤러리에는 안 뜨고 캔버스의 미리보기 자리에만 뜬다. */
  auto_save: boolean;
  /** ★켜면 파일 이름 앞의 **씬 번호를 뺀다** (v2 `exclude_slot_number`).
   *  번호는 탐색기에서 씬 순서를 만드는 것이라, 순서가 필요 없을 때만 끈다.
   *  ★★**빼는 것은 번호뿐이고 씬 이름은 남는다** (v2 와 같다 — 사용자 결정 2026-08-18,
   *    v2-port-audit D3). 규칙은 `backend/workspace.py` 의 `file_lead` 가 정본이다. */
  exclude_slot_number: boolean;
  /** 시드를 **언제 새로 뽑나** — ★셋 중 하나다 (v2 의 `랜덤/고정/슬롯마다 랜덤` 이관).
   *
   *  ★체크박스 둘로 두지 않는다 (사용자 지적 2026-08-11): 「고정」과 「씬마다 랜덤」을
   *    함께 켜면 무슨 뜻인지 알 수 없다. 배타적 3택이라 그런 상태가 아예 없다.
   *
   *  - `fixed`  숫자칸 그대로. 켜져 있어도 숫자는 남으므로 언제든 되돌아온다
   *  - `round`  **한 바퀴에 시드 하나** — 그 바퀴의 씬들이 같은 조건이라 서로 견줄 수 있다
   *  - `scene`  같은 바퀴 안에서도 씬마다 새로 뽑는다 */
  seed_mode: SeedMode;
};

/** ★**V4.5 계열만 제공한다** (사용자 결정 2026-08-12 — V4.0 을 뺐다).
 *
 *  ★모델을 줄이면 규칙도 함께 줄어든다. V4.0 은 퀄리티 접미사·UC 프리셋·캐릭터 기본 UC·
 *    Variety+ 기준 시그마(19)가 전부 달라서, 남겨 두면 안 쓰는 갈래를 계속 맞춰야 한다.
 *  ★옛 워크스페이스가 V4.0 모델 id 를 들고 있으면 서버가 V4.5 Full 표로 떨어뜨린다
 *    (`nai.uc_presets`) — 조용히 다른 그림이 나오지 않게 화면도 기본값으로 되돌린다. */
export const MODELS: [string, string][] = [
  ["nai-diffusion-4-5-full", "V4.5 Full"],
  ["nai-diffusion-4-5-curated", "V4.5 Curated"],
];

/** v2 의 Size 드롭다운 그대로. ✦ 는 NAI 가 기본 요금으로 처리하는 해상도 */
/** 크기 프리셋 — ★**v2 목록 그대로**다 (`index.html` 의 `sizePreset`, 대조 2026-08-16).
 *  세 번째 값(`★`)은 **NAI 공홈에 있는 것**이라는 표시다 (공홈 v4 프리셋 표).
 *  ★Small·Large·Wallpaper 가 통째로 빠져 있었다 — 옮기다 만 자리였다. */
export const SIZE_PRESETS: { group: string; items: [number, number, boolean][] }[] = [
  { group: "landscape", items: [[1536, 640, false], [1344, 768, false], [1216, 832, true], [1152, 896, false]] },
  { group: "square", items: [[1024, 1024, true]] },
  { group: "portrait", items: [[896, 1152, false], [832, 1216, true], [768, 1344, false], [640, 1536, false]] },
  { group: "small", items: [[768, 512, true], [640, 640, true], [512, 768, true]] },
  { group: "large", items: [[1536, 1024, true], [1472, 1472, true], [1024, 1536, true]] },
  { group: "wallpaper", items: [[1920, 1088, true], [1088, 1920, true]] },
];

/** ★NAI 가 받는 범위. 넘기면 400 이 온다 (v2 enforceNaiLimits, index.html:14476) */
export const NAI_MAX = { steps: 50, cfg: 10 };


/** ★NAI 는 64 배수 해상도만 받는다. 식은 `lib/align.ts` 하나뿐이다 —
 *  화면과 서버가 다른 식을 쓰면 표시 해상도·Anlas 가 실제 청구와 어긋난다. */
export { alignTo64 } from "../lib/align";

/** 베이스 그림을 넣었을 때 **해상도를 그 그림에 맞춘다** — 공홈이 하는 그대로다
 *  (`lib/baseSize` 머리 주석). 잠그지 않는다: 값만 채우고 사용자가 바꿀 수 있다.
 *
 *  ★이 단계가 없으면 전송 직전 리샘플이 **비율을 무시하고 늘려** 그림이 눌린다.
 *    3.0 에 통째로 빠져 있던 자리다 (실측 2026-08-13).
 *  ★바꿨으면 **알린다** — 말없이 숫자가 바뀌면 사용자가 자기가 고른 값을 잃었다고 느낀다. */
export async function fitSizeToBase(b64: string): Promise<void> {
  const size = await new Promise<{ w: number; h: number } | null>((res) => {
    const im = new Image();
    im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight });
    im.onerror = () => res(null);
    im.src = "data:image/png;base64," + b64;
  });
  if (!size) return;
  const next = sizeForBase(size.w, size.h);
  const cur = useGen.getState().params;
  // ★이미 그 값이면 아무 말도 하지 않는다 — 바뀐 게 없는데 알리면 소음이다
  if (!next || (next.width === cur.width && next.height === cur.height)) return;
  useGen.setState({ params: { ...useGen.getState().params, ...next } });
  // ★바꿨으면 **어디가 바뀌었는지 보여 준다** (사용자 지시 2026-08-13) —
  //   우측 패널을 펴고 해상도 자리를 잠깐 강조한다
  useUi.getState().reveal("right", "size");
  toast(t("imgIn.sizeFitted", { w: String(next.width), h: String(next.height) }));
}

const DEFAULT_PARAMS: GenParams = {
  model: "nai-diffusion-4-5-full",
  width: 832,
  height: 1216,
  steps: 28,
  cfg: 5,
  sampler: "k_euler_ancestral",
  scheduler: "karras",
  // ★처음부터 **구체적인 숫자**다 — `-1` 이면 재현할 값이 화면에 없다 (페로픽스파이와 같다)
  seed: Math.floor(Math.random() * 4294967295),
  cfg_rescale: 0,
  uc_preset: "Heavy",
  quality_tags: true,
  variety_plus: false,
  furry_mode: false,
  save_format: "png",
  jpg_quality: 95,
  strip_metadata: false,
  auto_save: true,
  exclude_slot_number: false,
  seed_mode: "round",
};

type S = {
  params: GenParams;
  set: <K extends keyof GenParams>(k: K, v: GenParams[K]) => void;
  /** 세트 탭에서 지금 보고 있는 셀 (싱글이면 null) */
  cell: string | null;
  setCell: (c: string | null) => void;
  current: string | null;
  select: (file: string | null) => void;
  busy: boolean;
  error: string;
  base: string;
  init: () => Promise<void>;
  /** @param extra 요청에 얹을 것 (강화의 `enhance_of` 등) */
  generate: (cell?: string | null, extra?: Record<string, unknown>) => Promise<void>;
  generateAll: () => Promise<void>;
};

export const useGen = create<S>((set, get) => ({
  params: DEFAULT_PARAMS,
  set: (k, v) => set({ params: { ...get().params, [k]: v } }),
  cell: null,
  setCell: (c) => set({ cell: c }),
  current: null,
  select: (file) => set({ current: file }),
  busy: false,
  error: "",
  base: "",

  async init() {
    set({ base: await backendUrl() });
  },

  async generate(cell, extra) {
    const ws = useWs.getState();
    const tab = ws.activeTab();
    if (!tab) return;
    const targetCell = cell !== undefined ? cell : tab.kind === "set" ? get().cell : null;
    // ★id 를 함께 보낸다 — 화면은 이걸로 묶는다 (workspace.ts `takesOf`).
    //   폴더는 계속 이름을 쓰지만, 이름은 바뀌므로 화면이 이름을 믿으면 안 된다.
    const slotId =
      tab.kind === "set" && targetCell != null
        ? (allCells(tab).find((c) => c.name === targetCell)?.id ?? null)
        : null;

    set({ busy: true, error: "" });
    // ★이번 장에 쓸 시드 — **적힌 값 그대로**다 (`lib/seedRounds` 머리 주석).
    //   랜덤이어도 아무 숫자가 아니라 이 값으로 뽑고, 끝난 뒤에 칸을 굴린다.
    const shot = get().params.seed;
    try {
      // ★한 장짜리 자리라 추첨도 한 번이다 (강화·인핸스가 여기로 온다)
      const { prompt, uc, chars } = resolveShot(wildcardPools(), usePrompt.getState().compiled());
      const r = await api<Record<string, any> & { file: string | null; seed: number }>("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...get().params,
          // 바이브·레퍼런스·베이스 그림 — 단발과 큐가 **같은 창구**를 쓴다
          ...useImageInput.getState().payload(),
          // ★Random 이어도 **숫자를 박아** 보낸다 (아래 `randomSeed` 주석)
          seed: shot,
          // 강화라면 원본 파일이 실린다 (`enhance_of`) — 그 그림의 버전으로 묶인다
          ...(extra ?? {}),
          prompt,
          negative_prompt: uc,
          characters: chars,
          workspace: ws.current,
          char: tab.kind === "set" ? (ws.activeCharOf()?.name ?? null) : null,
          tab: tab.name,
          cell: targetCell,
          cell_no:
            tab.kind === "set" && targetCell != null
              ? allCells(tab).findIndex((c) => c.name === targetCell) + 1
              : null,
          tab_id: tab.id,
          cell_id: slotId,
        }),
      });
      // ★자동 저장을 껐으면 파일이 없다 — 디스크에 기록하지 않고 **메모리에만** 담는다.
      //   자리는 저장된 것과 같다 (씬 줄의 「미저장」 칸, `store/previews.ts`)
      if (!r.file) {
        const { usePreviews } = await import("./previews");
        usePreviews.getState().add({ ...r, workspace: ws.current });
        set({ current: null });
        if (get().params.seed_mode !== "fixed") get().set("seed", randomSeed());
        return;
      }
      ws.addRecord({
        // ★서버가 찍은 시각을 쓴다 (`lib/takes.localTs` 주석 — UTC 와 지역시각이 섞이면
        //   줄 차례가 어긋난다)
        ts: (r as { ts?: string }).ts || localTs(),
        file: r.file,
        enhance_of: (extra?.enhance_of as string) ?? null,
        tab: tab.name,
        cell: targetCell,
        tab_id: tab.id,
        cell_id: slotId,
        seed: r.seed,
      });
      set({ current: r.file });
      // ★랜덤이면 **끝난 뒤 표시 시드를 굴린다** — 시드 칸이 매번 바뀌고, Random 을 끄면
      //   방금 값으로 고정 재현이 된다 (페로픽스파이 `start` 끝의 advance 와 같다)
      if (get().params.seed_mode !== "fixed") get().set("seed", randomSeed());
    } catch (e) {
      set({ error: String(e) });
    } finally {
      set({ busy: false });
    }
  },

  async generateAll() {
    const ws = useWs.getState();
    const tab = ws.activeTab();
    if (!tab || tab.kind !== "set") return;
    // ★락은 **생성에서 뺀다** (v2 슬롯의 락). 지운 것이 아니라 이번에만 건너뛴다.
    // ★공통 접두는 **카드마다 다르다** (2026-08-11) — 그래서 씬을 카드와 함께 편다.
    const all = allScenes(tab);
    const live = all.filter((x) => !x.cell.locked && !x.card.locked);
    if (!live.length) {
      /* ★눌렀는데 **조용히 아무 일도 안 일어나면** 고장으로 보인다 (v2 `index.html:15905`).
         까닭이 둘이라 말도 둘이다:
           · 씬은 있는데 **전부 잠김** — 잠금을 풀라고 한다.
           · 씬이 **아예 없음** — 새 탭·새 워크스페이스의 기본값이 그렇다(2026-08-20).
             예전에는 기본으로 씬 하나가 박혀 있어 이 경우가 드물었지만, 이제는 **처음 화면**
             이라 아무 말도 없으면 생성 단추가 죽은 것으로 읽힌다. */
      toast(t(all.length ? "gen.allLocked" : "gen.noScenes"), "warn");
      return;
    }

    const raw = usePrompt.getState().compiled();
    const pools = wildcardPools();
    // ★요청 레벨은 **대표값(폴백)** 이다. 실제로 쓰이는 것은 항목마다 다시 뽑은 값이다
    //   (v2 `index.html:16080`).
    const { uc, chars } = resolveShot(pools, raw);
    /** 씬 번호(1부터) — ★카드를 가로질러 **탭 안에서** 센다. 파일 이름 앞에 붙는 번호라
     *  카드마다 1로 되돌아가면 탐색기에서 같은 번호가 여럿이 된다. */
    const order = allCells(tab);
    // ★큐로 보낸다 — 한 장씩 await 하면 중간에 앱을 닫거나 새로고침하면 나머지가 사라진다.
    //   큐는 백엔드가 들고 있어 재연결로 복원된다 (store/queue.ts).
    await useQueue.getState().enqueue(
      {
        ...get().params,
        ...useImageInput.getState().payload(),
        workspace: ws.current,
        char: ws.activeCharOf()?.name ?? null,
        tab: tab.name,
        tab_id: tab.id,
        negative_prompt: uc,
        characters: chars,
      },
      // ★**바퀴를 여기서 편다** (2026-08-11). 예전에는 씬 목록만 보내고 장 수는 서버가
      //   펼쳤는데(`qb.count`), 그러면 "한 바퀴에 시드 하나"를 표현할 수가 없다.
      //   여기서 펴면 순서와 시드가 둘 다 정확해진다.
      rounds(Math.max(1, useUi.getState().perSlot), get().params, live, ({ card, cell: c }, seed) => {
        // ★씬 프롬프트가 **payload 의 어디로** 들어가나 — 탭의 선택 하나가 정한다.
        //   `base` 면 top-level prompt 에, 캐릭터 id 면 그 사람의 `characterPrompts[]` 에 붙는다.
        //   ★고른 캐릭터가 목록에 없으면(꺼짐·삭제) base 로 떨어진다 — 조용히 사라지지 않게.
        const scene = compileBlocks(c.blocks);
        // ★목적지는 **셋**이다 — base · 캐릭터 한 명 · **캐릭터 전원**(`"all"`).
        //   「전원」은 v2 의 `promptTarget === "char"` 이다 (`backend.py:2803-2833`): 그쪽은
        //   씬 태그를 **켜진 캐릭터 전부**의 프롬프트에 이어 붙였다.
        //   ★켜진 캐릭터가 **둘 이상일 때만** 뜻이 있다 (한 명이면 그 사람을 고르는 것과 같다) —
        //     화면도 그때만 선택지를 낸다(`SceneLane`). 조건이 깨지면 base 로 떨어진다.
        const dest =
          tab.sceneDest === "all" && raw.chars.length > 1
            ? "all"
            : raw.chars.some((ch) => ch.id === tab.sceneDest)
              ? tab.sceneDest
              : "base";
        const toChar = dest !== "base";
        // ★★**이 장의 추첨**이다. 회차마다·씬마다 따로 뽑히며, 이 한 줄이 와일드카드의
        //   존재 이유다 (`docs/v2-feature-catalog.md:477`: 한 번만 풀면 전 이미지가 굳는다).
        //   ★푸는 것은 **이어 붙인 뒤**다. `#이름` 은 나타날 때마다 따로 뽑히므로 결과가 같고,
        //     접두·캐릭터·씬을 따로 풀던 v2 보다 자리가 하나로 모인다.
        const shot = resolveShot(pools, {
          // 카드 접두 + 캐릭터 + 이 씬의 블록들 순서로 잇는다 (v2 프리셋 prefix 와 같은 자리).
          // ★씬도 블록이라 **켜진 블록만** 들어간다 — 프롬프트 쪽과 같은 규칙이다
          prompt: [(card.prefix || "").trim(), raw.prompt, toChar ? "" : scene]
            .filter(Boolean)
            .join(", "),
          uc: raw.uc,
          chars: toChar
            ? raw.chars.map((ch) =>
                (dest === "all" || ch.id === dest) && scene
                  ? { ...ch, prompt: [ch.prompt, scene].filter(Boolean).join(", ") }
                  : ch,
              )
            : raw.chars,
        });
        return {
          cell: c.name,
          cell_id: c.id,
          // ★씬 번호(1부터) — 파일 이름 앞에 붙어 탐색기에서 순서를 만든다.
          //   ★잠긴 씬을 뺀 뒤의 순번이 아니라 **탭에서의 자리**여야 번호가 안 흔들린다
          cell_no: order.findIndex((x) => x.id === c.id) + 1,
          seed,
          prompt: shot.prompt,
          negative_prompt: shot.uc,
          characters: shot.chars,
          // ★★**이 장을 뽑는 화면 구조를 그대로 남긴다** (사용자 지시 2026-08-19).
          //   「새 탭으로 복제」가 이것으로 환경을 되살린다 — PNG 메타데이터에는 **합쳐진
          //   문자열**만 남아 스타일 카드·블록 나눔·캐릭터 카드를 못 되살리기 때문이다.
          //   ★남겨 두면 나중에 그 탭을 고치거나 지워도 **그때 환경 그대로** 복제된다.
          //   ★여기 담는 것은 **`generateAll` 이 읽는 것 전부**여야 한다 (회귀 `cloneEnv.test.ts`).
          //     그림 바이트는 안 담는다 — 구조뿐이라 작다.
          env: {
            prompt: usePrompt.getState().snapshot(),
            prefix: card.prefix,
            sceneDest: tab.sceneDest,
            cell: { name: c.name, blocks: c.blocks },
          },
        };
      }),
      1,
    );
    if (get().params.seed_mode !== "fixed") get().set("seed", randomSeed());
  },
}));
