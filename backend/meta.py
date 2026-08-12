"""생성 이미지의 메타데이터 — 읽기 · 정규화 · 쓰기 · 제거.

★**진실은 이미지 메타데이터에 있다** (feature-inventory K절). 폴더 구조를 상태의 정본으로
  삼지 않으므로, 사용자가 탐색기에서 파일을 옮기거나 이름을 고쳐도 갤러리·재현이 깨지지 않는다.

★이 파일은 **v2(`d:\\PeroPix\\backend.py` · `index.html`)의 이식**이다. 재구현이 아니다.
  아래 셋은 v2 에서 시행착오로 굳은 코드라 **동작을 바꾸지 말 것** (docs/v2-port-plan.md):

    1. `read_raw` 의 **6단계 폴백 순서** — 순서 자체가 규칙이다. Comment 가 있으면 EXIF 를
       안 보고, stealth 는 앞이 전부 실패했을 때만 본다 (opaque 이미지에서 헛돌지 않게).
    2. `normalize` 의 **퀄리티 태그 제거 패턴** — 어긋나면 Apply 할 때마다 태그가 중복 누적된다.
       V4.5 패턴이 Enhance 용·일반용 **두 가지**다.
    3. `strip` 의 **알파 LSB 처리** — NAI 는 스테가노그래피로 메타데이터를 한 벌 더 심는다.
       tEXt 만 지우면 남는다. 단 실제 투명도가 있는 그림은 건드리면 안 된다.

원본 위치: read_raw ← backend.py:629-784 · normalize ← index.html:17422-17668 ·
           write ← backend.py:509-582 · strip ← backend.py:2794-2821
"""
from __future__ import annotations

import gzip
import io
import json
from pathlib import Path

import piexif
import piexif.helper
from PIL import Image
from PIL.PngImagePlugin import PngInfo

# NAI 원본 PNG tEXt 청크 — 이걸 보존해야 NAI 공홈이 자기 이미지로 인식한다 (backend.py:506)
ND_PNG_TEXT_CHUNKS = ("Title", "Description", "Software", "Source", "Generation time")


# ── 1. 읽기 ──────────────────────────────────────────────────


def _decode_stealth_pnginfo(img: Image.Image) -> dict | None:
    """NAI stealth pnginfo(알파 채널 LSB 스테가노그래피) 디코드.

    다른 유저가 공유한 파일은 업로드·재저장에서 PNG tEXt(Comment)가 제거되지만,
    알파 채널에 숨은 데이터는 남는다 (NAI 공홈이 이걸 읽는다).
    알파 LSB 를 **column-major**(x 바깥, y 안쪽)로 읽어 시그니처·길이·페이로드를 복원한다."""
    try:
        if img.mode != "RGBA":
            return None
        import numpy as np

        alpha = np.array(img)[:, :, 3]
        bits = (alpha & 1).astype(np.uint8).T.reshape(-1)  # column-major
        sig_bits = 15 * 8
        if bits.size < sig_bits + 32:
            return None
        # 시그니처 확인 (opaque 이미지는 알파 LSB 가 전부 1이라 여기서 걸러진다)
        sig = np.packbits(bits[:sig_bits]).tobytes().decode("utf-8", "ignore")
        if sig not in ("stealth_pnginfo", "stealth_pngcomp"):
            return None
        compressed = sig == "stealth_pngcomp"
        off = sig_bits
        param_len = int.from_bytes(np.packbits(bits[off : off + 32]).tobytes(), "big")
        off += 32
        if param_len <= 0 or param_len % 8 != 0 or off + param_len > bits.size:
            return None
        payload = np.packbits(bits[off : off + param_len]).tobytes()
        raw = gzip.decompress(payload).decode("utf-8") if compressed else payload.decode("utf-8")
        outer = json.loads(raw)  # {Description, Software, Source, Comment, ...}
        comment = outer.get("Comment")  # 내부 Comment(문자열 JSON)가 실제 NAI 메타데이터
        if isinstance(comment, str):
            return json.loads(comment)
        if isinstance(comment, dict):
            return comment
        return outer or None
    except Exception:
        return None


