"""NAI 생성 — v2.x `backend.py` 의 `call_nai_api` 에서 옮겨온 것.

★이 파일의 페이로드 구조는 NAI 웹의 실제 요청과 대조해 맞춘 결과다.
   필드 하나만 달라져도 결과 이미지가 바뀐다. 임의로 "정리"하지 말 것.
   근거: docs/renewal/feature-inventory.md 「절대 재구현하지 말 것」

5단계에서 vibe·Precise Reference·i2i·인페인트를 붙였다 (v2 backend.py:1479-1700).
그 구간은 **★재구현 금지가 가장 몰린 곳**이라 원문을 그대로 옮겼다 —
각 항목의 ★주석이 "왜 그 값인지"를 담고 있으니 지우지 말 것.
"""
from __future__ import annotations

import io
import math
import random
import re
import zipfile
from dataclasses import dataclass, field

import httpx

import imgutil
import vibe as vibe_mod

NAI_ENDPOINT = "https://image.novelai.net/ai/generate-image"
#: 업스케일 — 생성과 **다른 호스트**다 (공홈 번들: `ImageBackendUrl` 이 아니라 `BackendUrl`)
UPSCALE_ENDPOINT = "https://api.novelai.net/ai/upscale"

#: 업스케일 배율 — ★공홈은 **언제나 4**다 (번들 `upscale:` 호출이 4 를 박아 넣는다).
#: 고를 수 있는 것처럼 UI 를 만들지 말 것 — 다른 값은 공홈이 보내지 않는다.
UPSCALE_SCALE = 4

#: 픽셀 수 구간별 Anlas (공홈 `e0`). **작은 구간이 이긴다** — 목록을 큰 것부터 훑으며
#: `px <= 한계` 일 때마다 값을 덮으므로 마지막(가장 작은) 것이 남는다.
UPSCALE_COST_TABLE = ((1048576, 7), (786432, 5), (524288, 3), (409600, 2), (262144, 1))
#: 이보다 크면 못 한다 — 공홈도 버튼을 막고 "Image is larger than 1024x1024." 를 띄운다
UPSCALE_MAX_PX = 1048576
#: Opus(3티어 구독중)는 이 이하를 공짜로 준다
UPSCALE_FREE_PX = 409600

# ══ 모델별 표 — 정본은 `docs/nai-web-reference.md` 2절 (공홈 번들에서 추출) ══════════
#
# ★여기 값은 **모델마다 다르다.** 예전에는 V4.5 Full 것 한 벌을 모든 모델에 썼는데,
#   V4.5 Curated·V4 Curated 에 남의 퀄리티 접미사와 남의 UC 프리셋이 나가고 있었다.

#: 퀄리티 접미사 (`ed()`). prefix 는 V3 이후 전부 빈 문자열이라 suffix 만 쓴다.
QUALITY_SUFFIX = {
    "nai-diffusion-4-5-full": ", very aesthetic, masterpiece, no text",
    "nai-diffusion-4-5-curated": ", very aesthetic, masterpiece, no text, -0.8::feet::, rating:general",
    "custom": ", very aesthetic, masterpiece, no text",
    # ★아래는 **우리가 만들지 않는 모델**이다 (목록에 없다). 그래도 표에 둔다 —
    #   갤러리에 들어온 옛 그림에서 퀄리티 태그를 떼어내려면 그 모델의 접미사를 알아야 한다
    #   (`meta.normalize`). 값은 공홈 번들 `ed()` 그대로다 (대조 2026-08-19).
    "nai-diffusion-4-full": ", no text, best quality, very aesthetic, absurdres",
    "nai-diffusion-4-curated-preview": ", rating:general, best quality, very aesthetic, absurdres",
    "nai-diffusion-3": ", best quality, amazing quality, very aesthetic, absurdres",
    "nai-diffusion-furry-3": ", {best quality}, {amazing quality}",
}

#: 퀄리티 태그를 **앞에** 붙이는 옛 모델 (`ed()` 의 `qualityTags`). V3 이후로는 전부 빈 값이라
#: 생성 경로는 안 쓰고, 옛 그림을 읽을 때만 쓴다.
QUALITY_PREFIX = {
    "nai-diffusion-2": "very aesthetic, best quality, absurdres, ",
}

