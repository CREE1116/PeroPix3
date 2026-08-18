"""AI 가 만지는 것은 **데이터**다 — 화면이 아니다 (사용자 지시 2026-08-07).

★**앞선 구조(화면 조작)를 버렸다.** 도구를 화면(zustand)에 두고 WebSocket 으로 넘기던 방식은
  실사용에서 이렇게 깨졌다:

  1. **도구가 0개로 보였다.** 명세를 화면이 **붙는 순간에만** 올려서, 코드가 갱신돼도(HMR)
     소켓이 그대로면 영영 안 올라간다. 그러면 에이전트는 우리 도구를 못 보고 Read/Bash 로
     우리 소스를 뒤지다 권한 벽에 막힌다 (실제 대화 전문에서 확인).
  2. **화면이 없으면 아무것도 못 한다.** 앱을 안 켜면 도구가 통째로 사라진다.

★지금 구조는 단순하다: **도구는 파일을 만진다.** 카드는 `data/cards/`, 작업 상태는
  `outputs/<ws>/workspace.json` 에 이미 다 있다 (`workspace.py` 머리 주석: "spec — 사람·LLM 이
  편집"). 화면은 그 파일을 보여 주는 것일 뿐이라, **읽는 데도 쓰는 데도 화면이 필요 없다.**

★그래서 도구 목록은 **언제나 같다.** 앱이 꺼져 있어도 목록이 나오고, 켜져 있으면 바뀐 것을
  화면이 다시 읽는다 (`data_changed` 브로드캐스트).
"""
from __future__ import annotations

import asyncio
import json
import uuid
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

# 태그 사전은 프론트 자산이지만 **파일**이라 백엔드도 읽는다 (한 벌만 둔다)
TAGS_JSON = Path(__file__).resolve().parent.parent / "public" / "tags.json"

_tags_cache: list[dict] | None = None


def _tags() -> list[dict]:
    global _tags_cache
    if _tags_cache is None:
        try:
            _tags_cache = json.loads(TAGS_JSON.read_text(encoding="utf-8"))
        except Exception:
            _tags_cache = []
    return _tags_cache


def _blocks(items: list[dict] | None) -> list[dict]:
    """`[{label, tags}]` → 블록 목록. 프론트의 `makeBlock` 과 같은 모양을 만든다."""
    out = []
    for i, b in enumerate(items or []):
        raw = str(b.get("tags", "")).strip()
        tags = [{"t": x.strip(), "w": None} for x in raw.split(",") if x.strip()]
        out.append(
            {
                "id": f"b{int(datetime.now().timestamp() * 1000):x}{i}",
                "label": str(b.get("label", "블록")),
                "color": b.get("color"),
                "on": True,
                "open": True,
                "tags": tags,
            }
        )
    return out


def _view(blocks: list[dict] | None) -> list[dict]:
    """블록 목록을 읽기 쉬운 줄로 (LLM 이 다루기 쉬운 모양)."""
    out = []
    for b in blocks or []:
        tags = ", ".join(
            (f"{x['w']}::{x['t']}::" if x.get("w") not in (None, 1) else str(x.get("t", "")))
            for x in b.get("tags", [])
        )
        out.append({"id": b.get("id"), "label": b.get("label"), "on": b.get("on", True), "tags": tags})
    return out


