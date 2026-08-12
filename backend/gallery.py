"""갤러리 — 워크스페이스에 쌓인 그림을 훑어 보여준다.

★**파일을 훑는다. `records.jsonl` 을 읽지 않는다.**
  schema.md 가 못박은 원칙이다: *"records 는 인덱스이지 정본이 아니다. 정본은 PNG
  메타데이터다."* 사용자가 탐색기에서 파일을 옮기거나 밖에서 그림을 넣어도 갤러리에
  보여야 하고, records 가 깨져도 갤러리는 멀쩡해야 한다.

폴더는 워크스페이스 안의 상대 경로 그대로다 (schema.md 의 저장 구조):

    싱글/<탭>/            싱글 탭의 생성물            (2026-08-04~)
    멀티/<세트탭>/         멀티 생성물 — 슬롯은 파일 앞 번호  (2026-08-04~)
    work/<탭>/[<셀>/]     옛 경로. 그대로 둔다 — 폴더를 훑으므로 계속 보인다
    output/               내보낸 선별본
"""
from __future__ import annotations

import shutil
from pathlib import Path

IMG_EXT = {".png", ".jpg", ".jpeg", ".webp"}
# 파생 썸네일 캐시 — 갤러리에 그림으로 보여선 안 된다
SKIP_DIRS = {".thumbnails", ".thumbs"}


def _is_img(p: Path) -> bool:
    return p.is_file() and p.suffix.lower() in IMG_EXT


def _walk(root: Path):
    """캐시 폴더를 건너뛰며 이미지만 훑는다."""
    if not root.exists():
        return
    for p in root.rglob("*"):
        if any(part in SKIP_DIRS for part in p.parts):
            continue
        if _is_img(p):
            yield p


def folders(store, ws: str) -> list[dict]:
    """이 워크스페이스의 폴더 목록. **그림이 하나라도 있는 폴더만** 낸다.

    ★빈 폴더를 내지 않는 이유: 셀 폴더는 생성 전에 미리 만들어지므로(`work_dir`),
      전부 내면 아직 아무것도 없는 칸이 갤러리를 채운다."""
    base = store.dir_of(ws)
    counts: dict[str, int] = {}
    for p in _walk(base):
        rel = p.parent.relative_to(base).as_posix()
        counts[rel] = counts.get(rel, 0) + 1
    return [{"path": k, "count": v} for k, v in sorted(counts.items())]


def images(store, ws: str, folder: str | None = None) -> list[dict]:
    """그림 목록 — **새것부터.** folder 를 주면 그 폴더만(하위 폴더는 빼고).

    ★목록에서 그림을 열지 않는다 (해상도·메타데이터를 안 읽는다). 수백 장이면 그것만으로
      몇 초가 나간다. 화면은 썸네일로 그리고, 자세한 것은 고른 한 장만 읽는다."""
    base = store.dir_of(ws)
    if folder:
        root = store.file_path(ws, folder)
        if not root or not root.is_dir():
            return []
        it = (p for p in root.iterdir() if _is_img(p))
    else:
        it = _walk(base)
    out = []
    for p in it:
        st = p.stat()
        out.append(
            {
                "file": p.relative_to(base).as_posix(),
                "name": p.name,
                "bytes": st.st_size,
                "mtime": st.st_mtime,
            }
        )
    out.sort(key=lambda x: x["mtime"], reverse=True)
    return out


def move(store, ws: str, files: list[str], dest: str) -> dict:
    """고른 그림을 워크스페이스 안의 다른 폴더로 옮긴다.

    ★같은 이름이 이미 있으면 **덮어쓰지 않고 번호를 붙인다.** 생성물은 재생성에 Anlas 가
      드는 원본이라, 조용히 없어지는 경로를 만들지 않는다."""
    dst_dir = (store.dir_of(ws) / dest).resolve()
    base = store.dir_of(ws).resolve()
    if not str(dst_dir).startswith(str(base)):
        raise ValueError("워크스페이스 밖으로는 못 옮긴다")
    dst_dir.mkdir(parents=True, exist_ok=True)

    moved, missing = [], []
    for rel in files:
        src = store.file_path(ws, rel)
        if not src:
            missing.append(rel)
            continue
        target = dst_dir / src.name
        n = 1
        while target.exists():
            target = dst_dir / f"{src.stem}_{n}{src.suffix}"
            n += 1
        if src.resolve() == target.resolve():
            continue
        shutil.move(str(src), str(target))
        moved.append(target.relative_to(base).as_posix())
    return {"moved": moved, "missing": missing}


def delete(store, ws: str, files: list[str]) -> dict:
    """고른 그림을 지운다 — **사용자가 명시적으로 고른 것만.**

    ★자동 삭제·기간 만료 삭제를 만들지 말 것 (feature-inventory K절). 대량 생산 도구가
      사용자 생성물을 알아서 지우면 사고가 된다. 여기는 목록을 받아야만 돈다."""
    gone, missing = [], []
    for rel in files:
        p = store.file_path(ws, rel)
        if not p:
            missing.append(rel)
            continue
        p.unlink()
        gone.append(rel)
    return {"deleted": gone, "missing": missing}