def read_raw(image_bytes: bytes) -> dict:
    """이미지에서 **원본 형식 그대로** 메타데이터를 읽는다. 없으면 빈 dict.

    ★**단계 순서가 규칙이다** (backend.py:629-784 이식). 바꾸면 이전 세대 파일 복원이
      조용히 틀린다. Pillow 버전에 따라 UserComment 가 str/bytes 로 갈리는 대응도 실측 산물."""
    meta: dict = {}
    try:
        img = Image.open(io.BytesIO(image_bytes))
        info = getattr(img, "info", {}) or {}

        # 1. PNG Comment (NAI 호환) — 있으면 여기서 끝. EXIF 를 보지 않는다.
        if "Comment" in info:
            try:
                c = info["Comment"]
                if isinstance(c, bytes):
                    c = c.decode("utf-8")
                return json.loads(c)
            except Exception:
                pass

        # 2. ComfyUI 형식 (prompt/workflow 키)
        if "prompt" in info:
            try:
                p = info["prompt"]
                if isinstance(p, bytes):
                    p = p.decode("utf-8")
                wf = info.get("workflow")
                if isinstance(wf, bytes):
                    wf = wf.decode("utf-8")
                return {
                    "_comfyui": True,
                    "prompt": json.loads(p),
                    "workflow": json.loads(wf) if wf else None,
                }
            except Exception:
                pass

        # 3. 레거시 peropix 필드 → NAI 호환 형식으로 변환
        if "peropix" in info:
            try:
                legacy = json.loads(info["peropix"])
                return {
                    "prompt": legacy.get("prompt", ""),
                    "uc": legacy.get("negative_prompt", ""),
                    "seed": legacy.get("seed"),
                    "width": legacy.get("width"),
                    "height": legacy.get("height"),
                    "steps": legacy.get("steps"),
                    "scale": legacy.get("cfg"),
                    "sampler": legacy.get("sampler"),
                    "noise_schedule": legacy.get("scheduler"),
                    "request_type": legacy.get("nai_model"),
                    "ucPreset": legacy.get("uc_preset"),
                    "qualityToggle": legacy.get("quality_tags"),
                    "cfg_rescale": legacy.get("cfg_rescale"),
                    "peropix": {
                        "version": 0,
                        "provider": legacy.get("provider", "nai"),
                        "character_prompts": legacy.get("character_prompts", []),
                        "variety_plus": legacy.get("variety_plus", False),
                        "furry_mode": legacy.get("furry_mode", False),
                    },
                }
            except Exception:
                pass

        # 4. EXIF UserComment — getexif() (Pillow 9.0+, WebP/JPEG 모두)
        try:
            exif = img.getexif()
            if exif:
                ifd = exif.get_ifd(0x8769)  # ExifIFD
                if ifd and 0x9286 in ifd:  # UserComment
                    v = ifd[0x9286]
                    uc = None
                    if isinstance(v, str):
                        uc = v
                    elif isinstance(v, bytes):
                        try:
                            uc = piexif.helper.UserComment.load(v)
                        except Exception:
                            try:
                                uc = v.decode("utf-8")
                            except Exception:
                                pass
                    if uc:
                        return json.loads(uc)
        except Exception:
            pass

        # 5. EXIF raw bytes (WebP — piexif.load 는 JPEG 만 받는다)
        try:
            raw = info.get("exif")
            if raw:
                d = piexif.load(raw)
                if "Exif" in d and piexif.ExifIFD.UserComment in d["Exif"]:
                    return json.loads(piexif.helper.UserComment.load(d["Exif"][piexif.ExifIFD.UserComment]))
        except Exception:
            pass

        # 6. piexif 로 직접 (JPEG 전용)
        try:
            d = piexif.load(image_bytes)
            if "Exif" in d and piexif.ExifIFD.UserComment in d["Exif"]:
                return json.loads(piexif.helper.UserComment.load(d["Exif"][piexif.ExifIFD.UserComment]))
        except Exception:
            pass

        # 7. NAI stealth pnginfo — ★앞이 전부 실패했을 때만.
        stealth = _decode_stealth_pnginfo(img)
        if stealth:
            return stealth
    except Exception:
        pass
    return meta


# ── 2. 정규화 ────────────────────────────────────────────────
# index.html:17422-17668 이식. NAI 원본과 PeroPix 확장을 하나의 내부 형식으로 맞춘다.

# ★두 가지다 — Enhance 용과 일반용. 하나만 두면 Enhance 이미지에서 태그가 남는다.
V45_QUALITY_TAGS = [
    ", very aesthetic, masterpiece, no text, -2::upscaled, blurry::,",  # Enhance
    ", very aesthetic, masterpiece, no text",  # 일반
]

