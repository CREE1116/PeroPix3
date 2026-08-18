"""검열 — 가릴 곳을 찾아 가린다 (8단계).

★**ONNX 로 바꿔 통째로 번들한다** (사용자 결정 2026-08-05).
  v2 는 ultralytics(`.pt`)로 돌렸고, 그 때문에 **torch 4.4GB** 가 딸려 왔다 (v2 번들 파이썬 실측).
  그래서 v2 는 "처음 켤 때 설치"를 골랐고, 첫 검열마다 수 GB 설치를 기다려야 했다.
  ONNX 로 내보내면 실행기가 `onnxruntime` 하나로 줄어, 모델 39MB 를 앱에 넣어도 부담이 없다.
  → 다운로드 경로·설치 실패 지점·HF 파일 크기 하드코딩이 **통째로 사라진다.**

★**박스만 쓴다.** 모델은 세그멘테이션(`-segm`)이지만 v2 도 마스크를 한 번도 안 봤다
  (`result.masks` 참조 0회). 그래서 mask 계수 32개는 그냥 버린다.

★**cv2 를 쓰지 않는다** (109MB). numpy + Pillow 로 같은 그림을 만든다.

★**imgsz 를 모델에서 읽는다 (여기 640 을 박지 말 것).** 이 모델은 **1024** 로 학습·추론된다
  (`m.overrides['imgsz']`). ultralytics 는 `.pt` 를 부를 때 그 값을 그대로 쓰므로 v2 는 내내
  1024 로 돌고 있었다. 640 으로 내보내면 같은 골든 16장에서 **탐지가 40→36 으로 준다**
  (실측 2026-08-05). 검열에서 탐지 감소는 곧 놓침이라 행동 퇴행이다.

★**모델은 둘**이고 **출력 형식이 다르다.**

    기본 ntd11 (40MB · 1024px)   YOLO11s-seg  — 우리가 NMS 를 돌린다
    고급 XL    (251MB · 1280px)  YOLO26x-seg  — **모델이 이미 NMS 를 했다**(end2end)

  end2end 는 (300, 4+1+1+32) 로 **걸러진 결과**를 낸다. 여기서 NMS 를 또 돌리면 안 된다.
  둘을 가르는 것은 코드가 아니라 **모델 메타데이터**(`end2end`)다. 클래스 이름도 서로 다르다.
  기본은 **가벼운 쪽**이다 — 무거운 쪽이 기본이면 첫 검열이 10배 느려진다.

정확도의 정본은 `.pt` 다 (feature-inventory.md 가 정한 분업: 검증은 torch, 배포는 ONNX).
`test_censor_golden.py` 가 골든 16장으로 대조한다 (2026-08-05):

    기본 — 덮음 40/40 · IoU 0.9975 · 0.3px · conf 0.001 · CPU 0.4초/장
    XL   — 덮음 56/56 · IoU 0.9956 · 0.2px · conf 0.016 · CPU 4.0초/장

문서가 세운 기준(기본 36/36 · 0.981 / XL 48/50)보다 둘 다 낫다.
"""
from __future__ import annotations

import ast
import math
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

MODEL_DIR = Path(__file__).resolve().parent.parent / "models" / "censor"
# ★ultralytics predict 의 기본값. 바꾸면 v2 와 결과가 달라진다 (cfg/default.yaml:54)
IOU_THRES = 0.7
MAX_DET = 300
MAX_NMS = 30000
MAX_WH = 7680
PAD_VALUE = 114  # LetterBox 기본 채움색


def models() -> list[dict]:
    """번들된 모델 목록. ★다운로드 항목이 없다 — 전부 앱에 들어 있다.

    ★**가벼운 것부터** 낸다 (첫 줄이 기본). 이름순으로 두면 무거운 XL 이 기본이 되어
      첫 검열이 몇 배 느려진다. 크기는 곧 무게라 따로 표를 두지 않아도 순서가 유지된다."""
    out = []
    for p in sorted(MODEL_DIR.glob("*.onnx"), key=lambda f: f.stat().st_size):
        try:
            _, names, size, _, _ = _load(p.name)
        except Exception:
            names, size = {}, (0, 0)
        out.append(
            {
                "id": p.stem,
                "file": p.name,
                "classes": list(names.values()),
                "bytes": p.stat().st_size,
                "imgsz": size[0],
            }
        )
    return out


