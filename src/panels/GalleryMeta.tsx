import { t, useI18n } from "../i18n";
import { useState } from "react";
import { makeBlock, parseSegs } from "../lib/blocks";
import { useGen } from "../store/gen";
import { DEFAULT_CENTER } from "../lib/charPos";
import { useGallery, type ImageMeta } from "../store/gallery";
import { CHAR_COLOR, usePrompt, type Char } from "../store/prompt";
import { useImageInput } from "../store/imageInput";
import { useUi } from "../store/ui";
import { keepScroll, LEFT_SCROLL } from "../lib/keepScroll";
import { useSceneFocus } from "../store/sceneFocus";
import { useWs } from "../store/workspace";
import { api } from "../lib/backend";
import { toast } from "../store/toast";
import { metaParams } from "../lib/metaApply";

/** 그림 정보 — 우 패널. 고른 **한 장**의 메타데이터를 보여주고, 프롬프트로 되돌린다.
 *
 *  ★"프롬프트로 불러오기"가 v2 의 통합 Apply 모달 자리다 (feature-inventory G절).
 *    모달 대신 패널에 둔 이유: 그림을 넘겨 가며 비교하다 마음에 드는 것을 그대로 쓰는 흐름이라,
 *    창이 뜨면 비교가 끊긴다. */
