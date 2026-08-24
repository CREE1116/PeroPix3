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
import inspect
import json
import uuid
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

import nai

# 태그 사전은 프론트 자산이지만 **파일**이라 백엔드도 읽는다 (한 벌만 둔다)
#: ★★**둘을 함께 읽는다** — 단부루 덤프와, 우리가 더한 것(V5 태그·nsfw/sfw 등).
#   2026-08-24 까지 더한 것은 **화면 코드에만** 있어서, 조수는 그 태그들을 「없다」고 했다.
#   같은 정보에 창구가 둘이면 반드시 갈린다 (`src/lib/tagData.ts` 의 ★★주).
_PUBLIC = Path(__file__).resolve().parent.parent / "public"
TAGS_JSON = _PUBLIC / "tags.json"
TAGS_EXTRA_JSON = _PUBLIC / "tags-extra.json"

_tags_cache: list[dict] | None = None


def _tags() -> list[dict]:
    global _tags_cache
    if _tags_cache is None:
        out: list[dict] = []
        for p in (TAGS_EXTRA_JSON, TAGS_JSON):   # 더한 것이 앞에 서서 먼저 걸린다
            try:
                got = json.loads(p.read_text(encoding="utf-8"))
                if isinstance(got, list):
                    out.extend(got)
            except Exception:
                continue
        _tags_cache = out
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


def _scenes(st: dict) -> list[dict]:
    """세트 안의 **씬들**.

    ★★씬은 **카드 안에** 있다 (`cards[].cells` — 2026-08-11 의 카드 층). 예전에는 세트가
      `cells` 를 직접 들었고, 여기는 그 옛 자리만 읽고 있었다. 그래서 **지금 만든 워크스페이스는
      조수에게 씬이 하나도 없는 것으로 보였다** (2026-08-24 발견).
    ★옛 자리도 함께 읽는다 — 파일은 앱이 열어야 이전되므로, 아직 안 연 워크스페이스는 옛 모양이다.
    ★공통 접두(`prefix`)는 **카드마다** 있다 (그때 함께 내려갔다). 씬에 그 카드 이름과 접두를
      붙여 준다 — 조수가 「어느 카드의 씬인가」를 물어볼 필요가 없게."""
    out = []
    for k in st.get("cards") or [{"name": st.get("name"), "prefix": st.get("prefix", ""),
                                  "cells": st.get("cells") or []}]:
        for c in k.get("cells") or []:
            out.append({
                "id": c.get("id"), "name": c.get("name"),
                "card": k.get("name"), "prefix": k.get("prefix", ""),
                "blocks": _view(c.get("blocks")), "locked": bool(c.get("locked")),
            })
    return out


def _set_prompt(spec: dict, st: dict) -> dict:
    """그 세트에 걸리는 **프롬프트**.

    ★★세트(kind=="set")의 프롬프트는 **탭에 산다** (`spec.tabs[].prompt` — `workspace.ts` 의
      `promptOf`). 한 탭 아래 세트들은 같은 인물의 다른 포즈 묶음이라 프롬프트를 함께 쓴다.
      여기는 세트에서만 찾고 있어서 **프롬프트가 통째로 안 보였다** (2026-08-24 발견).
    ★세트에 든 것도 읽는다 — 옛 워크스페이스와 싱글 탭이 그 모양이다."""
    if st.get("kind") == "set":
        cid = st.get("tabId") or spec.get("activeTab")
        for c in spec.get("tabs") or []:
            if c.get("id") == cid and c.get("prompt"):
                return c["prompt"]
    return st.get("prompt") or {}