@lru_cache(maxsize=2)
def _load(file: str):
    """세션과 클래스 이름. ★이름은 **모델이 들고 있다** — 코드에 박아 두면 모델을 바꿀 때 어긋난다."""
    import onnxruntime as ort

    p = MODEL_DIR / file
    if not p.exists():
        raise FileNotFoundError(f"검열 모델이 없습니다: {p}")
    so = ort.SessionOptions()
    so.log_severity_level = 3
    sess = ort.InferenceSession(str(p), so, providers=["CPUExecutionProvider"])
    meta = sess.get_modelmeta().custom_metadata_map or {}
    names = ast.literal_eval(meta.get("names", "{}"))
    names = {int(k): str(v) for k, v in names.items()}
    shape = sess.get_inputs()[0].shape  # [1, 3, H, W] — 동적이면 H·W 가 문자열이다
    fixed = isinstance(shape[2], int) and isinstance(shape[3], int)
    # ★크기도 **모델이 들고 있다**. 640 을 박아 두면 1024·1280 모델에서 탐지를 놓친다
    size = (int(shape[2]), int(shape[3])) if fixed else (int(meta.get("imgsz", "[640, 640]").strip("[] ").split(",")[0]),) * 2
    # ★YOLO26(XL)은 **NMS 를 모델이 이미 한다**(end2end). 출력 모양이 통째로 다르다
    e2e = str(meta.get("end2end", "")).lower() == "true"
    return sess, names, size, not fixed, e2e


def default_model() -> str:
    """★기본은 **가벼운 쪽**이다 (models() 주석 참조)."""
    got = sorted(MODEL_DIR.glob("*.onnx"), key=lambda f: f.stat().st_size)
    if not got:
        raise FileNotFoundError("번들된 검열 모델이 없습니다 (models/censor/*.onnx)")
    return got[0].name


def _resize_linear(a: np.ndarray, nw: int, nh: int) -> np.ndarray:
    """cv2 `INTER_LINEAR` 과 **같은 방식**으로 줄인다.

    ★PIL 의 `resize(BILINEAR)` 를 쓰면 안 된다 — 축소할 때 필터 폭을 배율만큼 넓혀
      **안티에일리어싱**을 건다. cv2 는 걸지 않는다. 그 차이만으로 검출이 달라졌다
      (실측 2026-08-05: IoU 0.95 · conf 차 0.075 · 검출 개수까지 어긋남).
      cv2 의 좌표 대응은 `src = (dst + 0.5) * 배율 - 0.5`, 가장자리는 복제다."""
    h, w = a.shape[:2]
    if (w, h) == (nw, nh):
        return a.astype(np.float32)
    src = a.astype(np.float32)
    y = (np.arange(nh, dtype=np.float32) + 0.5) * (h / nh) - 0.5
    x = (np.arange(nw, dtype=np.float32) + 0.5) * (w / nw) - 0.5
    y0 = np.floor(y).astype(np.int32)
    x0 = np.floor(x).astype(np.int32)
    wy = (y - y0)[:, None, None]
    wx = (x - x0)[None, :, None]
    y0c, y1c = np.clip(y0, 0, h - 1), np.clip(y0 + 1, 0, h - 1)
    x0c, x1c = np.clip(x0, 0, w - 1), np.clip(x0 + 1, 0, w - 1)
    top = src[y0c][:, x0c] * (1 - wx) + src[y0c][:, x1c] * wx
    bot = src[y1c][:, x0c] * (1 - wx) + src[y1c][:, x1c] * wx
    # ★**8비트로 반올림해서 돌려준다** — cv2 는 uint8 배열을 낸다. 실수로 두면 픽셀마다
    #   1 미만의 차가 남고, 문턱 근처의 검출에서 confidence 가 0.026 까지 흔들렸다
    #   (실측 2026-08-05: 0.530 vs 0.504). 반올림하니 소수점까지 같아졌다.
    return np.round(top * (1 - wy) + bot * wy)


