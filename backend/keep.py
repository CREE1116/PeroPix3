"""갤러리 = **골라 둔 것을 보관하는 곳** (v2 `GALLERY_DIR` 과 같은 자리).

★생성물 전체를 훑는 곳이 아니다 (사용자 지적 2026-08-05). 만든 것 중 **남길 것만** 여기로
  복사해 둔다. 그래서 두 가지가 따라온다:

  1. **워크스페이스를 넘는다.** 덱(스타일·캐릭터·포즈세트)과 같은 층이다 —
     "이번 작업"이 아니라 "내가 모아 둔 것"이라서.
  2. **생성 옵션을 통째로 안고 간다.** 복사할 때 PNG 메타데이터를 그대로 옮기고,
     원본에 없으면 화면이 준 것을 `Comment` 로 써 넣는다. 나중에 그대로 불러 쓸 수 있어야 한다.

★원본을 옮기지 않는다 — **복사**다. 작업 폴더의 그림은 그대로 남는다.
"""
from __future__ import annotations

import json
import shutil
from datetime import datetime
from pathlib import Path

from PIL import Image
from PIL.PngImagePlugin import PngInfo

IMG_EXT = {".png", ".jpg", ".jpeg", ".webp"}


def safe_folder(root: Path, folder: str) -> Path:
    """폴더 경로 검증 — 밖으로 나가지 못하게 한다."""
    p = (root / folder).resolve() if folder else root.resolve()
    if not str(p).startswith(str(root.resolve())):
        raise ValueError("폴더 경로가 올바르지 않습니다")
    return p


def _count(d: Path) -> int:
    return sum(1 for f in d.glob("*") if f.is_file() and f.suffix.lower() in IMG_EXT)


def folders(root: Path) -> list[dict]:
    """보관함의 폴더들.

    ★첫 줄(`""`)은 **전체**다 — 루트에 놓인 것만이 아니라 보관함에 든 전부를 센다.
      폴더에 넣어 둔 그림이 "전체"에서 안 보이면 넣는 순간 사라진 것처럼 보인다
      (실측 2026-08-05: 폴더에 3장을 넣었는데 전체가 0장)."""
    out = [{"path": "", "count": sum(1 for f in root.rglob("*") if f.is_file() and f.suffix.lower() in IMG_EXT)}]
    for d in sorted(p for p in root.rglob("*") if p.is_dir()):
        out.append({"path": d.relative_to(root).as_posix(), "count": _count(d)})
    return out


def images(root: Path, folder: str = "", page: int = 1, limit: int = 0) -> dict:
    """그림 목록. ★`folder` 가 비면 **전체**(하위 폴더까지), 주면 그 폴더만.

    ★**쪽으로 끊어 준다** (v2 `/api/outputs-list` 와 같은 방식, 사용자 결정 2026-08-05).
      수백 장을 한 번에 내려 주면 화면이 그만큼의 DOM 을 만들어야 한다. `limit=0` 이면 전량.
    ★정렬을 먼저 하고 자른다 — 순서가 흔들리면 다음 쪽에 같은 그림이 또 온다."""
    d = safe_folder(root, folder)
    if not d.exists():
        return {"images": [], "total": 0, "page": 1, "pages": 1}
    it = d.rglob("*") if not folder else d.glob("*")
    files = sorted(
        (f for f in it if f.is_file() and f.suffix.lower() in IMG_EXT),
        key=lambda x: x.name,
        reverse=True,
    )
    total = len(files)
    page, pages, chunk = _slice(files, page, limit)
    return {
        "images": [
            {
                "file": f.relative_to(root).as_posix(),
                "name": f.name,
                "size": f.stat().st_size,
                "mtime": f.stat().st_mtime,
            }
            for f in chunk
        ],
        "total": total,
        "page": page,
        "pages": pages,
    }


def _slice(items: list, page: int, limit: int):
    """정렬된 목록에서 한 쪽을 떼어 준다. ★`limit<=0` 이면 자르지 않는다."""
    if limit <= 0:
        return 1, 1, items
    pages = max(1, -(-len(items) // limit))
    page = max(1, min(page, pages))
    start = (page - 1) * limit
    return page, pages, items[start : start + limit]


def save(root: Path, src: Path, folder: str, meta: dict | None) -> dict:
    """작업 폴더의 그림 하나를 보관함으로 **복사**한다.

    ★PNG 메타데이터를 그대로 옮긴다 — 그것이 "그대로 다시 쓸 수 있다"의 전부다.
      원본에 `Comment` 가 없으면(포맷을 바꿨거나 밖에서 온 그림) 화면이 준 것을 써 넣는다."""
    d = safe_folder(root, folder)
    d.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    dst = d / f"{stamp}_{src.stem}.png"
    n = 2
    while dst.exists():
        dst = d / f"{stamp}_{src.stem}_{n}.png"
        n += 1

    with Image.open(src) as im:
        info = dict(im.info)
        has_comment = "Comment" in info
        if src.suffix.lower() == ".png" and (has_comment or not meta):
            # 손대지 않는 것이 가장 정확하다 (다시 인코딩하지 않는다)
            shutil.copy2(src, dst)
            return {"file": dst.relative_to(root).as_posix()}
        png = PngInfo()
        for k, v in info.items():
            if isinstance(v, str):
                png.add_text(k, v)
        if not has_comment and meta:
            png.add_text("Comment", json.dumps(meta, ensure_ascii=False))
        im.convert("RGBA" if im.mode in ("RGBA", "LA") else "RGB").save(dst, format="PNG", pnginfo=png)
    return {"file": dst.relative_to(root).as_posix()}


def delete(root: Path, files: list[str]) -> dict:
    gone = []
    for rel in files:
        p = safe_folder(root, rel)
        if p.is_file():
            p.unlink()
            gone.append(rel)
    return {"deleted": gone}


def move(root: Path, files: list[str], dest: str) -> dict:
    d = safe_folder(root, dest)
    d.mkdir(parents=True, exist_ok=True)
    moved = []
    for rel in files:
        p = safe_folder(root, rel)
        if not p.is_file():
            continue
        tgt = d / p.name
        n = 2
        while tgt.exists():
            tgt = d / f"{p.stem}_{n}{p.suffix}"
            n += 1
        p.rename(tgt)
        moved.append(tgt.relative_to(root).as_posix())
    return {"moved": moved}