export function GalleryMeta() {
  const t = useI18n((s) => s.t);
  const { focus, meta } = useGallery();
  const [flash, setFlash] = useState(false);

  // ★고른 그림이 없을 때 조작 안내를 또 적지 않는다 — 그 안내는 그리드 위 툴바에 이미 있다.
  //   여기는 "왜 비어 있는지"만 한 줄로 말한다.
  if (!focus) {
    return (
      <Frame>
        <div style={{ padding: "0 var(--sp-4)", fontSize: "var(--text-2xs)", color: "var(--ink-faint)" }}>
          —
        </div>
      </Frame>
    );
  }

  if (!meta) {
    return (
      <Frame>
        <div style={{ padding: "var(--sp-4)", color: "var(--ink-faint)" }}>
          <div style={{ fontSize: "var(--text-xs)" }}>{t("gallery.noMeta")}</div>
          <div style={{ fontSize: "var(--text-2xs)", marginTop: "var(--sp-2)" }}>
            {t("gallery.noMetaHint")}
          </div>
        </div>
      </Frame>
    );
  }

  /** ★★「설정 불러오기」가 아니라 **「새 탭으로 복제」**다 (사용자 지시 2026-08-19).
   *
   *  예전 이름은 **어디에 불러오는지**를 말하지 않아서, 지금 보고 있던 탭의 프롬프트가
   *  통째로 갈리는 줄 모르고 누르게 됐다. 지금은 **새 탭을 만들고 거기에** 되돌린다 —
   *  워크스페이스 그림의 「새 탭으로 복제」와 같은 뜻이다 (`workspace.cloneToNewTab`).
   *  ★다른 점 하나: 갤러리 그림에는 생성 시점 스냅샷(`env`)이 없다. 그래서 되돌릴 수 있는
   *    것은 **그림에 남은 것 전부**다 — 프롬프트·캐릭터·생성 옵션·해상도·시드·바이브. */
  const onClone = async () => {
    if (!focus) return;
    await cloneMetaToNewTab(meta, focus);
    setFlash(true);
    setTimeout(() => setFlash(false), 1600);
  };

  return (
    <Frame>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 var(--sp-4) var(--sp-4)" }}>
        <Grid>
          {meta.seed !== undefined && <Field k={t("gallery.fieldSeed")} v={String(meta.seed)} mono />}
          {meta.steps !== undefined && <Field k={t("gallery.fieldSteps")} v={String(meta.steps)} mono />}
          {meta.cfg !== undefined && <Field k={t("gallery.fieldCfg")} v={String(meta.cfg)} mono />}
          {meta.width !== undefined && (
            <Field k={t("gallery.fieldSize")} v={`${meta.width}×${meta.height}`} mono />
          )}
          {meta.sampler && <Field k={t("gallery.fieldSampler")} v={meta.sampler} />}
          {meta.scheduler && <Field k={t("gallery.fieldScheduler")} v={meta.scheduler} />}
        </Grid>
        {(meta.source || meta.nai_model) && (
          <Field k={t("gallery.fieldModel")} v={meta.source || meta.nai_model!} />
        )}

        <Text label={t("gallery.fieldPrompt")} body={meta.prompt} mark="prompt" />
        <Text label={t("gallery.fieldNegative")} body={meta.negative} dim mark="negative" />

        {!!meta.characters?.length && (
          <>
            <Label>{t("gallery.fieldCharacters")}</Label>
            {meta.characters.map((c, i) => (
              <div
                key={i}
                style={{
                  marginBottom: "var(--sp-2)",
                  padding: "var(--sp-2) var(--sp-3)",
                  borderRadius: "var(--r-2)",
                  background: "var(--surface2)",
                  fontSize: "var(--text-2xs)",
                  color: "var(--ink-dim)",
                  lineHeight: 1.5,
                  wordBreak: "break-word",
                }}
              >
                {c.prompt || "—"}
                {c.negative && (
                  <div style={{ marginTop: 2, color: "var(--ink-faint)" }}>− {c.negative}</div>
                )}
              </div>
            ))}
          </>
        )}
      </div>

      <div
        style={{
          flexShrink: 0,
          padding: "var(--sp-3) var(--sp-4)",
          borderTop: "1px solid var(--line-soft)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--sp-2)",
        }}
      >
        {/* ★「NAI 원본은 복원되지 않는다」는 알림을 걷었다 (사용자 지적 2026-08-19).
            UC 프리셋도 퀄리티 태그도 **모델별 표로 떼어내 되돌린다** (`backend/meta.py` —
            표는 `nai.py` 하나를 본다). 못 되돌리는 것이 없으므로 경고할 것도 없다. */}
        {/* ★적용은 **하나**다 (사용자 지시 2026-08-05). 「프롬프트만」을 따로 두지 않는다 —
            프롬프트는 적용하는 것이 아니라 **보는 것**이고, 그건 큰 그림 아래
            「프롬프트 보기」가 한다 (ImageActions). */}
        <button
          data-gallery-apply-all
          onClick={() => void onClone()}
          data-tip={t("act.cloneHint")}
          style={{
            ...applyBtn,
            background: flash ? "var(--ok)" : "var(--accent)",
            color: flash ? "#fff" : "var(--accent-on)",
            borderColor: flash ? "var(--ok)" : "var(--accent)",
          }}
        >
          {flash ? t("act.cloned") : t("act.clone")}
        </button>
      </div>
    </Frame>
  );
}

/** 그 그림의 설정으로 **새 탭을 만든다** (갤러리의 유일한 되돌리기 창구).
 *
 *  ★★**워크스페이스 그림의 복제와 같은 자리를 쓴다** (`workspace.cloneToNewTab`) —
 *    사용자 지시 2026-08-19: *"슬롯에서 복제할때랑 동일한 로직 사용해"*. 갈래를 두 벌 두면
 *    한쪽만 고쳐져 갤러리에서만 조용히 빠지는 것이 생긴다 (실제로 그렇게 됐다:
 *    **슬롯 프롬프트가 통째로 사라지고, 그림이 슬롯에 안 앉았다**).
 *
 *  다른 것은 셋뿐이다:
 *    · 파일이 **보관함**에 있다 — 서버가 거기서 집어 새 슬롯에 앉힌다 (`from: "keep"`)
 *    · 구조를 찾아볼 자리가 **그 그림의 출처**다 (`/api/keep/origin` → 그 워크스페이스의 `env`).
 *      ★구조는 PNG 에 안 남는다 — 출처를 못 찾으면 되돌릴 것이 합쳐진 문자열뿐이다.
 *    · 그때는 **씬을 메타데이터에서** 받는다 (`slot_prompt`, v2 가 PNG 에 남긴 슬롯 프롬프트)
 *
 *  ★예전 이름 「설정 불러오기」는 **어디에 불러오는지**를 말하지 않아, 보고 있던 탭이
 *    통째로 갈리는 줄 모르고 누르게 됐다 (사용자 지적 2026-08-19).
 *
 *  @param file 보관함 안에서의 경로 (갤러리가 다루는 그 파일) */
