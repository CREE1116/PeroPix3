"""따옴표 → `teXt:` **자동 조립** — 공홈 프런트의 이식이다 (번들 모듈 `51964`, 2026-08-21).

★★**V5 전용이 아니다.** 공홈은 `PE(model).text` 능력으로 거는데 그 능력은
  **V4.0·V4.5·V5 모두 참**이다 (V3 이하만 거짓). 즉 V4.5 에서도 걸린다.

★★**켬/끔 옵션이 없다** (공홈 설정 기본값에도, 호출부에도 없다 — 2026-08-21 전수 확인).
  빠져나가는 길은 둘뿐이다: 따옴표를 안 쓰거나, `text:` 를 손으로 적거나
  (손으로 적혀 있으면 아무것도 안 한다).

★붙는 자리는 **퀄리티 접미사보다 뒤**다. 공홈 순서:
    퀄리티 접미사(E0) → uc 해결(s3) → furry 접두 → 매크로 → **여기**
  그래서 `nsfw` 판정도 uc 도 이 문구를 안 본다.

★표기는 **`teXt:`** (가운데 X 만 대문자). 되읽을 때 쓰는 정규식은 대소문자를 **구분**한다 —
  사람이 손으로 적은 `text:` 와 갈라 보려는 것이다.
"""
from __future__ import annotations

import re

#: 프롬프트를 나누는 구분자와 조각 수 (공홈 `zg`·`Gp`·`jB`)
SEP = "|"
ESCAPED_SEP = "||"
MAX_PARTS = 6

#: 사람이 손으로 적은 `text:` 절 (공홈 `US`). ★대소문자 무시
MANUAL_RE = re.compile(r"(?:^|\s|[,.:\[\]{}、。])text:(?!:)", re.IGNORECASE)
#: 우리가 만든 블록 (공홈 `u`). ★대소문자 **구분** — 손으로 적은 것과 갈라 보려는 것이다
AUTO_RE = re.compile(r"(?:^|\s|[,.:\[\]{}、。])teXt:(?!:)")
AUTO_TAG = "teXt:"

#: 따옴표 짝 (공홈 `h`)
QUOTES = {'"': '"', "“": "”", "「": "」", "'": "'", "‘": "’"}

#: CJK 판정 (공홈 `y`) — 이 비율을 넘으면 조각 순서를 뒤집는다.
#: ★범위는 번들 원문 그대로다: 구두점·히라가나·가타카나·전각·한자(상용/확장A)
CJK_RE = re.compile(
    "[　-〿぀-ゟ゠-ヿ＀-ﾟ一-龯㐀-䶿]"
)
CJK_RATIO = 0.3

#: 줄 묶기 문턱 (공홈 `p`·`g`) — 전체 y 폭과 가장 큰 y 간격
GAP_MAX = 0.1
SPAN_MAX = 0.15

#: `split` 이 구분자를 잃지 않도록 잠시 바꿔 두는 글자 (공홈이 쓰는 것 그대로)
_TMP_SEP = "\U000103b9"
_TMP_ESC = "\U00012137"


def split_parts(prompt: str) -> list[str]:
    """`|` 로 최대 6조각. `||` 는 이스케이프다 (공홈 `Bk`).

    ★조각이 6개를 넘으면 **나머지를 마지막 조각에 다시 붙인다** — 잘라 버리지 않는다."""
    # ★구분자 자리를 **임시 글자로 바로 잇는다** — `"||"` 로 이었다가 되찾으면
    #   조각 끝의 `|` 와 붙어 `"|||"` 이 되는 자리에서 어긋난다 (공홈도 임시 글자로 잇는다).
    swapped = _TMP_ESC.join(
        part.replace(SEP, _TMP_SEP) if i % 2 == 1 else part
        for i, part in enumerate(prompt.split(ESCAPED_SEP))
    )
    parts = swapped.split(SEP)
    out = parts[: MAX_PARTS - 1]
    if len(parts) > MAX_PARTS - 1:
        out.append(SEP.join(parts[MAX_PARTS - 1:]))
    return [p.replace(_TMP_SEP, SEP).replace(_TMP_ESC, ESCAPED_SEP) for p in out]


def _wordish(ch: str | None) -> bool:
    """문자·숫자인가 (공홈 `d`) — `'` 가 아포스트로피인지 가르는 데 쓴다."""
    return bool(ch) and (ch.isalpha() or ch.isdigit())


