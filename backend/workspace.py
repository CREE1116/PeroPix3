"""워크스페이스 저장 — docs/renewal/schema.md 구현.

구조:
    workspaces/<워크스페이스>/
      workspace.json     ← spec (의도. 사람·LLM 이 편집)
      records.jsonl      ← 사실 (코드만 쓴다, append-only)
      output/싱글/<탭>/*.png              ← 생성물 = 원본. 앱이 자동으로 지우지 않는다
      output/멀티/<캐릭터>/<포즈세트>/*.png
      work/<탭>/<셀>/*.png                ← ★옛 경로. **읽기만** 한다 (아래 out_dir 주석)

★records.jsonl 은 인덱스이지 정본이 아니다. 정본은 PNG 메타데이터다.
  손상되면 이미지 폴더를 훑어 재구축할 수 있어야 한다.
"""
from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path

import thumbs
import trash

SPEC_NAME = "workspace.json"
RECORDS_NAME = "records.jsonl"
#: ★★**무거운 것은 따로 둔다** (사용자 결정 2026-08-22).
#:
#:  `records.jsonl` 은 화면이 워크스페이스를 열 때마다 통째로 읽는 **색인**인데, 한 줄에
#:  `resolved`(그때 NAI 로 나간 페이로드 — 바이브·베이스 그림의 base64)와 `env`(그때의 화면
#:  구조)가 같이 들어 있어 **줄당 평균 15.9KB · 883줄에 13.7MB** 였다 (실측 2026-08-22).
#:  화면이 실제로 쓰는 것은 줄당 **211B** 뿐이라 99%가 읽고 버리는 값이었고, 그래서
#:  「마지막 500줄만 읽는다」는 제한이 걸려 있었다 — 그 제한 때문에 **한 세트가 500칸의
#:  대부분을 먹으면 다른 세트의 그림이 화면에서 사라졌다** (사용자 지적).
#:
#:  ★그림 폴더에는 **아무것도 안 만든다.** 그림 한 장에 파일 하나씩 붙이면 탐색기로 그림을
#:    보는 자리가 지저분해진다 (사용자 지적) — 워크스페이스당 파일 **하나**만 는다.
#:  ★성질은 그대로 append-only JSONL 이다: 사람이 읽을 수 있고, 쓰다 죽어도 앞줄은 온전하다.
ENV_NAME = "records-env.jsonl"
#: 색인에서 빼고 곁파일로 보내는 필드
HEAVY_KEYS = ("resolved", "env")
#: 쪼개기 전 원본을 한 번 남긴다 (지워도 앱은 돈다 — 되살릴 때만 쓴다)
PRESPLIT_NAME = "records-before-split.jsonl"
WORK_DIR = "work"      # ★옛 경로 (읽기 전용)
OUT_DIR = "output"     # 생성물이 사는 곳 (사용자 결정 2026-08-08)
#: ★그 아래 한 겹. 「싱글/멀티」로 갈리던 시절의 이름이 그대로 남은 것이다 —
#:  갈래는 2026-08-24 에 없어졌고(`out_dir` 의 ★★주) 이름만 **호환을 위해** 둔다.
#:  바꾸면 이미 만든 그림과 새 그림이 두 폴더로 갈린다.
MULTI_DIR = "멀티"
# 파생 썸네일 캐시 — 원본에서 자동으로 굽는다. 지워도 다시 생긴다 (thumbs.py 참조)
THUMB_DIR = ".thumbs"

_SAFE = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def safe_name(s: str, fallback: str = "무제") -> str:
    """폴더명으로 쓸 수 있게. 경로 탈출을 막는 것이 주 목적이다."""
    s = _SAFE.sub("_", (s or "").strip()).strip(". ")
    return s[:80] or fallback


def safe_tag(s: str, max_length: int = 100) -> str:
    """**파일 이름 안에 넣을 이름 조각** — v2 `sanitize_filename`(backend.py:1396) 그대로다.

    글자·숫자·밑줄·하이픈만 남기고(파이썬 `\\w` 는 한글을 포함한다) 공백은 밑줄로 바꾼다.
    ★v2 의 `else "vibe"` 폴백은 **안 가져온다** — 그 함수가 원래 vibe 캐시 이름을 짓던
      것이라 붙은 값이고, 씬 이름에 쓰면 이름 없는 씬이 전부 `vibe` 가 된다.
      여기서는 빈 문자열을 돌려주고, 부르는 쪽이 "이름이 없다"로 다룬다.
    ★v2 는 앞에서 `Path(name).stem` 으로 확장자를 떼는데 **그것도 안 가져온다** — 씬 이름은
      파일 이름이 아니라서, 「1.5배 컷」 같은 이름이 `1` 한 글자로 잘린다 (실측으로 확인).
    ★`next_name` 이 접두로 `glob` 을 돌리므로 `[`·`?` 같은 글자가 남으면 안 된다 —
      위 규칙이 이미 다 걷어낸다."""
    s = re.sub(r"[^\w\s-]", "", (s or "").strip(), flags=re.UNICODE)
    return s.strip().replace(" ", "_")[:max_length]


