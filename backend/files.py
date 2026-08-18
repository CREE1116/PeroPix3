"""파일 관리 — **아웃풋 폴더를 그대로** 다루는 자리 (v2 `보조 도구 › 파일 관리`).

갤러리(`keep.py`)와 헷갈리지 말 것. 둘은 보는 대상이 다르다:

    keep.py     골라 둔 것        <APP>/gallery/           "남길 것만"
    files.py    아웃풋 폴더 전부   outputs/                 "디스크에 있는 그대로"

★여기는 **탐색기**다 — 워크스페이스 경계를 넘어 폴더 트리를 그대로 보여주고, 옮기고,
  이름을 바꾸고, 지운다. 그래서 경로는 워크스페이스가 아니라 **아웃풋 루트 기준**이다.
★한 발짝도 루트 밖으로 못 나간다 (`under`). 밖을 가리키면 즉시 ValueError.
★지우는 것은 **받은 목록만.** 자동 정리·기간 만료를 만들지 말 것 (keep.delete 주석과 같은 이유).
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

IMG_EXT = {".png", ".jpg", ".jpeg", ".webp"}
# 파생 캐시 — 사람이 만든 폴더가 아니다. 트리에 나오면 헷갈리기만 한다
SKIP = {".thumbs", ".thumbnails"}
# 휴지통만은 트리에 보인다 (backend/trash.py)
TRASH_DIR = ".trash"


def under(root: Path, rel: str) -> Path:
    """루트 안의 경로로 풀어 준다. **밖을 가리키면 거절한다.**"""
    base = root.resolve()
    p = (base / (rel or "")).resolve()
    if p != base and base not in p.parents:
        raise ValueError("아웃풋 폴더 밖입니다")
    return p


def _count(d: Path) -> int:
    """그 폴더에 **직접** 든 그림 수 (하위 폴더는 따로 센다)."""
    try:
        return sum(1 for f in d.iterdir() if f.is_file() and f.suffix.lower() in IMG_EXT)
    except OSError:
        return 0


def tree(root: Path) -> dict:
    """폴더 트리 — 재귀. ★빈 폴더도 낸다: 여기서는 **옮길 자리**로 쓴다."""

    def scan(d: Path, prefix: str) -> list[dict]:
        out = []
        try:
            items = sorted(d.iterdir(), key=lambda p: p.name.lower())
        except OSError:
            return out
        for it in items:
            # ★휴지통은 **보여 준다** — 직접 꺼내거나 비울 수 있어야 한다 (trash.py 머리 주석).
            #   나머지 점 폴더(썸네일 캐시 등)는 사람이 만든 것이 아니라 감춘다.
            if not it.is_dir() or it.name in SKIP or (it.name.startswith(".") and it.name != TRASH_DIR):
                continue
            rel = f"{prefix}/{it.name}" if prefix else it.name
            out.append({"name": it.name, "path": rel, "count": _count(it), "children": scan(it, rel)})
        return out

    root.mkdir(parents=True, exist_ok=True)
    return {"count": _count(root), "tree": scan(root, "")}


def listdir(root: Path, rel: str = "", page: int = 1, limit: int = 0) -> dict:
    """그 폴더의 그림 — **하위 폴더는 빼고.** 트리가 이미 계층을 보여주므로 섞을 이유가 없다.

    ★**쪽으로 끊어 준다** (keep.images 와 같은 규칙). `limit=0` 이면 전량."""
    d = under(root, rel)
    if not d.is_dir():
        return {"items": [], "total": 0, "page": 1, "pages": 1}
    files = sorted(
        (p for p in d.iterdir() if p.is_file() and p.suffix.lower() in IMG_EXT),
        key=lambda x: x.name.lower(),
    )
    total = len(files)
    if limit > 0:
        pages = max(1, -(-total // limit))
        page = max(1, min(page, pages))
        files = files[(page - 1) * limit : (page - 1) * limit + limit]
    else:
        pages, page = 1, 1
    base = root.resolve()
    return {
        "items": [
            {
                "file": p.relative_to(base).as_posix(),
                "name": p.name,
                "bytes": p.stat().st_size,
                "mtime": p.stat().st_mtime,
            }
            for p in files
        ],
        "total": total,
        "page": page,
        "pages": pages,
    }


def mkdir(root: Path, parent: str, name: str) -> dict:
    name = (name or "").strip().strip(". ")
    if not name or "/" in name or "\\" in name or ".." in name:
        raise ValueError("폴더 이름이 잘못됐습니다")
    d = under(root, parent) / name
    d.mkdir(parents=True, exist_ok=True)
    return {"path": d.relative_to(root.resolve()).as_posix()}


def rename(root: Path, rel: str, new_name: str) -> dict:
    """이름 바꾸기 — 파일·폴더 둘 다. ★확장자를 빼먹으면 원래 것을 붙인다."""
    p = under(root, rel)
    if not p.exists():
        raise ValueError("없는 항목입니다")
    new_name = (new_name or "").strip()
    if not new_name or "/" in new_name or "\\" in new_name or ".." in new_name:
        raise ValueError("이름이 잘못됐습니다")
    if p.is_file() and not Path(new_name).suffix:
        new_name += p.suffix
    dst = p.with_name(new_name)
    if dst.exists() and dst != p:
        raise ValueError("같은 이름이 이미 있습니다")
    p.rename(dst)
    return {"path": dst.relative_to(root.resolve()).as_posix()}


def move(root: Path, files: list[str], dest: str) -> dict:
    """옮기기. ★같은 이름이 있으면 **덮지 않고** 번호를 붙인다 — 생성물은 Anlas 가 든 원본이다."""
    d = under(root, dest)
    d.mkdir(parents=True, exist_ok=True)
    moved, missing = [], []
    for rel in files:
        try:
            src = under(root, rel)
        except ValueError:
            missing.append(rel)
            continue
        if not src.exists():
            missing.append(rel)
            continue
        target = d / src.name
        n = 1
        while target.exists():
            target = d / f"{src.stem}_{n}{src.suffix}"
            n += 1
        if src.resolve() == target.resolve():
            continue
        shutil.move(str(src), str(target))
        moved.append(target.relative_to(root.resolve()).as_posix())
    return {"moved": moved, "missing": missing}


def delete(root: Path, files: list[str]) -> dict:
    gone, missing = [], []
    for rel in files:
        try:
            p = under(root, rel)
        except ValueError:
            missing.append(rel)
            continue
        if not p.exists():
            missing.append(rel)
            continue
        if p.is_dir():
            shutil.rmtree(p)
        else:
            p.unlink()
        gone.append(rel)
    return {"deleted": gone, "missing": missing}


def _open(p: Path, select: bool) -> None:
    """탐색기 호출 한 곳. `select` 면 그 파일을 고른 채로, 아니면 폴더만 연다."""
    target = p if p.is_dir() else p.parent
    if sys.platform == "win32":
        if select and p.is_file():
            subprocess.Popen(["explorer", "/select,", str(p)])
        else:
            os.startfile(str(target))  # noqa: S606
    elif sys.platform == "darwin":
        subprocess.Popen(["open", "-R", str(p)] if select and p.is_file() else ["open", str(target)])
    else:
        subprocess.Popen(["xdg-open", str(target)])


def reveal(root: Path, rel: str = "") -> None:
    """탐색기에서 그 자리를 연다. ★파일이면 **고른 채로** 연다 (v2 와 같은 동작)."""
    p = under(root, rel)
    if not p.exists():
        raise ValueError("없는 항목입니다")
    _open(p, True)


def open_dir(p: Path) -> None:
    """폴더를 연다. ★`reveal` 과 달리 루트 밖도 연다 — 부르는 쪽이 **방금 자기가 쓴 자리**를
    넘길 때만 쓴다 (변환의 「완료 후 폴더 열기」). 사용자가 준 경로를 그대로 넣지 말 것."""
    if p.is_dir():
        _open(p, False)