def _letterbox(im: Image.Image, size: tuple[int, int], rect: bool):
    """ultralytics `LetterBox(scaleup=True, center=True)` 그대로.

    ★`rect` 는 ultralytics 의 `auto` 다 — 정사각으로 채우지 않고 **32의 배수까지만** 채운다.
      832×1216 을 640 으로 줄이면 640×448 이 되어, 정사각(640×640)보다 여백이 훨씬 적다.
      여백이 적으면 대상이 더 크게 들어가 검출이 는다 — v2(.pt)가 하던 방식이고,
      실측에서 정사각 고정은 v2 가 찾던 것을 놓쳤다 (8장 중 2장).
    ★비율을 유지한 채 가운데 놓고 남는 곳을 114 로 채운다. 여기를 틀리면 좌표가 통째로 밀린다."""
    h0, w0 = im.height, im.width
    r = min(size[0] / h0, size[1] / w0)
    nw, nh = round(w0 * r), round(h0 * r)
    dw, dh = size[1] - nw, size[0] - nh
    if rect:
        dw, dh = dw % 32, dh % 32
    dw, dh = dw / 2, dh / 2
    resized = _resize_linear(np.asarray(im, dtype=np.uint8), nw, nh)
    left, top = int(round(dw - 0.1)), int(round(dh - 0.1))
    right, bottom = int(round(dw + 0.1)), int(round(dh + 0.1))
    canvas = np.full((nh + top + bottom, nw + left + right, 3), PAD_VALUE, dtype=np.float32)
    canvas[top : top + nh, left : left + nw] = resized
    return canvas, r, (left, top)


def _nms(boxes: np.ndarray, scores: np.ndarray, iou: float) -> list[int]:
    """표준 NMS. ★클래스별로 나누는 것은 부르는 쪽에서 좌표를 밀어 처리한다 (ultralytics 방식)."""
    x1, y1, x2, y2 = boxes[:, 0], boxes[:, 1], boxes[:, 2], boxes[:, 3]
    areas = (x2 - x1) * (y2 - y1)
    order = scores.argsort()[::-1]
    keep = []
    while order.size:
        i = order[0]
        keep.append(int(i))
        if order.size == 1:
            break
        xx1 = np.maximum(x1[i], x1[order[1:]])
        yy1 = np.maximum(y1[i], y1[order[1:]])
        xx2 = np.minimum(x2[i], x2[order[1:]])
        yy2 = np.minimum(y2[i], y2[order[1:]])
        inter = np.clip(xx2 - xx1, 0, None) * np.clip(yy2 - yy1, 0, None)
        ovr = inter / (areas[i] + areas[order[1:]] - inter)
        order = order[1:][ovr <= iou]
    return keep