export async function cloneMetaToNewTab(m: ImageMeta, file: string) {
  const ws = useWs.getState();
  if (!ws.current || !ws.spec) return;
  const origin = await api<{ origin: { workspace: string; file: string } | null }>(
    `/api/keep/origin?file=${encodeURIComponent(file)}`,
  )
    .then((r) => r.origin)
    .catch(() => null);

  const landed = await ws.cloneToNewTab(file, {
    excludeNo: useGen.getState().params.exclude_slot_number,
    from: "keep",
    origin: origin && { ws: origin.workspace, file: origin.file },
    seed: m.seed,
    // 출처를 못 찾았을 때만 쓰인다 — 그때 슬롯을 비우면 씬 프롬프트가 사라진다
    scene: m.slot_prompt
      ? { blocks: [makeBlock(t("slots.blockTags"), [], { tags: parseSegs(m.slot_prompt), src: m.slot_prompt, open: true })] }
      : undefined,
    // ★구조를 되살렸으면 **값만** 얹는다 (워크스페이스 복제와 같다). 못 되살렸을 때만
    //   메타데이터로 프롬프트까지 세운다 — 안 그러면 되살린 블록·카드를 한 뭉텅이가 덮는다.
    apply: ({ structure }) => {
      if (structure) {
        applyMetaParams(m);
        applyMetaVibes(m);
      } else {
        applyMeta(m, "all");
      }
    },
  });
  useUi.getState().setMode("generate");
  // ★새 탭의 씬 줄은 탭이 바뀔 때 고른 것을 놓는다 — 그 뒤에 세워야 남는다 (Canvas 와 같다)
  if (landed) useSceneFocus.getState().focus(landed.cell, landed.file);
  toast(t("act.cloned"));
}

/** 메타데이터를 지금 작업 상태로 되돌린다 — 프롬프트·캐릭터·생성 설정 전부.
 *
 *  ★블록 하나에 통째로 넣는다. 원래 어떤 블록으로 나뉘어 있었는지는 이미지에 안 남아 있고
 *    (NAI 는 합쳐진 문자열만 저장한다), 임의로 쪼개면 사용자가 안 만든 구조가 생긴다. */
const applyBtn: React.CSSProperties = {
  flex: 1,
  padding: "var(--sp-2)",
  borderRadius: "var(--r-2)",
  border: "1px solid var(--line)",
  fontSize: "var(--text-xs)",
  transition: "background 120ms",
};

/** 그 그림의 **설정·해상도·시드만** 얹는다 (프롬프트는 안 건드린다).
 *
 *  ★「새 탭으로 복제」가 쓴다. 거기서 프롬프트·스타일·캐릭터·슬롯은 **그 그림이 나온 탭과
 *    씬에서 구조째** 가져오고(`cloneToNewTab`), 메타데이터에서는 값만 얹는다 —
 *    메타데이터에는 합쳐진 문자열만 남아 구조가 없기 때문이다 (사용자 지시 2026-08-19).
 *  ★표는 `lib/metaApply` **하나**를 쓴다. `applyMeta` 도 이 함수를 부른다. */