class App:
    """앱에 **이름 붙은 행동**을 시키는 통로 (생성처럼 화면이 해야 하는 것).

    ★데이터 도구와 달리 여기는 앱이 꼭 필요하다. 앱이 없으면 **그 도구만** 오류를 돌려준다 —
      도구 목록 자체는 백엔드가 갖고 있으므로 사라지지 않는다."""

    def __init__(self, clients: dict):
        self.clients = clients
        self._waiting: dict[str, asyncio.Future] = {}
        # ★앱이 열어 둔 워크스페이스. 파일 도구의 기준이 된다 — 앱이 알려 준다.
        #   없으면 도구가 세운다 (코드가 대신 고르지 않는다).
        self.workspace: str = ""

    async def do(self, action: str, args: dict, timeout: float = 60.0) -> dict:
        if not self.clients:
            return {"error": "앱이 안 켜져 있습니다. PeroPix 를 켜고 다시 시켜 주세요."}
        cid = uuid.uuid4().hex[:8]
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        self._waiting[cid] = fut
        msg = {"type": "do", "id": cid, "action": action, "args": args or {}}
        sent = False
        for _, ws in reversed(list(self.clients.items())):
            try:
                await ws.send_json(msg)
                sent = True
                break
            except Exception:
                continue
        if not sent:
            self._waiting.pop(cid, None)
            return {"error": "앱에 보내지 못했습니다."}
        try:
            return await asyncio.wait_for(fut, timeout)
        except asyncio.TimeoutError:
            return {"error": "앱이 제때 답하지 않았습니다."}
        finally:
            self._waiting.pop(cid, None)

    def resolve(self, cid: str, result) -> None:
        fut = self._waiting.get(cid)
        if fut and not fut.done():
            fut.set_result(result if isinstance(result, dict) else {"result": result})


#: 도구 줄에 보일 카드 종류 이름
_KIND_KO = {"characters": "캐릭터", "styles": "그림체", "posesets": "포즈세트"}


