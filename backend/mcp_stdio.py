"""PeroPix 도구를 MCP 로 내보내는 **얇은 중계** (stdio 트랜스포트).

클로드 코드 같은 에이전트 CLI 가 이 스크립트를 자식 프로세스로 띄우고 JSON-RPC 로 말한다.
여기서는 아무것도 판단하지 않는다 — 전부 백엔드(`/api/agent/*`)로 넘기고, 백엔드가
기존 WebSocket 으로 화면에 넘긴다 (`agent.py` 머리 주석).

    claude -p --mcp-config <설정> --allowedTools "mcp__peropix__*"

★**stdout 은 프로토콜 전용**이다. 로그는 반드시 stderr 로 — 한 줄이라도 섞이면 연결이 깨진다.
★HTTP 트랜스포트가 아니라 stdio 를 고른 이유: 규격 표면이 작아 조용히 틀릴 자리가 적고,
  클로드 코드가 stdio 서버에 주는 유휴 한계가 더 길다(30분 대 5분) — 사람 확인을 기다리는
  도구가 있으므로 그 편이 맞다.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

BASE = os.environ.get("PEROPIX_BACKEND", "http://127.0.0.1:8770")
NAME = "peropix"
VERSION = "3.0.0-dev"
# 클라이언트가 요구한 판을 그대로 돌려준다 (규격: 지원하면 같은 값으로 답한다).
# 안 오면 이 값을 쓴다.
FALLBACK_PROTOCOL = "2025-06-18"


def log(*a) -> None:
    print(*a, file=sys.stderr, flush=True)


def _req(path: str, body: dict | None = None) -> dict:
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"} if data else {}
    )
    # ★`ask_user` 는 사람이 답할 때까지 기다린다 — 여기서 먼저 끊기면 안 된다
    with urllib.request.urlopen(req, timeout=1800) as r:
        return json.loads(r.read().decode("utf-8"))


def send(msg: dict) -> None:
    sys.stdout.write(json.dumps(msg, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def reply(mid, result: dict) -> None:
    send({"jsonrpc": "2.0", "id": mid, "result": result})


def fail(mid, code: int, message: str) -> None:
    send({"jsonrpc": "2.0", "id": mid, "error": {"code": code, "message": message}})


def handle(msg: dict) -> None:
    method = msg.get("method")
    mid = msg.get("id")

    # ★알림(id 없음)에는 **응답하지 않는다**
    if mid is None:
        return

    if method == "initialize":
        want = (msg.get("params") or {}).get("protocolVersion") or FALLBACK_PROTOCOL
        reply(
            mid,
            {
                "protocolVersion": want,
                "capabilities": {"tools": {}},
                "serverInfo": {"name": NAME, "version": VERSION},
                "instructions": "PeroPix 3.0 의 화면을 직접 만지는 도구들입니다. "
                "고치기 전에 get_screen 으로 지금 상태를 확인하세요.",
            },
        )
        return

    if method == "ping":
        reply(mid, {})
        return

    if method == "tools/list":
        try:
            reply(mid, {"tools": _req("/api/agent/tools")["tools"]})
        except Exception as e:
            fail(mid, -32603, f"도구 목록을 못 받았습니다: {e}")
        return

    if method == "tools/call":
        p = msg.get("params") or {}
        try:
            out = _req("/api/agent/call", {"name": p.get("name"), "input": p.get("arguments") or {}})
        except Exception as e:
            out = {"error": str(e)}
        bad = bool(out.get("error") or out.get("cancelled"))
        reply(
            mid,
            {
                "content": [{"type": "text", "text": json.dumps(out, ensure_ascii=False)}],
                "isError": bad,
            },
        )
        return

    fail(mid, -32601, f"Unknown method: {method}")


def main() -> None:
    log(f"[peropix-mcp] 백엔드 {BASE}")
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except Exception as e:
            log("[peropix-mcp] 못 읽은 줄:", e)
            continue
        try:
            handle(msg)
        except Exception as e:  # 여기서 죽으면 연결이 통째로 끊긴다
            log("[peropix-mcp] 처리 실패:", e)
            if msg.get("id") is not None:
                fail(msg["id"], -32603, str(e))


if __name__ == "__main__":
    main()
