"""조수의 **변경 이력** — 되돌릴 근거 (2026-08-24).

★★되돌리기가 **둘로 나뉜다** (사용자 결정 2026-08-24):

      사람이 고친 것   `Ctrl+Z`            (`src/lib/undo.ts` 의 전역 로그)
      조수가 고친 것   조수에게 말한다      (이 파일 + `list_changes`·`undo_change`)

  섞지 않는 것이 요점이다 — 같은 키가 두 사람의 일을 되돌리면 무엇이 되돌아갈지 누르기 전에
  알 수 없다.

★대화 줄의 `did`·`at` 만으로는 **못 되돌린다** — 고치기 **전 값**이 없다. 그렇다고 대화에
  싣자니 매 턴 조수의 컨텍스트에 실려 비싸다. 그래서 여기 따로 적고, 대화 줄은 `at.log`(id)만
  가리킨다. 이력 본문은 조수가 물을 때만 읽는다.

★append-only 다. 되돌리기도 **하나의 변경**이라 이력에 남는다 — 되돌린 것을 다시 되돌릴 수 있다.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime
from pathlib import Path

FILE = "agent-log.jsonl"
#: 목록으로 돌려주는 최대 줄 수 — 이력이 길어져도 컨텍스트를 덮지 않게
MAX_LIST = 30


class AgentLog:
    def __init__(self, data_dir: Path):
        self.path = data_dir / FILE
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def add(self, tool: str, did: str, at: dict | None, before=None, after=None,
            undoable: bool = True, why: str = "") -> str:
        """변경 하나를 적고 그 id 를 돌려준다.

        ★`undoable=False` 는 **못 되돌리는 것**이다 (이미 Anlas 를 쓴 생성 등). 까닭(`why`)을
          함께 적어, 조수가 "왜 못 되돌리는지"를 말할 수 있게 한다."""
        rid = uuid.uuid4().hex[:8]
        row = {
            "id": rid,
            "ts": datetime.now().isoformat(timespec="seconds"),
            "tool": tool,
            "did": did,
            "at": at or {},
            "undoable": bool(undoable),
        }
        if why:
            row["why"] = why
        if before is not None:
            row["before"] = before
        if after is not None:
            row["after"] = after
        try:
            with self.path.open("a", encoding="utf-8") as f:
                f.write(json.dumps(row, ensure_ascii=False) + "\n")
        except Exception:
            pass  # ★이력을 못 적어도 그 작업 자체는 이미 끝났다 — 막지 않는다
        return rid

    def rows(self, limit: int = MAX_LIST) -> list[dict]:
        """최근 것부터. ★`before`·`after` 는 **빼고** 준다 — 목록은 고르라고 주는 것이고,
        본문은 되돌릴 때만 필요하다 (그대로 실으면 컨텍스트가 통째로 찬다)."""
        out = []
        try:
            for ln in self.path.read_text(encoding="utf-8").splitlines():
                if not ln.strip():
                    continue
                try:
                    r = json.loads(ln)
                except Exception:
                    continue
                out.append({k: v for k, v in r.items() if k not in ("before", "after")})
        except FileNotFoundError:
            return []
        except Exception:
            return []
        return list(reversed(out))[: max(1, min(MAX_LIST, limit))]

    def get(self, rid: str) -> dict | None:
        """되돌릴 때 쓰는 **전문** (before 포함)."""
        try:
            for ln in reversed(self.path.read_text(encoding="utf-8").splitlines()):
                if not ln.strip():
                    continue
                try:
                    r = json.loads(ln)
                except Exception:
                    continue
                if r.get("id") == rid:
                    return r
        except Exception:
            return None
        return None