#: UC 프리셋 — **목록의 순서가 곧 공홈 `ucPreset` 인덱스**다 (`eF()`).
#: 마지막은 언제나 none 이고, none 은 nsfw 프리픽스 대상이 아니다.
#: 항목은 `(카테고리, 표시이름, 본문)`. 본문에 `nsfw, ` 는 **넣지 않는다** — 붙이는 규칙이
#: 따로 있다(`resolve_uc`). 예전에는 본문에 박아 두고 다시 떼어내고 있었다.
UC_PRESETS: dict[str, list[tuple[str, str, str]]] = {
    "nai-diffusion-4-5-full": [
        ("heavy", "Heavy", "lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page"),
        ("light", "Light", "lowres, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, multiple views, very displeasing, too many watermarks, negative space, blank page"),
        ("furry", "Furry Focus", "{worst quality}, distracting watermark, unfinished, bad quality, {widescreen}, upscale, {sequence}, {{grandfathered content}}, blurred foreground, chromatic aberration, sketch, everyone, [sketch background], simple, [flat colors], ych (character), outline, multiple scenes, [[horror (theme)]], comic"),
        ("human", "Human Focus", "lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page, @_@, mismatched pupils, glowing eyes, bad anatomy"),
        ("none", "None", ""),
    ],
    "nai-diffusion-4-5-curated": [
        ("heavy", "Heavy", "blurry, lowres, upscaled, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, negative space, blank page"),
        ("light", "Light", "blurry, lowres, upscaled, artistic error, scan artifacts, jpeg artifacts, logo, too many watermarks, negative space, blank page"),
        ("human", "Human Focus", "blurry, lowres, upscaled, artistic error, film grain, scan artifacts, bad anatomy, bad hands, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, @_@, mismatched pupils, glowing eyes, negative space, blank page"),
        ("none", "None", ""),
    ],
}
# ★V4.0 계열도 표에 둔다 — 만들지는 않지만 **읽어야 한다** (위 QUALITY_SUFFIX 와 같은 이유).
#   순서가 곧 그 모델의 `ucPreset` 인덱스다 (공홈 번들 대조 2026-08-19).
UC_PRESETS["nai-diffusion-4-full"] = [
    ("heavy", "Heavy", "blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, multiple views, logo, too many watermarks, white blank page, blank page"),
    ("light", "Light", "blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing, white blank page, blank page"),
    ("none", "None", ""),
]
UC_PRESETS["nai-diffusion-4-curated-preview"] = [
    ("heavy", "Heavy", "blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, logo, dated, signature, multiple views, gigantic breasts, white blank page, blank page"),
    ("light", "Light", "blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing, logo, dated, signature, white blank page, blank page"),
    ("none", "None", ""),
]
UC_PRESETS["custom"] = UC_PRESETS["nai-diffusion-4-5-full"]

#: uc 앞에 `nsfw, ` 를 붙이지 **않는** 모델 (공홈 예외집합 `V`).
#: 실질적으로 V4.5 Full 만 붙는다.
#  ★번들 원본 그대로다 (`V=new Set([...])`). ★**V4 Full 은 여기 없다** — 문서의
#    "실질적으로 V4.5 Full 만 붙는다"를 읽고 V4 Full 을 넣었다가 번들 재확인으로 뺐다.
#    (지금은 V4.0 을 제공하지 않지만, 옛 레코드의 모델 id 가 들어와도 맞아야 한다)
NO_NSFW_PREFIX = {
    "safe-diffusion",
    "safe-diffusion-inpainting",
    "test",
    "custom",
    "nai-diffusion-4-curated-preview",
    "nai-diffusion-4-curated-inpainting",
    "nai-diffusion-4-5-curated",
    "nai-diffusion-4-5-curated-inpainting",
}

#: 모델을 바꿨을 때 없는 프리셋을 무엇으로 대체하나 (공홈 `eN`)
UC_CATEGORY_FALLBACK = {
    "none": ["none", "light", "heavy"],
    "light": ["light", "none", "heavy"],
    "heavy": ["heavy", "light", "none"],
    "human": ["human", "heavy", "light", "none"],
    "furry": ["furry", "heavy", "light", "none"],
}

#: 인페인트 모델 (공홈 `el()`). ★접미사 규칙으로 만들지 말 것 — 없는 모델 id 가 생긴다
#:  (`nai-diffusion-4-curated-preview` 는 **-preview 가 탈락**한다).
INPAINT_MODEL = {
    "nai-diffusion-4-5-full": "nai-diffusion-4-5-full-inpainting",
    "nai-diffusion-4-5-curated": "nai-diffusion-4-5-curated-inpainting",
    "custom": "custom",
}
INPAINT_MODEL_DEFAULT = "nai-diffusion-4-5-curated-inpainting"