def file_lead(cell_no: int | None, cell: str | None, exclude_no: bool) -> str:
    """생성물 파일 이름의 **앞 조각** — `<번호>_<씬 이름>` (v2 `backend.py:2737-2746`).

        번호+이름   003_수영복_001.png
        이름만      수영복_001.png        ← 「파일 이름에서 씬 번호 빼기」
        번호만      003_001.png           ← 씬 이름이 비었거나 쓸 수 없는 글자뿐일 때
        없음        001.png               ← 씬이 없는 싱글 탭

    ★★「씬 번호 빼기」는 v2 와 같이 **번호만** 뺀다 (사용자 결정 2026-08-18, v2-port-audit D3).
      예전에는 이름이 아예 안 들어가서, 번호를 빼면 그 폴더의 **모든 씬이 한 번호열을 공유**했다
      (`next_name` 이 접두마다 세기 때문이다).
    ★번호는 **순번을 세는 열쇠**이기도 하다 — 이름을 바꾸면 그 씬의 번호열이 1부터 다시
      시작한다. v2 도 같다 (category 에 이름이 들어간다)."""
    tag = safe_tag(cell or "")
    if exclude_no:
        return tag
    no = f"{cell_no:03d}" if cell_no else ""
    return "_".join(x for x in (no, tag) if x)