def _tab_model(spec: dict) -> str:
    """지금 탭이 쓰는 **모델**.

    ★조수가 이것을 알아야 하는 까닭: 자연어를 써도 되는지·투명 배경이 되는지·퀄리티 프리셋이
      무엇인지가 전부 모델에 매인다 (`docs/terms-plan.md` §4 의 빈칸 셋째).
    ★생성 옵션은 **탭마다 따로** 담긴다 (`src/store/gen.ts` 의 `stashGen` — 워크스페이스는
      각각이 개별 작업 공간이다). 그래서 세트가 아니라 **활성 탭**에서 꺼낸다.
    ★능력표(무엇이 되고 안 되나)는 여기 두지 않는다 — 정본은 `src/lib/naiModels.ts` 하나다.
      여기서 옮겨 적으면 표가 둘이 되어 반드시 갈린다. 지침에는 **모델 이름**만 실린다."""
    for c in spec.get("tabs") or []:
        if c.get("id") == spec.get("activeTab"):
            return str((c.get("gen") or {}).get("model") or nai.GenRequest.model)
    return nai.GenRequest.model


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

    ★★**바꾸는 도구는 `did` 와 `at` 을 돌려준다** (사용자 지시 2026-08-08 · 2026-08-24).
      `did` 는 **무엇을** 바꿨나, `at` 은 **어디를** 바꿨나다. 화면은 그 줄을 「고침 줄」로
      따로 그리고, 누르면 그 자리를 연다 (`docs/terms-plan.md` §3-4).
      ★읽기 도구에는 붙이지 않는다 (소음이 된다).
      ★★**고치는 도구는 `at` 없이 성공하면 안 된다** — 판정이 잡는다."""

    def __init__(self, cards, store, files_mod, outputs: Path, meta_mod, notify: Callable, app: App,
                 guide=None, log=None):
        self.cards = cards
        # ★조수의 **변경 이력** (`agentlog.py`) — 되돌릴 근거. 사람의 `Ctrl+Z` 와 섞지 않는다
        self.log = log
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

    def _mark(self, tool: str, did: str, at: dict, before=None, after=None,
              undoable: bool = True, why: str = "") -> dict:
        """변경 하나를 이력에 적고, 대화 줄이 가리킬 `at` 을 돌려준다.

        ★★`at` 은 **어디를 고쳤나**다 — 화면이 그것으로 그 자리를 연다. 이력의 id(`log`)만
          싣고 **본문(before/after)은 안 싣는다**: 대화에 실으면 매 턴 컨텍스트에 딸려 온다.
        ★이력을 못 적어도 `at` 은 돌려준다 — 자리는 알려 줘야 한다."""
        rid = self.log.add(tool, did, at, before, after, undoable, why) if self.log else ""
        return {**at, "log": rid} if rid else dict(at)

    def _mark_app(self, name: str, out: dict) -> dict:
        """**앱이 한 일**도 같은 이력에 담는다 (프롬프트 편집·생성).

        ★앱은 `did`·`at`·`before`·`after` 를 돌려주고, 이력에 담는 일은 여기서 한다 —
          이력 파일이 백엔드에 있어서다.
        ★★`before`·`after` 는 **여기서 걷어낸다.** 그대로 두면 고친 프롬프트 전문이 도구
          결과로 LLM 에 실려 매 턴 컨텍스트에 눌러앉는다 (`agentlog.rows` 와 같은 이유)."""
        if not isinstance(out, dict):
            return out
        if name == "generate" and out.get("ok") and not out.get("at"):
            # ★생성은 **못 되돌린다** — 이미 Anlas 를 썼다. 그래도 자리는 남긴다
            n = out.get("queued", 0)
            where = out.get("set") or ""
            did = f"「{where}」 세트에 {n}장을 넣음" if where else f"큐에 {n}장을 넣음"
            out["did"] = did
            out["at"] = self._mark("generate", did, {"kind": "queue"},
                                   undoable=False, why="이미 Anlas 를 쓴 생성입니다")
            return out
        if out.get("at") and out.get("did"):
            out["at"] = self._mark(name, str(out["did"]), dict(out["at"]),
                                   before=out.pop("before", None), after=out.pop("after", None))
        out.pop("before", None)
        out.pop("after", None)
        return out

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
            r["at"] = self._mark("write_guide", r["did"], {"kind": "guide"},
                                 before=b.get("text"), after=str(a.get("text") or ""))
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
                out = await self.app.do(name, args or {}, timeout=600.0 if name == "ask_user" else 120.0)
                return self._mark_app(name, out)
            try:
                out = fn(args or {})
                if inspect.isawaitable(out):
                    out = await out
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
                "그 워크스페이스 안의 폴더·파일. ★뿌리는 **워크스페이스 폴더**다 — 그림은 `output/멀티/<탭>/<세트>/` 아래에 있다 (옛것은 `output/싱글/…`·`싱글/…`·`work/…`).",
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
                "★**생성을 큐에 넣는다.** 그 세트의 잠기지 않은 씬 전부를 count 바퀴 돈다 "
                "(씬이 하나면 count 장이다). 비우면 지금 보고 있는 세트, workspace·set 을 주면 "
                "**거기로** 넣는다 (화면은 안 옮긴다). 앱이 켜져 있어야 한다. Anlas 가 든다 — "
                "사용자가 장수를 말했을 때만 쓴다.",
                obj({"count": n("몇 바퀴. 기본 1"),
                     "workspace": s("어디에 넣을지 — 비우면 지금 보고 있는 곳"),
                     "set": s("어느 세트에 넣을지 — 비우면 그 워크스페이스의 활성 세트")}),
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
                "★**보고 있는 것을 고친다** (덱의 카드에는 안 닿는다). "
                "\"지금 그림체를 더 플랫하게\"·\"키키 의상 바꿔 줘\" 같은 요청은 이것으로 한다. "
                "mode=\"add\" 는 블록을 새로 붙이고, \"replace\" 는 같은 이름의 블록을 갈아 끼운다 "
                "(없으면 새로 붙는다). "
                "★`set` 을 주면 **그 세트**를, 비우면 지금 보고 있는 세트를 고친다. "
                "★`area` 에 없는 캐릭터 이름을 주면 **그 자리를 새로 만든다.** "
                "앱이 켜져 있어야 한다.",
                obj(
                    {
                        "area": s('어디를 — "base"(베이스 프롬프트) · "baseUc"(베이스 UC) · '
                                  '캐릭터는 그 이름 · 캐릭터 UC 는 "<이름>:uc"'),
                        "label": s("블록 이름 (예: 그림체)"),
                        "tags": s("태그들 — 쉼표로 구분"),
                        "mode": s('"add"(기본) 또는 "replace"'),
                        "set": s("어느 세트를 — 비우면 지금 보고 있는 세트"),
                        "scene": s("씬 칸 하나를 고칠 때 그 씬의 이름이나 id "
                                   "(주면 area·label 은 쓰지 않는다 — 칸에는 블록이 하나뿐이다)"),
                    },
                    ["area", "label", "tags"],
                ),
                None,  # 앱에 시킨다
            ),
            (
                "list_changes",
                "★**내가 이 앱에서 바꾼 것들** — 최근 것부터. 사용자가 «되돌려» 라고 하면 "
                "이걸로 무엇을 되돌릴지 먼저 고른다. 사람이 손으로 고친 것은 여기 없다 "
                "(그건 사용자가 Ctrl+Z 로 되돌린다).",
                obj({"limit": n("몇 줄까지. 기본 10")}),
                self._list_changes,
            ),
            (
                "undo_change",
                "★**그 변경을 되돌린다** (`list_changes` 의 id). 되돌리는 것도 하나의 변경이라 "
                "이력에 남는다 — 되돌린 것을 다시 되돌릴 수 있다. 못 되돌리는 것은 까닭을 말한다.",
                obj({"id": s("되돌릴 변경의 id")}, ["id"]),
                self._undo_change,
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
        sets = []
        for t in spec.get("sets", []):
            row = {"id": t.get("id"), "kind": t.get("kind"), "name": t.get("name")}
            if t.get("kind") == "set":
                row["scenes"] = _scenes(t)
            p = _set_prompt(spec, t)
            if p:
                row["prompt"] = {
                    "style": (p.get("style") or {}).get("name"),
                    "base": _view(p.get("base")),
                    "baseUc": _view(p.get("baseUc")),
                    # ★「캐릭터 프롬프트」다 — 덱의 **캐릭터 카드**와 다른 것이다 (낱말표)
                    "characters": [
                        {"name": c.get("name"), "prompt": _view(c.get("prompt")), "uc": _view(c.get("uc"))}
                        for c in (p.get("chars") or [])
                    ],
                }
            sets.append(row)
        out: dict[str, Any] = {
            "name": name,
            # ★★이름은 **화면 낱말**이다 (`docs/terms-plan.md` 의 낱말표) — 탭·세트·씬.
            #   저장 열쇠와 우연히 같아진 것이지 묶인 것이 아니다. 저장 쪽 이름을 또 바꾸면
            #   여기서 **옮겨 담아** 계약을 지킨다.
            "tabs": [{"id": c.get("id"), "name": c.get("name")} for c in (spec.get("tabs") or [])],
            "activeTab": spec.get("activeTab"),
            "sets": sets,
            "activeSet": spec.get("activeSet"),
        }
        out["model"] = _tab_model(spec)
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
        did = f"{_KIND_KO.get(kind, kind)} 카드 만듦 — {saved.get('name')}"
        at = {"kind": "card", "cardKind": kind, "id": saved.get("id")}
        return {"ok": True, "id": saved.get("id"), "name": saved.get("name"),
                "did": did, "at": self._mark("create_card", did, at, after=saved)}

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
        did = (f"{_KIND_KO.get(kind, kind)} 카드 덮어씀 — {saved.get('name')} "
               f"(직전 내용은 .bak/{cur['id']}-{stamp}.json)")
        at = {"kind": "card", "cardKind": kind, "id": saved.get("id")}
        return {"ok": True, "id": saved.get("id"), "backup": f"{cur['id']}-{stamp}.json",
                "did": did, "at": self._mark("update_card", did, at, before=cur, after=saved)}

    def _list_changes(self, a: dict) -> dict:
        """★본문(before/after)은 안 준다 — 고르라고 주는 목록이다 (`agentlog.rows` 주석)."""
        if not self.log:
            return {"items": []}
        return {"items": self.log.rows(int(a.get("limit", 10) or 10))}

    async def _undo_change(self, a: dict) -> dict:
        """이력 하나를 되돌린다.

        ★★**되돌릴 수 있는 것만** 되돌린다. 이미 Anlas 를 쓴 생성처럼 못 되돌리는 것은
          까닭을 말하고 끝낸다 — 조용히 아무것도 안 하면 사용자는 됐다고 믿는다."""
        if not self.log:
            return {"error": "변경 이력이 없습니다."}
        row = self.log.get(str(a["id"]))
        if not row:
            return {"error": "그런 변경이 없습니다. list_changes 로 다시 보세요."}
        if not row.get("undoable", True):
            return {"error": f"되돌릴 수 없습니다: {row.get('why') or row.get('did')}"}
        at = row.get("at") or {}
        kind = at.get("kind")
        if kind == "card":
            ck, cid = at.get("cardKind"), at.get("id")
            before = row.get("before")
            if before is None:                      # 만든 것 → 지운다
                self.cards.delete(ck, cid)
                did = f"만들었던 카드를 지움 — {(row.get('after') or {}).get('name', cid)}"
            else:                                   # 덮어쓴 것 → 옛 내용으로
                self.cards.save(ck, before)
                did = f"카드를 되돌림 — {before.get('name', cid)}"
            self.notify("cards")
            return {"ok": True, "did": did,
                    "at": self._mark("undo_change", did, {"kind": "card", "cardKind": ck, "id": cid})}
        if kind == "guide":
            self.guide.write(str(row.get("before") or ""))
            self.notify("guide")
            did = "지침을 되돌림"
            return {"ok": True, "did": did, "at": self._mark("undo_change", did, {"kind": "guide"})}
        if kind == "prompt":
            # ★앱이 되돌린다 — 프롬프트는 **화면이 들고 있는 사본**이라 파일만 고칠 수 없다
            before = row.get("before")
            if not isinstance(before, dict):
                return {"error": "되돌릴 내용이 남아 있지 않습니다."}
            r = await self.app.do("restore_prompt", before, timeout=120.0)
            if r.get("error"):
                return r
            did = f"되돌림 — {row.get('did')}"
            return {"ok": True, "did": did, "at": self._mark("undo_change", did, at)}
        # ★파일 옮기기·폴더 만들기는 **아직 안 되돌린다** — 그 사이 사용자가 또 옮겼을 수 있어
        #   되돌리기가 오히려 어지럽힌다. 무엇을 했는지는 말해 준다.
        return {"error": f"이 변경은 아직 자동으로 못 되돌립니다: {row.get('did')}"}

    def _search_tags(self, a: dict) -> dict:
        """★★**밑줄과 띄어쓰기를 같은 것으로 본다.** 단부루 덤프는 `high_complexity` 꼴이고
        V5 새 태그는 `high complexity` 꼴이라, 한쪽으로만 맞추면 **다른 쪽이 영영 안 걸린다**
        (실측 2026-08-24: `medium complexity` 가 0건이었다). 화면 쪽도 같은 규칙이다
        (`src/lib/tagData.ts` 의 `norm`)."""
        norm = lambda x: x.lower().replace("_", " ")  # noqa: E731
        q = norm(str(a["query"]))
        if len(q) < 2:
            return {"items": []}
        mx = min(40, int(a.get("max", 15) or 15))
        starts, has = [], []
        for t in _tags():
            low = norm(t["label"])
            if low.startswith(q):
                starts.append(t)
                if len(starts) >= mx:
                    break
            elif q in low and len(has) < mx:
                has.append(t)
        items = (starts + has)[:mx]
        return {"items": [{"tag": t["label"], "count": t.get("count"), "type": t.get("type")} for t in items]}

    def _ws_name(self, a: dict) -> str:
        """이 도구가 보는 워크스페이스 이름 — 화면이 그 자리를 열 때 쓴다"""
        return str(a.get("workspace") or self.app.workspace or "").strip()

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
            path = f"{str(a.get('parent') or '').rstrip('/')}/{a['name']}".lstrip("/")
            out["did"] = f"폴더 만듦 — {path}"
            out["at"] = self._mark("create_folder", out["did"],
                                   {"kind": "file", "workspace": self._ws_name(a), "path": path},
                                   after={"path": path})
        return out

    def _move(self, a: dict) -> dict:
        files = list(a["files"])
        out = self.files.move(self._ws_root(a), files, str(a["dest"]))
        self.notify("files")
        if isinstance(out, dict) and not out.get("error"):
            # ★몇 개를 어디로 — 되돌리려면 이 둘이 있어야 한다
            head = ", ".join(files[:3]) + (f" 외 {len(files) - 3}개" if len(files) > 3 else "")
            out["did"] = f"{len(files)}개 옮김 → {a['dest']} ({head})"
            out["at"] = self._mark("move_files", out["did"],
                                   {"kind": "file", "workspace": self._ws_name(a), "path": str(a["dest"])},
                                   before={"files": files}, after={"dest": str(a["dest"])})
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

#: 낱말 정본 — 화면·코드·저장·조수가 **같은 이름**을 쓰기 위한 표 (`docs/terms-plan.md`)
TERMS_JSON = Path(__file__).resolve().parent.parent / "shared" / "terms.json"
_terms_cache: list[dict] | None = None


def _terms() -> list[dict]:
    global _terms_cache
    if _terms_cache is None:
        try:
            _terms_cache = json.loads(TERMS_JSON.read_text(encoding="utf-8")).get("terms", [])
        except Exception:
            _terms_cache = []
    return _terms_cache


def terms_block(lang: str = "") -> str:
    """지침에 실을 **용어 절**을 표에서 만든다.

    ★★표가 바뀌면 지침이 따라 바뀐다 — 문서에만 적어 두면 또 어긋난다 (2026-08-18 에
      표를 적어 뒀는데도 코드가 뒤집힌 채로 남아 있었다).
    ★**별칭을 그 언어로 함께 싣는다** (사용자 지시 2026-08-24: *"유저가 뭐라고 말할지
      모르니 유연성을 줘야 한다"*). 사용자가 「슬롯」·「칸」이라 해도 씬으로 알아듣는다.
    ★필드 이름은 **영어 하나**다 — 답은 사용자 언어로 하되 계약은 하나여야 한다."""
    rows = _terms()
    if not rows:
        return ""
    say = (lang or "en") if (lang or "en") in ("ko", "en", "ja") else "en"
    out = ["\n\nWords this app uses. **The tool field is the contract**; the rest is how the",
           "user may say it. When they use one of the aliases, they mean that term."]
    for t in rows:
        what = (t.get("what") or {}).get(say) or (t.get("what") or {}).get("en") or ""
        alias = (t.get("alias") or {}).get(say) or []
        also = (" — user may say: " + " / ".join(alias)) if alias else ""
        out.append(f"- `{t['tool']}` : {what}{also}")
    out += [
        "★A **character prompt** (`characters`) is a person inside the image being drawn;",
        "  a **character card** (`characterCard`) is saved material in the deck. Editing the card",
        "  does not change what is on screen. The same split holds for a **style card** and `base`.",
        "★`tabs` contain `sets`, and a set contains `scenes`. Say which one you mean.",
    ]
    return "\n".join(out)


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
    return (SYSTEM.replace("{support}", support or SUPPORT_URL) + line
            + terms_block(lang) + (guide_block or ""))


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
- **Danbooru tags are the default** - they reproduce best. Look one up with **search_tags**
  first and prefer what you find. Words outside the dictionary are allowed; just be clear
  about which ones you confirmed and which you did not. Write tags with spaces, not
  underscores (long_hair -> long hair).
- **Plain sentences only when the user asks for them.** V5 takes natural language well, but
  tags stay the default. When you do mix prose in, keep the tags.
- ★get_workspace tells you the **model** the open tab generates with. `nai-diffusion-5-*`
  reads plain sentences well and can do a transparent background; the 4.5 models do neither,
  so on those keep to tags and say a transparent background is not available there.
- When asked for a **whole prompt**, split it the way the app is built: `base` for what
  applies to the whole image (style, quality, framing, background) and one `characters`
  entry per person (looks, outfit, expression, pose). Never pile several people into one -
  NAI blends them, and the user cannot then fix a single person.
- Emphasis is `1.3::tag::`, de-emphasis is `0.7::tag::`. To keep a character's traits
  without drowning out other tags, **lower the weight** instead of removing the tag.
- ★**Three places a request can land, and they show up in different places:**
  (1) what they are looking at now - **edit_current_prompt** (on screen; they save it later),
  (2) the deck - **create_card** / **update_card** (kept for later; the screen does not change),
  (3) just your reply (nothing is touched).
  **When the wording does not say which, ask before you make anything.** Making a card when
  they meant (1) leaves the result nowhere they can see.
- **"Change X" defaults to (1)** - people usually mean what is on screen right now.
- **When a name comes up, find where it lives first.** Look at the current set's `characters`
  with get_workspace; if it is not there, look in the deck with list_cards. **If it is in
  both, ask which one.**
- update_card overwrites an existing card - use it only when they clearly asked for that.
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
- ★**Turn repeated questions into a rule.** The *second* time you have to ask the same kind
  of question, add "Should I keep doing it this way?" after you get the answer. If they say
  yes, write that one line into the guide. **Never write it without asking** - a rule they
  did not agree to is a rule they cannot see.
- ★**Always say what you changed.** If you touched a card, a prompt, a file or the guide,
  put one line about it in your reply. The user must be able to ask you to undo it.
- edit_current_prompt works on the set that is open. Pass `set` to work on another one - the
  app opens it, so the user watches the change land. Naming a character who is not there
  **creates that slot**, so "add a maid standing behind them" is one call, not a request for
  the user to set something up first.
  Pass `scene` to change one scene cell instead (a cell holds a single block, so `tags` is
  all it takes).
- ★**Undoing your own edits.** The user's Ctrl+Z covers only what **they** did; your edits
  are undone through you. When they say "undo that" or "put it back", call **list_changes**
  and then **undo_change** with the id. Some things cannot be undone - a queued generation
  has already spent Anlas. Say so plainly instead of acting as if it worked.
- ★**You never modify the app itself** (its code or config files). You have no tool for it.
  If the user asks for an app change, tell them **why and where to go**: editing the app
  directly **breaks on the next update** - the change is lost or the app stops working.
  Feature requests and bug reports go to {support}."""