#: 캐릭터 슬롯의 기본 UC (`xp()`) — **V4.0 계열과 custom** 만 값이 있다. V4.5 는 빈 문자열.
#:  (지금은 V4.0 을 제공하지 않아 실질적으로 늘 빈 문자열이다)
CHAR_DEFAULT_UC = {
    "nai-diffusion-4-curated-preview": "lowres, aliasing, ",
    "nai-diffusion-4-full": "lowres, aliasing, ",
    "custom": "lowres, aliasing, ",
}

#: ★Enhance 문구를 붙이는 모델 (`enhancePromptAdd` 능력치). 번들 확인: **V4.5 계열만 참**이고
#:  **custom 은 거짓**이다. "V4 면 붙인다"로 두면 V4.0·custom 에 없는 문구가 들어간다.
ENHANCE_PROMPT_MODELS = {
    "nai-diffusion-4-5-full",
    "nai-diffusion-4-5-full-inpainting",
    "nai-diffusion-4-5-curated",
    "nai-diffusion-4-5-curated-inpainting",
}

#: Variety+ 기준 시그마 (`cfgDelaySigma`). 832x1216 이 보정계수 1.0 이 되는 기준.
VARIETY_SIGMA_BASE_V45 = 58
VARIETY_SIGMA_BASE_V4 = 19

# ★공홈은 `text:` 지시가 있으면 덧붙이는 것을 그 **앞에** 넣는다 (퀄리티 접미사·인핸스 문구 모두).
#   뒤에 붙이면 렌더될 문자열 자체가 오염된다.
TEXT_CLAUSE_RE = re.compile(r"(?:^|\s|[,.:\[\]{}、。])text:(?!:)", re.IGNORECASE)

#: Enhance 가 V4.5 계열 프롬프트에 끼워 넣는 문구
ENHANCE_PROMPT_ADD = ", -2::upscaled, blurry::,"


def base_model(model: str) -> str:
    """인페인트 모델을 원본 모델로 되돌린다 (표 조회용)."""
    for base, inpaint in INPAINT_MODEL.items():
        if model == inpaint:
            return base
    return model


def quality_suffix(model: str) -> str:
    """그 모델의 퀄리티 접미사. ★모르는 모델은 **V4.5 Full 것**으로 본다 —
    `uc_presets` 와 같은 폴백이어야 한다. 옛 레코드가 없어진 모델 id 를 들고 와도
    접미사만 조용히 빠지는 일이 없게."""
    return QUALITY_SUFFIX.get(base_model(model), QUALITY_SUFFIX["nai-diffusion-4-5-full"])


def uc_presets(model: str) -> list[tuple[str, str, str]]:
    """그 모델의 프리셋 목록. 모르는 모델은 V4.5 Full 목록으로 본다."""
    return UC_PRESETS.get(base_model(model), UC_PRESETS["nai-diffusion-4-5-full"])


def uc_preset_index(model: str, preset_name: str) -> int:
    """표시이름 → 공홈 `ucPreset` 인덱스. 그 모델에 없으면 카테고리 폴백표를 태운다.

    ★인덱스는 **모델마다 다르다.** V4.5 Full 의 `Human Focus` 는 3 이고 Curated 는 2 다 —
      한 벌짜리 숫자표를 쓰던 때는 둘 다 2 로 나갔고, `Furry Focus` 는 표에 없어
      0(Heavy)으로 떨어졌다."""
    presets = uc_presets(model)
    for i, (_cat, name, _text) in enumerate(presets):
        if name == preset_name:
            return i
    src_cat = None
    for plist in UC_PRESETS.values():
        for cat, name, _text in plist:
            if name == preset_name:
                src_cat = cat
                break
        if src_cat:
            break
    for cat in UC_CATEGORY_FALLBACK.get(src_cat or "none", ["none"]):
        for i, (c, _n, _t) in enumerate(presets):
            if c == cat:
                return i
    return len(presets) - 1  # 마지막 = none


def append_prompt(prompt: str, addition: str) -> str:
    """`text:` 절이 있으면 그 앞에, 없으면 맨 뒤에 붙인다."""
    prompt = prompt or ""
    m = TEXT_CLAUSE_RE.search(prompt)
    if m:
        return prompt[: m.start()] + addition + prompt[m.start():]
    return prompt + addition