class Tools:
    """앱의 저장소를 그대로 쓴다 — 별도 경로를 만들면 화면과 어긋난다.

    ★★**바꾸는 도구는 `did` 를 돌려준다** (사용자 지시 2026-08-08). 무엇을 바꿨는지
      한 줄로 적으면 화면의 도구 줄에 그대로 뜨고, 사용자가 보고 "되돌려" 라고 할 수 있다.
      예전엔 성공하면 도구 **이름만** 보였다 — `create_card` 만으로는 무엇이 생겼는지 모른다.
      ★읽기 도구에는 붙이지 않는다 (소음이 된다)."""

    def __init__(self, cards, store, files_mod, outputs: Path, meta_mod, notify: Callable, app: App,
                 guide=None):
        self.cards = cards
        # ★앱이 들고 있는 **사용자 지침** (`guide.py`) — 엔진이 무엇이든 같은 것을 본다
        self.guide = guide
        self.store = store
        self.files = files_mod
        self.outputs = outputs
        self.meta = meta_mod
        # 데이터가 바뀌면 화면에 알린다 (화면은 다시 읽기만 한다)
        self.notify = notify
        # 생성처럼 **앱이 해야 하는 것**은 여기로 시킨다
        self.app = app

    # ── 사용자 지침 ──────────────────────────────────────────────
    def _read_guide(self, a: dict) -> dict:
        """지금 지침 **전문**. 고치기 전에 반드시 이걸로 읽는다 (통째로 덮어쓰므로)."""
        if not self.guide:
            return {"error": "지침 저장소가 없습니다."}
        return {"text": self.guide.read()}

    def _write_guide(self, a: dict) -> dict:
        """지침을 **통째로** 갈아 끼운다.

        ★목록에 한 줄씩 더하던 방식을 버렸다 (사용자 지적 2026-08-08) — 이건 '기억'이 아니라
          **지침**이라, "지금까지의 지침을 종합해 봐" 같은 일이 안 됐다.
        ★직전 내용은 `data/.guide-bak/` 에 남는다 — 자유 편집이라 한 번에 다 날릴 수 있다."""
        if not self.guide:
            return {"error": "지침 저장소가 없습니다."}
        r = self.guide.write(str(a.get("text") or ""))
        if r.get("error"):
            return r
        self.notify("guide")
        if r.get("unchanged"):
            r["did"] = "지침 그대로 (바뀐 것 없음)"
        else:
            b = r.get("before") or {}
            r["did"] = (f"지침을 고침 — {b.get('lines', 0)}줄 → {r['lines']}줄 "
                        f"({b.get('chars', 0)}자 → {r['chars']}자)")
        return r

    # ── 목록 ────────────────────────────────────────────────────
    def specs(self) -> list[dict]:
        return [
            {"name": n, "description": d, "inputSchema": s}
            for n, d, s, _ in self._table()
        ]

    async def call(self, name: str, args: dict) -> dict:
        for n, _, _, fn in self._table():
            if n != name:
                continue
            # ★`fn` 이 없는 도구는 **앱이 하는 것**이다 (생성처럼 화면이 조립해야 하는 일)
            if fn is None:
                # ★사람이 답할 때까지 기다리는 도구는 넉넉히 (클로드 코드의 stdio MCP 유휴
                #   한계가 30분이라 그 안이면 된다)
                return await self.app.do(name, args or {}, timeout=600.0 if name == "ask_user" else 120.0)
            try:
                out = fn(args or {})
                return out if isinstance(out, dict) else {"result": out}
            except Exception as e:
                return {"error": f"{type(e).__name__}: {e}"}
        return {"error": f"모르는 도구: {name}"}

    # ── 표 ──────────────────────────────────────────────────────
    def _table(self) -> list[tuple[str, str, dict, Callable]]:
        obj = lambda props, req=(): {"type": "object", "properties": props, "required": list(req)}
        s = lambda d: {"type": "string", "description": d}
        n = lambda d: {"type": "number", "description": d}
        arr = lambda d, it: {"type": "array", "description": d, "items": it}
        blk = obj({"label": s("블록 이름"), "tags": s("태그들 — 쉼표로 구분")}, ["label", "tags"])

        return [
            (
                "list_workspaces",
                "워크스페이스 목록 — 이름과 마지막 수정 시각.",
                obj({}),
                lambda a: {"items": self.store.list()},
            ),
            (
                "get_workspace",
                "작업 상태 전부 — 탭·포즈 슬롯·프롬프트 블록·캐릭터. **지금 사용자가 만지고 있는 것**이 "
                "여기 들어 있다 (화면은 이 파일을 보여 줄 뿐이다). 이름을 비우면 가장 최근 것.",
                obj({"name": s("워크스페이스 이름 (비우면 최근)"), "records": n("최근 생성물 몇 개까지 (기본 0)")}),
                self._get_ws,
            ),
            (
                "list_cards",
                "저장된 카드 — 그림체(styles) · 캐릭터(characters) · 포즈세트(posesets).",
                obj({"kind": s('"styles" | "characters" | "posesets" — 비우면 전부')}),
                self._list_cards,
            ),
            (
                "get_card",
                "카드 하나의 내용 (블록·슬롯).",
                obj({"kind": s("카드 종류"), "id": s("카드 id 또는 이름")}, ["kind", "id"]),
                self._get_card,
            ),
            (
                "create_card",
                "카드를 **새로 만든다** — 언제나 새로 추가하고 기존 것을 덮지 않는다. "
                "캐릭터 디자인·그림체·포즈세트를 남길 때 쓴다.",
                obj(
                    {
                        "kind": s('"styles" | "characters" | "posesets"'),
                        "name": s("카드 이름"),
                        "blocks": arr("그림체·캐릭터의 프롬프트 블록", blk),
                        "uc": arr("Undesired Content 블록", blk),
                        "cells": arr("포즈세트의 칸들", obj({"name": s("포즈 이름"), "blocks": arr("블록", blk)}, ["name"])),
                    },
                    ["kind", "name"],
                ),
                self._create_card,
            ),
            (
                "update_card",
                "★기존 카드를 **덮어쓴다.** 되도록 create_card 로 새로 만들고, 정말 고쳐야 할 때만 쓴다. "
                "직전 내용은 백업으로 남는다.",
                obj(
                    {
                        "kind": s("카드 종류"),
                        "id": s("카드 id"),
                        "name": s("새 이름 (비우면 그대로)"),
                        "blocks": arr("갈아 끼울 프롬프트 블록", blk),
                        "uc": arr("갈아 끼울 UC 블록", blk),
                        "cells": arr("갈아 끼울 포즈 칸", obj({"name": s("포즈 이름"), "blocks": arr("블록", blk)}, ["name"])),
                    },
                    ["kind", "id"],
                ),
                self._update_card,
            ),
            (
                "search_tags",
                "단부루 태그 사전을 찾는다. **실재하는 태그만 쓰기 위해** 프롬프트를 짜기 전에 확인한다. "
                "언더바로 찾고(long_hair), 넣을 때는 띄어쓰기로 쓴다(long hair).",
                obj({"query": s("찾을 말 (영어)"), "max": n("최대 개수 (기본 15)")}, ["query"]),
                self._search_tags,
            ),
            (
                "list_files",
                "그 워크스페이스 안의 폴더·파일. ★뿌리는 **워크스페이스 폴더**다 — 그림은 `output/싱글/<탭>/…` 아래에 있다 (옛것은 `싱글/…`·`work/…`).",
                obj({"folder": s("상대경로 — 뿌리는 빈 문자열"), "page": n("쪽 (기본 1)"),
                     "workspace": s("어느 워크스페이스인지 — 비우면 앱이 열어 둔 것")}),
                self._list_files,
            ),
            (
                "create_folder",
                "그 워크스페이스 안에 폴더를 만든다 (정리용).",
                obj({"parent": s("부모 폴더 상대경로"), "name": s("만들 이름"),
                     "workspace": s("어느 워크스페이스인지 — 비우면 앱이 열어 둔 것")}, ["name"]),
                self._mkdir,
            ),
            (
                "move_files",
                "생성물을 그 워크스페이스 안의 다른 폴더로 옮긴다 (캐릭터별 정리 등).",
                obj({"files": arr("옮길 파일 상대경로들", {"type": "string"}), "dest": s("받을 폴더"),
                     "workspace": s("어느 워크스페이스인지 — 비우면 앱이 열어 둔 것")}, ["files", "dest"]),
                self._move,
            ),
            (
                "generate",
                "★**생성을 큐에 넣는다.** 그 탭의 잠기지 않은 씬 전부를 count 바퀴 돈다 "
                "(씬이 하나면 count 장이다). 비우면 지금 보고 있는 탭, workspace·tab 을 주면 "
                "**거기로** 넣는다 (화면은 안 옮긴다). 앱이 켜져 있어야 한다. Anlas 가 든다 — "
                "사용자가 장수를 말했을 때만 쓴다.",
                obj({"count": n("몇 바퀴. 기본 1"),
                     "workspace": s("어디에 넣을지 — 비우면 지금 보고 있는 곳"),
                     "tab": s("어느 탭에 넣을지 — 비우면 그 워크스페이스의 활성 탭")}),
                None,  # 앱에 시킨다 (아래 _call_app)
            ),
            (
                "read_guide",
                "사용자가 정한 **지침 전문**을 읽는다. 이 지침은 매 대화에 자동으로 실리므로 "
                "평소엔 읽을 필요가 없다 — **고치기 전에** 읽어라 (통째로 덮어쓰기 때문에 "
                "읽지 않고 쓰면 앞서 있던 내용이 사라진다).",
                obj({}),
                self._read_guide,
            ),
            (
                "write_guide",
                "★사용자 지침을 **통째로** 갈아 끼운다. 다음 대화에도, 엔진(API·CLI)을 바꿔도 "
                "그대로 따라온다.\n"
                "쓰는 때: 사용자가 \"앞으로는 ~\"·\"이 태그는 쓰지 마\"·\"기억해\" 처럼 "
                "**계속 지킬 것**을 말했을 때, 또는 \"그건 이제 됐어\" 처럼 되물릴 때, "
                "또는 \"지침을 정리해 줘\" 처럼 손보라고 할 때.\n"
                "★**read_guide 로 먼저 읽고**, 있던 내용에 더하거나 고쳐서 **전문**을 준다. "
                "★사용자가 말하지 않은 것을 넣지 마라. 짧게 유지해라 — 매 턴 프롬프트에 실린다.",
                obj({"text": s("지침 전문 (마크다운). 빈 문자열이면 지침을 비운다)")}, ["text"]),
                self._write_guide,
            ),
            (
                "ask_user",
                "사용자에게 **선택지를 주고** 묻는다. ★**아무 때나 쓰지 않는다** — 사용자가 골라야 하고, "
                "고를 것이 **또렷하게 갈릴 때**만 쓴다 (예: 수채화풍 / 플랫 / 셀 셰이딩). "
                "그냥 되물을 일이면 도구 대신 **답글에 글로** 물어라. "
                "선택지는 2~4개, 각각 무엇이 달라지는지 한 줄로. "
                "여러 개를 함께 고를 수 있는 물음이면 multi=true 로 준다 (예: \"어떤 감정들을 넣을까요\"). "
                "★내장 AskUserQuestion 은 이 환경에서 안 되니 물을 때는 반드시 이 도구다. "
                "답이 올 때까지 기다린다(최대 10분).",
                obj(
                    {
                        "question": s("물어볼 것 — 한 문장"),
                        "header": s("짧은 제목 (선택)"),
                        "options": arr(
                            "선택지 2~4개",
                            obj({"label": s("보기 이름"), "description": s("무엇이 달라지는지")}, ["label"]),
                        ),
                        "multi": {
                            "type": "boolean",
                            "description": "여러 개를 함께 고를 수 있게 할지 (기본 false — 하나만)",
                        },
                    },
                    ["question", "options"],
                ),
                None,  # 앱에 시킨다
            ),
            (
                "edit_current_prompt",
                "★**지금 열려 있는 탭의 프롬프트**를 고친다 (원본 카드에는 안 닿는다). "
                "\"지금 그림체를 더 플랫하게\" 같은 요청은 이것으로 한다. "
                "mode=\"add\" 는 블록을 새로 붙이고, \"replace\" 는 같은 이름의 블록을 갈아 끼운다 "
                "(없으면 새로 붙는다). 앱이 켜져 있어야 한다.",
                obj(
                    {
                        "area": s('어디를 — "base"(공통·그림체) · "baseUc"(공통 UC) · '
                                  '캐릭터는 그 이름 · 캐릭터 UC 는 "<이름>:uc"'),
                        "label": s("블록 이름 (예: 그림체)"),
                        "tags": s("태그들 — 쉼표로 구분"),
                        "mode": s('"add"(기본) 또는 "replace"'),
                    },
                    ["area", "label", "tags"],
                ),
                None,  # 앱에 시킨다
            ),
            (
                "read_image_meta",
                "생성물 한 장의 메타데이터 — 프롬프트·시드·설정. 무엇으로 만들었는지 되짚을 때.",
                obj({"file": s("워크스페이스 폴더 기준 상대경로"),
                     "workspace": s("어느 워크스페이스인지 — 비우면 앱이 열어 둔 것")}, ["file"]),
                self._read_meta,
            ),
        ]

    # ── 구현 ────────────────────────────────────────────────────
    def _get_ws(self, a: dict) -> dict:
        name = str(a.get("name") or "").strip()
        if not name:
            lst = self.store.list()
            if not lst:
                return {"error": "워크스페이스가 없습니다."}
            name = lst[0]["name"]
        spec = self.store.load(name)
        if spec is None:
            return {"error": f"그런 워크스페이스가 없습니다: {name}"}
        tabs = []
        for t in spec.get("tabs", []):
            row = {"id": t.get("id"), "kind": t.get("kind"), "name": t.get("name")}
            if t.get("kind") == "set":
                row["prefix"] = t.get("prefix", "")
                row["slots"] = [
                    {"id": c.get("id"), "name": c.get("name"), "blocks": _view(c.get("blocks")),
                     "locked": bool(c.get("locked"))}
                    for c in t.get("cells", [])
                ]
            p = t.get("prompt") or {}
            if p:
                row["prompt"] = {
                    "style": (p.get("style") or {}).get("name"),
                    "base": _view(p.get("base")),
                    "baseUc": _view(p.get("baseUc")),
                    "chars": [
                        {"name": c.get("name"), "prompt": _view(c.get("prompt")), "uc": _view(c.get("uc"))}
                        for c in (p.get("chars") or [])
                    ],
                }
            tabs.append(row)
        out: dict[str, Any] = {
            "name": name,
            "activeTab": spec.get("activeTab"),
            "activeChar": spec.get("activeChar"),
            "chars": [{"id": c.get("id"), "name": c.get("name")} for c in (spec.get("chars") or [])],
            "tabs": tabs,
        }
        limit = int(a.get("records", 0) or 0)
        if limit:
            recs = self.store.records(name, limit)
            out["records"] = recs[-limit:]
        return out

    def _list_cards(self, a: dict) -> dict:
        kinds = [a["kind"]] if a.get("kind") else ["styles", "characters", "posesets"]
        out = {}
        for k in kinds:
            out[k] = [{"id": c.get("id"), "name": c.get("name")} for c in self.cards.list(k)]
        return out

    def _find_card(self, kind: str, key: str) -> dict | None:
        for c in self.cards.list(kind):
            if c.get("id") == key or c.get("name") == key:
                return c
        return None

    def _get_card(self, a: dict) -> dict:
        c = self._find_card(str(a["kind"]), str(a["id"]))
        if not c:
            return {"error": "그런 카드가 없습니다."}
        out: dict[str, Any] = {"id": c.get("id"), "name": c.get("name")}
        if "base" in c:
            out["base"] = _view(c.get("base"))
        if "prompt" in c:
            out["prompt"] = _view(c.get("prompt"))
        if "uc" in c:
            out["uc"] = _view(c.get("uc"))
        if "cells" in c:
            out["cells"] = [{"name": x.get("name"), "blocks": _view(x.get("blocks"))} for x in c.get("cells", [])]
        return out

    def _card_body(self, kind: str, a: dict, base: dict | None = None) -> dict:
        card = dict(base or {})
        if a.get("name"):
            card["name"] = str(a["name"])
        if kind == "posesets":
            if a.get("cells") is not None:
                card["cells"] = [
                    {"name": str(c.get("name", "포즈")), "blocks": _blocks(c.get("blocks"))}
                    for c in a["cells"]
                ]
        else:
            key = "base" if kind == "styles" else "prompt"
            if a.get("blocks") is not None:
                card[key] = _blocks(a["blocks"])
            if a.get("uc") is not None:
                card["uc"] = _blocks(a["uc"])
        return card

    def _create_card(self, a: dict) -> dict:
        kind = str(a["kind"])
        card = self._card_body(kind, a, {"name": str(a["name"])})
        saved = self.cards.save(kind, card)
        self.notify("cards")
        return {"ok": True, "id": saved.get("id"), "name": saved.get("name"),
                "did": f"{_KIND_KO.get(kind, kind)} 카드 만듦 — {saved.get('name')}"}

    def _update_card(self, a: dict) -> dict:
        kind = str(a["kind"])
        cur = self._find_card(kind, str(a["id"]))
        if not cur:
            return {"error": "그런 카드가 없습니다."}
        # ★덮어쓰기 전에 직전 내용을 남긴다 — 사람이 확인할 창구가 없는 경로라 되돌릴 길을 둔다
        bak = Path(self.cards.root) / kind / ".bak"
        bak.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        (bak / f"{cur['id']}-{stamp}.json").write_text(
            json.dumps(cur, ensure_ascii=False), encoding="utf-8"
        )
        saved = self.cards.save(kind, self._card_body(kind, a, cur))
        self.notify("cards")
        return {"ok": True, "id": saved.get("id"), "backup": f"{cur['id']}-{stamp}.json",
                "did": f"{_KIND_KO.get(kind, kind)} 카드 덮어씀 — {saved.get('name')} "
                       f"(직전 내용은 .bak/{cur['id']}-{stamp}.json)"}

    def _search_tags(self, a: dict) -> dict:
        q = str(a["query"]).lower().replace(" ", "_")
        if len(q) < 2:
            return {"items": []}
        mx = min(40, int(a.get("max", 15) or 15))
        starts, has = [], []
        for t in _tags():
            low = t["label"].lower()
            if low.startswith(q):
                starts.append(t)
                if len(starts) >= mx:
                    break
            elif q in low and len(has) < mx:
                has.append(t)
        items = (starts + has)[:mx]
        return {"items": [{"tag": t["label"], "count": t.get("count"), "type": t.get("type")} for t in items]}

    def _ws_root(self, a: dict) -> Path:
        """파일 도구가 볼 자리 — **그 워크스페이스 안**이다.

        ★인자 `workspace` 가 있으면 그것, 없으면 앱이 알려 준 현재 워크스페이스.
          둘 다 없으면 세운다 — 코드가 대신 고르면 엉뚱한 데 쌓인다."""
        ws = str(a.get("workspace") or self.app.workspace or "").strip()
        if not ws:
            raise ValueError("어느 워크스페이스인지 알 수 없습니다. workspace 를 지정하세요.")
        return self.store.dir_of(ws)

    def _list_files(self, a: dict) -> dict:
        """★**폴더도 함께 돌려준다.** 앱 화면은 트리를 따로 갖고 있어 목록에서 폴더를 빼지만
        (`files.listdir` 주석), AI 에게는 트리가 없다 — 그러면 루트가 늘 "비어 있다"가 된다
        (실측 2026-08-08)."""
        root = self._ws_root(a)
        rel = str(a.get("folder", ""))
        out = self.files.listdir(root, rel, int(a.get("page", 1) or 1), 200)
        d = self.files.under(root, rel)
        base = root.resolve()
        out["folders"] = (
            sorted(
                x.relative_to(base).as_posix()
                for x in d.iterdir()
                if x.is_dir() and not x.name.startswith(".")
            )
            if d.is_dir()
            else []
        )
        return out

    def _mkdir(self, a: dict) -> dict:
        out = self.files.mkdir(self._ws_root(a), str(a.get("parent", "")), str(a["name"]))
        self.notify("files")
        if isinstance(out, dict) and not out.get("error"):
            out["did"] = f"폴더 만듦 — {str(a.get('parent') or '').rstrip('/')}/{a['name']}".lstrip("/")
        return out

    def _move(self, a: dict) -> dict:
        files = list(a["files"])
        out = self.files.move(self._ws_root(a), files, str(a["dest"]))
        self.notify("files")
        if isinstance(out, dict) and not out.get("error"):
            # ★몇 개를 어디로 — 되돌리려면 이 둘이 있어야 한다
            head = ", ".join(files[:3]) + (f" 외 {len(files) - 3}개" if len(files) > 3 else "")
            out["did"] = f"{len(files)}개 옮김 → {a['dest']} ({head})"
        return out

    def _read_meta(self, a: dict) -> dict:
        p = self.files.under(self._ws_root(a), str(a["file"]))
        if not p.is_file():
            return {"error": "그런 파일이 없습니다."}
        return self.meta.read(p) or {"error": "메타데이터가 없습니다."}