def detect(
    img: Image.Image,
    model: str | None = None,
    targets: list[str] | None = None,
    label_conf: dict[str, float] | None = None,
    default_conf: float = 0.25,
    return_all: bool = False,
) -> list[dict]:
    """가릴 곳 찾기 — v2 `detect_nsfw_regions` 와 같은 계약.

    `return_all` 이면 문턱을 0.01 까지 낮춰 **문턱 미달까지** 돌려준다 (화면이 슬라이더로
    다시 거를 수 있게). 그때 `passes_threshold` 로 통과 여부를 함께 표시한다."""
    sess, names, size, rect, e2e = _load(model or default_model())
    label_conf = label_conf or {}
    labels = list(names.values())
    targets = targets if targets is not None else labels
    min_conf = 0.01 if return_all else min([label_conf.get(x, default_conf) for x in targets] + [default_conf])

    im = img.convert("RGB")
    canvas, r, (padx, pady) = _letterbox(im, size, rect)
    x = canvas.transpose(2, 0, 1)[None] / 255.0
    out = sess.run(None, {sess.get_inputs()[0].name: np.ascontiguousarray(x, dtype=np.float32)})[0]

    if e2e:
        # ★YOLO26 은 **이미 걸러진 결과**를 낸다: (1, 300, 4+1+1+32) = xyxy · conf · cls · 마스크.
        #   여기서 NMS 를 또 돌리면 안 된다 (ultralytics 도 end2end 면 문턱만 건다).
        pred = out[0]  # (300, 4+1+1+32) — 배치 축은 위에서 이미 벗겼다
        boxes, conf, cls = pred[:, :4].copy(), pred[:, 4], pred[:, 5].astype(np.int32)
        m = conf > min_conf
        boxes, conf, cls = boxes[m], conf[m], cls[m]
        if not len(boxes):
            return []
        keep = list(range(min(len(boxes), MAX_DET)))
    else:
        # (1, 4+nc+32, N) → (N, 4+nc+32). ★뒤의 마스크 계수 32 개는 안 쓴다
        pred = out[0].T
        nc = len(names)
        xywh, scores = pred[:, :4], pred[:, 4 : 4 + nc]
        cls = scores.argmax(1)
        conf = scores.max(1)
        m = conf > min_conf
        xywh, cls, conf = xywh[m], cls[m], conf[m]
        if not len(xywh):
            return []
        if len(xywh) > MAX_NMS:
            top = conf.argsort()[::-1][:MAX_NMS]
            xywh, cls, conf = xywh[top], cls[top], conf[top]

        boxes = np.empty_like(xywh)
        boxes[:, 0] = xywh[:, 0] - xywh[:, 2] / 2
        boxes[:, 1] = xywh[:, 1] - xywh[:, 3] / 2
        boxes[:, 2] = xywh[:, 0] + xywh[:, 2] / 2
        boxes[:, 3] = xywh[:, 1] + xywh[:, 3] / 2
        # ★클래스마다 따로 억제한다 — 좌표를 클래스 번호만큼 밀어 한 번에 처리 (ultralytics max_wh)
        keep = _nms(boxes + (cls[:, None] * MAX_WH), conf, IOU_THRES)[:MAX_DET]

    # 레터박스를 되돌린다 (여백 빼고 배율 나누고, 그림 밖은 잘라낸다)
    dets = []
    for i in keep:
        b = boxes[i]
        x1 = (b[0] - padx) / r
        y1 = (b[1] - pady) / r
        x2 = (b[2] - padx) / r
        y2 = (b[3] - pady) / r
        label = names[int(cls[i])]
        if label not in targets:
            continue
        need = label_conf.get(label, default_conf)
        ok = float(conf[i]) >= need
        if not return_all and not ok:
            continue
        dets.append(
            {
                "label": label,
                "confidence": round(float(conf[i]), 3),
                # ★반올림이 아니라 **버림**이다 (v2 `int(x)`, backend.py:6924).
                #   반올림하면 박스가 한 픽셀씩 밀려 v2 결과와 어긋난다 (실측 2026-08-05).
                "box": [
                    int(max(0, min(im.width, x1))),
                    int(max(0, min(im.height, y1))),
                    int(max(0, min(im.width, x2))),
                    int(max(0, min(im.height, y2))),
                ],
                "passes_threshold": ok,
            }
        )
    return dets


# ── 가리기 ────────────────────────────────────────────────────


def _corners(x1, y1, x2, y2, rotation: float, expand: int):
    """회전·확장한 네 꼭짓점 (v2 `get_rotated_corners` 그대로)."""
    if expand:
        x1, y1, x2, y2 = x1 - expand, y1 - expand, x2 + expand, y2 + expand
    cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
    local = [(x1 - cx, y1 - cy), (x2 - cx, y1 - cy), (x2 - cx, y2 - cy), (x1 - cx, y2 - cy)]
    cos_r, sin_r = math.cos(rotation), math.sin(rotation)
    return [(cx + lx * cos_r - ly * sin_r, cy + lx * sin_r + ly * cos_r) for lx, ly in local]


SS = 4  # 계단을 없애려고 4배로 그린 뒤 줄인다 (cv2 의 LINE_AA 대신)


def _mask(size: tuple[int, int], pts, feather: int) -> Image.Image:
    """가릴 모양의 알파. ★feather 는 **가장자리만** 흐리게 한다 — 안쪽은 100% 로 남는다."""
    w, h = size
    big = Image.new("L", (w * SS, h * SS), 0)
    ImageDraw.Draw(big).polygon([(x * SS, y * SS) for x, y in pts], fill=255)
    m = big.resize((w, h), Image.BILINEAR)
    if feather > 0:
        # v2 는 거리변환으로 선형 감쇠를 만들었다. 여기서는 가우시안으로 같은 인상을 낸다 —
        # 안쪽이 옅어지지 않도록 **먼저 넓혀서** 흐린다.
        m = m.filter(ImageFilter.MaxFilter(_odd(feather))).filter(ImageFilter.GaussianBlur(feather / 2))
    return m


