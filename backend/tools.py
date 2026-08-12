"""보조 도구 — **이미 있는 그림을 손보는** 일 (9단계).

여기 오는 그림은 **밖에서 온 것일 수 있다.** 그래서 세 갈래로 받는다 (`_read`):

    path  절대 경로 — 앱 창에 떨군 파일 (Tauri 가 경로를 준다)
    rel   아웃풋 루트 기준 상대 경로 — 파일 관리에서 고른 것
    data  base64 — 경로가 없는 곳(브라우저)에서 떨군 파일

★규칙 하나는 어디서 오든 같다: **원본을 지우지 않는다.** 변환은 새 파일을 만든다.
★같은 이름이 있으면 덮지 않고 번호를 붙인다.
"""
from __future__ import annotations

import base64
import binascii
from pathlib import Path

from PIL import Image

import files as files_mod
import meta as meta_mod

Item = dict  # {"name": str, "path"?: str, "rel"?: str, "data"?: base64}


def _read(root: Path, it: Item) -> tuple[bytes, Path | None]:
    """그림의 바이트와 **원본 자리**(있으면). 자리를 아는 것만 `원본 옆에` 저장할 수 있다."""
    if it.get("rel"):
        p = files_mod.under(root, it["rel"])
        return p.read_bytes(), p
    if it.get("path"):
        p = Path(it["path"])
        return p.read_bytes(), p
    if it.get("data"):
        raw = it["data"]
        if "," in raw[:64]:  # data:image/png;base64,....
            raw = raw.split(",", 1)[1]
        try:
            return base64.b64decode(raw), None
        except (binascii.Error, ValueError) as e:
            raise ValueError("base64 를 못 읽었습니다") from e
    raise ValueError("그림이 비었습니다")


def _free(d: Path, stem: str, ext: str) -> Path:
    """빈 자리를 찾아 준다 — 덮어쓰지 않는다."""
    cand = d / f"{stem}.{ext}"
    n = 2
    while cand.exists():
        cand = d / f"{stem}_{n}.{ext}"
        n += 1
    return cand


def convert(
    root: Path,
    items: list[Item],
    fmt: str = "png",
    quality: int = 95,
    strip_metadata: bool = False,
    prefix: str | None = None,
    start: int = 1,
    pad: int = 3,
    dest: str = "",
) -> dict:
    """변환 + (원하면) 일괄 이름 바꾸기.

    `dest` 가 비면 **원본 옆에** 둔다 (경로를 아는 것만). 값이 있으면 아웃풋 루트 아래
    그 폴더에 모은다 — 브라우저에서 떨군 것처럼 원본 자리를 모르는 경우의 유일한 길이다.

    ★이름 번호는 **받은 차례**를 따른다 (v2 `generateNewFilename`: `<접두><번호>.<확장자>`,
      자릿수 0 이면 그대로). 정렬을 여기서 바꾸지 않는다 — 목록을 정한 것은 화면이다.
    """
    fmt = (fmt or "png").lower()
    if fmt not in ("png", "jpg", "webp"):
        raise ValueError("지원하지 않는 형식입니다")

    out_dir: Path | None = None
    if dest:
        out_dir = files_mod.under(root, dest)
        out_dir.mkdir(parents=True, exist_ok=True)

    results = []
    for i, it in enumerate(items):
        name = it.get("name") or f"image_{i + 1}"
        try:
            data, src = _read(root, it)
            if strip_metadata:
                blob = meta_mod.strip(data, fmt, quality)
            else:
                # ★메타데이터를 **옮겨 준다** — 그림만 남고 설정을 잃으면 재생성이 끊긴다
                raw = meta_mod.read_raw(data)
                import io

                with Image.open(io.BytesIO(data)) as im:
                    chunks = dict(im.info)
                blob = meta_mod.write(data, raw, fmt, quality, chunks)

            d = out_dir or (src.parent if src else None)
            if d is None:
                raise ValueError("저장할 폴더를 정해 주세요")
            if prefix is not None:
                num = str(start + i).zfill(max(0, pad))
                stem = f"{prefix}{num}"
            else:
                stem = Path(name).stem
            dst = _free(d, stem, "jpg" if fmt == "jpg" else fmt)
            dst.write_bytes(blob)
            results.append({"name": name, "saved": dst.name, "dir": str(dst.parent), "ok": True})
        except Exception as e:  # 한 장이 깨져도 나머지는 간다
            results.append({"name": name, "error": str(e), "ok": False})
    return {"results": results, "ok": sum(1 for r in results if r["ok"])}


def read_meta(root: Path, it: Item) -> dict:
    """EXIF 리더 — **읽기만.** 파일을 저장하지도, 고치지도 않는다."""
    data, _ = _read(root, it)
    return meta_mod.normalize(meta_mod.read_raw(data)) or {}