# ★요청 창구. **설정에서 바꿀 수 있다**(`config.json` 의 `support_url`) — 주소가 바뀌어도
#   앱을 새로 내보내지 않는다.
SUPPORT_URL = "https://discord.gg/Cv4hUFM2Z2"


#: 앱이 지원하는 표시 언어 → 프롬프트에 적을 이름
LANGS = {"ko": "Korean", "en": "English", "ja": "Japanese"}


def system_prompt(support: str = "", guide_block: str = "", lang: str = "") -> str:
    """지침 정본. 주소를 갈아 끼우고 **앱의 기억**을 이어 붙여 돌려준다.

    ★지침을 여기서 붙이는 이유: 이 함수가 **두 경로(BYOK·CLI)의 유일한 창구**다
      (`/api/agent/system`). 한쪽에만 붙이면 엔진에 따라 다르게 군다.

    ★지침 본문이 **영문인 이유**(사용자 결정 2026-08-12): 앱은 한국어·영어·일본어를
      제공하고, 답은 사용자가 쓰는 언어로 나와야 한다. 지침을 그 셋 중 하나로 쓰면
      답이 그쪽으로 끌린다 — 셋 다 아닌 언어로 쓰고 출력 언어를 아래에서 **명시**한다.
      (덤으로 같은 내용에 토큰이 덜 든다)
      ★코드 주석은 한국어 그대로다 — 읽고 고치는 것은 사용자다.

    ★**사용자가 쓴 언어가 먼저다. 앱 언어는 모를 때의 기본값이다** (사용자 지시 2026-08-12).
      앱이 주는 언어는 셋뿐인데, 그 셋 밖의 사용자는 **영어로 놓고 자기 말로 쓴다.**
      앱 언어로 못 박으면 그 사람은 평생 영어로만 답을 받는다."""
    say = LANGS.get(lang or "")
    line = (
        "\n- ★Reply in the language the user writes to you in."
        + (
            f" When you cannot tell, or they have not written yet, use {say} — "
            f"the language they chose in the app."
            if say
            else ""
        )
    )
    return SYSTEM.replace("{support}", support or SUPPORT_URL) + line + (guide_block or "")