class Store:
    def __init__(self, root: Path):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)

    # ── 워크스페이스 ──────────────────────────────────────────
    def dir_of(self, ws: str) -> Path:
        return self.root / safe_name(ws)

    def list(self) -> list[dict]:
        out = []
        for d in sorted(self.root.iterdir()) if self.root.exists() else []:
            # ★점으로 시작하는 것은 우리 내부 폴더다 — 워크스페이스인 척하면 안 된다
            if not d.is_dir() or d.name.startswith("."):
                continue
            spec = d / SPEC_NAME
            if spec.exists():
                try:
                    s = json.loads(spec.read_text(encoding="utf-8"))
                    out.append({"name": d.name, "id": s.get("id"), "updatedAt": s.get("updatedAt")})
                    continue
                except Exception:
                    pass
            out.append({"name": d.name, "id": None, "updatedAt": None})
        return out

    def load(self, ws: str) -> dict | None:
        p = self.dir_of(ws) / SPEC_NAME
        if not p.exists():
            return None
        return json.loads(p.read_text(encoding="utf-8"))

    def save(self, ws: str, spec: dict) -> dict:
        d = self.dir_of(ws)
        d.mkdir(parents=True, exist_ok=True)
        spec["updatedAt"] = datetime.now().isoformat(timespec="seconds")
        # 임시 파일에 쓴 뒤 교체 — 쓰는 중 앱이 죽어도 기존 파일이 남는다
        tmp = d / (SPEC_NAME + ".tmp")
        tmp.write_text(json.dumps(spec, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(d / SPEC_NAME)
        return spec

    def rename(self, old: str, new: str) -> str:
        a, b = self.dir_of(old), self.dir_of(new)
        if a.exists() and not b.exists():
            a.rename(b)
        return b.name

    def delete(self, ws: str) -> dict:
        """워크스페이스를 **휴지통으로** (사용자 결정 2026-08-18, v2-port-audit D7).

        ★예전에는 `rmtree` 였다 — 이 앱에서 가장 크게 없어지는 동작인데 되돌릴 길이 없었다.
          휴지통은 `workspaces/.trash` 다 (워크스페이스 자신의 것은 함께 담겨 간다)."""
        d = self.dir_of(ws)
        if not d.exists():
            return {"deleted": [], "trashed": []}
        r = trash.send_at(self.root, [d.name])
        return {"deleted": [m["file"] for m in r["moved"]], "trashed": r["moved"]}

    def restore_ws(self, entries: list[dict]) -> dict:
        return trash.restore_at(self.root, entries)

    # ── 생성물 ────────────────────────────────────────────────
    def work_dir(self, ws: str, set_name: str, cell: str | None = None) -> Path:
        """옛 경로 (`work/<탭>/<셀>`). ★새로 만드는 그림은 `out_dir` 로 간다 —
        이미 있는 그림을 읽는 쪽(갤러리·썸네일)이 이 경로를 계속 쓴다."""
        p = self.dir_of(ws) / WORK_DIR / safe_name(set_name)
        if cell:
            p = p / safe_name(cell)
        p.mkdir(parents=True, exist_ok=True)
        return p

    def out_dir(self, ws: str, set_name: str, tab_name: str | None = None) -> Path:
        """저장 자리 — **그림이 앉는 슬롯의 자리**를 그대로 따른다.

            <ws>/output/멀티/<탭>/<세트>/       <씬번호>_<씬이름>_<순번>.png

        ★★**「싱글」 갈래를 걷어냈다** (사용자 지시 2026-08-24: *"싱글이라는 개념은 없어졌음.
          싱글에 저장하는 것 자체가 레거시가 남아있는 이슈"*). 2026-08-11 에 싱글 탭이
          없어졌는데 저장 자리만 그 갈래를 들고 있어서, 씬을 못 찾은 그림(강화·옛 경로로 온
          것)이 `싱글/` 로 떨어져 **그림이 나온 자리와 다른 폴더**에 쌓였다.
          이제 갈래가 하나다 — 씬 이름·번호를 모르면 **파일 이름 앞이 비는 것**으로 끝나고,
          폴더는 언제나 그 그림이 속한 탭·세트다.
        ★`output/` 아래로 내린 것은 **워크스페이스 안이 정리되게** 하기 위해서다
          (사용자 지시 2026-08-08). 옛 경로(`싱글/`·`멀티/`·`work/`)의 그림은 **옮기지 않는다** —
          records 의 상대경로와 썸네일 tid 가 통째로 바뀌어 꽂아 둔 커버가 깨진다.
          읽는 쪽은 상대경로를 그대로 쓰므로 옛것도 계속 보인다.
        ★`멀티/` 라는 이름도 그 시절의 자국이지만 **그대로 둔다** — 폴더 이름을 바꾸면
          이미 만든 그림과 새 그림이 두 폴더로 갈린다 (`CLAUDE.md` 「저장 경로」 절).
        ★씬 폴더를 만들지 않는다 — 씬은 **파일 이름 앞의 번호**다. 그래야 탐색기에서 한 세트가
          한자리에 모이고 씬 순서대로 정렬된다 (페로픽스파이 `001_이름_00001_.png` 과 같은 취지).
        ★탭·세트 이름이 없으면(옛 세션·이름을 못 받은 경우) 그 칸을 건너뛴다 — 「무제」 같은
          폴더를 지어내면 그 이름의 진짜 세트와 섞인다."""
        p = self.dir_of(ws) / OUT_DIR / MULTI_DIR
        if tab_name:
            p = p / safe_name(tab_name)
        if set_name:
            p = p / safe_name(set_name)
        p.mkdir(parents=True, exist_ok=True)
        return p

    def next_name(self, d: Path, prefix: str, fmt: str, ws: str | None = None) -> Path:
        """그 폴더에서 **다음 순번**. 시각이 아니라 순번이라 만든 차례가 그대로 보인다.
        ★번호는 **접두마다 따로** 센다 — 멀티에서 슬롯 1의 3장과 슬롯 2의 3장이
        각각 001~003 이 되어야 슬롯 안에서 몇 번째인지 읽힌다.

        ★★**휴지통에 든 것도 센다** (`ws` 를 준 경우, 사용자 지적 2026-08-20).
          지우면 파일이 `.trash/<시각>/<원래 경로>` 로 **옮겨져** 그 이름이 폴더에서 비고,
          다음 생성이 **같은 경로**를 다시 쓴다. 그런데 앱은 여러 곳에서 **경로를 그림의
          신원**으로 쓴다 — 레코드 중복 판정 · 「지운 것」·「별표」 목록. 그래서 새 그림이
          옛 그림의 표식을 물려받아, 방금 만든 것이 **화면에 아예 안 뜬다.**
          (실측: 씬 삭제 → 이미지 삭제 → 씬 다시 생성 → 1장 생성 → 파일은 생겼는데 안 보임.
           레코드 두 줄의 `file` 이 똑같았다.)
          번호를 건너뛰는 편이 낫다 — 되돌리기(`restore`)로 옛 파일이 제자리에 돌아와도
          이름이 겹치지 않는다."""
        head = f"{prefix}_" if prefix else ""
        used = 0
        spots = [d]
        names: list[str] = []
        if ws:
            base = self.dir_of(ws)
            try:
                rel = d.relative_to(base)
            except ValueError:
                rel = None
            if rel is not None:
                troot = trash.trash_root(base)
                # ★옛 묶음 폴더(`<지운 시각>/<원래 경로>`)가 아직 남아 있을 수 있다
                if troot.is_dir():
                    spots += [b / rel for b in troot.iterdir() if b.is_dir()]
                # ★★휴지통이 **평평해진 뒤**로는 원래 자리를 장부가 안다 (`trash` 머리 주석,
                #   2026-08-23). 파일 이름만 보면 다른 폴더에서 버린 같은 이름까지 세므로
                #   **적힌 원래 경로의 폴더가 여기와 같을 때만** 센다.
                here = rel.as_posix()
                for row in trash.read_index(troot):
                    f = str(row.get("file") or "")
                    at = f.rsplit("/", 1)
                    if len(at) == 2 and at[0] == here:
                        names.append(at[1])
        for spot in spots:
            if not spot.is_dir():
                continue
            names += [f.name for f in spot.glob(f"{head}*")]
        for name in names:
            stem = name.rsplit(".", 1)[0]
            if not stem.startswith(head):
                continue
            part = stem[len(head):].split("_")[0]
            if part.isdigit():
                used = max(used, int(part))
        return d / f"{head}{used + 1:03d}.{fmt}"

    def rel(self, ws: str, path: Path) -> str:
        return path.relative_to(self.dir_of(ws)).as_posix()

    def store_output(
        self,
        ws: str,
        set_name: str,
        cell: str | None,
        cell_no: int | None,
        tab_name: str | None,
        exclude_no: bool,
        fmt: str,
        data: bytes,
    ) -> str:
        """생성물을 **자리에 앉히고** 상대경로를 돌려준다 — ★이름 규칙의 **유일한 창구**다.

        자리는 `out_dir` 하나가 정한다 (`output/멀티/<탭>/<세트>/`). 씬 폴더 대신 **파일 앞
        씬 번호**를 쓰고, 이름은 시각이 아니라 **순번**이다 (`file_lead`).

        부르는 곳이 셋이다 — 평소 생성(`_generate_one`) · 미저장 그림의 「파일로 저장」
        (`/api/save-preview`) · 「새 탭으로 복제」(`copy_to_set`). 두 벌이 되면 번호열이
        갈린다: `next_name` 은 **접두마다 따로** 세므로, 한쪽만 `file_lead` 를 다르게 지으면
        같은 폴더 안에서 번호가 겹치거나 건너뛴다."""
        # ★씬을 몰라도 **자리는 같다** — 비는 것은 파일 이름 앞뿐이다 (`out_dir` 의 ★★주)
        d = self.out_dir(ws, set_name, tab_name)
        lead = file_lead(cell_no, cell, exclude_no)
        path = self.next_name(d, lead, fmt, ws)
        path.write_bytes(data)
        return self.rel(ws, path)

    def append_record(self, ws: str, rec: dict) -> None:
        """레코드 한 줄. ★무거운 것은 **곁파일로 갈라** 적는다 (`ENV_NAME` 머리 주석).

        ★순서가 안전장치다: **곁파일을 먼저** 적는다. 거꾸로 하면 그 사이에 죽었을 때
          색인에는 있는데 무거운 것이 없는 그림이 생긴다 (「새 탭으로 복제」가 조용히 빈손이 된다).
          반대로 곁파일만 남는 것은 해가 없다 — 아무도 안 찾는 줄일 뿐이다."""
        d = self.dir_of(ws)
        d.mkdir(parents=True, exist_ok=True)
        heavy = {k: rec[k] for k in HEAVY_KEYS if rec.get(k) is not None}
        if heavy:
            with (d / ENV_NAME).open("a", encoding="utf-8") as f:
                f.write(json.dumps({"file": rec.get("file"), **heavy}, ensure_ascii=False) + "\n")
        light = {k: v for k, v in rec.items() if k not in HEAVY_KEYS}
        with (d / RECORDS_NAME).open("a", encoding="utf-8") as f:
            f.write(json.dumps(light, ensure_ascii=False) + "\n")

    def records(self, ws: str, limit: int = 0) -> list[dict]:
        """색인 전체. ★**제한이 없다** (사용자 결정 2026-08-22) — 무거운 것을 곁파일로 뺀 뒤로
        줄당 211B 라 전부 읽어도 싸다. `limit` 은 옛 부르는 쪽을 위해 남겨 둔 것이다.

        ★쪼개지기 전에 적힌 줄이 섞여 있을 수 있다 (마이그레이션 전 · 옛 백업을 되돌린 경우).
          그 줄에는 무거운 것이 그대로 들어 있으므로 **여기서 걷어 낸다** — 부르는 쪽은
          언제나 가벼운 줄만 본다."""
        p = self.dir_of(ws) / RECORDS_NAME
        if not p.exists():
            return []
        lines = p.read_text(encoding="utf-8").splitlines()
        if limit > 0:
            lines = lines[-limit:]
        out = []
        for ln in lines:
            try:
                r = json.loads(ln)
            except Exception:
                continue  # 깨진 줄은 건너뛴다 — 인덱스일 뿐이다
            for k in HEAVY_KEYS:
                r.pop(k, None)
            out.append(r)
        return out

    def heavy_of(self, ws: str, file: str) -> dict:
        """그 그림의 **무거운 것**(`resolved`·`env`). 없으면 빈 것.

        ★찾는 자리는 곁파일이고, **뒤에서부터** 본다 (같은 경로가 여러 번 적혔으면 마지막 것).
        ★파싱하기 전에 **경로 문자열이 그 줄에 있는지**부터 본다 — 줄 하나가 수십 KB 라
          전부 파싱하면 느리다.
        ★곁파일에 없으면 색인의 옛 줄을 되짚는다 (쪼개지기 전에 적힌 그림)."""
        d = self.dir_of(ws)
        for name in (ENV_NAME, RECORDS_NAME):
            p = d / name
            if not p.exists():
                continue
            for ln in reversed(p.read_text(encoding="utf-8").splitlines()):
                if file not in ln:
                    continue
                try:
                    r = json.loads(ln)
                except Exception:
                    continue
                if r.get("file") != file:
                    continue
                got = {k: r[k] for k in HEAVY_KEYS if r.get(k) is not None}
                if got:
                    return got
        return {}

    def split_records(self, ws: str) -> int:
        """색인에 남아 있는 무거운 것을 곁파일로 옮긴다. 옮긴 줄 수를 돌려준다.

        ★**한 번만 돈다.** 무거운 것이 든 줄이 하나도 없으면 아무 일도 안 한다.
        ★원본을 `records-before-split.jsonl` 로 한 번 남긴다 — 이 앱은 사용자 그림 기록을
          잃은 적이 있어(CLAUDE.md) 되돌릴 자리를 둔다. 지워도 앱은 돈다.
        ★임시 파일에 쓰고 rename 한다 — 쓰다 죽어도 옛 파일이 온전하다.
        ★부르는 자리는 **서버가 요청을 받기 전**이다 (`server.py` 부팅) — 그래서 옮기는 도중에
          새 그림이 끼어들 수 없다. 생성 중이어도 앱을 다시 켜기만 하면 된다."""
        d = self.dir_of(ws)
        p = d / RECORDS_NAME
        if not p.exists():
            return 0
        lines = p.read_text(encoding="utf-8").splitlines()
        heavy_lines, light_lines, moved = [], [], 0
        for ln in lines:
            try:
                r = json.loads(ln)
            except Exception:
                light_lines.append(ln)   # 깨진 줄은 손대지 않고 그대로 둔다
                continue
            heavy = {k: r[k] for k in HEAVY_KEYS if r.get(k) is not None}
            if heavy:
                moved += 1
                heavy_lines.append(
                    json.dumps({"file": r.get("file"), **heavy}, ensure_ascii=False))
                r = {k: v for k, v in r.items() if k not in HEAVY_KEYS}
            light_lines.append(json.dumps(r, ensure_ascii=False))
        if not moved:
            return 0

        (d / PRESPLIT_NAME).write_text("\n".join(lines) + "\n", encoding="utf-8")
        env_tmp = d / (ENV_NAME + ".tmp")
        # ★이미 곁파일이 있으면 **앞에 잇는다** — 새로 적힌 줄이 뒤에 와야 마지막 것이 이긴다
        old_env = (d / ENV_NAME).read_text(encoding="utf-8").splitlines() if (d / ENV_NAME).exists() else []
        env_tmp.write_text("\n".join(heavy_lines + old_env) + "\n", encoding="utf-8")
        env_tmp.replace(d / ENV_NAME)
        idx_tmp = d / (RECORDS_NAME + ".tmp")
        idx_tmp.write_text("\n".join(light_lines) + "\n", encoding="utf-8")
        idx_tmp.replace(p)
        return moved

    def thumb_path(self, ws: str, rel: str) -> Path | None:
        """생성물의 **파생 썸네일**. 히스토리 줄·셀 그리드가 이걸 쓴다.

        ★캐시다 — `.thumbs/` 를 통째로 지워도 다음 요청에 다시 구워진다.
          원본이 더 새로우면(같은 경로에 다른 그림) 자동으로 다시 굽는다."""
        src = self.file_path(ws, rel)
        if not src:
            return None
        return thumbs.derive(src, self.dir_of(ws) / THUMB_DIR / thumbs.flat_name(rel))

    def file_path(self, ws: str, rel: str) -> Path | None:
        """워크스페이스 밖으로 나가는 경로를 막는다."""
        base = self.dir_of(ws).resolve()
        p = (base / rel).resolve()
        if not str(p).startswith(str(base)) or not p.exists():
            return None
        return p

    # ── 새 탭으로 복제 ────────────────────────────────────────
    def copy_to_set(
        self,
        ws: str,
        file: str,
        set_name: str,
        set_id: str | None,
        cell: str | None,
        cell_id: str | None,
        cell_no: int | None,
        tab_name: str | None,
        exclude_no: bool,
        src_path: Path | None = None,
        seed: int | None = None,
    ) -> dict:
        """그림 한 장을 **같은 워크스페이스의 다른 탭**으로 복사한다 (원본은 그대로).

        「새 탭으로 복제」가 부르는 자리다 (사용자 결정 2026-08-18). 옛 「다른 탭으로 복제」는
        싱글 폴더에 넣었는데 싱글 탭이 없어져 갈 곳이 사라졌다 — 그 경로를 지우고 이것으로 합쳤다.

        ★옮기지 않고 **복사**한다. 원본이 그대로라 보던 화면·선택이 흐트러지지 않는다.
        ★이름·자리는 `store_output` 하나가 정한다 — 보통 생성과 같은 규칙이라야 받는 씬의
          번호열이 어긋나지 않는다.
        ★레코드에 `set_id`·`cell_id` 를 함께 쓴다 — 받는 세트가 `idOnly` 라 그것이 없으면
          복사해 놓고 화면 어디에도 안 뜬다 (`lib/takes.ts`).

        ★`src_path` 는 **워크스페이스 밖의 원본**이다 (보관함 그림). 갤러리의
          「새 탭으로 복제」도 그림이 슬롯에 앉아야 해서 같은 자리를 쓴다 (사용자 지시
          2026-08-19: *"슬롯에서 복제할때랑 동일한 로직 사용해"*). 그때는 이 워크스페이스에
          그 파일의 레코드가 없으므로 **시드도 밖에서 받는다**(`seed`, 메타데이터에서 읽은 값)."""
        src = src_path or self.file_path(ws, file)
        if not src or not src.is_file():
            raise ValueError("복제할 그림을 찾지 못했습니다")
        old = next(
            (r for r in reversed(self.records(ws, limit=100000)) if r.get("file") == file),
            {},
        )
        fmt = src.suffix.lstrip(".").lower() or "png"
        rel = self.store_output(ws, set_name, cell, cell_no, tab_name, exclude_no, fmt, src.read_bytes())
        # ★`resolved`(그때 나간 페이로드)와 `enhance_of` 는 안 싣는다. resolved 는 바이브·베이스
        #   그림의 base64 가 들어 있어 크고, enhance_of 는 **다른 탭의 파일**을 가리키는
        #   출처 기록이라 옮겨 오면 뜻이 어긋난다 (`/api/save-preview` 와 같은 판단).
        rec = {
            "ts": datetime.now().isoformat(timespec="seconds"),
            "file": rel,
            "set": set_name,
            "cell": cell,
            "set_id": set_id,
            "cell_id": cell_id,
            "enhance_of": None,
            "seed": int(seed if seed is not None else (old.get("seed") or 0)),
        }
        self.append_record(ws, rec)
        return {"ok": True, "file": rel, "record": rec}
