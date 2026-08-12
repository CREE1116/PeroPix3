# -*- coding: utf-8 -*-
"""사용자 지침 — **앱이 들고 있는 문서 한 장** (사용자 결정 2026-08-08).

CLI 의 개인 지침(`CLAUDE.md`·`AGENTS.md`)에 기대지 않는 이유는 그대로다: 그것은 그 사람의
코딩 작업용이고, 끌고 들어오면 엔진마다 다르게 굴어 **재현이 안 된다**. 그래서 격리는
유지하고 지침은 여기 둔다 — API·클로드 코드·Codex·OpenCode 가 **같은 문서**를 본다.

★**목록이 아니라 문서다** (사용자 지적 2026-08-08). 처음엔 한 줄씩 더하고 지우는 목록으로
  만들었는데, 이건 '기억'이라기보다 **지침**이라 "지금까지의 지침을 종합해 봐" 같은 일이
  안 됐다. 통째로 읽고 통째로 쓴다.

★**덮어쓰기 전에 직전 내용을 남긴다** (`.guide-bak/`). 자유 편집이라 한 번에 다 날릴 수
  있는데, 되돌릴 길이 없으면 그 자유가 위험이 된다. 카드의 `update_card` 와 같은 방식이다.

★**길이는 코드가 막는다.** 이 문서는 **매 턴 프롬프트에 들어간다** — 긴 글을 한 번 붙여
  넣으면 그 비용이 이후 모든 턴에 붙는다.
"""
from __future__ import annotations

from datetime import datetime
from pathlib import Path

#: 문서 전체의 길이 상한. 한글 기준 대략 1,300~1,600 토큰 — 매 턴 붙는 값이라 이 정도로 둔다
MAX_CHARS = 4000
#: 남겨 두는 직전 내용 개수
KEEP_BAK = 20


class Guide:
    """`data/guide.md` — 그냥 글이다. 형식을 강요하지 않는다 (사람도 AI 도 읽고 쓴다)."""

    def __init__(self, path: Path):
        self.path = path
        self.bak = path.parent / ".guide-bak"
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def read(self) -> str:
        try:
            return self.path.read_text(encoding="utf-8")
        except Exception:
            return ""

    def write(self, text: str) -> dict:
        """통째로 갈아 끼운다. 돌려주는 것에 **무엇이 달라졌는지**를 담는다."""
        new = (text or "").replace("\r\n", "\n").strip()
        if len(new) > MAX_CHARS:
            return {"error": f"지침이 너무 깁니다 ({len(new)}자). {MAX_CHARS}자 안으로 줄여 주세요."}
        old = self.read()
        # ★쓸 때 끝에 줄바꿈을 붙이므로, **읽은 것을 그대로 다시 쓰면** 원문과 안 같다.
        #   그대로 두면 손댄 것이 없는데도 매번 백업이 쌓이고 "고쳤다"고 말한다 (실측으로 밟았다).
        if new == old.strip():
            return {"ok": True, "unchanged": True, "chars": len(new), "lines": _lines(new)}
        if old:
            self._backup(old)
        if new:
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(new + "\n", encoding="utf-8")
            tmp.replace(self.path)
        else:
            self.path.unlink(missing_ok=True)
        return {
            "ok": True,
            "chars": len(new),
            "lines": _lines(new),
            "before": {"chars": len(old), "lines": _lines(old)},
        }

    def _backup(self, old: str) -> None:
        self.bak.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        (self.bak / f"guide-{stamp}.md").write_text(old, encoding="utf-8")
        # ★오래된 것부터 버린다 — 백업이 무한히 쌓이면 그것도 사고다
        files = sorted(self.bak.glob("guide-*.md"))
        for f in files[:-KEEP_BAK]:
            f.unlink(missing_ok=True)

    def block(self) -> str:
        """시스템 프롬프트에 붙일 조각. 비었으면 **빈 문자열** — 빈 제목만 남기지 않는다."""
        text = self.read().strip()
        if not text:
            return ""
        return (
            "\n\n★사용자가 정한 지침입니다 (앱이 들고 있습니다 — 매번 지켜 주세요):\n" + text
        )


def _lines(text: str) -> int:
    return len([x for x in (text or "").splitlines() if x.strip()])