# ★한 글자도 바꾸지 말 것 — 네거티브 앞에서 이 문자열을 그대로 대조해 프리셋을 알아낸다.
V45_UC_PRESETS = {
    "Heavy": "nsfw, lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page",
    "Light": "nsfw, lowres, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, multiple views, very displeasing, too many watermarks, negative space, blank page",
    "Furry Focus": "nsfw, {worst quality}, distracting watermark, unfinished, bad quality, {widescreen}, upscale, {sequence}, {{grandfathered content}}, blurred foreground, chromatic aberration, sketch, everyone, [sketch background], simple, [flat colors], ych (character), outline, multiple scenes, [[horror (theme)]], comic",
    "Human Focus": "nsfw, lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page, @_@, mismatched pupils, glowing eyes, bad anatomy",
}

UC_PRESET_BY_NUM = {0: "Heavy", 1: "Light", 2: "Human Focus", 3: "None"}


def _preset_candidates() -> list[tuple[str, str]]:
    """각 프리셋의 정상형 + NSFW 변형.

    ★NAI 는 프롬프트에 NSFW 가 있으면 프리셋 맨 앞의 `nsfw, ` 를 빼고 넣는다 (공홈 캡처로 확인).
    ★길이 내림차순 정렬 — 안 하면 짧은 Heavy 가 먼저 걸려 긴 Human Focus 를 놓친다."""
    out: list[tuple[str, str]] = []
    for name, tags in V45_UC_PRESETS.items():
        out.append((name, tags))
        if tags.startswith("nsfw, "):
            out.append((name, tags[6:]))
    out.sort(key=lambda x: len(x[1]), reverse=True)
    return out


def _strip_uc_preset(neg: str):
    """네거티브 앞에서 프리셋 태그를 감지·제거. 매칭되면 (이름, 나머지), 아니면 None."""
    neg = neg or ""
    for name, cand in _preset_candidates():
        if neg.startswith(cand):
            rest = neg[len(cand) :]
            return name, rest.lstrip(", ").lstrip()
    return None


def _detect_uc_preset_from_diff(full_uc: str, base_neg: str):
    """구버전 PeroPix 이미지(uc_preset 미저장)의 프리셋 복원.

    최종 uc = <프리셋 태그> + ", " + <클린 네거티브> 구조이므로 차분으로 역산한다.
    PeroPix 가 자기 테이블로 만든 값이라 매칭이 보장된다. 못 맞추면 None."""
    full_uc, base_neg = full_uc or "", base_neg or ""
    if full_uc == base_neg:
        return "None"
    prefix = full_uc
    if base_neg:
        if full_uc.endswith(base_neg):
            prefix = full_uc[: len(full_uc) - len(base_neg)].rstrip().rstrip(",").rstrip()
        else:
            return None
    for name, cand in _preset_candidates():
        if prefix == cand:
            return name
    return None


