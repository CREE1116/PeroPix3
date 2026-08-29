# -*- coding: utf-8 -*-
"""간단 번역 — v2 의 「번역 모드」를 옮겼다 (사용자 지시 2026-08-29).

v2 는 브라우저라 화면이 `translate.googleapis.com` 을 곧장 불렀다. 3.0 은 Tauri 셸이라
CSP(`connect-src`) 에 막히므로 **사이드카가 대신 부른다** — CSP·CORS 를 한 번에 푸는 쪽이다
(`docs/v2-feature-catalog.md` 「태그 번역」의 이식 주).

★둘 다 비공식 무료 엔드포인트다 — 열쇠가 없고, 언제든 막힐 수 있다.
  · 1순위 `clients5.google.com … client=dict-chrome-ex` — 실측 2026-08-29 에 됐다.
    응답은 `["번역"]`, `sl=auto` 면 `[["번역","감지언어"]]`.
  · 2순위 `translate.googleapis.com … client=gtx` (v2 가 쓰던 것) — 같은 날 실측에서 UA 와
    무관하게 **429** 를 돌려줬다. 그래서 뒤로 물렸다. 응답은 `[[[번역, 원문, …], …], …]`.
★막히면 **원문을 돌려주지 않고 오류를 말한다.** v2 는 실패해도 원문을 돌려줘서 「번역이 안
  되는데 에러도 안 난다」가 됐다 (카탈로그의 위험 주). 화면이 오류를 보고 알린다.
★캐시는 메모리다 (v2 와 같다). 껐다 켜면 빈다 — 태그는 짧고 응답도 빨라 파일로 올릴 이유가
  아직 없다.
"""
from __future__ import annotations

import urllib.parse

import httpx

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) PeroPix"}

_cache: dict[str, str] = {}


def _first(v):
    """`["x"]` · `[["x","en"]]` · `[[["x",…]]]` 어느 꼴이든 맨 앞 문자열을 꺼낸다."""
    while isinstance(v, list) and v:
        v = v[0]
    return v if isinstance(v, str) else ""


async def _clients5(c: httpx.AsyncClient, text: str, sl: str, tl: str) -> str:
    q = urllib.parse.urlencode({"client": "dict-chrome-ex", "sl": sl, "tl": tl, "q": text})
    r = await c.get(f"https://clients5.google.com/translate_a/t?{q}", headers=UA)
    if r.status_code != 200:
        raise RuntimeError(f"Google {r.status_code}")
    return _first(r.json())


async def _gtx(c: httpx.AsyncClient, text: str, sl: str, tl: str) -> str:
    q = urllib.parse.urlencode({"client": "gtx", "sl": sl, "tl": tl, "dt": "t", "q": text})
    r = await c.get(f"https://translate.googleapis.com/translate_a/single?{q}", headers=UA)
    if r.status_code != 200:
        raise RuntimeError(f"Google {r.status_code}")
    data = r.json()
    return "".join(str(seg[0]) for seg in data[0] if seg and seg[0])


async def translate(text: str, sl: str, tl: str) -> str:
    """`text` 를 `sl` → `tl` 로. 앞 창구가 막히면 뒤 창구를 한 번 더 두드린다."""
    text = text.strip()
    if not text:
        return ""
    key = f"{text}|{sl}|{tl}"
    hit = _cache.get(key)
    if hit is not None:
        return hit
    async with httpx.AsyncClient(timeout=8.0) as c:
        try:
            out = await _clients5(c, text, sl, tl)
        except Exception as first:  # noqa: BLE001 — 바깥 서비스라 무엇이 올지 모른다
            try:
                out = await _gtx(c, text, sl, tl)
            except Exception:
                raise RuntimeError(str(first)) from None
    if not out:
        raise RuntimeError("빈 응답")
    _cache[key] = out
    return out