export function applyMetaParams(m: ImageMeta) {
  const g = useGen.getState();
  // ★★값이 밖에서 갈리면 **그 자리를 펴고 강조한다** (사용자 지시 2026-08-19) —
  //   왼쪽 패널이 접혀 있으면 무엇이 바뀌었는지 알 길이 없다 (`Category` 의 `flashKey`)
  // ★★강조만 한다 — **데려가지 않는다** (사용자 지시 2026-08-21). 불러오면 여러 자리가
  //   한꺼번에 바뀌어서, 그때마다 화면이 움직이면 무엇이 바뀌었는지 오히려 못 본다.
  useUi.getState().reveal("left", "params", false);
  useUi.getState().reveal("left", "size", false);
  useGen.setState({ params: { ...g.params, ...metaParams(m) } });
  if (m.width !== undefined) g.set("width", m.width);
  if (m.height !== undefined) g.set("height", m.height);
  if (m.seed !== undefined) g.set("seed", m.seed);
  /* ★★캐릭터 좌표 켜짐은 **`lib/metaApply` 표에 안 넣는다** — 시드·해상도와 같은 사정이다
     (그 파일 머리 주석): 쓰는 자리마다 뜻이 다르다. 강화는 캐릭터를 `{prompt, uc}` 로만
     실어 보내기로 정해 둔 자리라(`EnhanceDialog.metaJob` 의 ★주, v2 `index.html:24472`),
     표에 넣으면 **자리 없이 좌표만 켜져** 인물 전원이 한가운데로 겹친다.
     여기(갤러리의 「설정 불러오기」)는 `applyMetaInner` 가 자리까지 되살리므로 뜻이 맞는다. */
  if (m.use_coords !== undefined) g.set("use_coords", m.use_coords);
  // ★★**시드 규칙(고정/한 바퀴/씬마다)은 건드리지 않는다** (사용자 지시 2026-08-21).
  //   예전에는 시드를 되살리면 「고정」으로 바꿨는데, 그러면 사용자가 골라 둔 규칙이
  //   그림 하나 불러올 때마다 말없이 뒤집힌다. 값만 넣고 규칙은 사용자 것으로 둔다
  //   (그 시드로 다시 뽑고 싶으면 「고정」은 바로 옆에서 누를 수 있다).
}

/** 그 그림의 **바이브**를 되살린다 (인코딩이 남아 있어 다시 굽지 않는다).
 *
 *  ★이미지 입력도 **「그 그림을 뽑은 환경」의 일부**다 — 「새 탭으로 복제」도 이것을 부른다
 *    (사용자 지시 2026-08-19: 환경을 그대로 옮겨 이어서 쓰는 기능이다). */
export function applyMetaVibes(m: ImageMeta) {
  // ★바이브는 **인코딩으로** 되살린다 (v2 index.html:18114-18150).
  //
  //  그림 자체는 메타데이터에 없고 구워진 인코딩만 남아 있다. 그 인코딩이 곧 쓸 수 있는
  //  물건이라, 모델과 정보추출을 함께 실어 두면 **다시 굽지 않고** 그대로 나간다 (무료).
  //  ★그림 자리에는 1×1 투명 PNG 를 둔다 (v2 와 같다). 빈 문자열을 두면 모델을 바꿨을 때
  //    재인코딩이 빈 그림을 열다 죽는다.
  //  ★`map` 으로 기존 목록을 고치던 예전 방식은 **목록이 비어 있으면 아무것도 안 만들었다** —
  //    되살리기가 통째로 헛돌았다. 목록을 새로 만든다.
  //  ★세는 기준은 **인코딩(`images`)** 이다 (v2 `naiVibes.images.length`). 강도 배열로 세면
  //    인코딩이 없는 자리에도 1×1 투명 PNG 짜리 항목이 생겨, 생성할 때 그 빈 그림을
  //    인코딩하려다 죽는다. 강도가 없는 자리는 v2 와 같이 0.6 으로 채운다.
  const vibes = m.nai_vibes;
  const im = useImageInput.getState();
  if (vibes?.images?.length) {
    const model = m.nai_model || "nai-diffusion-4-5-full";
    im.setVibeOn(true);
    im.setVibes(
      vibes.images.map((enc, i) => {
        const ie = vibes.info_extracted?.[i] ?? 1;
        return {
          image: BLANK_PNG,
          name: `NAI Vibe ${i + 1}`,
          strength: vibes.strengths?.[i] ?? 0.6,
          info_extracted: ie,
          encoded: enc,
          encoded_model: model,
          encoded_info_extracted: ie,
        };
      }),
    );
  } else if (im.vibes.length) {
    // ★바이브가 없는 그림의 설정을 적용하면 **들고 있던 바이브를 비운다** (v2 index.html:18153-18161).
    //   안 비우면 이 그림에 없던 바이브가 섞인 채로 생성돼, 「이 그림을 재현한다」가 어긋난다.
    im.setVibes([]);
    im.setVibeOn(false);
  }
}

