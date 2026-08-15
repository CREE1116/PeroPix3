"""조수 한 명 = **대화 내내 사는 세션 하나** — 어느 CLI 든 바깥에서는 같게 보인다.

    start_turn(글)   놀고 있으면 한 턴 시작
    steer(글)        ★도는 **도중에** 끼어들기 — 되면 True
    interrupt()      ★그 턴만 멈춘다 (프로세스는 살려 둔다)

★왜 세션인가 (사용자 결정 2026-08-15): 예전에는 **턴마다 프로세스를 새로 띄웠다.** 그래서
  도중에 끼어들 수도 없고, 「중단」이 프로세스를 죽여 대화가 통째로 끊겼다. 두 CLI 다
  오래 사는 방식을 지원하는 것을 실측으로 확인하고 옮겼다:

    코덱스     `codex app-server` (JSON-RPC) — `turn/steer` · `turn/interrupt`
    클로드 코드 `--input-format stream-json` — 도는 도중에 넣은 줄이 그 턴에 반영됐다
               (실측: 14.0초에 넣고 17.1초에 반응, `result` 는 한 번)

★흘러나오는 것을 여기서 옮겨 적지 않는다 — 그대로 화면에 넘기고 `src/lib/codexStream.ts`·
  `llm.ts` 가 wire 조각으로 바꾼다 (`cliagent` 와 같은 역할 분담).

★**턴의 끝은 언제나 `turn_end`** 다. CLI 마다 알리는 방식이 다르지만(코덱스는
  `turn/completed`, 클로드는 `result`) 화면이 볼 것은 하나여야 한다.
"""
from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any, Awaitable, Callable

import cliagent
import codexapp

Emit = Callable[[dict], Awaitable[None]]


class Session:
    """CLI 한 명. ★한 번에 하나만 산다 (화면이 하나라 둘이 앱을 만지면 뒤엉킨다)."""

    kind = ""

    def __init__(self, exe: str, cwd: Path, backend: str, emit: Emit):
        self.exe = exe
        self.cwd = cwd
        self.backend = backend
        self.emit = emit
        #: 저쪽이 들고 있는 대화 번호 — 화면이 대화 파일에 함께 저장한다
        self.session_id = ""
        self.busy = False

    async def close(self) -> None: ...

    async def start_turn(self, prompt: str, system: str) -> None: ...

    async def steer(self, text: str) -> bool:
        """도는 도중에 끼워 넣는다. 못 하면 False (부른 쪽이 줄을 세운다)."""
        return False

    async def interrupt(self) -> None: ...


