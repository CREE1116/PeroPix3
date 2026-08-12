"""휴지통 — **지우면 진짜 없어지되, 되돌릴 수는 있게** (사용자 결정 2026-08-05).

    지움 →  workspaces/<워크스페이스>/.trash/<지운 시각>/<원래 상대경로>
    되돌림 → 원래 자리로 (그 사이 같은 이름이 생겼으면 번호를 붙인다)
    비움  →  **앱을 켤 때** 24시간 지난 것

★왜 종료가 아니라 시작인가: 강제 종료·크래시에서는 종료 처리가 안 돌아 휴지통이 영영 남는다.
  시작은 반드시 한 번 돈다.
★왜 유예를 두는가: 생성물은 Anlas 가 든 원본이다. "지우고 껐다 켰는데 필요했다" 를 한 번은
  살릴 수 있어야 한다. 파일 관리에서 `.trash` 를 열어 직접 꺼내거나 비울 수도 있다.
★원래 상대경로를 **그대로** 유지한다 — 되돌릴 때 어디로 갈지가 경로에 적혀 있어야 한다.
"""
from __future__ import annotations

import shutil
import time
from datetime import datetime
from pathlib import Path

TRASH = ".trash"
KEEP_HOURS = 24


def trash_root(ws_dir: Path) -> Path:
    """★워크스페이스 **안**이다 (사용자 지시 2026-08-08) — 워크스페이스를 지우면 휴지통도 함께
    사라지고, `workspaces/` 를 열면 워크스페이스만 보인다."""
    return ws_dir / TRASH


def send(store, ws: str, files: list[str]) -> dict:
    """고른 그림을 휴지통으로 **옮긴다**. 되돌릴 수 있게 (원래 경로, 휴지통 경로)를 돌려준다."""
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    root = trash_root(store.dir_of(ws)) / stamp
    moved, missing = [], []
    for rel in files:
        src = store.file_path(ws, rel)
        if not src or not src.is_file():
            missing.append(rel)
            continue
        dst = root / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        n = 1
        while dst.exists():
            dst = dst.with_name(f"{dst.stem}_{n}{dst.suffix}")
            n += 1
        shutil.move(str(src), str(dst))
        moved.append({"file": rel, "at": dst.relative_to(trash_root(store.dir_of(ws))).as_posix()})
    return {"moved": moved, "missing": missing}


def restore(store, ws: str, entries: list[dict]) -> dict:
    """휴지통에서 **원래 자리로**. ★그 사이 같은 이름이 생겼으면 덮지 않고 번호를 붙인다."""
    back, missing = [], []
    for e in entries:
        base = trash_root(store.dir_of(ws))
        at = base / str(e.get("at", ""))
        rel = str(e.get("file", ""))
        if not rel or not at.is_file() or base not in at.parents:
            missing.append(rel)
            continue
        dst = store.dir_of(ws) / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        n = 1
        while dst.exists():
            dst = dst.with_name(f"{dst.stem}_{n}{dst.suffix}")
            n += 1
        shutil.move(str(at), str(dst))
        back.append(store.rel(ws, dst))
        # 빈 껍데기는 치운다 (휴지통에 빈 폴더가 쌓이지 않게)
        for d in (at.parent, at.parent.parent):
            try:
                d.rmdir()
            except OSError:
                break
    return {"restored": back, "missing": missing}


def sweep(ws_root: Path, hours: int = KEEP_HOURS) -> list[str]:
    """**앱을 켤 때** 오래된 것을 비운다. 지운 묶음의 이름을 돌려준다 (로그용).

    ★휴지통이 워크스페이스마다 있으므로 전부 훑는다."""
    if not ws_root.exists():
        return []
    cutoff = time.time() - hours * 3600
    gone = []
    for ws_dir in ws_root.iterdir():
        root = trash_root(ws_dir)
        if not root.is_dir():
            continue
        for batch in root.iterdir():
            if not batch.is_dir():
                continue
            try:
                if batch.stat().st_mtime > cutoff:
                    continue
                shutil.rmtree(batch)
                gone.append(f"{ws_dir.name}/{batch.name}")
            except OSError:
                continue
        try:
            ws_dir.rmdir()
        except OSError:
            pass
    return gone