/** 그 그림을 뽑을 때의 **베이스 이미지**(i2i·인페인트)를 되살린다.
 *
 *  ★★그림에는 안 남는다 — NAI 가 돌려주는 PNG 에 베이스 그림은 없다. 우리는 보낸 페이로드를
 *    통째로 기록해 두므로 서버가 거기서 꺼내 준다 (`/api/workspaces/{ws}/base`).
 *    사용자 지시 2026-08-22: 「설정 불러오기」가 되살리게 해 달라.
 *  ★**없으면 비운다** — 바이브와 같은 규칙이다 (위 `applyMetaVibes` 의 ★주). 안 비우면 이
 *    그림에 없던 베이스가 섞인 채로 생성돼 「이 그림을 재현한다」가 어긋난다.
 *  ★되살아나는 것은 **전처리된 그림**이다 (해상도에 맞춰 리샘플·레터박스된 것). 그대로 다시
 *    뽑으면 같은 결과가 나오고, 그게 이 기능의 목적이다.
 *  ★강도 슬라이더는 **둘**이다 (`backend/nai.py` 의 인페인트 절) — 한 값으로 합치지 말 것. */
export async function applyRecordedBase(
  got: {
    image?: string;
    mask?: string;
    mode?: string;
    strength?: number;
    noise?: number;
    inpaint_strength?: number;
  } | null,
  name: string,
) {
  const im = useImageInput.getState();
  if (!got?.image) {
    if (im.baseImage) im.clearBase();
    return;
  }
  im.setBase(got.image, name);
  // ★`setBase` 가 마스크를 비우므로 **그 뒤에** 넣는다
  im.patchBase({
    baseMode: got.mode === "inpaint" ? "inpaint" : "img2img",
    baseMask: got.mask ?? "",
    ...(got.strength !== undefined ? { baseStrength: got.strength } : null),
    ...(got.noise !== undefined ? { baseNoise: got.noise } : null),
    ...(got.inpaint_strength !== undefined
      ? { baseInpaintStrength: got.inpaint_strength }
      : null),
  });
  // ★그림이 들어간 자리를 펴고 강조한다 — 접혀 있으면 무엇이 바뀌었는지 알 길이 없다.
  //   ★데려가지는 않는다 (불러오기는 여러 자리가 한꺼번에 바뀌는 자리다)
  useUi.getState().reveal("left", "base", false);
}

/** @param what `prompt` = 프롬프트만 · `all` = 설정·시드·이미지 입력까지 (그 그림을 재현한다) */
export function applyMeta(m: ImageMeta, what: "prompt" | "all" = "all") {
  // ★★**보던 자리를 고정한다** (사용자 지시 2026-08-21). 불러오면 좌측 패널에서 여러 가지가
  //   한꺼번에 벌어져(묶음 펴짐·프롬프트 교체·강조) 내용 높이가 변하고, 그러면 보던 자리가
  //   위아래로 밀린다. 「데려가지 않기」만으로는 안 잡히는 움직임이라 값을 재서 되돌린다.
  keepScroll(LEFT_SCROLL, () => applyMetaInner(m, what));
}

