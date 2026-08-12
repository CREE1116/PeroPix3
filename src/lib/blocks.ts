/** 블록 모델과 컴파일 — 목업(peropix-block-editor.html)에서 이식.
 *
 *  ★가중치는 **태그에만** 있다 (2026-08-01 결정).
 *    목업에는 블록 가중치(제목 휠)가 있었지만, 쓰임이 불분명하고 곱셈이 혼란스러워 걷어냈다.
 *    필요해지면 되살릴 수 있으나, 되살릴 땐 "왜 태그 가중치로는 안 되는가"를 먼저 답할 것.
 *  ★NAI 가중치 문법은 `n::tag::` 가 정본이다 (갤러리 392건 중 63.5%).
 *    `{}` `[]` 는 구형이라 만들지 않는다.
 */

export type Tag = { t: string; w: number | null };

export type BlockColor = "blue" | "teal" | "purple" | "amber" | "red" | "green" | null;

export type Block = {
  id: string;
  label: string;
  color: BlockColor;
  /** 끄면 컴파일에서 빠진다 */
  on: boolean;
  open: boolean;
  tags: Tag[];
  /** ★**이 탭에서만 사는 블록** (사용자 지시 2026-08-07).
   *
   *  포즈세트 카드는 여럿이 나눠 쓰는 것이라, 이 캐릭터에만 붙일 것을 거기 담으면 안 된다.
   *  그래서 이 블록은 **카드로 저장할 때 빠진다**(`cardBlocks`). 색·이름을 못 바꾸고
   *  생김새도 다른 것은 전부 그 한 가지를 눈으로 알리기 위해서다 — 고쳐서 평범한 블록처럼
   *  보이게 만들면 "왜 이건 카드에 안 담겼지"가 된다. */
  extra?: boolean;
};

/** 「추가」 블록의 **고정 색** — 고를 수 없다. 어느 화면에서나 같은 뜻으로 읽히게. */
export const EXTRA_COLOR = "var(--warn)";

/** 카드에 담을 블록만 — ★`extra` 는 이 탭 것이라 뺀다 */
export const cardBlocks = (blocks: Block[]): Block[] => blocks.filter((b) => !b.extra);

export const COLORS: BlockColor[] = [null, "blue", "teal", "purple", "amber", "red", "green"];

export const COLOR_HEX: Record<string, string> = {
  blue: "#4a90d9",
  teal: "#2aa198",
  purple: "#9b6dd6",
  amber: "#d8a34f",
  red: "#d9736a",
  green: "#58a86c",
};

let seq = 0;
export const newId = () => `b${Date.now().toString(36)}${(seq++).toString(36)}`;

export function makeBlock(label: string, tags: string[] = [], opt: Partial<Block> = {}): Block {
  return {
    id: newId(),
    label,
    color: null,
    on: true,
    open: false,
    tags: tags.map((t) => ({ t, w: null })),
    ...opt,
  };
}

/** 소수점 둘째 자리까지. 1.20 -> "1.2" */
export const fmtW = (w: number) => String(Math.round(w * 100) / 100);

/** 실효 가중치 = 태그 가중치. 1 이면 null (문법을 붙이지 않는다) */
export function effW(x: Tag): number | null {
  if (x.w == null) return null;
  const e = Math.round(x.w * 100) / 100;
  return e === 1 ? null : e;
}

/** 블록 하나를 NAI 프롬프트 문자열로.
 *  ★같은 실효 가중치가 연속되면 하나로 묶는다: `1.8::a, b::` */
export function compileBlock(bl: Block): string {
  const tags = bl.tags.filter((x) => x.t.trim());
  if (!tags.length) return "";

  const parts: string[] = [];
  let run: string[] = [];
  let runW: number | null | undefined = undefined;

  const flush = () => {
    if (!run.length) return;
    parts.push(runW != null ? `${fmtW(runW)}::${run.join(", ")}::` : run.join(", "));
    run = [];
    runW = undefined;
  };

  for (const x of tags) {
    const w = effW(x);
    if (runW === undefined) {
      run = [x.t];
      runW = w;
    } else if (w === runW) {
      run.push(x.t);
    } else {
      flush();
      run = [x.t];
      runW = w;
    }
  }
  flush();
  return parts.join(", ");
}

/** 켜진 블록만 이어 붙인다. */
export function compileBlocks(blocks: Block[]): string {
  return blocks
    .filter((b) => b.on)
    .map(compileBlock)
    .filter(Boolean)
    .join(", ");
}

/** 텍스트를 태그 목록으로. `1.8::a, b::, plain, -2::c::` 를 이해한다. */
export function parseSegs(str: string): Tag[] {
  const out: Tag[] = [];
  const re = /(-?\d+(?:\.\d+)?)\s*::(.*?)::/gs;
  let last = 0;
  let m: RegExpExecArray | null;

  const plain = (s: string) =>
    s
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
      .forEach((t) => out.push({ t, w: null }));

  while ((m = re.exec(str))) {
    plain(str.slice(last, m.index));
    const w = parseFloat(m[1]);
    m[2]
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
      .forEach((t) => out.push({ t, w }));
    last = re.lastIndex;
  }
  plain(str.slice(last));
  return out;
}

/** 블록을 텍스트 편집용으로 직렬화. 파싱의 역이라 왕복해도 같은 결과가 나온다. */
export function serializeBlock(bl: Block): string {
  return bl.tags
    .map((x) => {
      const e = effW(x);
      return e != null ? `${fmtW(e)}::${x.t}::` : x.t;
    })
    .join(", ");
}

/** 켜진 블록들에서 중복 태그를 찾는다 (계기판 — 고치지 않고 표시만 한다). */
export function dupSet(blocks: Block[]): Set<string> {
  const seen = new Set<string>();
  const dup = new Set<string>();
  blocks
    .filter((b) => b.on)
    .forEach((b) =>
      b.tags.forEach((x) => {
        const k = x.t.trim().toLowerCase();
        if (!k) return;
        if (seen.has(k)) dup.add(k);
        else seen.add(k);
      }),
    );
  return dup;
}

/** 가중치 강조 수준 → 칩 색 세기 (사용자 요청: 칩 상태에서도 강조가 보이게).
 *  0 = 보통, 양수 = 강조, 음수 = 억제 */
export function weightLevel(w: number | null): number {
  if (w == null || w === 1) return 0;
  if (w < 0) return -2;
  if (w < 1) return -1;
  if (w >= 1.5) return 2;
  return 1;
}
