"""로컬 에이전트 CLI — 찾아서 띄우고, 흘러나오는 것을 화면으로 넘긴다.

★**왜 CLI 인가**: 사용자가 이미 구독료를 내고 있는 것을 그대로 쓴다 (API 크레딧이 따로 안 든다).
  에이전트 루프·도구·재시도를 저쪽이 돌고, 우리는 **우리 도구만** 열어 준다 (`mcp_stdio.py`).

★실행 깃발 셋이 핵심이다 (실측 2026-08-07, `test_agent_live.py`):

    --mcp-config <설정> --strict-mcp-config --allowedTools "mcp__peropix__*"

  - `--strict-mcp-config` 를 빼면 **사용자의 다른 MCP 서버까지 딸려 온다.**
  - `--allowedTools` 는 **자동 승인일 뿐 막지 않는다.** 그래서 `--disallowedTools` 로
    Read/Bash 등을 실제로 닫는다 — 안 닫으면 에이전트가 우리 소스를 뒤지다 권한 벽에 막힌다
    (실사용 로그에서 확인).
  - ★`--bare` 는 쓰지 않는다 — OAuth 를 안 읽어 **구독 대신 API 키**를 요구한다.
  - ★**앱 안의 빈 폴더에서 돌린다**(`work_dir`). 예전엔 앱 밖이었다 — 왜 되돌렸는지는
    그 함수의 주석에 있다 (근거가 실측으로 무너졌다).
"""
from __future__ import annotations

import asyncio
import json
import os
import shutil
import sys
from pathlib import Path

# ★일곱에서 셋으로 줄였다 (사용자 지시 2026-08-08). 고를 수 없는 줄이 넷이나 떠 있어
#   "왜 회색인가"만 늘렸다. 남긴 기준은 **앞으로 붙일 값어치가 있는가**다:
#     Codex     OpenAI 공식 (GitHub 별 104k)
#     OpenCode  CLI 중 별 최다 193k · npm 주당 168만 — 이 PC 에도 이미 깔려 있었다
#   내린 것: Gemini CLI(구글이 Antigravity 로 흡수, 개인 무료 2026-06-18 종료) ·
#            Cursor Agent · Qwen Code · GitHub Copilot CLI.
#   ★다시 늘릴 때는 **스트림 파싱도 함께** 붙여야 한다 (`src/lib/codexStream.ts` 가 그 예다).
#   ★2026-08-15: 코덱스를 붙였다. 실행 깃발은 `argv_codex`, 옮겨 적기는 `codexStream.ts`.
KNOWN = [
    {"id": "claude-code", "label": "Claude Code", "bins": ["claude"]},
    {"id": "codex", "label": "Codex CLI", "bins": ["codex"]},
    {"id": "opencode", "label": "OpenCode", "bins": ["opencode"]},
]

# 지금 실제로 몰 수 있는 것 — 나머지는 목록에만 보이고 고를 수 없다
DRIVABLE = {"claude-code", "codex"}


def agent_of(exe: str) -> str:
    """실행 파일 이름으로 어느 CLI 인지 가른다.

    ★화면이 `agent` 를 안 실어 보냈을 때의 **폴백일 뿐**이다. 어느 CLI 인지는 화면이 안다
      (고른 항목의 id). 이름으로 짐작하는 것을 정본으로 삼지 말 것."""
    stem = Path(exe).stem.lower()
    for c in KNOWN:
        if stem in c["bins"]:
            return c["id"]
    return "claude-code"


def _extra_dirs() -> list[Path]:
    """PATH 에 늘 있지는 않은 툴체인 폴더 (스튜디오 `engine.rs` 와 같은 자리)."""
    home = Path.home()
    if os.name == "nt":
        rel = [
            ("AppData", "Roaming", "npm"),
            ("AppData", "Local", "Programs", "claude"),
            ("scoop", "shims"),
            (".cargo", "bin"),
        ]
    else:
        rel = [(".npm-global", "bin"), (".local", "bin"), (".cargo", "bin"), (".bun", "bin")]
    return [home.joinpath(*r) for r in rel]


