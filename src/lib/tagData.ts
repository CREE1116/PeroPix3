/** Danbooru 태그 사전 — 페로픽스파이(`ui/src/tags/tagData.ts`)에서 이식.
 *
 *  `public/tags.json` 68,427개(2026-01-18 시점)를 **한 번** 읽어 첫 글자 인덱스를 만들고,
 *  `startsWith` → 모자라면 `includes` 두 단계로 찾는다.
 *
 *  ★사전은 **읽기만 한다.** 코드가 고치지 않는다.
 *  ★한국어 별칭은 없다 — 공개된 한국어 단부루 태그 데이터셋이 없다(2026-08-07 조사,
 *    일본어·중국어는 있다). 필요해지면 별도 파일로 얹되 이 파일은 그대로 둔다. */

export type TagEntry = {
  label: string;
  value: string;
  count: number;
  /** general | artist | character | copyright | meta */
  type: string;
  category: number;
  aliases?: string[];
  _lower?: string;
};

/** NAI 가 쓰는데 단부루 사전에는 없는 것들 — 실제로 확인하고 넣는다.
 *  `very aesthetic, masterpiece, no text` 는 백엔드가 V4.5 프롬프트 끝에 붙이는 품질
 *  태그이고(`backend/nai.py` `V45_QUALITY_TAGS`), `best quality` 는 기본 블록이 쓴다
 *  (`store/prompt.ts` `defaultBase`). 넷 다 `tags.json` 에 없어 여기서 메운다. */
const EXTRA: TagEntry[] = ["very_aesthetic", "masterpiece", "no_text", "best_quality"].map(
  (label) => ({ label, value: label, count: 8_000_000, type: "meta", category: 5 }),
);

/** ★NAI Diffusion **V5 에서 새로 생긴 태그** (NAI 공지 2026-08-21, 사용자 전달).
 *
 *  ★★근거는 **공지문뿐**이다. 공홈 번들에는 태그 사전이 없다 — 자동완성을 서버
 *    (`/ai/generate-image/suggest-tags`)에 물어보는 구조라 뽑아 올 데가 없었다.
 *    번들에서 교차 확인된 것은 실제 생성 프롬프트에 쓰인 `medium complexity` 하나다.
 *  ★★**표기를 손대지 않는다** (사용자 지시 2026-08-21). 밑줄로 바꾸거나 콜론을 빼면
 *    자동완성이 넣어 주는 문자열이 실제 태그와 달라진다 — 사전 표기가 아니라
 *    **프롬프트에 그대로 나가는 문자열**이 정본이다.
 *  ★`count` 는 0 이다 — 새 태그라 사용량 자료가 없다. 지어내지 않는다.
 *  ★`tags.json`(단부루 덤프)에 이미 있는 `transparent background`·`alpha transparency`
 *    는 여기 넣지 않는다 (중복은 `loadTags` 가 거르지만 애초에 둘 필요가 없다).
 */
const V5_TAGS: [string, number][] = [
  ["depthness", 0],
  ["attractive male", 0],
  ["low complexity", 0],
  ["medium complexity", 0],
  ["high complexity", 0],
  ["ultra complexity", 0],
  ["has alpha", 0],
  ["visual novel art", 0],
  ["visual novel bg", 0],
  ["visual novel cg", 0],
  ["visual novel chibi", 0],
  ["visual novel sprite", 0],
  // ★`meta:` 접두가 붙은 둘. 콜론을 친 뒤에 골라도 제대로 들어간다
  //   (`currentWord` 가 홑콜론을 태그 글자로 본다 — 2026-08-21 에 고쳤다).
  ["meta:novel era", 5],
  ["meta:golden era", 5],
];
EXTRA.push(
  ...V5_TAGS.map(([label, category]) => ({
    label,
    value: label,
    count: 0,
    type: category === 5 ? "meta" : "general",
    category,
  })),
);

/** 검색용 표기 — ★**밑줄과 띄어쓰기를 같은 것으로 본다.**
 *
 *  ★★단부루 사전은 `high_complexity` 꼴이고 V5 새 태그는 `high complexity` 꼴이다.
 *    예전에는 화면이 질의의 띄어쓰기를 밑줄로 바꿔 던졌는데(`word.replace(/ /g,"_")`),
 *    그러면 **띄어쓰기 표기의 태그는 영영 안 걸린다.** 한쪽으로 맞추는 자리를 여기 하나로 둔다. */
const norm = (s: string) => s.toLowerCase().replace(/_/g, " ");

let ALL: TagEntry[] = [];
let INDEX: Record<string, TagEntry[]> = {};
let loaded = false;
let loading: Promise<void> | null = null;