def resolve_uc(model: str, preset_name: str, prompt: str, user_negative: str) -> str:
    """공홈 `J()` 와 같은 순서로 최종 uc 를 만든다.

    ★`nsfw, ` 는 프리셋이 none 이 아니고 · 모델이 예외집합에 없고 · **베이스 프롬프트**에
      `nsfw` 가 없을 때만 맨 앞에 붙는다. 검사 대상은 **퀄리티 태그가 붙은 베이스 프롬프트
      하나뿐**이고(캐릭터 슬롯은 안 본다), 매칭도 단어 경계가 아니라 **단순 부분문자열**이다."""
    presets = uc_presets(model)
    idx = uc_preset_index(model, preset_name)
    text = presets[idx][2]
    is_none = idx == len(presets) - 1

    if text and model not in NO_NSFW_PREFIX and "nsfw" not in (prompt or "").lower():
        text = "nsfw, " + text

    if user_negative:
        if is_none:
            return user_negative
        return (text + ", " + user_negative) if text else user_negative
    return text


def align64(v: int) -> int:
    """★가까운 쪽으로 **반올림**이다 (올림이 아니다 — 공홈 `K()`). 동률이면 큰 쪽.

    ★올림으로 두면 800 이 832 가 되어(공홈은 768) **없던 Anlas 를 쓰고** 그림도 달라진다.
    ★공통 전송 구간에서 걸리므로 txt2img 뿐 아니라 **Enhance·img2img·인페인트 전부**
      여기를 지난다. 비용도 정렬된 해상도로 세야 표시와 청구가 맞는다."""
    lo = math.floor(v / 64) * 64
    hi = math.ceil(v / 64) * 64
    r = lo if (v - lo < hi - v) else hi
    return 64 if r <= 0 else int(r)


@dataclass
class CharPrompt:
    prompt: str = ""
    uc: str = ""
    center: dict = field(default_factory=lambda: {"x": 0.5, "y": 0.5})
    use_coord: bool = False


@dataclass
class GenRequest:
    prompt: str = ""
    negative_prompt: str = ""
    model: str = "nai-diffusion-4-5-full"
    width: int = 832
    height: int = 1216
    steps: int = 28
    cfg: float = 5.0
    cfg_rescale: float = 0.0
    sampler: str = "k_euler_ancestral"
    scheduler: str = "karras"
    seed: int = -1
    uc_preset: str = "Heavy"
    quality_tags: bool = True
    variety_plus: bool = False
    #: 프롬프트 앞에 `fur dataset, ` 를 붙인다 (v2 backend.py:1326)
    furry_mode: bool = False
    characters: list[CharPrompt] = field(default_factory=list)
    #: ★이 요청이 Enhance 인가 — V4.5 계열 프롬프트에 `-2::upscaled, blurry::` 를 끼운다.
    #:  강화는 별도 경로가 아니라 **i2i 의 프리셋**이라, 조립은 여기 한 곳에서 한다.
    enhance: bool = False
    #: ★vibe 강도 정규화는 **사용자 토글**이다 (공홈 기본 켜짐, V4+ 에서만 노출).
    #:  하드코딩하지 말 것 — 끄면 값을 그대로 보내야 한다.
    normalize_reference_strength: bool = True

    # ── 이미지 입력 (5단계) ──
    #: Vibe Transfer. 각 항목 `{image, info_extracted, strength, name, encoded, encoded_model,
    #: encoded_info_extracted}`. `encoded*` 는 앞선 생성이 채워 준 것으로, 재사용 판정에 쓴다.
    vibe_transfer: list[dict] = field(default_factory=list)
    #: Precise Reference (V4.5). 각 항목 `{image, mode, strength, fidelity}`.
    precise_references: list[dict] = field(default_factory=list)
    #: i2i / 인페인트의 바탕 그림 (base64)
    base_image: str = ""
    #: `"img2img"` 또는 `"inpaint"`
    base_mode: str = "img2img"
    #: img2img 슬라이더 값. ★인페인트에서도 **이 값이 `strength` 로 그대로 나간다**
    base_strength: float = 0.7
    #: ★인페인트 슬라이더는 **`inpaintImg2ImgStrength` 하나에만** 실린다 (7절).
    #:  기본 1 이고, 1 이면 `img2img` 필드가 아예 없다(= 마스크 영역 완전 재생성).
    base_inpaint_strength: float = 1.0
    base_noise: float = 0.0
    #: 인페인트 마스크 (base64). 흰 부분이 다시 그려진다
    base_mask: str = ""


