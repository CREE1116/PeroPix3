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
import io
from pathlib import Path

from PIL import Image

import files as files_mod
import meta as meta_mod

Item = dict  # {"name": str, "path"?: str, "rel"?: str, "data"?: base64}

#: EXIF 리더의 미리보기 / 변환 목록의 작은 칸. ★**서버가 줄여서 준다** — 앱(Tauri)에는 경로만
#  오고 그 파일을 가리킬 주소가 없어서, 줄이지 않으면 화면에 그림을 못 띄운다.
PREVIEW_MAX = 320
LIST_THUMB = 96

#: 화면이 이미 다른 칸으로 보여 주는 tEXt 청크 — 「그 밖」 목록에서 뺀다 (index.html:25822)
SHOWN_CHUNKS = {"Comment", "prompt", "workflow", "peropix",
                "vibe_data", "cache_key", "model", "strength", "info_extracted"}


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


def _thumb(data: bytes, max_side: int) -> str:
    """줄인 그림을 data URL 로. 못 읽으면 빈 문자열 (그림이 아니어도 예외로 만들지 않는다)."""
    try:
        with Image.open(io.BytesIO(data)) as im:
            small = im.convert("RGB")
            small.thumbnail((max_side, max_side), Image.LANCZOS)
            buf = io.BytesIO()
            small.save(buf, format="JPEG", quality=80)
        return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")
    except Exception:
        return ""


def probe(root: Path, items: list[Item]) -> dict:
    """목록에 보여 줄 것만 — 작은 썸네일 · 파일 크기 · 해상도. ★**읽기만 한다.**

    변환 목록이 이걸 쓴다 (v2 `file-item-thumb`·`file-item-meta`). 한 장이 깨져도
    나머지는 그대로 준다 — 목록에서 그 줄만 이름으로 남는다."""
    out = []
    for it in items:
        row: dict = {"name": it.get("name") or ""}
        try:
            data, _ = _read(root, it)
            with Image.open(io.BytesIO(data)) as im:
                row["width"], row["height"] = im.size
            row["bytes"] = len(data)
            row["thumb"] = _thumb(data, LIST_THUMB)
        except Exception as e:
            row["error"] = str(e)
        out.append(row)
    return {"items": out}


#: 앱 창에 떨군 파일을 통째로 들여올 때의 한계. ★그림 한 장·바이브 파일 한 개면 충분하고,
#  상한이 없으면 실수로 떨군 큰 파일 하나가 그대로 메모리에 올라온다.
READ_MAX = 24 * 1024 * 1024
#: 글로 읽어 줄 것 (`.naiv4vibe` 는 JSON 이다). 그 밖은 base64 로 준다
TEXT_EXT = {".naiv4vibe", ".json", ".txt"}


def read_dropped(root: Path, it: Item) -> dict:
    """앱 창에 **떨군 파일 하나**를 화면이 쓸 수 있는 모양으로 준다.

    ★왜 서버가 하나: Tauri 는 창에 떨어진 파일을 가로채 **경로만** 준다 (`lib/dropImages.ts`
      머리 주석). 화면에는 그 경로를 열 수단이 없어서, 안 거치면 앱에서는 떨구기가
      통째로 안 되고 브라우저에서만 된다.
    ★글 파일은 `text`, 그림은 `data`(base64) 로 준다. 둘 다 아니면 그림으로 시도한다."""
    p = Path(it.get("path") or "")
    if not p.is_file():
        raise ValueError("파일을 찾을 수 없습니다")
    if p.stat().st_size > READ_MAX:
        raise ValueError("파일이 너무 큽니다")
    raw = p.read_bytes()
    if p.suffix.lower() in TEXT_EXT:
        return {"name": p.name, "text": raw.decode("utf-8", "replace")}
    return {"name": p.name, "data": base64.b64encode(raw).decode("ascii")}


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
    open_folder: bool = False,
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

    # ★「완료 후 폴더 열기」 (v2 `convertOpenFolder`). 여는 것은 **방금 우리가 쓴 자리**뿐이라
    #   사용자가 준 경로를 그대로 여는 창구를 새로 열지 않는다 (files.open_dir 주석).
    if open_folder:
        for r in results:
            if r["ok"]:
                files_mod.open_dir(Path(r["dir"]))
                break
    return {"results": results, "ok": sum(1 for r in results if r["ok"])}


def read_meta(root: Path, it: Item) -> dict:
    """EXIF 리더 — **읽기만.** 파일을 저장하지도, 고치지도 않는다.

    내부 형식(`meta.normalize`)에 화면이 쓰는 셋을 얹어 준다:

        kind     형식 배지 (nai · peropix · comfyui · vibe · custom)
        preview  줄인 그림 — 앱에는 경로만 와서 화면이 원본을 가리킬 주소가 없다
        extra    우리가 다른 칸으로 안 보여 주는 tEXt 청크 (v2 「Raw Metadata」)

    ★`full` 을 켜면 **원본 바이트**(`data`)와 바이브 인코딩(`vibe.data`)도 얹는다 —
      드롭 가져오기가 그것으로 베이스 이미지·바이브를 만든다.
    """
    data, _ = _read(root, it)
    raw = meta_mod.read_raw(data)
    out = meta_mod.normalize(raw) or {}
    info: dict = {}
    try:
        with Image.open(io.BytesIO(data)) as im:
            info = {k: v for k, v in im.info.items() if isinstance(v, (str, int, float))}
            if out.get("width") is None:
                out["width"] = im.width
            if out.get("height") is None:
                out["height"] = im.height
    except Exception:
        pass
    out["kind"] = meta_mod.kind_of(raw, info)
    out["preview"] = _thumb(data, PREVIEW_MAX)
    out["bytes"] = len(data)
    if out["kind"] == "vibe":
        out["vibe"] = {
            "model": str(info.get("model") or ""),
            "strength": str(info.get("strength") or ""),
            "info_extracted": str(info.get("info_extracted") or ""),
        }
    # ★★`full` 은 **드롭 가져오기**가 켠다 (EXIF 리더는 안 켠다).
    #   앱(Tauri)에는 경로만 와서 화면에 원본 바이트가 없는데, 떨군 그림을 베이스 이미지나
    #   바이브로 넣으려면 그 바이트가 있어야 한다. `preview` 는 320px JPEG 이라 못 쓴다.
    #   ★재인코딩하지 않고 **파일 그대로** 준다 (v2 `fileToBase64` 와 같다) — 다시 구우면
    #     바이브 캐시 키가 달라져 이미 구워 둔 인코딩을 못 알아본다.
    if it.get("full"):
        out["data"] = base64.b64encode(data).decode("ascii")
        # ★바이브 캐시 PNG 는 tEXt 에 **인코딩 자체**를 들고 있다 — 그것을 그대로 쓰면
        #   다시 굽지 않아 Anlas 가 안 나간다 (`vibe.py` 의 `put`).
        if out["kind"] == "vibe":
            out["vibe"]["data"] = str(info.get("vibe_data") or "")
    # ★500자에서 자른다 — 화면에 통째로 쏟으면 읽을 수 없다 (v2 도 같은 자리에서 잘랐다)
    out["extra"] = {k: str(v)[:500] for k, v in info.items() if k not in SHOWN_CHUNKS}
    return out