def normalize(meta: dict | None) -> dict | None:
    """NAI 원본 + PeroPix 확장 → 내부 형식. `read_raw` 의 결과를 넣는다."""
    if not meta:
        return None
    # 이미 내부 형식이면 그대로
    if "negative" in meta or "cfg" in meta or "nai_model" in meta:
        return meta

    ppx = meta.get("peropix") or {}
    is_pure_nai = "peropix" not in meta

    # 캐릭터 프롬프트 — peropix 확장 > v4_prompt > characterPrompts
    char_prompts: list[str] = []
    if ppx.get("character_prompts"):
        char_prompts = list(ppx["character_prompts"])
    elif ((meta.get("v4_prompt") or {}).get("caption") or {}).get("char_captions"):
        char_prompts = [
            c.get("char_caption", "")
            for c in meta["v4_prompt"]["caption"]["char_captions"]
            if c.get("char_caption")
        ]
    elif meta.get("characterPrompts"):
        char_prompts = [c.get("prompt", "") for c in meta["characterPrompts"] if c.get("prompt")]

    # 캐릭터 네거티브 — ★같은 인덱스로 정렬해야 남의 네거티브가 안 붙는다
    char_negs: list[str] = []
    if ppx.get("character_negatives"):
        char_negs = list(ppx["character_negatives"])
    elif ((meta.get("v4_negative_prompt") or {}).get("caption") or {}).get("char_captions"):
        char_negs = [c.get("char_caption", "") for c in meta["v4_negative_prompt"]["caption"]["char_captions"]]

    # 좌표 — v4_prompt 의 centers
    centers: list[dict | None] = []
    for c in ((meta.get("v4_prompt") or {}).get("caption") or {}).get("char_captions") or []:
        cs = c.get("centers") or []
        centers.append(cs[0] if cs else None)

    uc_preset = UC_PRESET_BY_NUM.get(meta.get("ucPreset"), meta.get("ucPreset")) or "Heavy"
    quality_tags = meta.get("qualityToggle")
    slot_prompt = ppx.get("slot_prompt") or ""
    prompt = meta.get("prompt") or ""
    negative = meta.get("uc") or ""

    if is_pure_nai:
        # 순수 NAI: 프롬프트 끝의 퀄리티 태그 제거 (안 지우면 Apply 때마다 중복 누적)
        removed = False
        for pat in V45_QUALITY_TAGS:
            if prompt.endswith(pat):
                prompt = prompt[: -len(pat)]
                quality_tags = True
                removed = True
                break
        if not removed:
            quality_tags = False
        res = _strip_uc_preset(negative)
        if res:
            uc_preset, negative = res
        else:
            uc_preset = "None"
    else:
        # PeroPix 이미지
        base_neg = ppx.get("base_negative_prompt")
        if base_neg is not None:
            negative = base_neg or ""
        if ppx.get("uc_preset") is not None:
            uc_preset = ppx["uc_preset"]
        elif base_neg is not None:
            uc_preset = _detect_uc_preset_from_diff(meta.get("uc") or "", base_neg or "") or "None"
        else:
            res = _strip_uc_preset(negative)
            if res:
                uc_preset, negative = res
            else:
                uc_preset = "None"
        if ppx.get("quality_tags") is not None:
            quality_tags = ppx["quality_tags"]
        else:
            quality_tags = any((meta.get("prompt") or "").endswith(p) for p in V45_QUALITY_TAGS)

        # base_prompt 가 있으면 직접 (v3+), 없으면 슬롯 프롬프트 수동 제거 (v2 하위호환)
        if ppx.get("base_prompt") is not None:
            prompt = ppx["base_prompt"] or ""
        elif slot_prompt:
            for pat in V45_QUALITY_TAGS:
                if prompt.endswith(pat):
                    prompt = prompt[: -len(pat)]
                    quality_tags = True
                    break
            for suffix in (", " + slot_prompt, "," + slot_prompt, slot_prompt):
                if prompt.endswith(suffix):
                    prompt = prompt[: -len(suffix)].rstrip().rstrip(",").rstrip()
                    break

    variety_plus = bool(ppx.get("variety_plus"))
    if not variety_plus and meta.get("skip_cfg_above_sigma") is not None:
        variety_plus = True

    furry = bool(ppx.get("furry_mode"))
    if not furry and (meta.get("prompt") or "").startswith("fur dataset,"):
        furry = True

    # ★모델명 — request_type 이 "PromptGenerateRequest" 같은 내부 타입이면 무시한다
    nai_model = ""
    for key in ("request_type", "model"):
        v = meta.get(key)
        if isinstance(v, str) and v.startswith("nai-diffusion"):
            nai_model = v
            break

    return {
        "prompt": prompt,
        "negative": negative,
        "characters": [
            {
                "prompt": p,
                "negative": char_negs[i] if i < len(char_negs) else "",
                "center": centers[i] if i < len(centers) else None,
            }
            for i, p in enumerate(char_prompts)
        ],
        "slot_prompt": slot_prompt,
        "seed": meta.get("seed"),
        "width": meta.get("width"),
        "height": meta.get("height"),
        "steps": meta.get("steps"),
        "cfg": meta.get("scale"),
        "sampler": meta.get("sampler"),
        "scheduler": meta.get("noise_schedule") or "karras",
        "nai_model": nai_model,
        "smea": "SMEA+DYN" if meta.get("sm_dyn") else ("SMEA" if meta.get("sm") else "none"),
        "uc_preset": uc_preset,
        "quality_tags": bool(quality_tags),
        "cfg_rescale": meta.get("cfg_rescale"),
        "variety_plus": variety_plus,
        "furry_mode": furry,
        "vibe_transfer": ppx.get("vibe_transfer"),
        "nai_vibes": {
            "images": meta.get("reference_image_multiple") or [],
            "strengths": meta.get("reference_strength_multiple") or [],
            "info_extracted": meta.get("reference_information_extracted_multiple") or [],
        },
        "precise_ref_count": len(meta.get("director_reference_strength_values") or []),
        "pure_nai": is_pure_nai,
        "raw": meta,
    }