def quoted(text: str) -> list[str]:
    """따옴표로 감싼 조각을 순서대로 (공홈 `f`).

    ★`'` 는 **앞 글자가 문자·숫자면** 여는 따옴표로 안 본다 (`don't` 의 아포스트로피).
      닫을 때도 마찬가지로 **뒤 글자가 문자·숫자면** 닫는 것으로 안 본다.
    ★짝이 없으면 그 문자는 버리고 다음으로 넘어간다."""
    out: list[str] = []
    i = 0
    n = len(text)
    while i < n:
        close = QUOTES.get(text[i])
        if close is None or (text[i] == "'" and _wordish(text[i - 1] if i else None)):
            i += 1
            continue
        apostrophe = close in ("'", "’")
        j = i + 1
        while j < n and (
            text[j] != close or (apostrophe and _wordish(text[j + 1] if j + 1 < n else None))
        ):
            j += 1
        if j >= n:
            i += 1
            continue
        inner = text[i + 1:j].strip()
        if inner:
            out.append(inner)
        i = j + 1
    return out


def _rows(chars: list[dict]) -> list[dict]:
    """캐릭터를 **읽는 순서**로 (공홈 `m`/`A`) — y 로 줄을 묶고 줄 안에서 x 순.

    ★줄 나누기: 전체 y 폭이 0.15 이하이고 가장 큰 간격이 0.1 이하면 **한 줄**로 본다.
      아니면 가장 벌어진 자리에서 잘라 양쪽을 다시 같은 규칙으로 본다."""

    def cy(c: dict) -> float:
        return float((c.get("center") or {}).get("y", 0.5))

    def cx(c: dict) -> float:
        return float((c.get("center") or {}).get("x", 0.5))

    def group(items: list[dict]) -> list[list[dict]]:
        if len(items) <= 1:
            return [items]
        span = cy(items[-1]) - cy(items[0])
        cut, widest = 1, -1.0
        for k in range(1, len(items)):
            gap = cy(items[k]) - cy(items[k - 1])
            if gap > widest:
                widest, cut = gap, k
        if span <= SPAN_MAX and widest <= GAP_MAX:
            return [items]
        return group(items[:cut]) + group(items[cut:])

    out: list[dict] = []
    for row in group(sorted(chars, key=cy)):
        out.extend(sorted(row, key=cx))
    return out


def collect(base: str, chars: list[dict], use_coords: bool) -> list[str]:
    """베이스와 캐릭터에서 따옴표 조각을 모은다 (공홈 `v`).

    ★CJK 가 30% 를 넘으면 **각 출처의 조각 순서를 뒤집는다** (세로쓰기 순서)."""
    live = [c for c in chars if (c.get("prompt") or "").strip()]
    ordered = _rows(live) if use_coords else live
    groups = [quoted(base)] + [quoted(c.get("prompt") or "") for c in ordered]
    joined = "".join(x for g in groups for x in g)
    if joined and len(CJK_RE.findall(joined)) / len(joined) > CJK_RATIO:
        for g in groups:
            g.reverse()
    return [x for g in groups for x in g]


def build(prompt: str, chars: list[dict], use_coords: bool) -> str:
    """프롬프트 끝에 `teXt:` 블록을 붙인다 (공홈 `v2`/`v2k`). 붙일 게 없으면 그대로.

    ★손으로 적은 `text:` 가 베이스나 **어느 캐릭터에라도** 있으면 아무것도 안 한다.
    ★블록은 **첫 조각**(`|` 기준)의 끝에 붙는다."""
    live = [c for c in chars if (c.get("prompt") or "").strip()]
    if MANUAL_RE.search(prompt) or any(MANUAL_RE.search(c.get("prompt") or "") for c in live):
        return prompt
    parts = split_parts(prompt)
    found = collect(parts[0] if parts else "", live, use_coords)
    if not found:
        return prompt
    block = f"{AUTO_TAG} " + "\n\n".join(found)
    head = re.sub(r"[\s,]+$", "", parts[0] if parts else "")
    parts[0] = f"{head}, {block}" if head else block
    return SEP.join(parts)


def strip(prompt: str, chars: list[dict], use_coords: bool) -> str:
    """되읽을 때 그 블록을 **떼어낸다** (공홈 `PA`).

    ★★**다시 만들어 보고 같을 때만** 뗀다 — 사람이 손으로 적은 `teXt:` 를 지우지 않으려는
      것이다. 조금이라도 다르면 그 조각은 그대로 둔다."""
    live = [c for c in chars if (c.get("prompt") or "").strip()]
    out = []
    for part in split_parts(prompt):
        m = AUTO_RE.search(part)
        if not m:
            out.append(part)
            continue
        head = part[: m.start()]
        tail = part[m.start() + len(m.group(0)):].strip()
        if tail != "\n\n".join(collect(head, live, use_coords)):
            out.append(part)
            continue
        out.append(re.sub(r"[\s,]+$", "", head))
    return SEP.join(out)