class CodexSession(Session):
    """`codex app-server` 한 벌 (`codexapp.py` 머리 주석에 프로토콜 설명)."""

    kind = "codex"

    def __init__(self, exe: str, cwd: Path, backend: str, emit: Emit):
        super().__init__(exe, cwd, backend, emit)
        self.rpc: codexapp.Rpc | None = None
        self.turn_id = ""
        self._loop = asyncio.get_running_loop()

    def _note(self, msg: dict) -> None:
        """저쪽 스레드에서 불린다 — 서버 루프로 넘겨 순서대로 내보낸다."""
        self._loop.call_soon_threadsafe(lambda: asyncio.ensure_future(self._forward(msg)))

    async def _forward(self, msg: dict) -> None:
        method = msg.get("method")
        if method:
            await self.emit({"type": str(method), **(msg.get("params") or {})})
            # ★턴의 끝은 우리가 한 가지 이름으로 알린다 (클래스 머리 주석)
            if method == "turn/completed":
                self.busy = False
                self.turn_id = ""
                await self.emit({"type": "turn_end", "code": 0})
            return
        t = msg.get("type")
        if t == "stderr":
            await self.emit(msg)
        elif t == "gone":
            # 프로세스가 죽었다 — 돌던 턴이 있으면 끝을 알려 화면이 안 멈추게 한다
            self.rpc = None
            if self.busy:
                self.busy = False
                await self.emit({"type": "turn_end", "code": msg.get("code") or -1})
            await self.emit({"type": "exit", "code": msg.get("code") or -1})

    async def _ensure(self, system: str) -> None:
        if self.rpc and self.rpc.alive and self.session_id:
            return
        self.rpc = codexapp.Rpc(self.exe, self.cwd, self._note)
        await self.rpc.start()
        await self.rpc.call("initialize", {"clientInfo": {
            "name": "peropix", "title": "PeroPix", "version": "3.0"}})
        cfg = codexapp.thread_config(self.backend)
        params: dict[str, Any] = {"cwd": str(self.cwd), "config": cfg}
        if system:
            params["developerInstructions"] = system
        if self.session_id:
            # 앱을 껐다 켠 뒤 — 그 대화를 이어 연다
            r = await self.rpc.call("thread/resume", {**params, "threadId": self.session_id})
        else:
            r = await self.rpc.call("thread/start", params)
        tid = (r.get("thread") or {}).get("id") or r.get("threadId") or ""
        if not tid:
            raise RuntimeError(f"대화를 못 열었습니다: {json.dumps(r, ensure_ascii=False)[:200]}")
        self.session_id = tid

    async def start_turn(self, prompt: str, system: str) -> None:
        await self._ensure(system)
        assert self.rpc is not None
        # ★이어붙임 번호는 **우리가 알려 준다.** 화면이 대화 파일에 함께 저장해야 앱을 껐다
        #   켜도 이어진다 (알림에서 캐내게 두면 이어 여는 경우에 안 온다)
        await self.emit({"type": "session", "id": self.session_id})
        params: dict[str, Any] = {"threadId": self.session_id,
                                  "input": [{"type": "text", "text": prompt}]}
        if self.model:
            params["model"] = self.model
        if self.effort:
            params["effort"] = self.effort
        self.busy = True
        try:
            # ★턴 번호는 **이 답**에 들어 있다 — 알림을 뒤질 일이 없다
            r = await self.rpc.call("turn/start", params, timeout=60)
        except Exception:
            self.busy = False
            raise
        self.turn_id = (r.get("turn") or {}).get("id") or ""

    async def steer(self, text: str) -> bool:
        if not (self.rpc and self.rpc.alive and self.busy and self.turn_id):
            return False
        await self.rpc.call("turn/steer", {
            "threadId": self.session_id, "expectedTurnId": self.turn_id,
            "input": [{"type": "text", "text": text}]}, timeout=60)
        return True

    async def interrupt(self) -> None:
        if self.rpc and self.rpc.alive and self.turn_id:
            with __import__("contextlib").suppress(Exception):
                await self.rpc.call("turn/interrupt",
                                    {"threadId": self.session_id, "turnId": self.turn_id},
                                    timeout=30)

    async def close(self) -> None:
        if self.rpc:
            await self.rpc.stop()
            self.rpc = None


class ClaudeSession(Session):
    """클로드 코드 — **아직 옛 방식**(턴마다 프로세스)이다.

    ★다음 차례에 `--input-format stream-json` 으로 옮긴다. 되는 것은 이미 쟀다
      (14.0초에 끼어들어 17.1초에 반응). 그때까지 `steer` 는 False 를 돌려주고,
      부른 쪽이 줄을 세운다 — **바깥에서 보이는 창구는 지금도 같다.**"""

    kind = "claude-code"

    def __init__(self, exe: str, cwd: Path, backend: str, emit: Emit):
        super().__init__(exe, cwd, backend, emit)
        self.runner = cliagent.Runner()

    async def start_turn(self, prompt: str, system: str) -> None:
        cfg = cliagent.mcp_config(self.cwd.parent, self.backend)
        self.busy = True

        async def emit(ev: dict):
            sid = ev.get("session_id")
            if sid and str(sid) != self.session_id:
                self.session_id = str(sid)
                # 코덱스와 **같은 이름**으로 알린다 — 화면이 한 가지만 알면 되게
                await self.emit({"type": "session", "id": self.session_id})
            await self.emit(ev)
            if ev.get("type") == "exit":
                self.busy = False
                await self.emit({"type": "turn_end", "code": ev.get("code") or 0})

        await self.runner.run(self.exe, prompt, cfg, self.cwd, system, emit,
                              self.session_id, self.model, self.effort, "claude-code",
                              self.backend)

    async def interrupt(self) -> None:
        await self.runner.stop()

    async def close(self) -> None:
        await self.runner.stop()


#: 모델·강도는 두 세션이 같은 이름으로 든다 (`Session` 을 가볍게 두려고 밖에서 붙인다)
Session.model = ""  # type: ignore[attr-defined]
Session.effort = ""  # type: ignore[attr-defined]


def make(kind: str, exe: str, cwd: Path, backend: str, emit: Emit) -> Session:
    return (CodexSession if kind == "codex" else ClaudeSession)(exe, cwd, backend, emit)
