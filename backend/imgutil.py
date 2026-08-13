"""이미지 입력 보조 — v2.x `backend.py:322-381` 이식.

★두 함수 다 **재인코딩을 최대한 피한다.** PIL 로 다시 구운 PNG 가 NAI 와 호환되지 않는
  경우가 있어서 v2 가 그렇게 만들었다. "어차피 PNG 로 통일하면 되지" 로 바꾸지 말 것.
"""
from __future__ import annotations

import base64
import io

from PIL import Image, ImageFilter


def ensure_png_base64(b64: str, force_reencode: bool = False) -> str:
    """base64 이미지를 PNG 로 만든다 — **필요할 때만** 다시 굽는다.

    ★RGBA 를 RGB 로 눕히지 않는다. NAI API 가 RGBA 를 받고, vibe 인코딩 호환에도 필요하다
      (v2 backend.py:322 주석)."""
    data = base64.b64decode(b64)
    img = Image.open(io.BytesIO(data))

    if not force_reencode and img.format == "PNG" and img.mode in ("RGB", "RGBA"):
        return b64

    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("utf-8")


def binarize_mask(b64_mask: str, threshold: int = 1) -> str:
    """인페인트 마스크를 **순흑백**으로 만든다.

    ★NAI 는 순수 흑백만 받는다 — 회색 가장자리(안티앨리어싱)가 남으면 솔기가 생긴다.
    ★**이미 순흑백이면 원본을 그대로 돌려준다.** PIL 재인코딩이 NAI 와 호환 안 되는
      경우가 있어서다 (v2 backend.py:346 주석). 최적화가 아니라 호환성 조치다."""
    data = base64.b64decode(b64_mask)
    img = Image.open(io.BytesIO(data))

    if img.mode == "RGBA":
        values = set(img.split()[0].getdata())  # 흑백이면 R=G=B
    else:
        values = set(img.convert("L").getdata())

    if values <= {0, 255}:
        return b64_mask

    gray = img.convert("L")
    binary = gray.point(lambda x: 255 if x >= threshold else 0, mode="L")
    alpha = Image.new("L", binary.size, 255)
    out = Image.merge("RGBA", (binary, binary, binary, alpha))
    buf = io.BytesIO()
    out.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("utf-8")


def preprocess_base_image(b64_image: str, width: int, height: int) -> str:
    """베이스 그림을 **요청 해상도로 리샘플하고 흰 배경 위에 평탄화**한다 (공홈 `rX`).

    ★서버 리사이즈에 맡기지 말 것 — 필터가 다르면 **초기 latent 가 달라진다.**
      공홈은 pica 의 lanczos3 를 쓴다. PIL 의 LANCZOS 가 같은 계열이다.
    ★`docs/nai-web-reference.md` 1절의 공통 전송 구간이
      `image = await rX(image, transparent?"transparent":"white", height, width, false)` 로
      **모든** 베이스 이미지에 건다 — i2i·인페인트뿐 아니라 **Enhance 도** 지난다.
      6절의 "원본을 미리 확대하지 않는다"는 `generateEnhance` **함수 안**의 이야기이고,
      그 뒤 공통 구간이 목표 해상도로 키운다. 기능 함수만 읽고 옮기면 여기서 틀린다.
    ★투명 PNG 를 그대로 보내면 결과가 갈린다. 알파는 **흰색**에 깐다 —
      `convert("RGB")` 는 검정에 깔아서 다른 그림이 된다."""
    img = Image.open(io.BytesIO(base64.b64decode(b64_image)))
    if img.size != (width, height):
        img = img.resize((width, height), Image.LANCZOS)
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        canvas = Image.new("RGBA", img.size, (255, 255, 255, 255))
        canvas.alpha_composite(img)
        img = canvas.convert("RGB")
    elif img.mode != "RGB":
        img = img.convert("RGB")

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("utf-8")


