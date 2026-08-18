/** 와일드카드. 이름 붙인 프롬프트 풀에서 하나를 무작위로 뽑는다.
 *  v2 `index.html:20523(parseWildcardDoc)·20547(resolveWildcards)` 이식 (2026-08-18).
 *
 *      #이름       정의해 둔 풀에서 한 줄 (여러 번 써도 매번 따로 뽑는다)
 *      ||a|b||     NAI 네이티브 인라인 (그 자리 한정)
 *      {a|b}       인라인 변형 (그 자리 한정)
 *
 *  ★★**추첨은 「이미지 한 장」마다 돈다.** 요청을 만들 때 한 번만 풀면 한 배치가 전부 같은
 *    태그로 나와 기능의 존재 이유가 사라진다 (`docs/v2-feature-catalog.md:477`).
 *    v3 에서 그 자리는 `lib/seedRounds.rounds()` 의 콜백이다. 회차 × 씬을 여기서 펴므로
 *    장마다 `resolveShot()` 을 한 번씩 부른다 (`store/gen.ts`).
 *
 *  ★`{a|b}` 는 `lib/blocks.ts` 가 말하는 구형 가중치 `{}` 와 **다른 것**이다.
 *    가르는 것은 세로줄이다: 세로줄이 없는 `{tag}` 는 건드리지 않는다.
 *  ★이 파일은 순수 함수만 둔다 (문서 저장·화면은 `store/wildcards.ts` · `panels/WildcardModal`).
 */

/** 이름(소문자) → 후보 목록 */
export type Pools = Record<string, string[]>;

export const EMPTY_POOLS: Pools = {};

/** 정의 문서를 풀 표로.
 *
 *  ★주석은 **줄 시작 또는 공백 뒤**의 `//` 만이다. `http://` 처럼 붙어 있는 것은 살린다.
 *  ★단독으로 `#이름` 인 줄만 섹션 머리다. 이름은 소문자로 맞춘다.
 *  ★머리 없이 시작하는 본문은 버린다 (어느 풀 것인지 알 수 없다). */
export function parseWildcardDoc(text: string): Pools {
  const pools: Pools = {};
  if (!text) return pools;
  let current: string | null = null;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\r$/, "").replace(/(^|\s)\/\/.*$/, "$1");
    const trimmed = line.trim();
    if (!trimmed) continue;
    const header = trimmed.match(/^#([A-Za-z0-9_]+)$/);
    if (header) {
      current = header[1].toLowerCase();
      if (!pools[current]) pools[current] = [];
      continue;
    }
    if (current) {
      const cand = trimmed.replace(/[\s,]+$/, "");
      if (cand) pools[current].push(cand);
    }
  }
  return pools;
}

/** 프롬프트 한 벌의 토큰을 실제 값으로 바꾼다.
 *
 *  ★뽑은 후보 안에 또 토큰이 있으면 다시 푼다 (`#scene` 안의 `#hair`). 깊이 20 에서 멈춘다.
 *    서로를 부르는 풀 두 개면 끝나지 않는다.
 *  ★정의되지 않은 `#이름` 은 **원문 그대로** 둔다. 지워 버리면 오타를 알 길이 없다.
 *  ★`source#tag` 같은 NAI 액션 태그의 `#` 은 건드리지 않는다 (앞에 낱말이 붙어 있다). */
export function resolveWildcards(text: string, pools: Pools, depth = 0): string {
  if (!text) return text;
  if (depth > 20) return text;
  const pool = pools || EMPTY_POOLS;
  const pick = (opts: string[]) => opts[Math.floor(Math.random() * opts.length)];

  let result = text;
  result = result.replace(/(?<![A-Za-z0-9_])#([A-Za-z0-9_]+)/g, (m, name: string) => {
    const list = pool[name.toLowerCase()];
    if (!list || !list.length) return m;
    return resolveWildcards(pick(list), pool, depth + 1);
  });
  result = result.replace(/\|\|([^]*?)\|\|/g, (_m, body: string) =>
    resolveWildcards(pick(body.split("|")), pool, depth + 1),
  );
  result = result.replace(/\{([^{}]*\|[^{}]*)\}/g, (_m, body: string) =>
    resolveWildcards(pick(body.split("|")), pool, depth + 1),
  );
  return result;
}

/** 이 글에 풀어야 할 토큰이 있는가. 계기판이다. 화면 표시(칩 강조)에만 쓴다. */
export const hasWildcard = (text: string): boolean =>
  /(?<![A-Za-z0-9_])#[A-Za-z0-9_]+/.test(text) ||
  /\|\|[^]*?\|\|/.test(text) ||
  /\{[^{}]*\|[^{}]*\}/.test(text);

/** 한 장에 실려 나갈 프롬프트 전부. 이 함수가 **장 하나의 추첨 단위**다.
 *
 *  ★캐릭터마다 따로 푼다. 한 번 풀어 돌려쓰면 두 사람이 늘 같은 머리색이 된다. */
export function resolveShot<C extends { prompt: string; uc: string }>(
  pools: Pools,
  shot: { prompt: string; uc: string; chars: C[] },
): { prompt: string; uc: string; chars: C[] } {
  return {
    prompt: resolveWildcards(shot.prompt, pools),
    uc: resolveWildcards(shot.uc, pools),
    chars: shot.chars.map((c) => ({
      ...c,
      prompt: resolveWildcards(c.prompt, pools),
      uc: resolveWildcards(c.uc, pools),
    })),
  };
}

/** 정의 문서에서 그 풀의 머리 줄이 몇 번째인가 (0부터). 없으면 -1.
 *  ★목록 칩을 눌렀을 때 편집기에서 그 자리로 데려가는 데 쓴다 (v2 `focusWildcardLine`). */
export function findPoolLine(text: string, name: string): number {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].replace(/(^|\s)\/\/.*$/, "$1").trim();
    const h = stripped.match(/^#([A-Za-z0-9_]+)$/);
    if (h && h[1].toLowerCase() === name.toLowerCase()) return i;
  }
  return -1;
}
