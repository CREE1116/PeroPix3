/** 조수의 말에 든 **마크다운을 실제로 보이게** 한다 (사용자 지적 2026-08-25).
 *
 *  ★★*"채팅창에 `**강조**` 양식을 쓰는데 실제론 강조가 안 됨"* — LLM 은 마크다운을 습관처럼
 *    쓴다. 그대로 두면 별표가 글자로 보여서 오히려 읽기 나쁘다.
 *
 *  ★**라이브러리를 안 쓴다.** 필요한 것은 LLM 이 실제로 쓰는 몇 가지뿐이고, 이 저장소는
 *    의존성을 늘리지 않는다. 대신 **HTML 을 만들지 않는다** — 조각 목록을 돌려주고 화면이
 *    React 요소로 그린다. 그래야 `dangerouslySetInnerHTML` 이 필요 없다.
 *  ★못 알아본 표시는 **글자 그대로** 남긴다. 파서가 욕심을 내면 프롬프트에 든 `*` 하나가
 *    글을 통째로 먹는다.
 */

/** 한 줄 안의 조각 */
export type Seg =
  | { t: "text"; v: string }
  /** `**굵게**` */
  | { t: "b"; v: string }
  /** `` `코드` `` — 태그·파일 이름이 여기 들어온다 */
  | { t: "code"; v: string };

/** 한 덩이 = 화면의 한 줄 */
export type Blk =
  | { k: "p"; segs: Seg[] }
  /** `- 항목` · `* 항목` · `1. 항목` */
  | { k: "li"; segs: Seg[] }
  /** `### 제목` — 굵은 한 줄로 그린다 (크기는 안 키운다: 채팅 줄이라 요란해진다) */
  | { k: "h"; segs: Seg[] };

/* ★★순서가 규칙이다: **굵게**를 코드보다 **나중에** 본다.
     `` `a**b` `` 처럼 코드 안에 별표가 있으면 코드가 이겨야 한다. */
const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)/g;

/** 한 줄 → 조각들 */
export function segsOf(line: string): Seg[] {
  const out: Seg[] = [];
  let at = 0;
  for (const m of line.matchAll(INLINE)) {
    const i = m.index ?? 0;
    if (i > at) out.push({ t: "text", v: line.slice(at, i) });
    if (m[1]) out.push({ t: "code", v: m[1].slice(1, -1) });
    else out.push({ t: "b", v: m[2].slice(2, -2) });
    at = i + m[0].length;
  }
  if (at < line.length) out.push({ t: "text", v: line.slice(at) });
  return out.length ? out : [{ t: "text", v: line }];
}

const LI = /^\s*(?:[-*•]\s+|\d+[.)]\s+)/;
const H = /^\s*#{1,6}\s+/;

/** 조수의 말 → 그릴 덩이들.
 *
 *  ★빈 줄은 **덩이 사이의 간격**으로만 쓴다 — 빈 `p` 를 만들면 줄 높이만큼 벌어져
 *    대화가 듬성듬성해진다. */
export function chatBlocks(text: string): Blk[] {
  const out: Blk[] = [];
  for (const raw of (text ?? "").split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) continue;
    if (H.test(line)) out.push({ k: "h", segs: segsOf(line.replace(H, "")) });
    else if (LI.test(line)) out.push({ k: "li", segs: segsOf(line.replace(LI, "")) });
    else out.push({ k: "p", segs: segsOf(line) });
  }
  return out;
}
