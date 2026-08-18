"""휴지통 — **지우면 진짜 없어지되, 되돌릴 수는 있게** (사용자 결정 2026-08-05).

    지움 →  <뿌리>/.trash/<지운 시각>/<원래 상대경로>
    되돌림 → 원래 자리로 (그 사이 같은 이름이 생겼으면 번호를 붙인다)
    비움  →  **앱을 켤 때** 24시간 지난 것

★왜 종료가 아니라 시작인가: 강제 종료·크래시에서는 종료 처리가 안 돌아 휴지통이 영영 남는다.
  시작은 반드시 한 번 돈다.
★왜 유예를 두는가: 생성물은 Anlas 가 든 원본이다. "지우고 껐다 켰는데 필요했다" 를 한 번은
  살릴 수 있어야 한다. 파일 관리에서 `.trash` 를 열어 직접 꺼내거나 비울 수도 있다.
★원래 상대경로를 **그대로** 유지한다 — 되돌릴 때 어디로 갈지가 경로에 적혀 있어야 한다.

★★**지우는 창구는 전부 여기를 지난다** (사용자 결정 2026-08-18, `docs/v2-port-audit.md` D7).
  예전에는 캔버스의 `Del` 만 휴지통을 썼고 파일 관리·갤러리·바이브 캐시는 바로 지웠다.
  뿌리가 저마다 다르므로(`workspaces/<ws>` · `workspaces` · `gallery` · `data/cards` …)
  **뿌리를 받는 함수**(`*_at`)가 본체이고, 워크스페이스용 `send`·`restore` 는 그 껍데기다.

★★**폴더도 담는다** (같은 결정). `shutil.move` 는 폴더를 통째로 옮기므로 담는 쪽은 파일과
  같고, 되돌릴 때도 같은 상대경로로 돌아온다. 이것이 없으면 파일 관리의 폴더 삭제
  (`rmtree`)만 되돌릴 수 없는 구멍으로 남는다.
"""
from __future__ import annotations

import re
import shutil
import time
from datetime import datetime
from pathlib import Path

TRASH = ".trash"
KEEP_HOURS = 24
#: 묶음 폴더 이름 (`send_at` 이 찍는다). 옛 자리 이전이 이것으로 새 묶음을 가려낸다
STAMP = re.compile(r"^\d{8}_\d{6}$")


def trash_root(base: Path) -> Path:
    """그 뿌리의 휴지통. ★워크스페이스는 **자기 안**에 둔다 (사용자 지시 2026-08-08) —
    워크스페이스를 지우면 휴지통도 함께 사라지고, `workspaces/` 를 열면 워크스페이스만 보인다."""
    return base / TRASH


def _inside(base: Path, rel: str) -> Path | None:
    """뿌리 안의 경로로 풀어 준다. **밖을 가리키면 None** (`files.under` 와 같은 규칙)."""
    rel = (rel or "").strip().strip("/")
    if not rel:
        return None
    b = base.resolve()
    p = (b / rel).resolve()
    if p == b or b not in p.parents:
        return None
    return p


def _free(dst: Path) -> Path:
    """같은 이름이 있으면 **덮지 않고** 번호를 붙인다 — 생성물은 Anlas 가 든 원본이다.
    ★폴더에도 그대로 먹는다 (`suffix` 가 빈 문자열일 뿐이다)."""
    n = 1
    while dst.exists():
        dst = dst.with_name(f"{dst.stem}_{n}{dst.suffix}")
        n += 1
    return dst


# ── 뿌리를 받는 본체 ──────────────────────────────────────────────
def send_at(base: Path, rels: list[str]) -> dict:
    """고른 것을 휴지통으로 **옮긴다**. 되돌릴 수 있게 (원래 경로, 휴지통 경로)를 돌려준다.

    ★파일도 폴더도 받는다. ★휴지통 자신은 못 지운다 — 지우면 되돌릴 자리가 사라진다."""
    root = trash_root(base)
    batch = root / datetime.now().strftime("%Y%m%d_%H%M%S")
    moved, missing = [], []
    for rel in rels:
        src = _inside(base, rel)
        if src is None or not src.exists() or src == root.resolve() or root.resolve() in src.parents:
            missing.append(rel)
            continue
        dst = _free(batch / rel)
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(src), str(dst))
        moved.append({"file": rel, "at": dst.relative_to(root).as_posix()})
    return {"moved": moved, "missing": missing}


def restore_at(base: Path, entries: list[dict]) -> dict:
    """휴지통에서 **원래 자리로**. ★그 사이 같은 이름이 생겼으면 덮지 않고 번호를 붙인다.

    ★`pairs` 로 **어디서 어디로** 갔는지 함께 준다 — 이름이 바뀌었을 때 곁장부(별표·캐시 키)를
      새 경로로 따라 보내려면 부르는 쪽이 짝을 알아야 한다."""
    root = trash_root(base)
    back, missing, pairs = [], [], []
    for e in entries:
        rel = str(e.get("file", ""))
        at = _inside(root, str(e.get("at", "")))
        dst_base = _inside(base, rel)
        if at is None or not at.exists() or dst_base is None:
            missing.append(rel)
            continue
        dst = _free(dst_base)
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(at), str(dst))
        now = dst.relative_to(base.resolve()).as_posix()
        back.append(now)
        pairs.append({"file": rel, "to": now})
        # 빈 껍데기는 치운다 (휴지통에 빈 폴더가 쌓이지 않게). 묶음 폴더와 휴지통 자신까지
        # 올라가되, 비어 있지 않으면 그 자리에서 멈춘다
        d, top = at.parent, root.resolve()
        while d == top or top in d.parents:
            try:
                d.rmdir()
            except OSError:
                break
            d = d.parent
    return {"restored": back, "missing": missing, "pairs": pairs}


def sweep_at(base: Path, hours: int = KEEP_HOURS) -> list[str]:
    """그 뿌리의 휴지통에서 오래된 묶음을 비운다. 지운 묶음 이름을 돌려준다 (로그용)."""
    root = trash_root(base)
    if not root.is_dir():
        return []
    cutoff = time.time() - hours * 3600
    gone = []
    for batch in root.iterdir():
        if not batch.is_dir():
            continue
        try:
            if batch.stat().st_mtime > cutoff:
                continue
            shutil.rmtree(batch)
            gone.append(batch.name)
        except OSError:
            continue
    return gone


# ── 워크스페이스 껍데기 ───────────────────────────────────────────
def send(store, ws: str, files: list[str]) -> dict:
    """워크스페이스 안의 그림을 휴지통으로 (캔버스의 `Del`)."""
    return send_at(store.dir_of(ws), files)


def restore(store, ws: str, entries: list[dict]) -> dict:
    return restore_at(store.dir_of(ws), entries)


def sweep(ws_root: Path, hours: int = KEEP_HOURS) -> list[str]:
    """**앱을 켤 때** 오래된 것을 비운다.

    ★휴지통이 워크스페이스마다 있으므로 전부 훑고, `workspaces/` 자체의 휴지통
      (파일 관리·워크스페이스 삭제가 쓴다)도 함께 본다."""
    if not ws_root.exists():
        return []
    gone = [f"{TRASH}/{b}" for b in sweep_at(ws_root, hours)]
    for ws_dir in ws_root.iterdir():
        if not ws_dir.is_dir() or ws_dir.name == TRASH:
            continue
        gone += [f"{ws_dir.name}/{b}" for b in sweep_at(ws_dir, hours)]
        try:
            ws_dir.rmdir()  # 통째로 비었으면 껍데기도 치운다
        except OSError:
            pass
    return gone