def _odd(n: int) -> int:
    n = max(1, int(n))
    return n if n % 2 else n + 1


def _mosaic(region: Image.Image, block: int) -> Image.Image:
    w, h = region.size
    b = max(1, block)
    small = region.resize((max(1, w // b), max(1, h // b)), Image.BILINEAR)
    return small.resize((w, h), Image.NEAREST)


# ── 스팀/구름 ────────────────────────────────────────────────
# ★v2 의 **기본 방식**이다 (`index.html` 의 `censorMethod` 첫 항목). v2 는 이것을 화면의
#   canvas 에서 그렸고 백엔드는 아예 몰랐다. 그래서 스팀이 섞이면 화면이 렌더해 base64 로
#   올려 보내는 우회로가 있었다 (`renderCensoredImageOnCanvas`).
#   3.0 은 **가리는 일을 서버 하나가 한다.** 두 벌로 두면 미리보기와 저장본이 갈린다.
# ★알고리즘은 v2 원문 그대로다: 심플렉스 노이즈로 밝기와 가장자리를 흔든 타원 구름.
#   난수표(`_simplex_perm`)의 섞는 규칙까지 옮겼다. 같은 씨앗이면 같은 무늬가 나온다.

_F2 = 0.5 * (math.sqrt(3.0) - 1.0)
_G2 = (3.0 - math.sqrt(3.0)) / 6.0
# grad3 12개의 x·y 성분만 (2D 노이즈는 z 를 안 쓴다)
_GRAD2 = np.array(
    [(1, 1), (-1, 1), (1, -1), (-1, -1), (1, 0), (-1, 0), (1, 0), (-1, 0), (0, 1), (0, -1), (0, 1), (0, -1)],
    dtype=np.float32,
)
# ★노이즈를 만드는 판의 상한. 큰 박스(전신)는 텍스처가 3000px 를 넘어 픽셀당 6번의 노이즈가
#   수천만 번이 된다. 구름은 **판 크기에 비례한 무늬**라(noiseScale = 판/2) 작게 만들어
#   늘려도 같은 그림이 나온다. 줄어드는 것은 비용뿐이다.
_STEAM_MAX = 512


def _simplex_perm(seed: int):
    """v2 `SimplexNoise.seed` 그대로. LCG 로 256개를 섞어 512로 늘린다."""
    p = list(range(256))
    s = int(seed)
    for i in range(255, 0, -1):
        s = (s * 16807 + 1) % 2147483647
        j = s % (i + 1)
        p[i], p[j] = p[j], p[i]
    perm = np.array([p[i & 255] for i in range(512)], dtype=np.int32)
    return perm, perm % 12


def _noise2(x: np.ndarray, y: np.ndarray, perm: np.ndarray, pm12: np.ndarray) -> np.ndarray:
    """2D 심플렉스 노이즈 (v2 `noise2D` 의 벡터화). 결과 범위는 대략 -1..1."""
    s = (x + y) * _F2
    i = np.floor(x + s)
    j = np.floor(y + s)
    t = (i + j) * _G2
    x0 = x - (i - t)
    y0 = y - (j - t)
    upper = x0 > y0
    i1 = upper.astype(np.int32)
    j1 = (~upper).astype(np.int32)
    x1 = x0 - i1 + _G2
    y1 = y0 - j1 + _G2
    x2 = x0 - 1.0 + 2.0 * _G2
    y2 = y0 - 1.0 + 2.0 * _G2
    ii = i.astype(np.int64) & 255
    jj = j.astype(np.int64) & 255

    def corner(dx, dy, gi):
        tt = 0.5 - dx * dx - dy * dy
        g = _GRAD2[gi]
        return np.where(tt < 0, 0.0, np.square(np.maximum(tt, 0.0)) ** 2 * (g[..., 0] * dx + g[..., 1] * dy))

    n0 = corner(x0, y0, pm12[ii + perm[jj]])
    n1 = corner(x1, y1, pm12[ii + i1 + perm[jj + j1]])
    n2 = corner(x2, y2, pm12[ii + 1 + perm[jj + 1]])
    return 70.0 * (n0 + n1 + n2)


def steam_scale(w: float, h: float) -> float:
    """박스가 클수록 구름을 더 넓게 편다 (v2 `getSteamBoxScale`)."""
    size = max(min(w, h), 2.0)
    return max(1.05, min(1 + 0.04 * math.log2(size), 1.5))


def _steam_texture(w: float, h: float, feather: int, brightness: int, alpha: int, seed: int):
    """구름 한 덩이를 만든다 (RGB, 알파, 판 크기). v2 `generateSteamTexture` 이식.

    ★`feather` 는 여기서 **가장자리 흔들림**을 줄이는 값이다 (다른 방식의 깃털과 다르다).
      값이 커질수록 무늬가 커지고(`featherFactor`) 윤곽의 요철이 얕아진다."""
    expand_x = w * 0.35
    expand_y = h * 0.35
    tw = max(1, math.ceil(w + expand_x * 2))
    th = max(1, math.ceil(h + expand_y * 2))
    # 노이즈는 작은 판에서 만들고 늘린다 (_STEAM_MAX 주석)
    k = min(1.0, _STEAM_MAX / max(tw, th))
    nw = max(2, int(round(tw * k)))
    nh = max(2, int(round(th * k)))

    perm, pm12 = _simplex_perm(seed)
    px = np.arange(nw, dtype=np.float32)[None, :] / k
    py = np.arange(nh, dtype=np.float32)[:, None] / k
    px = np.broadcast_to(px, (nh, nw)).astype(np.float32)
    py = np.broadcast_to(py, (nh, nw)).astype(np.float32)

    feather = max(0, int(feather))
    ns = max(tw, th) / 2 * (1 + feather / 25)
    n = lambda sx, ox=0.0: _noise2(px / sx + ox, py / sx + ox, perm, pm12)  # noqa: E731

    bright = n(ns) * 1.0 + n(ns / 2) * 0.5 + n(ns / 4) * 0.25
    bright = (bright / 1.75 + 1) / 2
    bright = 0.5 + bright * 0.5

    dx = (px - tw / 2) / max(w / 2, 1e-6)
    dy = (py - th / 2) / max(h / 2, 1e-6)
    ellipse = np.sqrt(dx * dx + dy * dy)

    edge_strength = 1 - feather / 62.5
    edge = n(ns * 0.5, 50.0) * 0.5 + n(ns * 0.25, 150.0) * 0.35 + n(ns * 0.12, 250.0) * 0.15
    warped = ellipse + edge * 0.25 * edge_strength

    tsm = np.clip((warped - 0.6) / 0.55, 0, 1)
    a = np.where(warped < 0.6, 255.0, np.where(warped < 1.15, (1 - tsm * tsm * (3 - 2 * tsm)) * 255.0, 0.0))

    # 판 가장자리는 반드시 0 으로 떨어뜨린다. 구름이 네모나게 잘리면 티가 난다
    safe = min(expand_x, expand_y) * 0.25
    gx = np.minimum(px, tw - 1 - px)
    gy = np.minimum(py, th - 1 - py)
    from_edge = np.minimum(gx, gy)
    fade_end = safe * 4
    if fade_end > safe:
        a = a * np.clip((from_edge - safe) / (fade_end - safe), 0, 1)
    a = np.where(from_edge < safe, 0.0, a)

    b_pct = max(0, min(100, int(brightness))) / 100
    rgb = math.floor(b_pct * 230) + np.floor(bright * math.floor(b_pct * 25))
    a = a * (max(0, min(100, int(alpha))) / 100)

    rgb_img = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "L").resize((tw, th), Image.BILINEAR)
    a_img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "L").resize((tw, th), Image.BILINEAR)
    return rgb_img, a_img, tw, th


def apply_boxes(
    img: Image.Image,
    boxes: list[dict],
    method: str = "black",
    color: str | None = None,
    expand: int = 0,
    feather: int = 0,
    mosaic_strength: int = 12,
    mosaic_opacity: int = 100,
    blur_strength: int = 20,
    steam_brightness: int = 100,
    steam_alpha: int = 100,
) -> Image.Image:
    """찾은 자리를 가린다 — v2 `apply_censor_boxes` 이식.

    박스마다 `method`·`color`·`rotation` 을 따로 가질 수 있다 (한 그림 안에서 섞어 쓴다)."""
    im = img.convert("RGB")
    alpha = max(0.0, min(1.0, (mosaic_opacity if mosaic_opacity is not None else 100) / 100))

    for b in boxes:
        box = b.get("box")
        if not isinstance(box, (list, tuple)) or len(box) != 4:
            continue  # ★고치지 않고 건너뛴다 — 화면이 보낸 것을 코드가 추측하지 않는다
        try:
            x1, y1, x2, y2 = (int(v) for v in box)
        except (TypeError, ValueError):
            continue
        how = b.get("method") or method
        rot = float(b.get("rotation") or 0)

        if how == "steam":
            _paste_steam(im, x1, y1, x2, y2, rot, int(expand), int(feather),
                         steam_brightness, steam_alpha)
            continue

        pts = _corners(x1, y1, x2, y2, rot, int(expand))
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        pad = feather + 2
        bx1 = max(0, int(min(xs)) - pad)
        by1 = max(0, int(min(ys)) - pad)
        bx2 = min(im.width, int(max(xs)) + pad)
        by2 = min(im.height, int(max(ys)) + pad)
        if bx2 <= bx1 or by2 <= by1:
            continue

        region = im.crop((bx1, by1, bx2, by2))
        m = _mask(region.size, [(x - bx1, y - by1) for x, y in pts], feather)

        if how == "mosaic":
            layer = _mosaic(region, mosaic_strength)
            if alpha < 1:
                m = m.point(lambda v: int(v * alpha))
        elif how == "blur":
            layer = region.filter(ImageFilter.GaussianBlur(max(1, blur_strength)))
        else:
            fill = (0, 0, 0)
            if how == "white":
                fill = (255, 255, 255)
            else:
                # ★색은 박스가 따로 가질 수 있다 (머리 주석의 계약). 없으면 전체 설정을 쓴다
                c = b.get("color") or color
                if how == "color" and isinstance(c, str) and c.startswith("#") and len(c) >= 7:
                    fill = (int(c[1:3], 16), int(c[3:5], 16), int(c[5:7], 16))
            layer = Image.new("RGB", region.size, fill)

        im.paste(Image.composite(layer, region, m), (bx1, by1))
    return im


def _paste_steam(im: Image.Image, x1, y1, x2, y2, rot: float, expand: int, feather: int,
                 brightness: int, alpha: int) -> None:
    """구름을 박스 **가운데에 맞춰** 얹는다 (v2 `applySteamEffect`).

    ★다른 방식과 달리 박스 안에 갇히지 않는다. 확장·동적 배율·노이즈 여백만큼 밖으로 번진다.
      그래서 자를 사각형을 따로 계산하지 않고 텍스처의 중심을 박스 중심에 맞춘다
      (v2 의 오프셋 셋을 정리하면 중심이 정확히 박스 중심으로 떨어진다)."""
    w, h = x2 - x1, y2 - y1
    if w <= 0 or h <= 0:
        return
    k = steam_scale(w, h)
    ew = w * k + expand * 2
    eh = h * k + expand * 2
    seed = math.floor(x1 * 1000 + y1)
    rgb, a, tw, th = _steam_texture(ew, eh, feather, brightness, alpha, seed)
    tex = Image.merge("RGBA", (rgb, rgb, rgb, a))
    if rot:
        # 캔버스는 화면 좌표(y 아래)에서 시계 방향으로 돈다. PIL 은 반시계라 부호를 뒤집는다
        tex = tex.rotate(-math.degrees(rot), resample=Image.BICUBIC, expand=True)
        tw, th = tex.size
    cx, cy = x1 + w / 2, y1 + h / 2
    im.paste(tex, (int(round(cx - tw / 2)), int(round(cy - th / 2))), tex)