#: ★본문은 영문이다 — 까닭은 `system_prompt()` 주석에 있다 (출력 언어를 명시하려고).
#  ★문구는 실측으로 다듬어진 것이다. "정리"하지 말고, 바꿀 때는 까닭을 남길 것.
SYSTEM = """You are the assistant inside PeroPix 3.0, an image generation app.
The user makes art with NovelAI (NAI); a prompt is **Danbooru tags** joined by commas.

★What you touch is **data**, not the screen. Your working material is the user's cards
  (characters, styles, pose sets) and their output folders. You can **read** what the user
  is working on right now with get_workspace.

Principles:
- When you need to know what the user is doing, call **get_workspace** first.
  It holds their tabs, pose slots and prompt blocks exactly as they are.
- Never invent tags. Confirm a tag really exists with **search_tags** before using it.
  Write them with spaces, not underscores (long_hair -> long hair).
- Emphasis is `1.3::tag::`, de-emphasis is `0.7::tag::`. To keep a character's traits
  without drowning out other tags, **lower the weight** instead of removing the tag.
- ★**Prefer create_card.** update_card overwrites an existing card - use it only when the
  user clearly asked you to change that card, and say what you changed.
- **Organize files only within that workspace.** Folders you create land under it.
- Never decide a matter of taste on your own. There are **two ways to ask**:
  - **ask_user (buttons)** - only when the user must choose and the **options differ clearly**.
    (e.g. "watercolor / flat / cel shading?") 2-4 options, one line each on what differs.
    Use multi=true when several can be picked together (e.g. "which emotions?").
  - **Plain prose** - otherwise, just ask in your reply. The next turn continues, so you
    will get an answer.
  ★Asking every small confirmation with buttons is annoying. Buttons are for choices
  **worth choosing**. (The built-in AskUserQuestion does not work in this environment.)
- When the user says to change **what they are working on right now** ("change the style"),
  use edit_current_prompt - editing a card would not show on their screen. Cards are for
  **keeping something for later**.
- When the user names a number of images ("queue 20"), put them in the queue with
  **generate**. Otherwise ask first - generating unasked spends their Anlas.
- After using tools, say **what you did in a sentence or two**.
- When the user states something to **keep following** ("from now on...", "never use this
  tag", "remember this"), **read it with read_guide and rewrite the whole thing with
  write_guide**. Same when they take it back ("forget that") or ask you to tidy it up.
  ★Never add what they did not say. ★Writing without reading first erases what was there.
- ★**Always say what you changed.** If you touched a card, a prompt, a file or the guide,
  put one line about it in your reply. The user must be able to ask you to undo it.
- ★**You never modify the app itself** (its code or config files). You have no tool for it.
  If the user asks for an app change, tell them **why and where to go**: editing the app
  directly **breaks on the next update** - the change is lost or the app stops working.
  Feature requests and bug reports go to {support}."""