def find(bins: list[str]) -> str | None:
    for b in bins:
        p = shutil.which(b)
        if p:
            return p
    exts = [""] if os.name != "nt" else os.environ.get("PATHEXT", ".EXE;.CMD;.BAT").lower().split(";")
    for d in _extra_dirs():
        for b in bins:
            for e in exts:
                cand = d / (b + e)
                if cand.is_file():
                    return str(cand)
    return None


#: 클로드 코드의 모델 별칭 — 도움말이 예로 든 둘 (실측 2026-08-08)
CLAUDE_MODELS = ["opus", "sonnet"]


def codex_home() -> Path:
    """코덱스가 자기 것을 두는 곳. ★우리가 옮기지 않는다 — 인증서가 여기 있다."""
    d = os.environ.get("CODEX_HOME")
    return Path(d) if d else Path.home() / ".codex"


def codex_models() -> list[str]:
    """코덱스가 **자기 캐시에 적어 둔** 모델 목록 (`~/.codex/models_cache.json`).

    ★목록을 우리가 들고 있지 않는다. 저쪽이 새 모델을 받으면 그 파일이 바뀌고 우리는 따라간다.
      실측 2026-08-15: `visibility` 가 `list` 인 것만 사람에게 보인다 (`hide` 는 내부용).
    ★못 읽으면 **빈 목록**이다. 그러면 `-m` 을 안 넘기고 코덱스 기본값으로 돈다."""
    try:
        raw = json.loads((codex_home() / "models_cache.json").read_text(encoding="utf-8"))
        return [m["slug"] for m in raw.get("models", []) if m.get("visibility") == "list"]
    except Exception:
        return []


def detect() -> list[dict]:
    out = []
    for c in KNOWN:
        path = find(c["bins"])
        out.append(
            {
                "id": c["id"],
                "label": c["label"],
                "installed": bool(path),
                "path": path,
                # ★"깔려 있다"와 "몰 수 있다"는 다르다. 목록에는 보이되 고르지 못하게 한다
                "drivable": c["id"] in DRIVABLE,
                # ★모델 목록은 **CLI 마다 다르다.** 하나로 두면 코덱스를 골라 놓고
                #   `sonnet` 이 떠 있게 된다 (고를 수 있는 값이 아니다)
                "models": CLAUDE_MODELS if c["id"] == "claude-code" else (
                    codex_models() if c["id"] == "codex" else []
                ),
            }
        )
    return out


def work_dir(data_dir: Path) -> Path:
    """CLI 를 돌릴 **빈 폴더** — 앱 안이다 (`data/agent/`).

    ★예전에는 앱 **밖**(임시 폴더)이었다. "앱 안에서 돌리면 우리 `CLAUDE.md` 가 문맥에
      실려 에이전트가 개발자처럼 군다"가 근거였는데, 실측(2026-08-12)으로 무너졌다:

        빈 임시 폴더에서 돌려도 **사용자 홈의 `~/.claude/CLAUDE.md` 는 그대로 실린다.**
        (조수에게 직접 물어 확인 — 로드된 지침 파일로 그 경로 하나를 댔다)

      즉 밖으로 뺀 것이 막은 것은 개발 폴더의 `CLAUDE.md` 하나뿐이고, 그것도 **개발
      환경에만 있는 파일**이다. 배포된 앱에는 없다. 그 이유로 앱이 쓰는 폴더를 앱 밖에
      둘 값어치가 없다 (사용자 결정 2026-08-12).

    ★전역 지침이 실리는 것은 **막지 않는다** (사용자 결정 2026-08-12) — 사용자는 자기
      지침을 바탕으로 도는 것을 오히려 기대한다. 막을 수단도 마땅치 않다: `--bare` 는
      OAuth 를 안 읽어 구독 대신 API 키를 요구하고, `CLAUDE_CONFIG_DIR` 로 홈을 옮기면
      인증서까지 따라가 **로그인이 깨진다** (둘 다 실측).

    ★비워 둔다 — 여기에 파일을 만들지 말 것. 조수가 만든 것은 MCP 도구를 거쳐 앱의
      제자리(카드·워크스페이스)로 간다."""
    d = data_dir / "agent"
    d.mkdir(parents=True, exist_ok=True)
    return d


