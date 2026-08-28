/** NAI 가 **글자로 그리는 자리** — 따옴표 짝과 `text:` 절.
 *
 *  ★★정본은 백엔드다 (`backend/naitext.py`, 공홈 번들 `51964` 이식). 여기 있는 것은
 *    **화면이 칩을 자를 때 쓰는 같은 규칙**이고, 둘이 갈리면 화면에 보이는 조각과 실제로
 *    그려지는 글이 어긋난다. `naiText.test.ts` 가 두 파일의 따옴표 표를 맞대어 지킨다.
 *
 *  ★왜 필요한가 (사용자 지적 2026-08-28): *"NAI 에서 텍스트 보낼 때 … 우리는 쉼표가
 *    칩으로 분할해버림."* 프롬프트를 칩으로 자르는 규칙이 쉼표 하나뿐이라, NAI 가 **한
 *    덩어리로 그리는 글**이 여러 칩으로 흩어졌다. 흩어진 채로 가중치를 주거나 자리를
 *    옮기면 문장 한가운데가 갈라진다.
 */

/** 따옴표 짝 (공홈 `h` · `naitext.py` 의 `QUOTES`) */
export const QUOTES: Record<string, string> = {
  '"': '"',
  "\u201c": "\u201d", // “ ”
  "\u300c": "\u300d", // 「 」
  "'": "'",
  "\u2018": "\u2019", // ‘ ’
};

/** 사람이 손으로 적은 `text:` 절 (공홈 `US` · `naitext.py` 의 `MANUAL_RE`).
 *  ★우리가 만든 `teXt:` 도 대소문자 무시라 함께 걸린다 — 어느 쪽이든 **글자로 그려진다.** */
const CLAUSE_RE = /(?:^|\s|[,.:[\]{}、。])text:(?!:)/i;

/** 문자·숫자인가 (공홈 `d`) — `'` 가 아포스트로피인지 가르는 데 쓴다 */
const wordish = (ch: string | undefined) => !!ch && /[\p{L}\p{N}]/u.test(ch);

/** 따옴표로 감싼 구간 `[여는 자리, 닫는 자리 다음]` (공홈 `f` 와 같은 걸음).
 *
 *  ★`'` 는 **앞 글자가 문자·숫자면** 여는 것으로 안 본다 (`don't` 의 아포스트로피).
 *    닫을 때도 **뒤 글자가 문자·숫자면** 닫는 것으로 안 본다.
 *  ★짝이 없으면 그 글자는 버리고 다음으로 넘어간다. */
export function quotedRanges(str: string): [number, number][] {
  const out: [number, number][] = [];
  let i = 0;
  while (i < str.length) {
    const close = QUOTES[str[i]];
    if (close === undefined || (str[i] === "'" && wordish(str[i - 1]))) {
      i += 1;
      continue;
    }
    const apostrophe = close === "'" || close === "\u2019";
    let j = i + 1;
    while (j < str.length && (str[j] !== close || (apostrophe && wordish(str[j + 1])))) j += 1;
    if (j >= str.length) {
      i += 1;
      continue;
    }
    out.push([i, j + 1]);
    i = j + 1;
  }
  return out;
}

/** `text:` 절이 시작하는 자리 (없으면 `-1`).
 *  ★절은 **글 끝까지**다 — 백엔드가 퀄리티 접미사·인핸스 문구를 그 **앞에** 끼우는 까닭이
 *    그것이다 (`nai.py` 의 `append_prompt`). 그래서 뒤쪽 전부가 한 덩어리다. */
export function textClauseAt(str: string): number {
  const m = CLAUSE_RE.exec(str);
  if (!m) return -1;
  // 앞의 경계 글자(빈칸·쉼표…)는 절에 안 넣는다 — `text:` 부터가 절이다
  return m.index + m[0].length - "text:".length;
}

/** **자르면 안 되는 구간**들 — 겹치지 않게 정리해서 돌려준다. */
export function guardedRanges(str: string): [number, number][] {
  const at = textClauseAt(str);
  const ranges = quotedRanges(str).filter(([s]) => at < 0 || s < at);
  if (at >= 0) ranges.push([at, str.length]);
  return ranges;
}

/** 그 자리가 **자르면 안 되는 구간 안**인가 */
export function isGuarded(ranges: [number, number][], i: number): boolean {
  return ranges.some(([s, e]) => i >= s && i < e);
}