export const tagsLoaded = () => loaded;

/** 한 번만 읽는다. 파일이 없어도 위 넷은 언제나 제안된다. */
export function loadTags(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (loading) return loading;
  loading = (async () => {
    let tags: TagEntry[] = [];
    try {
      const res = await fetch("/tags.json");
      if (res.ok) tags = (await res.json()) as TagEntry[];
    } catch {
      /* 사전이 없어도 앱은 돈다 — 자동완성만 빠진다 */
    }
    const index: Record<string, TagEntry[]> = {};
    const seen = new Set<string>();
    for (const t of tags) {
      t._lower = norm(t.label);
      seen.add(t._lower);
      (index[t._lower[0]] ||= []).push(t);
    }
    // ★중복 검사도 **같은 표기**로 — `seen` 은 정규화된 것이라 여기만 날것이면 걸리지 않는다
    const extra = EXTRA.filter((t) => !seen.has(norm(t.label)));
    for (const t of extra) {
      t._lower = norm(t.label);
      (index[t._lower[0]] ||= []).unshift(t); // 앞에 넣어 먼저 보이게
    }
    ALL = [...extra, ...tags];
    INDEX = index;
    loaded = true;
  })().catch(() => {});
  return loading;
}

/** 두 단계 검색: 첫 글자 인덱스(앞부터 일치) → 모자라면 전체(포함). */
export function searchTags(query: string, max = 15): TagEntry[] {
  if (!query || query.length < 2) return [];
  const q = norm(query);
  const out: TagEntry[] = [];

  for (const t of INDEX[q[0]] ?? []) {
    if (t._lower!.startsWith(q)) {
      out.push(t);
      if (out.length >= max) return out;
    }
  }
  if (out.length < max) {
    for (const t of ALL) {
      if (out.includes(t)) continue;
      if (t._lower!.includes(q)) {
        out.push(t);
        if (out.length >= max) break;
      }
    }
  }
  return out;
}

export function formatCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

/** 넣을 때 언더바를 띄어쓰기로 — NAI 프롬프트는 띄어쓰기를 쓴다.
 *  ★`^_^` `>_<` 같은 얼굴 태그의 언더바는 남긴다. */
export const underscoresToSpaces = (tag: string) =>
  tag.replace(/_/g, (_m, i: number, s: string) => {
    const before = s[i - 1];
    const after = s[i + 1];
    if (before === "^" || after === "^" || (before && after && /[><;:=]/.test(before + after)))
      return "_";
    return " ";
  });

/** 커서가 놓인 '지금 낱말'. 쉼표·줄바꿈·괄호·콜론이 경계다.
 *  검색에는 커서 **앞부분만** 쓰고, 갈아 끼울 범위는 낱말 뒤 공백까지 먹는다. */
export function currentWord(value: string, cursor: number) {
  // 어퍼스트로피도 태그 글자다 (`another's` 처럼 쓰는 태그가 있다)
  const isTagChar = (c: string) => /[\p{L}\p{N}_\-\s']/u.test(c);
  let start = cursor;
  while (start > 0) {
    const ch = value[start - 1];
    if (ch === ":") {
      // ★★홑콜론은 **태그 글자**다 (`meta:novel era` · `honkai:_star_rail`).
      //   예전에는 경계라서, 콜론을 친 뒤에 고르면 앞의 `meta:` 가 남아
      //   `meta:meta:novel era` 가 됐다 (사용자 지적 2026-08-21).
      // ★★단 `::` 는 **강조 문법**이라 경계다 — 안 그러면 `1.5::fee` 가 통째로
      //   한 낱말이 되어, 고르는 순간 강조 문법이 지워진다.
      // ★★경계로 두는 것**만**으로 충분하다. 한때 강조 구간 안에서 자동완성을 통째로
      //   껐는데(`inEmphasis`), `-0.8::feet::` 처럼 강조 안에 태그를 쓰는 것이 흔해서
      //   되돌렸다 (사용자 지적 2026-08-21). 경계가 있으면 안쪽 낱말만 갈리므로
      //   `1.5::` 는 그대로 남는다.
      if (value[start - 2] === ":" || value[start] === ":") break;
      start--;
      continue;
    }
    if (",\n\r{}[]()".includes(ch) || !isTagChar(ch)) break;
    start--;
  }
  let end = cursor;
  while (end < value.length && (value[end] === " " || value[end] === "\t")) end++;
  const head = value.substring(start, cursor);
  const lead = head.length - head.trimStart().length;
  return { word: head.trim(), start: start + lead, end, fullStart: start };
}
