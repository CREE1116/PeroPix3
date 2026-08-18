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
WORK_DIR = "work"      # ★옛 경로 (읽기 전용)
OUT_DIR = "output"     # 생성물이 사는 곳 (사용자 결정 2026-08-08)
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
    def work_dir(self, ws: str, tab: str, cell: str | None = None) -> Path:
        """옛 경로 (`work/<탭>/<셀>`). ★새로 만드는 그림은 `out_dir` 로 간다 —
        이미 있는 그림을 읽는 쪽(갤러리·썸네일)이 이 경로를 계속 쓴다."""
        p = self.dir_of(ws) / WORK_DIR / safe_name(tab)
        if cell:
            p = p / safe_name(cell)
        p.mkdir(parents=True, exist_ok=True)
        return p

    def out_dir(self, ws: str, tab: str, is_set: bool, char: str | None = None) -> Path:
        """저장 자리 — ★**싱글과 멀티를 갈라 놓는다** (사용자 지시 2026-08-04).

            <ws>/output/싱글/<탭>/                    <순번>.png
            <ws>/output/멀티/<캐릭터>/<포즈세트>/       <포즈번호>_<순번>.png

        ★`output/` 아래로 내린 것은 **워크스페이스 안이 정리되게** 하기 위해서다
          (사용자 지시 2026-08-08). 옛 경로(`싱글/`·`멀티/`·`work/`)의 그림은 **옮기지 않는다** —
          records 의 상대경로와 썸네일 tid 가 통째로 바뀌어 꽂아 둔 커버가 깨진다.
          읽는 쪽은 상대경로를 그대로 쓰므로 옛것도 계속 보인다.

        멀티는 슬롯 폴더를 만들지 않는다 — 슬롯은 **파일 이름 앞의 번호**다.
        그래야 탐색기에서 한 세트가 한자리에 모이고 슬롯 순서대로 정렬된다
        (페로픽스파이 `001_이름_00001_.png` 과 같은 취지).
        ★캐릭터가 없으면(옛 세션) 그 칸을 건너뛴다."""
        p = self.dir_of(ws) / OUT_DIR / ("멀티" if is_set else "싱글")
        if is_set and char:
            p = p / safe_name(char)
        p = p / safe_name(tab)
        p.mkdir(parents=True, exist_ok=True)
        return p

    def next_name(self, d: Path, prefix: str, fmt: str) -> Path:
        """그 폴더에서 **다음 순번**. 시각이 아니라 순번이라 만든 차례가 그대로 보인다.
        ★번호는 **접두마다 따로** 센다 — 멀티에서 슬롯 1의 3장과 슬롯 2의 3장이
        각각 001~003 이 되어야 슬롯 안에서 몇 번째인지 읽힌다."""
        head = f"{prefix}_" if prefix else ""
        used = 0
        for f in d.glob(f"{head}*"):
            part = f.stem[len(head):].split("_")[0]
            if part.isdigit():
                used = max(used, int(part))
        return d / f"{head}{used + 1:03d}.{fmt}"

    def rel(self, ws: str, path: Path) -> str:
        return path.relative_to(self.dir_of(ws)).as_posix()

    def store_output(
        self,
        ws: str,
        tab: str,
        cell: str | None,
        cell_no: int | None,
        char: str | None,
        exclude_no: bool,
        fmt: str,
        data: bytes,
    ) -> str:
        """생성물을 **자리에 앉히고** 상대경로를 돌려준다 — ★이름 규칙의 **유일한 창구**다.

        싱글/멀티를 갈라 저장한다 (`out_dir` 주석). 멀티는 슬롯 폴더 대신 **파일 앞 슬롯
        번호**를 쓰고, 이름은 시각이 아니라 **순번**이다 (`file_lead`).

        부르는 곳이 셋이다 — 평소 생성(`_generate_one`) · 미저장 그림의 「파일로 저장」
        (`/api/save-preview`) · 「새 탭으로 복제」(`copy_to_tab`). 두 벌이 되면 번호열이
        갈린다: `next_name` 은 **접두마다 따로** 세므로, 한쪽만 `file_lead` 를 다르게 지으면
        같은 폴더 안에서 번호가 겹치거나 건너뛴다."""
        is_set = cell is not None
        d = self.out_dir(ws, tab, is_set, char)
        lead = file_lead(cell_no, cell, exclude_no) if is_set else ""
        path = self.next_name(d, lead, fmt)
        path.write_bytes(data)
        return self.rel(ws, path)

    def append_record(self, ws: str, rec: dict) -> None:
        d = self.dir_of(ws)
        d.mkdir(parents=True, exist_ok=True)
        with (d / RECORDS_NAME).open("a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")

    def records(self, ws: str, limit: int = 500) -> list[dict]:
        p = self.dir_of(ws) / RECORDS_NAME
        if not p.exists():
            return []
        lines = p.read_text(encoding="utf-8").splitlines()
        out = []
        for ln in lines[-limit:]:
            try:
                out.append(json.loads(ln))
            except Exception:
                continue  # 깨진 줄은 건너뛴다 — 인덱스일 뿐이다
        return out

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
    def copy_to_tab(
        self,
        ws: str,
        file: str,
        tab: str,
        tab_id: str | None,
        cell: str | None,
        cell_id: str | None,
        cell_no: int | None,
        char: str | None,
        exclude_no: bool,
    ) -> dict:
        """그림 한 장을 **같은 워크스페이스의 다른 탭**으로 복사한다 (원본은 그대로).

        「새 탭으로 복제」가 부르는 자리다 (사용자 결정 2026-08-18). 옛 「다른 탭으로 복제」는
        `out_dir(..., False)` 로 **싱글 폴더**에 넣었는데 싱글 탭이 없어져 갈 곳이 사라졌다 —
        그 경로를 지우고 이것으로 합쳤다.

        ★옮기지 않고 **복사**한다. 원본이 그대로라 보던 화면·선택이 흐트러지지 않는다.
        ★이름·자리는 `store_output` 하나가 정한다 — 보통 생성과 같은 규칙이라야 받는 씬의
          번호열이 어긋나지 않는다.
        ★레코드에 `tab_id`·`cell_id` 를 함께 쓴다 — 받는 탭이 `idOnly` 라 그것이 없으면
          복사해 놓고 화면 어디에도 안 뜬다 (`lib/takes.ts`)."""
        src = self.file_path(ws, file)
        if not src:
            raise ValueError("복제할 그림을 찾지 못했습니다")
        old = next(
            (r for r in reversed(self.records(ws, limit=100000)) if r.get("file") == file),
            {},
        )
        fmt = src.suffix.lstrip(".").lower() or "png"
        rel = self.store_output(ws, tab, cell, cell_no, char, exclude_no, fmt, src.read_bytes())
        # ★`resolved`(그때 나간 페이로드)와 `enhance_of` 는 안 싣는다. resolved 는 바이브·베이스
        #   그림의 base64 가 들어 있어 크고, enhance_of 는 **다른 탭의 파일**을 가리키는
        #   출처 기록이라 옮겨 오면 뜻이 어긋난다 (`/api/save-preview` 와 같은 판단).
        rec = {
            "ts": datetime.now().isoformat(timespec="seconds"),
            "file": rel,
            "tab": tab,
            "cell": cell,
            "tab_id": tab_id,
            "cell_id": cell_id,
            "enhance_of": None,
            "seed": int(old.get("seed") or 0),
        }
        self.append_record(ws, rec)
        return {"ok": True, "file": rel, "record": rec}