function applyMetaInner(m: ImageMeta, what: "prompt" | "all") {
  const p = usePrompt.getState();

  const block = (label: string, body?: string) =>
    /* ★★`src` 를 함께 담는다 — 그 그림이 실제로 쓴 글자다. 칩을 안 건드리면 다시 뽑을 때
       **한 글자도 다르지 않게** 나간다 (`lib/blocks` 의 `Block.src`). */
    body ? [makeBlock(label, [], { tags: parseSegs(body), src: body, open: true })] : [];

  const chars: Char[] = (m.characters ?? []).map((c, i) => ({
    id: `c${Date.now().toString(36)}${i}`,
    ref: null,
    name: `#${i + 1}`,
    color: CHAR_COLOR,
    thumb: null,
    prompt: block("Character", c.prompt),
    uc: block("UC", c.negative),
    on: true,
    // ★자리가 없던 그림은 한가운데 (백엔드 기본값과 같다 — `charPos.DEFAULT_CENTER`)
    center: c.center ?? DEFAULT_CENTER,
    stack: [],
  })) as Char[];

  p.load({
    base: block("Prompt", m.prompt),
    baseUc: block("UC", m.negative),
    chars,
  });

  // ★프롬프트가 통째로 바뀐다 — 좌측 패널을 펴고 알린다 (사용자 지시 2026-08-13)
  //   ★데려가지는 않는다 (2026-08-21) — 불러오기는 여러 자리가 함께 바뀐다
  useUi.getState().reveal("left", "prompt", false);
  if (what === "prompt") return;

  // 설정 — 있는 것만 덮는다. 없는 값을 기본값으로 되돌리면 사용자가 잡아 둔 것이 날아간다.
  // ★어느 필드가 어느 설정인가는 `lib/metaApply` **하나**가 정한다 — 강화도 같은 표를 쓴다
  //   (`EnhanceDialog`, v2 `buildEnhanceRequest`). 두 벌이면 "이 그림 설정대로"가 두 화면에서
  //   조용히 달라진다.
  applyMetaParams(m);

  applyMetaVibes(m);
}

/** 1×1 투명 PNG — 인코딩만 있고 원본이 없는 바이브의 자리 그림 (v2 `placeholderImage`) */
const BLANK_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/** ★제목은 패널 머리글(Shell)이 이미 달고 있다 — 여기서 또 적으면 두 겹이 된다 */
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, paddingTop: "var(--sp-3)" }}>
      {children}
    </div>
  );
}

const Grid = ({ children }: { children: React.ReactNode }) => (
  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-1) var(--sp-3)" }}>
    {children}
  </div>
);

function Field({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div style={{ padding: "3px 0", minWidth: 0 }}>
      <div style={{ fontSize: "0.62rem", color: "var(--ink-faint)" }}>{k}</div>
      <div
        style={{
          fontSize: "var(--text-2xs)",
          color: "var(--ink-soft)",
          fontFamily: mono ? "var(--font-mono)" : undefined,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        data-tip={v}
      >
        {v}
      </div>
    </div>
  );
}

const Label = ({ children }: { children: React.ReactNode }) => (
  <div
    style={{
      marginTop: "var(--sp-3)",
      marginBottom: "var(--sp-1)",
      fontSize: "0.62rem",
      color: "var(--ink-faint)",
    }}
  >
    {children}
  </div>
);

function Text({ label, body, dim, mark }: { label: string; body?: string; dim?: boolean; mark?: string }) {
  if (!body) return null;
  return (
    <>
      <Label>{label}</Label>
      <div
        data-gallery-field={mark}
        style={{
          padding: "var(--sp-2) var(--sp-3)",
          borderRadius: "var(--r-2)",
          background: "var(--surface2)",
          fontSize: "var(--text-2xs)",
          lineHeight: 1.55,
          color: dim ? "var(--ink-faint)" : "var(--ink-dim)",
          wordBreak: "break-word",
        }}
      >
        {body}
      </div>
    </>
  );
}
