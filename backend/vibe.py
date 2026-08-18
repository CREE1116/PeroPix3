"""Vibe Transfer 인코딩 + 캐시 — v2.x `backend.py:1096-1300` 이식.

★**Anlas 가 걸린 코드다.** V4+ 는 vibe 를 `/ai/encode-vibe` 로 미리 굽는데, 그 호출이
  유료다. 캐시가 빗나가면 사용자가 **같은 그림 값을 다시 지불한다.**

그래서 두 가지를 원문 그대로 옮긴다 (docs/v2-port-plan.md 「절대 재구현하지 말 것」):

1. **캐시 키 산식** — 해시 16자 · info 정수 3자리 · 모델 약칭. 바꾸면 기존 캐시가 전부
   미스가 된다 (v2 backend.py:1096).
2. **재사용 판정** — `-inpainting` 접미어를 **떼고** 비교한다. 안 그러면 인페인트로
   전환할 때마다 전 vibe 를 다시 굽는다. info 비교에 0.001 오차를 두는 것도
   부동소수 때문이라 필요하다 (v2 backend.py:1479-1542).

캐시는 **PNG 한 장**이다 — 썸네일이 보이고 vibe 데이터는 tEXt 청크에 들어간다.
탐색기로 열어 무엇이 들었는지 눈으로 볼 수 있게 v2 가 그렇게 만들었다.
"""
from __future__ import annotations

import base64
import datetime
import hashlib
import io
import json
import re
from pathlib import Path

import httpx
from PIL import Image
from PIL.PngImagePlugin import PngInfo

import trash

ENCODE_ENDPOINT = "https://image.novelai.net/ai/encode-vibe"
KEY_MAP_NAME = "key_map.json"
THUMB_MAX = 512


def cache_key(image_b64: str, model: str, info_extracted: float) -> str:
    """★산식을 바꾸지 말 것 — 바꾸면 기존 캐시가 전부 미스가 되어 Anlas 를 다시 낸다."""
    image_hash = hashlib.sha256(image_b64.encode()).hexdigest()[:16]
    info_str = f"{int(info_extracted * 100):03d}"  # 0.70 -> "070"
    model_short = model.replace("nai-diffusion-", "").replace("-", "")
    return f"{image_hash}_{model_short}_{info_str}"


def base_model(model: str) -> str:
    """인페인트 접미어를 뗀 모델명.

    ★재사용 판정이 이걸 쓴다. `nai-diffusion-4-5-full-inpainting` 과
      `nai-diffusion-4-5-full` 은 **같은 vibe 를 쓴다** — 떼고 비교하지 않으면
      인페인트로 전환할 때마다 전부 다시 굽는다."""
    return model.replace("-inpainting", "")


def reuse_ok(v: dict, model: str, info_extracted: float) -> bool:
    """이미 인코딩해 둔 vibe 를 그대로 쓸 수 있는가 (v2 backend.py:1500-1506).

    ★info 비교에 0.001 오차를 둔다 — 부동소수라 정확히 같지 않을 수 있다."""
    if not v.get("encoded"):
        return False
    encoded_model = v.get("encoded_model", "")
    if base_model(encoded_model) != base_model(model):
        return False
    encoded_info = v.get("encoded_info_extracted", info_extracted)
    return abs(info_extracted - encoded_info) <= 0.001


def as_nai_number(x: float) -> int | float:
    """NAI 는 정수 값을 **정수로** 받는다 (1.0 -> 1). v2 backend.py:1529."""
    return int(x) if float(x) == int(x) else x


def sanitize_filename(name: str, max_length: int = 100) -> str:
    name = Path(name).stem
    name = re.sub(r"[^\w\s가-힣-]", "", name)
    name = name.replace(" ", "_")
    return name[:max_length] if name else "vibe"


