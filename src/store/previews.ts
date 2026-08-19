import { create } from "zustand";
import { api } from "../lib/backend";
import { localTs, type Rec } from "../lib/takes";

/** **미저장 그림** — 「자동 저장」을 껐을 때 나온 결과 (v2 `auto_save` 이식 2026-08-18).
 *
 *  ★v2 에는 이것만을 위한 화면이 **없다**. 미저장 그림도 저장된 것과 **같은 슬롯 카드**에
 *    들어가고, 파일명 자리가 「미저장」이 되며 「파일로 저장」 단추가 뜰 뿐이다
 *    (`index.html:12140-12185`). 3.0 도 같다 — 씬 줄의 **같은 칸**에 들어간다.
 *  ★★**디스크에 기록을 남기지 않는다.** `Rec` 는 파일 경로를 전제로 하고 그 목록은
 *    `records.jsonl` 에 쌓이는데, 미저장 그림에는 파일이 없다. 그래서 여기(메모리)에만 두고
 *    새로고침하면 사라진다 — v2 도 같다.
 *  ★묶는 창구는 여전히 `takesOf` 하나다. 이 스토어가 하는 일은 **목록에 얹는 것**뿐이고
 *    (`withPreviews`), 어느 씬 것인지 판정하는 것은 `takesOf` 가 한다.
 */

/** 미저장 그림의 `file` 자리에 들어가는 표식.
 *  ★진짜 경로와 섞이면 안 되므로 경로에 못 쓰는 글자(`:`)를 일부러 넣었다 —
 *    `workspace.safe_name` 이 걸러 내는 글자라 실제 파일이 이 이름을 가질 수 없다. */
export const PREVIEW_PREFIX = "preview:";

/** 문자열만 들고 있는 자리(선택 집합 등)의 판정 — 레코드가 있으면 `r.preview` 를 본다 */
export const isPreviewFile = (file: string) => file.startsWith(PREVIEW_PREFIX);

/** 저장할 때 필요한 것 — ★**서버가 생성 때 쓴 값 그대로** 돌려준다 (`_generate_one`).
 *  화면이 저장 시점의 상태로 다시 만들면, 그 사이 씬 이름을 고쳤을 때 번호열이 갈린다
 *  (`workspace.file_lead` 는 이름마다 따로 센다). */
type SaveHint = {
  char: string | null;
  cell_no: number | null;
  exclude_slot_number: boolean;
};

export type PreviewTake = Rec & {
  /** 어느 워크스페이스 것인가 — `records` 와 달리 워크스페이스를 옮겨도 안 비워진다 */
  ws: string;
  preview: { b64: string; fmt: string };
  save: SaveHint;
};

type S = {
  items: PreviewTake[];
  /** 서버가 보낸 미리보기 한 장을 담는다 (`image_preview` 브로드캐스트 · 단발 생성 응답) */
  add: (m: Record<string, any>) => PreviewTake;
  /** 미리보기를 버린다 (파일이 아니라 메모리에서 없어질 뿐이다) */
  drop: (file: string) => void;
  /** **파일로 저장** — 보통 생성과 같은 이름 규칙을 쓴다 (`/api/save-preview`).
   *  성공하면 그 미리보기는 목록에서 빠지고, 진짜 레코드가 그 자리를 잇는다. */
  save: (file: string) => Promise<Rec>;
};

let seq = 1;

export const usePreviews = create<S>((set, get) => ({
  items: [],

  add(m) {
    const take: PreviewTake = {
      // ★저장된 그림과 **같은 자**로 찍는다 — 줄에서 나란히 서야 한다 (`lib/takes.localTs`)
      ts: (m.ts as string) || localTs(),
      file: `${PREVIEW_PREFIX}${seq++}`,
      tab: String(m.tab ?? ""),
      cell: (m.cell as string) ?? null,
      tab_id: (m.tab_id as string) ?? null,
      cell_id: (m.cell_id as string) ?? null,
      seed: Number(m.seed ?? 0),
      enhance_of: (m.enhance_of as string) ?? null,
      ws: String(m.workspace ?? ""),
      preview: { b64: String(m.b64 ?? ""), fmt: String(m.fmt ?? "png") },
      save: {
        char: (m.char as string) ?? null,
        cell_no: m.cell_no == null ? null : Number(m.cell_no),
        exclude_slot_number: !!m.exclude_slot_number,
      },
    };
    set({ items: [...get().items, take] });
    return take;
  },

  drop(file) {
    set({ items: get().items.filter((x) => x.file !== file) });
  },

  async save(file) {
    const it = get().items.find((x) => x.file === file);
    if (!it) throw new Error(file);
    const r = await api<{ ok: boolean; file: string; record: Rec }>("/api/save-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspace: it.ws,
        b64: it.preview.b64,
        fmt: it.preview.fmt,
        tab: it.tab,
        tab_id: it.tab_id,
        cell: it.cell,
        cell_id: it.cell_id,
        cell_no: it.save.cell_no,
        char: it.save.char,
        exclude_slot_number: it.save.exclude_slot_number,
        enhance_of: it.enhance_of,
        seed: it.seed,
      }),
    });
    // ★파일이 된 **뒤에** 미리보기를 버린다. 먼저 버리면 저장이 실패했을 때 그림이 사라진다
    get().drop(file);
    return r.record;
  },
}));

/** 저장된 결과 + 미저장 그림을 **한 목록으로** 만든다.
 *
 *  ★섞는 자리를 여럿 두지 않는다 — 씬 줄과 큰 그림이 같은 목록을 봐야 휠로 넘기는 순서가
 *    줄과 어긋나지 않는다. 묶는 판정 자체는 그대로 `takesOf` 가 한다.
 *  ★미저장은 **뒤에 붙는다** — 방금 나온 것이므로 줄에서는 맨 왼쪽에 선다 (줄은 뒤집는다). */
export function withPreviews(records: Rec[], ws: string, previews: PreviewTake[]): Rec[] {
  if (!previews.length) return records;
  const mine = previews.filter((p) => p.ws === ws);
  return mine.length ? [...records, ...mine] : records;
}