def build_payload(req: GenRequest) -> dict:
    """NAI 요청 페이로드를 조립한다. 실제 생성 여부와 무관하게 단위 검증이 가능하도록 분리."""
    is_v4 = "diffusion-4" in req.model
    seed = req.seed if req.seed >= 0 else random.randint(0, 2**31 - 1)

    # ★Furry 모드는 **퀄리티 태그보다 먼저** 앞에 붙는다 (v2 backend.py:1326 순서 그대로).
    #   순서가 바뀌면 프롬프트 문자열이 달라지고 곧 결과가 달라진다.
    prompt_for_nai = f"fur dataset, {req.prompt}" if req.furry_mode else req.prompt
    negative_for_nai = req.negative_prompt

    if is_v4:
        # ★퀄리티 접미사는 **모델마다 다르다**. `text:` 절이 있으면 그 앞에 넣는다
        if req.quality_tags:
            prompt_for_nai = append_prompt(prompt_for_nai, quality_suffix(req.model))
        # ★Enhance 는 접미사 **뒤**에 자기 문구를 끼운다 (공홈 순서)
        if req.enhance and req.model in ENHANCE_PROMPT_MODELS:
            if "upscaled, blurry" not in prompt_for_nai:
                prompt_for_nai = append_prompt(prompt_for_nai, ENHANCE_PROMPT_ADD)

        # ★uc 는 `resolve_uc` 하나가 만든다 — 프리셋 본문·인덱스·nsfw 규칙이 전부 모델에 달렸다.
        #   ★nsfw 검사 대상은 **퀄리티 태그가 붙은 베이스 프롬프트 하나**다 (캐릭터는 안 본다).
        negative_for_nai = resolve_uc(
            req.model, req.uc_preset, prompt_for_nai, req.negative_prompt
        )

    # ★64 정렬 — **가까운 쪽 반올림**이다 (올림 아님). `align64` 주석 참조.
    width = align64(req.width)
    height = align64(req.height)

    params: dict = {
        "params_version": 3,
        "width": width,
        "height": height,
        "scale": req.cfg,
        "sampler": req.sampler,
        "steps": req.steps,
        "seed": int(seed),
        "n_samples": 1,
        "ucPreset": uc_preset_index(req.model, req.uc_preset),
        "qualityToggle": req.quality_tags,
        "dynamic_thresholding": False,
        "controlnet_strength": 1.0,
        "legacy": False,
        "add_original_image": True,
        "cfg_rescale": req.cfg_rescale,
        "noise_schedule": req.scheduler,
        "legacy_v3_extend": False,
        # ★`uncond_scale` 은 **보내지 않는다** — 공홈이 params_version 2 승격 때 이 키를
        #   지웠고(`delete r.uncond_scale`) V4 기본 파라미터에도 없다.
        "negative_prompt": negative_for_nai,
        "prompt": prompt_for_nai,
        # ★`extra_noise_seed` 도 여기 두지 않는다 — 공홈은 **베이스 이미지가 있을 때만**
        #   넣고, 값은 `seed - 1` 이다 (아래 i2i 절). 클램프도 없다.
        "normalize_reference_strength_multiple": req.normalize_reference_strength,
        # ★**언제나 실리는 값**이다 (10절) — 예전에는 i2i·인페인트 분기 안에서만 넣어서
        #   txt2img 요청에는 빠져 있었다
        "image_format": "png",
        "inpaintImg2ImgStrength": 1,
        "legacy_uc": False,
    }

    if is_v4:
        # V4+ 는 sm/sm_dyn 대신 autoSmea (웹과 동일). V3 경로는 아직 옮기지 않았다.
        # ★SMEA 선택 UI 는 **일부러 안 만든다** — v2 에도 있지만 죽은 컨트롤이다.
        #   v2 가 제공하는 모델 3종이 전부 `diffusion-4` 라 `sm`·`sm_dyn` 이 항상 False 였다
        #   (v2 backend.py:1316). V3 모델을 되살릴 때 함께 꺼낸다.
        params["autoSmea"] = False

    # ★빈 슬롯은 보내지 않는다 (공통 전송 구간이 지운다). 슬롯이 비어 있는데 보내면
    #   캐릭터 수만 늘어나 구도가 달라진다.
    chars = [c for c in req.characters if (c.prompt or "").strip()]
    # ★캐릭터 슬롯의 기본 UC 는 모델마다 다르다 (`xp()`) — V4.0 계열만 값이 있다
    char_uc_default = CHAR_DEFAULT_UC.get(req.model, "")
    for c in chars:
        if not (c.uc or "").strip():
            c.uc = char_uc_default
    use_coords = any(c.use_coord for c in chars)
    params["use_coords"] = use_coords
    params["characterPrompts"] = [
        {"prompt": c.prompt, "uc": c.uc, "center": c.center, "enabled": True} for c in chars
    ]
    params["v4_prompt"] = {
        "use_coords": use_coords,
        "use_order": True,
        "caption": {
            "base_caption": prompt_for_nai,
            "char_captions": [
                {"char_caption": c.prompt, "centers": [c.center]} for c in chars
            ],
        },
    }
    params["v4_negative_prompt"] = {
        "legacy_uc": False,
        "caption": {
            "base_caption": negative_for_nai,
            "char_captions": [{"char_caption": c.uc, "centers": [c.center]} for c in chars],
        },
    }

    # ── Vibe Transfer (v2 backend.py:1479-1542) ──
    #   ★여기서는 **인코딩하지 않는다.** 인코딩은 유료 네트워크 호출이라 조립 밖에 있다
    #     (`encode_vibes`). 여기 오는 항목은 이미 `encoded` 가 채워져 있거나 V3 원본이다.
    if req.vibe_transfer:
        images: list[str] = []
        infos: list[int | float] = []
        strengths: list[float] = []
        for v in req.vibe_transfer:
            info = v.get("info_extracted", 1.0)
            if is_v4:
                images.append(v["encoded"])
            else:
                # V3 는 사전 인코딩이 없다 — 원본 그림을 그대로 보낸다
                images.append(imgutil.ensure_png_base64(v["image"]))
            # ★NAI 는 정수 값을 정수로 받는다 (1.0 -> 1)
            infos.append(vibe_mod.as_nai_number(info))
            strengths.append(v.get("strength", 0.6))
        # ★정규화는 **클라이언트가** 한다 (사용자 토글 · 기본 켜짐). 2장 이상이고 합이 1을
        #   넘을 때만 각 값을 합으로 나눈다 — 서버가 알아서 해 주지 않는다.
        if req.normalize_reference_strength and len(strengths) > 1:
            total = sum(strengths)
            if total > 1:
                strengths = [s / total for s in strengths]
        params["reference_image_multiple"] = images
        # ★V4+ 경로는 **IE 배열을 보내지 않는다** — 정보량은 인코딩에 이미 구워져 있다.
        #   V3 레거시 경로만 함께 보낸다.
        if not is_v4:
            params["reference_information_extracted_multiple"] = infos
        params["reference_strength_multiple"] = strengths

    # ── Precise Reference (V4.5, v2 backend.py:1544-1593) ──
    #   ★전부 웹 캡처로 맞춘 값이다: secondary = 1 - fidelity 반전 · round(...,2) ·
    #     information_extracted 는 **항상 1** · mode 를 `base_caption` 에 넣는 구조.
    refs = [r for r in req.precise_references if r.get("image")]
    if refs:
        params["director_reference_images"] = [r["image"] for r in refs]
        params["director_reference_information_extracted"] = [1 for _ in refs]
        params["director_reference_strength_values"] = [r.get("strength", 1.0) for r in refs]
        params["director_reference_secondary_strength_values"] = [
            round(1.0 - r.get("fidelity", 1.0), 2) for r in refs
        ]
        params["director_reference_descriptions"] = [
            {
                "caption": {"base_caption": r.get("mode", "character&style"), "char_captions": []},
                "legacy_uc": False,
            }
            for r in refs
        ]

    if req.variety_plus:
        # ★해상도로 보정한다 — 19 고정으로 보내면 V4.5 에서 CFG 지연 구간이 3배 짧아져
        #   Variety+ 가 거의 안 걸린다. 832x1216 이 보정계수 정확히 1.0 이다.
        base_sigma = (
            VARIETY_SIGMA_BASE_V45
            if ("diffusion-4-5" in req.model or req.model == "custom")
            else VARIETY_SIGMA_BASE_V4
        )
        params["skip_cfg_above_sigma"] = base_sigma * math.sqrt(
            (width // 8) * (height // 8) / 15808
        )

    # k_euler_ancestral + non-native scheduler 조합에서 필수
    if req.sampler == "k_euler_ancestral" and req.scheduler != "native":
        params["deliberate_euler_ancestral_bug"] = False
        params["prefer_brownian"] = True

    # ── i2i / 인페인트 (v2 backend.py:1626-1700) ──
    action = "generate"
    model = req.model
    if req.base_image:
        # ★**요청 해상도로 우리가 리샘플해 보낸다** — 서버 리사이즈에 맡기면 필터가 달라
        #   초기 latent 가 어긋난다 (`imgutil.preprocess_base_image` 주석).
        #   ★Enhance 도 여기를 지난다: `generateEnhance` 는 width/height 만 키우고,
        #     공통 전송 구간이 그 크기로 그림을 리샘플한다.
        params["image"] = imgutil.preprocess_base_image(req.base_image, width, height)
        params["strength"] = req.base_strength
        # ★`extra_noise_seed` 는 **이미지가 있을 때만**, 값은 `seed - 1` 이다.
        #   클램프가 없어 시드 0 이면 -1 이 그대로 나간다 (공홈과 같다).
        params["extra_noise_seed"] = int(seed) - 1

        if req.base_mode == "inpaint" and req.base_mask:
            action = "infill"
            # ★공홈 마스크는 **8px 블록**이다 (7절). 1px 단위로 보내면 같은 마스크로도
            #   다른 그림이 나온다. 크기는 **정렬된** 요청 해상도로 맞춘다.
            params["mask"] = imgutil.quantize_mask_8px(req.base_mask, width, height)

            # ★★여기부터는 NAI 웹의 실제 인페인트 요청을 캡처해 맞춘 것이다.
            #   세 줄이 각각 **다른 버그를 고친 흔적**이라, "중복이니 하나로" 하면
            #   강도 슬라이더가 통째로 무효가 되거나 솔기가 돌아온다:
            #     · request_type 미전송 — "NativeInfillingRequest" 는 마스크 영역을
            #       강도와 무관하게 완전 재생성시켜 강도를 무효화했다
            #     · add_original_image=False — 웹이 false 다 (우리는 True 로 보내고 있었다)
            #
            # ★강도 배치 (2026-08-12 번들 재확인 — "세 곳에 다 넣는다"는 틀렸다):
            #   **인페인트 슬라이더는 `inpaintImg2ImgStrength` 하나에만** 실린다. 기본 1 이고,
            #   1 이면 `img2img` 필드가 아예 없다(= 마스크 영역 완전 재생성).
            #   `strength` 는 별개로, **img2img 슬라이더 값**(기본 0.7)이 그대로 나간다.
            params.pop("request_type", None)
            params["add_original_image"] = False
            params["strength"] = req.base_strength
            params["inpaintImg2ImgStrength"] = req.base_inpaint_strength
            if req.base_inpaint_strength != 1:
                params["img2img"] = {
                    "strength": req.base_inpaint_strength,
                    "color_correct": True,
                }
            else:
                params.pop("img2img", None)
            params["noise"] = 0
            # 웹은 V3 SMEA(sm/sm_dyn) 대신 autoSmea:false 를 쓴다
            params.pop("sm", None)
            params.pop("sm_dyn", None)
            params["autoSmea"] = False
            params["deliberate_euler_ancestral_bug"] = False
            params["prefer_brownian"] = True

            # ★인페인트는 vibe 를 지원하지 않는다 (Precise Reference 는 지원한다)
            for k in (
                "reference_image_multiple",
                "reference_information_extracted_multiple",
                "reference_strength_multiple",
            ):
                params.pop(k, None)

            # ★인페인트 전용 모델은 **표로** 고른다 — 접미사 규칙으로 만들면 없는 id 가 생긴다
            #   (`nai-diffusion-4-curated-preview` 는 -preview 가 탈락한다).
            if not model.endswith("-inpainting"):
                model = INPAINT_MODEL.get(model, INPAINT_MODEL_DEFAULT)
        else:
            action = "img2img"
            params["noise"] = req.base_noise
            # ★공홈은 action 이 img2img 면 최상위 `color_correct=false` 를 붙인다
            params["color_correct"] = False

    return {
        "input": prompt_for_nai,
        "model": model,
        "action": action,
        # ★공홈이 최상위에 늘 싣는 값이다 (`docs/nai-web-reference.md` 1절 최상위 본문).
        #   v2 대조에서 **우리만 빠져 있었다** (2026-08-12).
        "use_new_shared_trial": True,
        "parameters": params,
    }


async def encode_vibes(req: GenRequest, token: str, cache: vibe_mod.VibeCache) -> None:
    """V4+ vibe 를 미리 굽는다 — **조립 전에** 부른다 (v2 backend.py:1489-1526).

    ★유료 호출이다. 이미 구워 둔 것이 있고 모델·info 가 맞으면 **건드리지 않는다.**
      판정은 `vibe.reuse_ok` 하나가 한다 (인페인트 접미어 제거·0.001 오차 포함)."""
    if not req.vibe_transfer or "diffusion-4" not in req.model:
        return
    for i, v in enumerate(req.vibe_transfer):
        info = v.get("info_extracted", 1.0)
        if vibe_mod.reuse_ok(v, req.model, info):
            continue
        png = imgutil.ensure_png_base64(v["image"])
        v["encoded"] = await vibe_mod.encode(
            png, req.model, info, v.get("strength", 0.6), token, cache,
            v.get("name", f"vibe_{i + 1}"),
        )
        v["encoded_model"] = req.model
        v["encoded_info_extracted"] = info


async def generate_with_payload(payload: dict, token: str) -> tuple[bytes, int]:
    """이미 조립된 페이로드로 생성한다.

    ★조립(build_payload)과 전송을 나눈 이유: **records.jsonl 에 그 시점의 완전한 요청을
      그대로 남기기 위해서**다. 나중에 spec 이 바뀌어도 재현·비교가 가능해진다."""
    if not token:
        raise RuntimeError("NAI 토큰이 설정되지 않았습니다.")

    seed = payload["parameters"]["seed"]
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=120) as client:
        res = await client.post(NAI_ENDPOINT, headers=headers, json=payload)
        if res.status_code != 200:
            raise RuntimeError(f"NAI API {res.status_code}: {res.text[:500]}")

        # 응답은 이미지 한 장이 든 zip 이다.
        with zipfile.ZipFile(io.BytesIO(res.content)) as zf:
            return zf.read(zf.namelist()[0]), seed