def config_dir() -> Path:
    """claude 가 자기 것을 두는 곳 — 홈의 `.claude`, 또는 `CLAUDE_CONFIG_DIR` 로 옮긴 자리.

    ★우리가 옮기지는 않는다. 옮기면 인증서까지 따라가 **로그인이 깨진다** (실측 2026-08-12)."""
    d = os.environ.get("CLAUDE_CONFIG_DIR")
    return Path(d) if d else Path.home() / ".claude"


def session_exists(sid: str, agent: str = "claude-code") -> bool:
    """그 대화가 저쪽에 **아직 있는가**.

    ★있어야 `--resume` 이 먹는다. 없으면 claude 는 한 마디도 못 하고 죽는데, 화면에는
      까닭 없는 오류만 남는다 — 그래서 **대화를 열 때 미리** 물어 안내한다.

    ★claude 는 기본 30일이 지난 기록을 지운다(`cleanupPeriodDays`). 우리가 늘릴 수는
      없다 — 청소는 claude 홈 전체를 대상으로 **매 실행 시작 때** 돌아서, 우리가 큰 값을
      넘겨도 사용자가 직접 쓰는 claude 가 기본값으로 지워 버린다 (사용자 결정: 손대지 않음).

    ★폴더 이름 규칙을 흉내 내지 않고 **전 프로젝트에서 그 번호를 찾는다.** 규칙은
      작업 폴더 경로에서 나오는데, claude 버전에 따라 찾는 범위도 바뀐다
      (v2.1.223 부터는 프로젝트를 가리지 않고 찾는다). 파일 하나를 찾는 것뿐이라 싸다."""
    if not sid or any(c in sid for c in "/\\.:"):
        return False  # 경로 조각이 섞인 것은 우리 번호가 아니다
    if agent == "codex":
        # ★코덱스는 날짜로 나눠 담는다: `sessions/<년>/<월>/<일>/rollout-<시각>-<uuid>.jsonl`
        #   (실측 2026-08-15). claude 와 자리도 이름 규칙도 달라 한 함수로 겸할 수 없다.
        root = codex_home() / "sessions"
        return root.is_dir() and any(root.glob(f"*/*/*/rollout-*-{sid}.jsonl"))
    root = config_dir() / "projects"
    if not root.is_dir():
        return False
    return any(root.glob(f"*/{sid}.jsonl"))


def mcp_spec(backend: str) -> dict:
    """우리 도구를 여는 stdio 서버 한 벌 — **여기 하나뿐이다.**

    ★CLI 마다 적는 자리가 다르다 (claude 는 파일, 코덱스는 실행 깃발). 담는 그릇이 다를 뿐
      내용은 같아야 하므로 값은 여기서만 만든다."""
    return {
        "command": sys.executable,
        "args": [str(Path(__file__).resolve().parent / "mcp_stdio.py")],
        "env": {"PEROPIX_BACKEND": backend},
    }


def mcp_config(data_dir: Path, backend: str) -> Path:
    """우리 도구를 여는 MCP 설정 — 켤 때마다 다시 쓴다 (백엔드 주소가 바뀔 수 있다)."""
    cfg = data_dir / "mcp.json"
    cfg.write_text(
        json.dumps({"mcpServers": {"peropix": {"type": "stdio", **mcp_spec(backend)}}}, ensure_ascii=False),
        encoding="utf-8",
    )
    return cfg


