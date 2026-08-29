"""WD 태거 — 그림 한 장에서 danbooru 태그를 뽑는다 (사용자 승인 2026-08-29).

쓰임: NAI 가 `1girl` 만 받고 알아서 채운 캐릭터를 **재현할 태그**가 궁금할 때,
그 그림을 돌려 태그를 뽑는다 (사용자: *"무슨 태그를 넣어야 하는지 궁금할 때"*).

★모델은 **로라메이커와 같은 것**이다 (`SmilingWolf/wd-eva02-large-tagger-v3` ONNX, 1.26GB) —
  작은 모델(vit 378MB)은 사용자가 품질로 반려했다 (*"로라메이커급 아니면 좀 구리던데"*).
★★**동봉하지 않는다** — 첫 사용 때 내려받는다 (배포본이 1.26GB 커지는 것을 피한다).
  ★모델 자리는 `models/tagger` **하나**다. 처음에는 허깅페이스 로컬 캐시(로라메이커가 받아 둔
    것)도 2순위로 뒤졌는데 걷어냈다 (사용자 지적 2026-08-29: 그 캐시는 개발 기계에만 있는
    사정이라 제품에는 뜻이 없고, 내려받기 흐름이 한 번도 안 돈 것을 가렸다).
★전처리·후처리는 로라메이커 `modules/captioning.py` 를 그대로 옮겼다 (검증된 구현):
  흰 배경 정사각 패딩 → BICUBIC 448² → RGB→BGR → float32 NHWC. 문턱값 0.35,
  캐릭터·판권(카테고리 3·4)은 0.75. 등급 태그(카테고리 9)는 뺀다.
★실행기·락은 검열(`censor.py`)과 같은 규칙이다 — 같은 세션을 두 스레드가 돌리면
  네이티브 크래시가 난다. 부르는 쪽(server)은 `def` 엔드포인트다.
"""
from __future__ import annotations

import csv
import threading
from pathlib import Path

REPO = "SmilingWolf/wd-eva02-large-tagger-v3"
FILES = ("model.onnx", "selected_tags.csv")
MODEL_DIR = Path(__file__).resolve().parent.parent / "models" / "tagger"
#: 진행 표시용 총 크기(바이트) — 실제 다운로드는 Content-Length 를 쓰고, 이것은 안내용이다
APPROX_TOTAL = 1_260_744_467

THRESHOLD_GENERAL = 0.35
THRESHOLD_CHARACTER = 0.75

PREFER = ("CUDAExecutionProvider", "DmlExecutionProvider", "CPUExecutionProvider")

_lock = threading.Lock()          # ★추론은 한 번에 하나 (censor 와 같은 이유)
_sess = None
_tags: list[tuple[str, int]] | None = None

#: 다운로드 상태 — 백그라운드 스레드가 갱신한다
_dl = {"running": False, "got": 0, "total": 0, "error": ""}
_dl_lock = threading.Lock()


def model_dir() -> Path | None:
    """모델이 있는 폴더 — `models/tagger` 에 두 파일이 다 있을 때만."""
    if all((MODEL_DIR / f).is_file() for f in FILES):
        return MODEL_DIR
    return None


def status() -> dict:
    with _dl_lock:
        dl = dict(_dl)
    return {
        "ready": model_dir() is not None,
        "downloading": dl["running"],
        "got": dl["got"],
        "total": dl["total"] or APPROX_TOTAL,
        "error": dl["error"],
    }


def start_download() -> dict:
    """모델 내려받기를 **백그라운드로** 시작한다 (1.26GB — 요청을 붙들면 안 된다)."""
    with _dl_lock:
        if _dl["running"]:
            return status()
        _dl.update(running=True, got=0, total=0, error="")
    threading.Thread(target=_download, daemon=True).start()
    return status()


def _download() -> None:
    import httpx

    try:
        MODEL_DIR.mkdir(parents=True, exist_ok=True)
        for name in FILES:
            url = f"https://huggingface.co/{REPO}/resolve/main/{name}"
            tmp = MODEL_DIR / (name + ".part")
            with httpx.stream("GET", url, follow_redirects=True, timeout=60) as r:
                r.raise_for_status()
                if name == "model.onnx":
                    with _dl_lock:
                        _dl["total"] = int(r.headers.get("content-length") or APPROX_TOTAL)
                with tmp.open("wb") as f:
                    for chunk in r.iter_bytes(1 << 20):
                        f.write(chunk)
                        if name == "model.onnx":
                            with _dl_lock:
                                _dl["got"] += len(chunk)
            tmp.replace(MODEL_DIR / name)   # ★다 받은 뒤에 이름을 준다 — 반쪽 파일이 안 남게
    except Exception as e:                   # noqa: BLE001 — 사유를 화면까지 전한다
        with _dl_lock:
            _dl["error"] = str(e)
    finally:
        with _dl_lock:
            _dl["running"] = False


def _load():
    global _sess, _tags
    if _sess is not None:
        return
    d = model_dir()
    if d is None:
        raise RuntimeError("태거 모델이 없습니다. 먼저 내려받아 주세요.")
    import onnxruntime as ort

    have = set(ort.get_available_providers())
    providers = [p for p in PREFER if p in have] or ["CPUExecutionProvider"]
    _sess = ort.InferenceSession(str(d / "model.onnx"), providers=providers)
    rows: list[tuple[str, int]] = []
    with (d / "selected_tags.csv").open("r", encoding="utf-8") as f:
        reader = csv.reader(f)
        header = next(reader)
        try:
            name_idx, cat_idx = header.index("name"), header.index("category")
        except ValueError:
            name_idx, cat_idx = 1, 2
        for row in reader:
            if len(row) <= max(name_idx, cat_idx):
                continue
            try:
                rows.append((row[name_idx], int(row[cat_idx])))
            except (ValueError, IndexError):
                continue
    _tags = rows


def run(src) -> dict:
    """태그를 뽑는다. 점수 내림차순 목록과 캐릭터/일반 구분을 돌려준다.

    `src` 는 경로이거나 이미 연 PIL 그림이다 — 보조도구의 Tagger 탭은 밖에서 떨군 그림
    (base64) 도 받으므로 경로만으로는 모자란다 (사용자 지시 2026-08-29)."""
    import numpy as np
    from PIL import Image

    with _lock:
        _load()
        img = (src if isinstance(src, Image.Image) else Image.open(src)).convert("RGB")
        w, h = img.size
        side = max(w, h)
        padded = Image.new("RGB", (side, side), (255, 255, 255))
        padded.paste(img, ((side - w) // 2, (side - h) // 2))
        if side != 448:
            padded = padded.resize((448, 448), Image.BICUBIC)
        arr = np.asarray(padded, dtype=np.float32)[:, :, ::-1]   # RGB → BGR
        arr = np.expand_dims(arr, axis=0)
        scores = _sess.run(None, {_sess.get_inputs()[0].name: arr})[0][0]

    out = []
    for (tag, category), score in zip(_tags, scores):
        if category == 9:                                        # 등급(rating)은 뺀다
            continue
        limit = THRESHOLD_CHARACTER if category in (3, 4) else THRESHOLD_GENERAL
        if score >= limit:
            out.append({"tag": tag.replace("_", " "), "score": float(score),
                        "character": category in (3, 4)})
    out.sort(key=lambda x: x["score"], reverse=True)
    return {"tags": out, "caption": ", ".join(x["tag"] for x in out)}
