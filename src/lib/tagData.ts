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
      t._lower = t.label.toLowerCase();
      seen.add(t._lower);
      (index[t._lower[0]] ||= []).push(t);
    }
    const extra = EXTRA.filter((t) => !seen.has(t.label.toLowerCase()));
    for (const t of extra) {
      t._lower = t.label.toLowerCase();
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
  const q = query.toLowerCase();
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
    if (",\n\r{}[]():".includes(ch) || !isTagChar(ch)) break;
    start--;
  }
  let end = cursor;
  while (end < value.length && (value[end] === " " || value[end] === "\t")) end++;
  const head = value.substring(start, cursor);
  const lead = head.length - head.trimStart().length;
  return { word: head.trim(), start: start + lead, end, fullStart: start };
}