def blend_mask_8px(b64_mask: str, width: int, height: int) -> Image.Image:
    """인페인트 결과를 원본에 되붙일 때 쓰는 **소프트 마스크** (공홈 합성 파이프라인).

    1/8 마스크 → `dilate(반경 4)` → 8배 확대 → `blur(반경 20)` ×2.
    1/8 스케일의 반경 4 는 원본 기준 **약 32px 확장**이다.

    ★와이어로 보내는 마스크(`quantize_mask_8px`)와 **다른 물건**이다. 이건 로컬 합성 전용.
    ★공홈의 dilate/blur 워커 본체는 지연 로드 청크라 번들에 없다 — 반경 값과 순서만
      확인됐고 **커널 형태는 미확인**이다. 픽셀 단위로 같지는 않고 "경계 32px 을 부드럽게
      섞는다"가 같다. (`docs/nai-web-reference.md` 7절)"""
    mask = Image.open(io.BytesIO(base64.b64decode(b64_mask))).convert("L")
    if mask.size != (width, height):
        mask = mask.resize((width, height), Image.NEAREST)

    sw, sh = max(1, width // 8), max(1, height // 8)
    small = mask.resize((sw, sh), Image.NEAREST).point(lambda v: 255 if v >= 155 else 0, mode="L")
    # dilate 반경 4 = 9x9 최대값 필터 (1/8 스케일)
    small = small.filter(ImageFilter.MaxFilter(9))
    blend = small.resize((width, height), Image.NEAREST)
    for _ in range(2):
        blend = blend.filter(ImageFilter.GaussianBlur(20))
    return blend


def composite_inpaint(result_png: bytes, sent_image_b64: str, b64_mask: str) -> bytes:
    """인페인트 결과를 **보낸 원본 위에** 소프트 마스크로 되붙인다.

    ★NAI 결과는 마스크 밖도 미세하게 달라진다. 그대로 저장하면 고치지 않은 자리가 바뀐다.
    ★원본은 **NAI 로 보낸 그 이미지**여야 한다 (`preprocess_base_image` 를 거친 것) —
      알파를 검정에 깐 것으로 합성하면 투명했던 자리가 검게 되돌아온다.
    ★이진 마스크로 자르면 경계에 계단·색단차가 남는다. 그래서 소프트 마스크다."""
    with Image.open(io.BytesIO(result_png)) as res:
        res.load()
        w, h = res.size
        original = Image.open(io.BytesIO(base64.b64decode(sent_image_b64))).convert("RGB")
        if original.size != (w, h):
            original = original.resize((w, h), Image.LANCZOS)
        out = Image.composite(res.convert("RGB"), original, blend_mask_8px(b64_mask, w, h))
        # ★원본 PNG 의 tEXt 청크(NAI 메타데이터)를 그대로 물려준다 — 다시 저장하면서
        #   잃으면 공홈이 자기 이미지로 인식하지 못하고 재생성도 안 된다
        info = res.info
    buf = io.BytesIO()
    out.save(buf, format="PNG", pnginfo=_pnginfo_of(info))
    return buf.getvalue()


def _pnginfo_of(info: dict):
    """PIL 로 다시 저장할 때 tEXt 청크를 넘겨주기 위한 그릇."""
    from PIL import PngImagePlugin

    meta = PngImagePlugin.PngInfo()
    for k, v in (info or {}).items():
        if isinstance(v, str):
            meta.add_text(k, v)
    return meta


def quantize_mask_8px(b64_mask: str, width: int, height: int) -> str:
    """인페인트 마스크를 **8px 격자**에 맞추고 요청 해상도로 되돌린다.

    정본은 `docs/nai-web-reference.md` 7절 (공홈 `generateInfill`):
      1/8 축소(**스무딩 없음**) → 임계 155 → 스무딩 없이 원래 크기로 복원 = 8px 블록.

    ★단순 이진화(`binarize_mask`)와 다른 물건이다. 공홈이 보내는 마스크는 **8px 블록**이라,
      우리가 1px 단위로 보내면 같은 마스크로도 다른 그림이 나온다.
    ★크기는 **정렬된 요청 해상도**로 맞춘다. 공홈은 마스크 리사이즈를 64 정렬보다 먼저 해서
      정렬로 크기가 바뀌면 마스크와 요청 해상도가 어긋나는데(공홈 쪽 결함), 우리는 정렬된
      크기로 만든다."""
    mask = Image.open(io.BytesIO(base64.b64decode(b64_mask))).convert("L")
    if mask.size != (width, height):
        mask = mask.resize((width, height), Image.NEAREST)

    small = mask.resize((max(1, width // 8), max(1, height // 8)), Image.NEAREST)
    small = small.point(lambda v: 255 if v >= 155 else 0, mode="L")
    mask = small.resize((width, height), Image.NEAREST)

    alpha = Image.new("L", mask.size, 255)
    out = Image.merge("RGBA", (mask, mask, mask, alpha))
    buf = io.BytesIO()
    out.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("utf-8")


#: 인페인트 타일 한 장의 상한 — 1024×1024. 공홈 Focused Inpainting 과 같은 한도이고,
#: Opus 무료 판정(`src/lib/anlas.ts`)도 이 값을 본다. 넘기면 아낄 것 없이 요금만 는다.
TILE_MAX_PX = 1_048_576


def fit_tile_rect(rect: dict, iw: int, ih: int) -> tuple[int, int, int, int]:
    """크롭 사각형을 **보낼 수 있는 형태**로 다듬는다 — 64 배수 · 그림 안 · 1MP 이하.

    ★화면이 준 값을 그대로 믿지 않는다. 요금이 걸린 값이고(1MP 를 넘으면 Opus 무료가
      깨진다), 64 배수가 아니면 NAI 가 거절한다.
    ★**중심을 지킨 채** 줄인다 — 마스크를 감싸라고 잡은 사각형이라 한쪽 모서리를 깎으면
      칠한 자리가 밖으로 밀려난다."""
    x, y, w, h = (int(rect.get(k, 0)) for k in ("x", "y", "w", "h"))
    cx, cy = x + w / 2, y + h / 2

    # 64 배수로 내린다 (올리면 상한을 넘길 수 있다). 그림보다 크면 그림에 맞춘다
    w = max(64, min(int(w) // 64 * 64, iw // 64 * 64 or 64))
    h = max(64, min(int(h) // 64 * 64, ih // 64 * 64 or 64))

    # 1MP 를 넘으면 **비율을 지킨 채** 64 배수 단위로 줄인다
    while w * h > TILE_MAX_PX and (w > 64 or h > 64):
        if w >= h and w > 64:
            w -= 64
        elif h > 64:
            h -= 64
        else:
            break

    x = int(round(cx - w / 2))
    y = int(round(cy - h / 2))
    # 그림 안으로 밀어 넣는다 (경계에 붙는다)
    x = max(0, min(x, iw - w))
    y = max(0, min(y, ih - h))
    return x, y, w, h


def fit_to_1mp(w: int, h: int) -> tuple[int, int]:
    """조각을 **1MP 에 맞춰 키운 요청 크기**. 비율을 지키고 64 배수로 맞춘다.

    ★Focused Inpainting 의 핵심이 이 한 줄이다: 잘라낸 조각을 **그 크기 그대로** 보내면
      작게 그려지고, 1MP 로 키워 보내면 같은 자리를 더 촘촘하게 그린다. 공홈이 하는 그대로다
      (`docs/nai-web-reference.md`: 요청 크기는 사각형 비율을 1,048,576px 에 맞춘 값).
    ★조각이 589,824px(768×768) 이하면 확대율이 반드시 4/3 을 넘는다. 화면이 사각형을
      그 크기로 묶는 이유다 (`src/lib/focused.ts`).
    ★**넓이가 먼저고 비율 오차에는 천장(6%)을 둔다.** 오차를 먼저 보면 확대가 사라진다.
      320×1408 은 그대로가 오차 0 이라 1등이 되어 ×1.0 이 나왔다 (실측 2026-08-13).
      화면 쪽 `fitToPixels` 와 **같은 규칙이어야 한다** (표시한 크기로 실제로 나가야 하므로)."""
    if w <= 0 or h <= 0:
        return max(64, w), max(64, h)
    ar = w / h
    best: tuple[int, float, int, int] | None = None   # (넓이, 오차, w, h). 넓이가 클수록 좋다
    loose: tuple[float, int, int] | None = None       # 천장을 못 넘으면 오차가 가장 작은 것
    for cw in range(64, 4097, 64):
        ch = max(64, round(cw / ar / 64) * 64)
        px = cw * ch
        if px > TILE_MAX_PX:
            continue
        err = abs(cw / ch - ar) / ar
        if loose is None or err < loose[0]:
            loose = (err, cw, ch)
        if err > 0.06:
            continue
        if best is None or (px, -err) > (best[0], -best[1]):
            best = (px, err, cw, ch)
    if best:
        return best[2], best[3]
    return (loose[1], loose[2]) if loose else (w, h)


def resize_png(png: bytes, w: int, h: int) -> bytes:
    """다 만든 그림을 다른 크기로. ★tEXt 청크를 물려준다 (`paste_tile` 과 같은 이유)."""
    with Image.open(io.BytesIO(png)) as im:
        im.load()
        info = im.info
        if im.size == (w, h):
            return png
        out = im.convert("RGB").resize((w, h), Image.LANCZOS)
    buf = io.BytesIO()
    out.save(buf, format="PNG", pnginfo=_pnginfo_of(info))
    return buf.getvalue()


def crop_to_base64(img: Image.Image, x: int, y: int, w: int, h: int) -> str:
    """타일을 잘라 PNG base64 로. ★마스크로 지우지 않은 **원본 픽셀 그대로** 보낸다."""
    tile = img.crop((x, y, x + w, y + h))
    if tile.mode not in ("RGB", "RGBA"):
        tile = tile.convert("RGB")
    buf = io.BytesIO()
    tile.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("utf-8")


def mask_has_white(b64_mask: str) -> bool:
    """마스크에 칠한 곳이 있나 — 타일 안이 비었으면 생성을 세운다.

    ★익스텐션은 사각형 밖에 칠한 마스크를 **조용히 버린다**(조사 문서 1절). 우리는 세운다."""
    with Image.open(io.BytesIO(base64.b64decode(b64_mask))) as m:
        return m.convert("L").getextrema()[1] >= 155


def paste_tile(
    src: Image.Image, tile_png: bytes, x: int, y: int, w: int | None = None, h: int | None = None
) -> bytes:
    """되그린 타일을 원본 좌표에 얹어 **원본 크기** PNG 를 만든다.

    ★해상도를 지키는 것이 이 기능의 전부다 — 원본은 손대지 않고 타일 자리만 갈아 끼운다.
    ★`w`·`h` 는 **원본에서 잘라낸 사각형의 크기**다. 조각은 1MP 로 키워 보내므로 돌아온
      타일이 그보다 크다. 되붙이기 전에 원래 크기로 되돌린다 (`fit_to_1mp`).
    ★NAI 응답의 tEXt 청크를 결과에 **옮겨 싣는다.** 잃으면 공홈이 자기 이미지로 인식하지
      못하고 우리 「설정까지」 재현도 깨진다 (`composite_inpaint` 와 같은 이유)."""
    with Image.open(io.BytesIO(tile_png)) as tile:
        tile.load()
        info = tile.info
        piece = tile.convert("RGB")
        if w and h and piece.size != (w, h):
            piece = piece.resize((w, h), Image.LANCZOS)
        out = src.convert("RGB").copy()
        out.paste(piece, (x, y))
    buf = io.BytesIO()
    out.save(buf, format="PNG", pnginfo=_pnginfo_of(info))
    return buf.getvalue()


def size_of_base64(b64: str) -> tuple[int, int]:
    """base64 이미지의 크기. 진단 로그용."""
    with Image.open(io.BytesIO(base64.b64decode(b64))) as img:
        return img.size