class VibeCache:
    """디스크 + 메모리 두 층. 디스크는 PNG 한 장(썸네일 + tEXt)."""

    def __init__(self, dir_: Path):
        self.dir = dir_
        self._data: dict[str, str] = {}
        self._key_map: dict[str, str] | None = None
        self._key_map_mtime = 0.0

    # ── 읽기 ──
    def get(self, key: str) -> str | None:
        if key in self._data:
            return self._data[key]

        km = self.dir / KEY_MAP_NAME
        if km.exists():
            try:
                mtime = km.stat().st_mtime
                if self._key_map is None or mtime > self._key_map_mtime:
                    self._key_map = json.loads(km.read_text(encoding="utf-8"))
                    self._key_map_mtime = mtime
                name = (self._key_map or {}).get(key)
                if name and (self.dir / name).exists():
                    with Image.open(self.dir / name) as img:
                        data = img.info.get("vibe_data")
                    if data:
                        self._data[key] = data
                        return data
            except Exception:
                pass

        # 레거시 .vibe 파일 (v2 초기 형식)
        legacy = self.dir / f"{key}.vibe"
        if legacy.exists():
            data = legacy.read_text(encoding="utf-8")
            self._data[key] = data
            return data
        return None

    # ── 쓰기 ──
    def put(self, key: str, encoded: str, image_b64: str, strength: float,
            info_extracted: float, model: str, image_name: str = "vibe") -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        img = Image.open(io.BytesIO(base64.b64decode(image_b64)))
        if img.mode == "RGBA":
            bg = Image.new("RGB", img.size, (255, 255, 255))
            bg.paste(img, mask=img.split()[3])
            img = bg
        elif img.mode != "RGB":
            img = img.convert("RGB")

        w, h = img.size
        if w > THUMB_MAX or h > THUMB_MAX:
            scale = min(THUMB_MAX / w, THUMB_MAX / h)
            img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)

        meta = PngInfo()
        meta.add_text("vibe_data", encoded)
        meta.add_text("cache_key", key)
        meta.add_text("model", model)
        meta.add_text("info_extracted", str(info_extracted))
        meta.add_text("strength", str(strength))

        stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        name = f"{stamp}_{sanitize_filename(image_name)}_{strength:.1f}_{info_extracted:.1f}.png"
        img.save(self.dir / name, format="PNG", pnginfo=meta)

        km = self.dir / KEY_MAP_NAME
        try:
            m = json.loads(km.read_text(encoding="utf-8")) if km.exists() else {}
            m[key] = name
            km.write_text(json.dumps(m, indent=2), encoding="utf-8")
            self._key_map = m
            self._key_map_mtime = km.stat().st_mtime
        except Exception:
            pass
        self._data[key] = encoded

    # ── 한 항목 ──
    def path_of(self, name: str) -> Path | None:
        """이름 하나를 캐시 폴더 안의 파일로 푼다. ★경로 탈출은 여기 한 곳에서 막는다."""
        base = self.dir.resolve()
        f = (base / name).resolve()
        if not str(f).startswith(str(base)) or not f.exists() or not f.is_file():
            return None
        return f

    def detail(self, name: str) -> dict | None:
        """캐시 한 항목의 **인코딩과 그림**까지 (v2 backend.py:4286-4318).

        ★목록(`entries`)과 갈라 둔 이유는 크기다. vibe 데이터는 목록에 실으면 무겁고
          화면이 쓸 일도 없다 — 꺼내 쓰는 순간에만 한 항목을 이쪽으로 받아 간다.
        ★`image` 를 반드시 함께 준다. 예전에는 썸네일 PNG 만 내보내고 화면이 빈 그림으로
          항목을 만들어서, 생성 때 재인코딩이 빈 문자열을 열다 500 으로 죽었다.
          여기 담기는 그림은 캐시에 저장된 PNG 그대로다 (v2 도 같다 — 긴 변 512 로 줄여 굽는다)."""
        f = self.path_of(name)
        if f is None:
            return None
        try:
            data = f.read_bytes()
            with Image.open(io.BytesIO(data)) as img:
                info = dict(img.info)
                size = [img.width, img.height]
        except Exception:
            return None
        return {
            "file": f.name,
            "image": base64.b64encode(data).decode(),
            "vibe_data": info.get("vibe_data"),
            "cache_key": info.get("cache_key", ""),
            "model": info.get("model", ""),
            "strength": float(info.get("strength", 0.6) or 0.6),
            "info_extracted": float(info.get("info_extracted", 1) or 1),
            "size": size,
        }

    def _keys(self) -> dict[str, str]:
        """`key_map.json` 을 그대로 읽는다 (캐시 키 → 파일 이름)."""
        km = self.dir / KEY_MAP_NAME
        try:
            return json.loads(km.read_text(encoding="utf-8")) if km.exists() else {}
        except Exception:
            return {}

    def _put_keys(self, keys: dict[str, str]) -> None:
        """`key_map.json` 에 (캐시 키 → 파일 이름)을 써 넣는다. 값이 빈 문자열이면 뺀다."""
        km = self.dir / KEY_MAP_NAME
        try:
            m = json.loads(km.read_text(encoding="utf-8")) if km.exists() else {}
            for k, v in keys.items():
                if v:
                    m[k] = v
                else:
                    m.pop(k, None)
            km.write_text(json.dumps(m, indent=2), encoding="utf-8")
            self._key_map = m
            self._key_map_mtime = km.stat().st_mtime
        except Exception:
            pass

    def delete(self, name: str) -> dict | None:
        """캐시 한 장을 **휴지통으로 옮긴다** (사용자 결정 2026-08-18, v2-port-audit D7).

        ★★여기는 **Anlas 가 든 자리**라 되돌릴 수 있어야 한다는 요구가 가장 세다 —
          지운 캐시를 다시 얻으려면 같은 그림 값을 다시 지불한다.
        ★`key_map.json` 을 **먼저** 정리한다. 안 지우면 다음 생성이 없는 파일을 가리키는
          키를 찾다가 캐시 미스로 떨어져 같은 그림을 다시 굽는다 (유료).
        ★그래서 걷어낸 키를 **돌려준다** — 되돌리기가 파일만 되살리고 키를 안 되살리면
          그림은 돌아왔는데 캐시는 여전히 미스다 (되돌린 뜻이 없어진다)."""
        f = self.path_of(name)
        if f is None:
            return None
        keys = [k for k, v in self._keys().items() if v == f.name]
        if keys:
            self._put_keys({k: "" for k in keys})
        r = trash.send_at(self.dir, [f.name])
        if not r["moved"]:
            return None
        # ★메모리 층도 함께 비운다 — 안 비우면 지운 뒤에도 그 인코딩이 살아 있다
        for k in keys:
            self._data.pop(k, None)
        return {"ok": True, "name": f.name, "trashed": r["moved"], "keys": keys}

    def restore(self, entries: list[dict], keys: list[str] | None = None) -> dict:
        """휴지통에서 되살린다 (「되돌리기」). ★캐시 키도 같이 되살린다 — 이름이 바뀌었으면
        새 이름으로 이어 준다."""
        r = trash.restore_at(self.dir, entries)
        to = {p["file"]: p["to"] for p in r["pairs"]}
        if keys and to:
            new = next(iter(to.values()))
            self._put_keys({k: new for k in keys})
        return r

    def entries(self) -> list[dict]:
        """캐시 뷰어용 목록 — vibe 데이터 자체는 빼고 메타만."""
        out: list[dict] = []
        if not self.dir.exists():
            return out
        for f in sorted(self.dir.glob("*.png"), reverse=True):
            try:
                with Image.open(f) as img:
                    info = img.info
                    out.append({
                        "file": f.name,
                        "cache_key": info.get("cache_key", ""),
                        "model": info.get("model", ""),
                        "info_extracted": float(info.get("info_extracted", 1) or 1),
                        "strength": float(info.get("strength", 0.6) or 0.6),
                        "size": [img.width, img.height],
                    })
            except Exception:
                continue
        return out


async def encode(image_b64: str, model: str, info_extracted: float, strength: float,
                 token: str, cache: VibeCache, image_name: str = "vibe") -> str:
    """V4+ 용 vibe 사전 인코딩. ★캐시가 있으면 **네트워크를 타지 않는다** (유료 호출)."""
    key = cache_key(image_b64, model, info_extracted)
    cached = cache.get(key)
    if cached:
        try:
            base64.b64decode(cached)  # 손상된 캐시는 무시하고 다시 굽는다
            return cached
        except Exception:
            pass

    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    payload = {
        "image": image_b64,
        "information_extracted": as_nai_number(info_extracted),
        "model": model,
    }
    async with httpx.AsyncClient(timeout=120) as client:
        res = await client.post(ENCODE_ENDPOINT, headers=headers, json=payload)
        if res.status_code != 200:
            raise RuntimeError(f"vibe 인코딩 실패 {res.status_code}: {res.text[:300]}")
        encoded = base64.b64encode(res.content).decode("utf-8")

    cache.put(key, encoded, image_b64, strength, info_extracted, model, image_name)
    return encoded