async def generate(req: GenRequest, token: str) -> tuple[bytes, int]:
    """조립 + 전송을 한 번에 (단순 호출용)."""
    return await generate_with_payload(build_payload(req), token)


# ── 업스케일 ──────────────────────────────────────────────────────
def upscale_cost(width: int, height: int, tier: int = 0, active: bool = False) -> int:
    """이 그림을 4배로 키우는 값 (Anlas). **-1 이면 못 한다** (너무 크다).

    공홈 산식 그대로다 (`docs/nai-web-reference.md` 9절):
      픽셀 수로 구간을 정하고, Opus(3티어 구독중)는 409,600px 이하를 공짜로 준다.

    ★공홈은 못 하는 경우를 `-3` 으로 돌려주지만 우리는 **-1** 로 통일한다 —
      우리 쪽 다른 계산(Anlas 예상)이 음수를 "알 수 없음"으로 쓰고 있어서다."""
    px = int(width) * int(height)
    if px <= UPSCALE_FREE_PX and tier >= 3 and active:
        return 0
    cost = -1
    for limit, c in UPSCALE_COST_TABLE:
        if px <= limit:
            cost = c
    return cost


async def upscale(png_b64: str, width: int, height: int, token: str) -> bytes:
    """그림을 4배로 키운다 (`/ai/upscale`).

    ★생성과 **다른 호스트**(api.novelai.net)이고, 응답은 생성과 같은 **zip** 이다.
    ★보내는 width/height 는 **원본 크기**다 — 결과 크기가 아니다 (공홈 호출 그대로)."""
    if not token:
        raise RuntimeError("NAI 토큰이 설정되지 않았습니다.")
    body = {"image": png_b64, "width": int(width), "height": int(height), "scale": UPSCALE_SCALE}
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=120) as client:
        res = await client.post(UPSCALE_ENDPOINT, headers=headers, json=body)
        if res.status_code != 200:
            raise RuntimeError(f"NAI API {res.status_code}: {res.text[:500]}")
        with zipfile.ZipFile(io.BytesIO(res.content)) as zf:
            return zf.read(zf.namelist()[0])
