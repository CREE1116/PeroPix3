import { create } from "zustand";
import { compileBlocks } from "../lib/blocks";
import { api, backendUrl } from "../lib/backend";
import { usePrompt } from "./prompt";
import { allCells, allScenes, useWs } from "./workspace";
import { useQueue } from "./queue";
import { useImageInput } from "./imageInput";
import { useUi } from "./ui";
import { sizeForBase } from "../lib/baseSize";
import { toast } from "./toast";
import { t } from "../i18n";

// 시드 규칙은 `lib/seedRounds.ts` 하나뿐이다 (거기 머리 주석)
import { randomSeed, rounds, type SeedMode } from "../lib/seedRounds";
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
  /** ★싱글도 **큐로** 보낸다 (사용자 지적 2026-08-05: 한 장이 끝나야 다시 누를 수 있었다).
   *  `generate()` 는 강화처럼 **한 장을 즉시** 만드는 자리에만 남는다. */
  queueSingle: (count: number) => Promise<void>;
  /** 인페인트 한 장. 탭 종류를 안 가리고, 결과를 원본이 있던 씬 칸에 붙인다 */
  queueInpaint: (count: number) => Promise<void>;
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
      const { prompt, uc, chars } = usePrompt.getState().compiled();
      const r = await api<{ file: string; seed: number }>("/api/generate", {
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
      ws.addRecord({
        ts: new Date().toISOString(),
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

  /** 세트 탭: 셀마다 한 장씩 */
  async queueSingle(count) {
    const ws = useWs.getState();
    const tab = ws.activeTab();
    if (!tab || tab.kind === "set") return;
    const { prompt, uc, chars } = usePrompt.getState().compiled();
    // ★★시드는 **여기서 장마다 확정**한다 — 예전에는 랜덤이면 `-1` 로 보내 서버가 뽑게
    //   했는데, 그러면 **적힌 시드가 통째로 무시된다** (사용자 지적 2026-08-16).
    //   첫 장은 적힌 값, 그 뒤로만 새로 뽑는다 (`lib/seedRounds` 머리 주석).
    const shots = rounds(Math.max(1, count), get().params, [null], (_, seed) => ({ seed }));
    await useQueue.getState().enqueue(
      {
        ...get().params,
        ...useImageInput.getState().payload(),
        prompt,
        negative_prompt: uc,
        characters: chars,
        workspace: ws.current,
        tab: tab.name,
        tab_id: tab.id,
      },
      shots,
      1,
    );
    if (get().params.seed_mode !== "fixed") get().set("seed", randomSeed());
  },

  /** 인페인트 한 장. **탭 종류를 안 가린다**.
   *
   *  ★`queueSingle` 은 씬 탭에서 그냥 돌아가고(옛 싱글 탭 전용), `generateAll` 은 씬을 전부
   *    돈다. 인페인트는 **그림 한 장을 고치는 일**이라 둘 다 아니다.
   *  ★결과는 **원본이 있던 씬 칸**에 붙는다 (`origin`). 안 붙이면 씬 탭에서는 셀 없는
   *    레코드가 되어 화면 어디에도 안 뜬다 (`lib/takes.ts`).
   *  ★프롬프트는 **왼쪽 패널에 있는 그대로** 쓴다. 인페인트 중에는 그 패널이 씬 프롬프트가
   *    아니라 **인페인트 사본**을 들고 있다 (`store/imageInput` 의 startEdit). 여기서 씬
   *    블록을 또 붙이면 사본에 이미 든 것이 두 번 들어간다. */
  async queueInpaint(count) {
    const ws = useWs.getState();
    const tab = ws.activeTab();
    if (!tab) return;
    const { prompt, uc, chars } = usePrompt.getState().compiled();
    const origin = useImageInput.getState().originCell;
    const found = tab.kind === "set" && origin
      ? allScenes(tab).find((x) => x.cell.id === origin.id)
      : null;
    // ★페이로드를 **먼저** 굳힌다. `payload()` 와 `compiled()` 는 편집 중일 때만 인페인트
    //   내용을 내므로, 편집에서 나가기 전에 다 읽어 둬야 한다
    const body = {
      ...get().params,
      ...useImageInput.getState().payload(),
      prompt,
      negative_prompt: uc,
      characters: chars,
      workspace: ws.current,
      char: ws.activeCharOf()?.name ?? null,
      tab: tab.name,
      tab_id: tab.id,
      ...(found ? { cell: found.cell.name, cell_id: found.cell.id } : {}),
    };
    // ★보냈으면 편집에서 나온다 (사용자 결정 2026-08-13). 여기 머물면 결과를 못 본다.
    //   마스크·사각형·프롬프트 사본은 남아, 다시 들어가면 그대로 이어진다
    useImageInput.getState().endEdit();
    // ★시드는 장마다 여기서 확정한다 (`queueSingle` 과 같은 규칙)
    const shots = rounds(Math.max(1, count), get().params, [null], (_, seed) => ({ seed }));
    await useQueue.getState().enqueue(body, shots, 1);
    if (get().params.seed_mode !== "fixed") get().set("seed", randomSeed());
  },

  async generateAll() {
    const ws = useWs.getState();
    const tab = ws.activeTab();
    if (!tab || tab.kind !== "set") return;
    // ★락은 **생성에서 뺀다** (v2 슬롯의 락). 지운 것이 아니라 이번에만 건너뛴다.
    // ★공통 접두는 **카드마다 다르다** (2026-08-11) — 그래서 씬을 카드와 함께 편다.
    const live = allScenes(tab).filter((x) => !x.cell.locked && !x.card.locked);
    if (!live.length) return;

    const { prompt, uc, chars } = usePrompt.getState().compiled();
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
        const dest = chars.some((ch) => ch.id === tab.sceneDest) ? tab.sceneDest : "base";
        const toChar = dest !== "base";
        return {
          cell: c.name,
          cell_id: c.id,
          // ★씬 번호(1부터) — 파일 이름 앞에 붙어 탐색기에서 순서를 만든다.
          //   ★잠긴 씬을 뺀 뒤의 순번이 아니라 **탭에서의 자리**여야 번호가 안 흔들린다
          cell_no: order.findIndex((x) => x.id === c.id) + 1,
          seed,
          // 카드 접두 + 캐릭터 + 이 씬의 블록들 순서로 잇는다 (v2 프리셋 prefix 와 같은 자리).
          // ★씬도 블록이라 **켜진 블록만** 들어간다 — 프롬프트 쪽과 같은 규칙이다
          prompt: [(card.prefix || "").trim(), prompt, toChar ? "" : scene]
            .filter(Boolean)
            .join(", "),
          ...(toChar
            ? {
                characters: chars.map((ch) =>
                  ch.id === dest && scene
                    ? { ...ch, prompt: [ch.prompt, scene].filter(Boolean).join(", ") }
                    : ch,
                ),
              }
            : {}),
        };
      }),
      1,
    );
    if (get().params.seed_mode !== "fixed") get().set("seed", randomSeed());
  },
}));
