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
};

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

/** 씬 칸 하나 = **블록 하나** (사용자 결정 2026-08-20).
 *
 *  ★★씬 칸은 예전에 목록이었다. 그러다 줄 안이 좁아 글 상자로 바꾸면서
 *    **저장은 목록, 편집은 한 줄**로 갈라졌다 — 그래서 씬 칸은 칩도 가중치 휠도
 *    못 썼고, 블록이 둘 이상인 카드를 얹으면 첫 편집에 이름·색·온오프가 조용히 뭉개졌다.
 *    이제 **칸에 블록은 하나뿐**이다 — 그래서 머리(이름·색·켜고끄기)를 그리지 않고
 *    칩만 남긴다. 칸 이름은 줄 머리에 이미 있어 블록 라벨은 **빈다**
 *    (같은 이름을 두 곳에 두면 어느 쪽이 진짜인지 모른다).
 *  ★여러 개가 오면 **켜진 것만 이어 붙인다** — 꺼진 블록은 화면에 안 보이던 것이라
 *    살려 내면 안 적은 태그가 갑자기 나타난다 (지금까지 `compileBlocks` 가 보여 주던 것과 같다).
 *  ★id 는 **칸이 준다** — 매번 새로 발급하면 다시 그릴 때마다 블록이 바뀐 것으로 읽힌다. */
export function slotBlock(blocks: Block[] | undefined, id: string): Block {
  const on = (blocks ?? []).filter((b) => b.on);
  if (on.length === 1) return { ...on[0], label: "", open: true };
  return {
    id: on[0]?.id ?? id,
    label: "",
    color: null,
    on: true,
    open: true,
    tags: on.flatMap((b) => b.tags),
  };
}

/** 칸에 다시 담는다 — ★저장본은 언제나 **하나짜리 목록**이다 */
export const slotBlocksOf = (b: Block): Block[] => [{ ...b, label: "", on: true, open: true }];

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

/** 칩을 눌러 글 상자를 열 때 **그 태그의 쉼표 뒤**에 놓을 커서 자리와, 그때 펼칠 글.
 *
 *  ★태그 **끝**에 놓으면 치는 글자가 그 태그에 달라붙는다 (사용자 지적 2026-08-19).
 *    칩을 누르는 것은 거기서부터 **이어 적으려는** 것이라, 자리는 다음 태그가 시작하는 곳이다.
 *  ★한 태그가 한 조각이라(`serializeBlock`) 앞부분 길이 + `", "` 가 정확히 그 자리다.
 *  ★마지막 태그면 이어 붙일 쉼표가 없다 — 하나 만들어 준다. 안 치고 나가면 빈 조각이라
 *    `parseSegs` 가 버리므로 블록은 그대로다.
 */
export function caretAfterTag(bl: Block, i: number): { at: number; text: string } {
  const head = serializeBlock({ ...bl, tags: bl.tags.slice(0, i + 1) });
  const last = i >= bl.tags.length - 1;
  return { at: head.length + 2, text: last ? `${head}, ` : serializeBlock(bl) };
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