def read(path: Path) -> dict | None:
    """파일 한 장의 내부 형식 메타데이터. 없거나 못 읽으면 None.

    ★못 읽는 것은 **정상 경우다** — 밖에서 가져온 그림, 메타데이터를 지운 그림.
      예외로 만들지 않는다 (갤러리는 그런 파일도 보여줘야 한다)."""
    try:
        data = path.read_bytes()
        with Image.open(io.BytesIO(data)) as im:
            size = im.size
            info = dict(im.info)
    except Exception:
        return None

    out = normalize(read_raw(data)) or {}
    out.setdefault("width", size[0])
    out.setdefault("height", size[1])
    if out.get("width") is None:
        out["width"] = size[0]
    if out.get("height") is None:
        out["height"] = size[1]
    # 표시용 문자열 — NAI 가 PNG tEXt 에 넣는 것. 모델 **id**(nai_model)와 다르다.
    if "Source" in info:
        out["source"] = str(info["Source"])
    if "Software" in info:
        out["software"] = str(info["Software"])
    return out or None


# ── 3. 쓰기 ──────────────────────────────────────────────────


def write(image_bytes: bytes, metadata: dict, fmt: str = "PNG", quality: int = 95,
          extra_png_chunks: dict | None = None) -> bytes:
    """메타데이터를 박아 넣은 이미지 바이트를 돌려준다 (backend.py:509-582 이식).

    ★PNG 는 EXIF 를 직접 지원하지 않아 tEXt 로만 넣는다. 그리고 **NAI 원본 청크를 보존**해야
      (특히 `Source`) NAI 공홈이 자기 이미지로 인식한다."""
    try:
        js = json.dumps(metadata, ensure_ascii=False)
        img = Image.open(io.BytesIO(image_bytes))
        out = io.BytesIO()
        up = fmt.upper()

        if up == "PNG":
            info = PngInfo()
            if extra_png_chunks:
                for name in ND_PNG_TEXT_CHUNKS:
                    v = extra_png_chunks.get(name)
                    if isinstance(v, str) and v:
                        info.add_text(name, v)
            info.add_text("Comment", js)
            img.save(out, format="PNG", pnginfo=info)
        elif up in ("JPEG", "JPG"):
            exif = piexif.dump({
                "0th": {}, "GPS": {}, "1st": {}, "thumbnail": None,
                "Exif": {piexif.ExifIFD.UserComment: piexif.helper.UserComment.dump(js, encoding="unicode")},
            })
            if img.mode in ("RGBA", "P"):
                img = img.convert("RGB")
            img.save(out, format="JPEG", exif=exif, quality=quality)
        elif up == "WEBP":
            exif = piexif.dump({
                "0th": {}, "GPS": {}, "1st": {}, "thumbnail": None,
                "Exif": {piexif.ExifIFD.UserComment: piexif.helper.UserComment.dump(js, encoding="unicode")},
            })
            img.save(out, format="WEBP", exif=exif, quality=quality)
        else:
            img.save(out, format=fmt)
        return out.getvalue()
    except Exception:
        return image_bytes  # 실패하면 원본을 돌려준다 — 그림을 잃지 않는 것이 우선


def strip(image_bytes: bytes, fmt: str = "PNG", quality: int = 95) -> bytes:
    """메타데이터를 **완전히** 제거한다 (backend.py:2794-2821 이식).

    ★tEXt/EXIF 만 지우면 안 된다 — NAI 는 **알파 채널 LSB 스테가노그래피**로 한 벌 더 심는다.
    ★단 실제 투명도가 있는 그림은 건드리지 않는다. 알파 최솟값이 254 이상일 때만 불투명으로
      본다 (그때만 LSB 가 데이터다)."""
    import numpy as np

    img = Image.open(io.BytesIO(image_bytes))
    up = fmt.upper()
    if up in ("JPEG", "JPG") and img.mode in ("RGBA", "P"):
        img = img.convert("RGB")

    arr = np.array(img)
    if arr.ndim == 3 and arr.shape[2] == 4:
        if arr[:, :, 3].min() >= 254:
            arr[:, :, 3] = 255  # 불투명 — 스테가노그래피 LSB 를 지운다
    clean = Image.fromarray(arr)

    out = io.BytesIO()
    if up in ("JPEG", "JPG"):
        clean.save(out, format="JPEG", quality=quality, exif=b"")
    elif up == "WEBP":
        clean.save(out, format="WEBP", quality=quality, exif=b"")
    else:
        clean.save(out, format="PNG", pnginfo=PngInfo())  # 빈 pnginfo 를 명시
    return out.getvalue()