def toml_value(v) -> str:
    """TOML 값 한 조각 — 코덱스의 `-c <점표기>=<값>` 에 실어 보낸다.

    ★`json.dumps` 가 내는 문자열·배열은 **TOML 기본 문자열·배열과 같은 문법**이다.
      윈도우 경로의 역슬래시도 `\\\\` 로 이스케이프돼 그대로 살아남는다 (실측 2026-08-15).
      직접 따옴표를 붙이지 말 것 — 지침에 든 줄바꿈·따옴표에서 깨진다."""
    if isinstance(v, dict):
        return "{" + ", ".join(f"{k} = {json.dumps(x, ensure_ascii=False)}" for k, x in v.items()) + "}"
    return json.dumps(v, ensure_ascii=False)


class Runner:
    """한 번에 하나만 돈다 — 화면이 하나이므로 두 개가 동시에 앱을 만지면 뒤엉킨다.

    ★**프로세스는 서버의 이벤트 루프에서 띄우지 않는다** (실측 2026-08-12).
      uvicorn 0.38 은 `--reload`(개발용 핫리로드) 를 켜면 윈도우에서 **SelectorEventLoop** 를
      쓰는데(`Config.use_subprocess = reload or workers>1` → `asyncio_loop_factory`),
      그 루프에서 `create_subprocess_exec` 는 `NotImplementedError` 를 던진다.
      게다가 그 예외는 **메시지가 빈 문자열**이라, 화면에는 까닭 없이 「코드 -1」만 남았다.

      그래서 CLI 는 **자기 스레드에서 자기 루프**로 돈다 (윈도우면 Proactor). 서버가 어떤
      루프를 쓰든, uvicorn 이 또 바뀌든 상관없어진다. 흘러나온 것은 큐 하나로 서버 루프에
      넘겨 **순서 그대로** 내보낸다."""

    def __init__(self):
        self.proc: asyncio.subprocess.Process | None = None

    @property
    def busy(self) -> bool:
        return self.proc is not None and self.proc.returncode is None

    async def stop(self) -> None:
        p = self.proc
        if p and p.returncode is None:
            with __import__("contextlib").suppress(Exception):
                p.terminate()

    #: `claude --effort` 가 받는 단계 (실측: `claude --help` — low·medium·high·xhigh·max)
    EFFORTS = ["max", "xhigh", "high", "medium", "low"]

    def argv(self, cfg: Path, system: str = "", resume: str = "",
             model: str = "", effort: str = "") -> list[str]:
        """실행 깃발 — **여기 하나뿐이다.** 회귀(`test_lockdown_live.py`)도 이것을 그대로 쓴다."""
        args = [
            "-p",
            "--mcp-config", str(cfg),
            "--strict-mcp-config",
            "--allowedTools", "mcp__peropix__*",
            # ★`--allowedTools` 는 **자동 승인일 뿐 막지 않는다.** 실사용에서 에이전트가
            #   Read/Grep/Bash 로 우리 소스를 뒤지고 고치려 들었다. 이름으로 닫는다.
            "--disallowedTools",
            "Bash", "PowerShell", "BashOutput", "KillShell",
            "Read", "Write", "Edit", "NotebookEdit", "Glob", "Grep",
            "WebFetch", "WebSearch", "Task", "SlashCommand",
            # ★`Skill` 도 닫는다 — 바깥 지침을 문맥에 끌어들이는 통로다
            "Skill",
            # ★헤드리스에는 **답할 사람이 없다** — 물어 놓고 턴만 버린다 (실측 2026-08-08)
            "AskUserQuestion",
            # ★★**실제로 막는 것은 이것이다.** 위 목록은 이름을 하나씩 적는 것이라 새 도구가
            #   생기면 샌다 — 실측(2026-08-08)에서 에이전트가 `PowerShell` 을 시도했는데
            #   그 이름이 목록에 없었다. `dontAsk` 가 **허용 목록 밖을 묻지 않고 거절**해서
            #   막혔다. 목록은 보조일 뿐이니 이 깃발을 빼지 말 것.
            "--permission-mode", "dontAsk",
            "--output-format", "stream-json",
            "--verbose",
        ]
        # ★**이어 붙일 때는 지침을 다시 안 준다.** 세션에 이미 적용돼 있고, 다시 주면
        #   클로드 코드가 **다른 세션으로 갈라 버린다** — 그래서 2턴이 1턴을 기억 못 했다
        #   (실측 2026-08-08: 짧은 지침으로는 이어지고 긴 지침으로는 안 이어졌다).
        if system and not resume:
            args += ["--append-system-prompt", system]
        # ★이어 붙이기 — 없으면 새 대화가 된다 (「새 대화」가 이 값을 비운다)
        if resume:
            args += ["--resume", resume]
        # ★모델·추론 강도도 고를 수 있다 (사용자 지적 2026-08-08 — API 쪽에만 있었다).
        #   `--model` 은 별칭('sonnet'·'opus')도 전체 이름도 받는다. 비우면 CLI 기본값.
        if model:
            args += ["--model", model]
        if effort:
            args += ["--effort", effort]
        return args

    @staticmethod
    def codex_stdin(system: str, prompt: str, resume: str) -> str:
        """코덱스에 stdin 으로 넣을 것 — **첫 턴에만 지침이 앞에 붙는다.**

        ★argv 로 못 보내는 사정은 `argv_codex` 주석에 있다 (배치 래퍼가 `>` 를 삼킨다).
        ★이어 붙일 때 다시 안 붙이는 것은 claude 와 같은 이유다 — 이미 그 대화 안에 있다."""
        return f"{system}\n\n{prompt}" if system and not resume else prompt

    def argv_codex(self, spec: dict, resume: str = "",
                   model: str = "", effort: str = "") -> list[str]:
        """코덱스 실행 깃발 — **여기 하나뿐이다.** 전부 실측으로 확인했다 (2026-08-15, v0.147.0).

        클로드 코드와 같은 일을 하는 깃발이 이름만 다르다:

            --strict-mcp-config   →  --ignore-user-config   사용자의 다른 MCP 서버를 안 싣는다
            --mcp-config <파일>   →  -c mcp_servers.…       설정 파일이 아니라 깃발로 준다
            --permission-mode     →  -c approval_policy=never
            --append-system-prompt→  -c developer_instructions=…
            --resume <id>         →  exec resume <id> -
            --output-format …     →  --json                 (줄 단위 JSON)

        ★`--ignore-user-config` 는 **인증은 그대로 둔다** (도움말 원문: "auth still uses
          CODEX_HOME"). claude 의 `--bare` 와 다르다 — 그쪽은 OAuth 를 안 읽어 API 키를 요구했다.
          이 PC 에 사용자의 MCP 서버가 둘(node_repl·pencil) 붙어 있어 실제로 필요하다.
        ★★`default_tools_approval_mode="approve"` 가 **없으면 도구가 안 돈다.** 헤드리스라
          물어볼 사람이 없어서 코덱스가 스스로 취소한다 — 실측에서 도구 결과가
          `"user cancelled MCP tool call"` 로 돌아왔다. `approval_policy=never` 는 셸 쪽이라
          MCP 도구를 덮지 않는다. 뺄 수 없는 줄이다.
        ★`enabled_tools` 는 **일부러 안 쓴다.** 우리 서버는 우리 도구만 내보내므로 목록을
          여기 또 적으면 `/api/agent/tools` 와 두 벌이 된다.
        ★`--skip-git-repo-check` 가 필요하다 — 작업 폴더(`data/agent`)는 깃 저장소가 아니다.
        ★이어 붙일 때는 `-s/--sandbox` 를 **못 쓴다** (resume 도움말에 없다). 그래서 모래상자는
          언제나 `-c sandbox_mode` 로 건다 — 두 경로가 같은 값을 쓰게.
        ★셸 도구는 **끄지 않았다** (사용자와 미결). 끄려면 `--disable shell_tool`.

        ★★**지침은 여기 안 싣는다 — stdin 으로 보낸다** (실측 2026-08-15, 실연동에서 밟았다).
          `-c developer_instructions=…` 는 되기는 하는데, npm 이 깔아 준 `codex.CMD` 가
          **배치 파일**이라 윈도우가 `cmd.exe /c` 를 한 겹 끼운다. 그러면 cmd 가 명령줄을
          **다시 해석**해서, 지침에 든 `long_hair -> long hair` 의 `>` 가 **출력 리다이렉션**이
          된다. 실제로 JSON 이 통째로 `data/agent/long` 이라는 파일로 새고, 화면에는 아무것도
          안 오는데 종료 코드는 0 이었다 (가장 나쁜 종류의 조용한 실패다).
          그래서 **긴 사람 글은 argv 에 절대 싣지 않는다.** 여기 남은 값은 우리가 정한 짧은
          것들(경로·모델 이름·숫자)뿐이다."""
        flags = [
            "--json",
            "--ignore-user-config",
            "--skip-git-repo-check",
            # ★셸을 끈다 (사용자 결정 2026-08-15). `shell_tool` 은 stable 등급 기능 플래그이고
            #   기본이 켜짐이다 (`codex features list`). 모래상자가 읽기 전용이라 고칠 수는
            #   없었지만, 켜 두면 조수가 우리 소스를 **읽으며 턴을 쓴다** — 클로드 코드 쪽에서
            #   실제로 겪은 일이라 거기서도 이름으로 닫아 뒀다(`argv` 의 --disallowedTools).
            "--disable", "shell_tool",
            "-c", "sandbox_mode=" + toml_value("read-only"),
            "-c", "approval_policy=" + toml_value("never"),
            "-c", "mcp_servers.peropix.command=" + toml_value(spec["command"]),
            "-c", "mcp_servers.peropix.args=" + toml_value(spec["args"]),
            "-c", "mcp_servers.peropix.env=" + toml_value(spec["env"]),
            "-c", "mcp_servers.peropix.default_tools_approval_mode=" + toml_value("approve"),
            # 파이썬이 뜨고 백엔드에 도구 목록을 물어 오는 데 걸리는 시간
            "-c", "mcp_servers.peropix.startup_timeout_sec=30",
        ]
        if model:
            flags += ["-m", model]
        if effort:
            flags += ["-c", "model_reasoning_effort=" + toml_value(effort)]
        # ★프롬프트는 stdin 이다. 이어 붙일 때는 `-` 를 **적어야** stdin 을 읽는다
        #   (안 적으면 프롬프트 없이 이어 붙이고 끝난다).
        if resume:
            return ["exec", "resume", resume, "-", *flags]
        return ["exec", *flags]

    async def run(
        self, exe: str, prompt: str, cfg: Path, cwd: Path, system: str, emit, resume: str = "",
        model: str = "", effort: str = "", agent: str = "claude-code", backend: str = "",
    ) -> None:
        """CLI 를 띄우고 흘러나오는 JSON 을 한 줄씩 `emit` 으로 넘긴다.

        ★`cwd` 는 **빈 폴더**여야 한다(`work_dir()`). 조수가 우리 소스를 뒤지고 고치려 든
          적이 있는데, 그것을 실제로 막는 것은 폴더 위치가 아니라 `argv()` 의 도구 잠금이다
          (`--disallowedTools` · `--permission-mode dontAsk`).

        ★프로세스는 **다른 스레드의 다른 루프**에서 돈다 (클래스 머리 주석). 여기서는
          그 스레드가 넘겨 준 것을 큐에서 꺼내 `emit` 할 뿐이다.

        ★흘러나오는 **모양은 CLI 마다 다르다** (claude 는 stream-json, 코덱스는 줄 단위 JSON).
          여기서는 옮겨 적지 않는다 — 그대로 화면에 넘기고 `llm.ts` 가 wire 조각으로 바꾼다."""
        codex = agent == "codex"
        args = (
            self.argv_codex(mcp_spec(backend), resume, model, effort)
            if codex
            else self.argv(cfg, system, resume, model, effort)
        )
        # ★코덱스는 지침도 stdin 으로 간다 (`codex_stdin` 주석 — 배치 래퍼가 argv 를 삼킨다)
        if codex:
            prompt = self.codex_stdin(system, prompt, resume)
        main = asyncio.get_running_loop()
        q: asyncio.Queue = asyncio.Queue()

        # ★큐를 한 줄로 비운다 — `emit` 은 await 라, 스레드에서 곧바로 여러 개를 태우면
        #   중간에 끼어들어 **순서가 뒤집힌다**. 스트림은 순서가 곧 내용이다.
        async def pump():
            while True:
                ev = await q.get()
                if ev is None:
                    return
                await emit(ev)

        drain = asyncio.create_task(pump())
        try:
            await asyncio.to_thread(
                self._drive, exe, args, str(cwd), prompt,
                lambda ev: main.call_soon_threadsafe(q.put_nowait, ev),
            )
        finally:
            q.put_nowait(None)
            await drain
            # ★★**끝을 알리는 것은 여기다** — 자리를 비운 **뒤에**. 화면은 `exit` 을 보면
            #   곧바로 다음 턴을 시작할 수 있는데(도는 중에 쌓아 둔 말), 프로세스를 놓기
            #   전에 알리면 그 요청이 「이미 돌고 있습니다」(409)로 튕긴다.
            code = self.proc.returncode if self.proc else -1
            self.proc = None
            await emit({"type": "exit", "code": code})

    def _drive(self, exe: str, args: list[str], cwd: str, prompt: str, hand) -> None:
        """**자기 루프**를 세워 거기서 프로세스를 돌린다 (다른 스레드에서 불린다)."""
        loop = asyncio.ProactorEventLoop() if os.name == "nt" else asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(self._pipe(exe, args, cwd, prompt, hand))
        finally:
            asyncio.set_event_loop(None)
            loop.close()

    async def _pipe(self, exe: str, args: list[str], cwd: str, prompt: str, hand) -> None:
        # ★`ask_user` 가 사람을 기다리는 동안 MCP 가 끊기지 않게 (페로툰도 같은 자리를 늘렸다)
        env = {**os.environ, "MCP_TIMEOUT": "1800000"}
        self.proc = await asyncio.create_subprocess_exec(
            exe,
            *args,
            cwd=cwd,
            env=env,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        p = self.proc
        # ★프롬프트는 stdin 으로 — 윈도우 argv 는 32KB 언저리에서 잘린다
        assert p.stdin is not None
        p.stdin.write(prompt.encode("utf-8"))
        await p.stdin.drain()
        p.stdin.close()

        async def pump_err():
            assert p.stderr is not None
            async for line in p.stderr:
                t = line.decode("utf-8", "replace").rstrip()
                if t:
                    hand({"type": "stderr", "text": t})

        err = asyncio.create_task(pump_err())
        assert p.stdout is not None
        async for raw in p.stdout:
            line = raw.decode("utf-8", "replace").strip()
            if not line.startswith("{"):
                continue
            try:
                hand(json.loads(line))
            except Exception:
                continue
        await p.wait()
        # ★죽은 까닭은 stderr 에 있다 — 잘라 버리지 말고 **끝까지 받는다.**
        #   프로세스가 끝났으니 파이프는 곧 EOF 다 (그래도 멎지 않게 시간 제한을 둔다).
        #   ★`exit` 는 여기서 안 낸다 — `run` 이 자리를 비운 뒤에 낸다 (그쪽 주석).
        with __import__("contextlib").suppress(Exception):
            await asyncio.wait_for(err, 2)
        err.cancel()
