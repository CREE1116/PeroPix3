import { useI18n } from "../i18n";
import { useState } from "react";
import { makeBlock, parseSegs } from "../lib/blocks";
import { useGen } from "../store/gen";
import { useGallery, type ImageMeta } from "../store/gallery";
import { CHAR_COLORS, usePrompt, type Char } from "../store/prompt";
import { useImageInput } from "../store/imageInput";
import { useUi } from "../store/ui";

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

  const onApply = (what: "prompt" | "all") => {
    applyMeta(meta, what);
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
        {/* ★순수 NAI 그림은 **되돌릴 수 없는 값**이 있다 — NAI 는 `ucPreset`·`qualityToggle` 을
            null 로 돌려주므로(=클라이언트가 프롬프트에 직접 넣는 값), 그 둘은 추측이 된다.
            숫자 필드로 프리셋을 판정하지 않는다 (v2 CLAUDE.md 의 round-trip 원칙). */}
        {meta.pure_nai && (
          <span data-pure-nai style={{ fontSize: "var(--text-2xs)", color: "var(--warn)" }}>
            {t("gallery.pureNai")}
          </span>
        )}
        {/* ★적용은 **하나**다 (사용자 지시 2026-08-05). 「프롬프트만」을 따로 두지 않는다 —
            프롬프트는 적용하는 것이 아니라 **보는 것**이고, 그건 큰 그림 아래
            「프롬프트 보기」가 한다 (ImageActions). */}
        <button
          data-gallery-apply-all
          onClick={() => onApply("all")}
          title={t("act.settingsHint")}
          style={{
            ...applyBtn,
            background: flash ? "var(--ok)" : "var(--accent)",
            color: flash ? "#fff" : "var(--accent-on)",
            borderColor: flash ? "var(--ok)" : "var(--accent)",
          }}
        >
          {flash ? t("act.applied") : t("act.settings")}
        </button>
      </div>
    </Frame>
  );
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

/** @param what `prompt` = 프롬프트만 · `all` = 설정·시드·이미지 입력까지 (그 그림을 재현한다) */
export function applyMeta(m: ImageMeta, what: "prompt" | "all" = "all") {
  const p = usePrompt.getState();
  const g = useGen.getState();

  const block = (label: string, body?: string) =>
    body ? [makeBlock(label, [], { tags: parseSegs(body), open: true })] : [];

  const chars: Char[] = (m.characters ?? []).map((c, i) => ({
    id: `c${Date.now().toString(36)}${i}`,
    ref: null,
    name: `#${i + 1}`,
    color: CHAR_COLORS[i % CHAR_COLORS.length],
    thumb: null,
    prompt: block("Character", c.prompt),
    uc: block("UC", c.negative),
    on: true,
    center: c.center ?? undefined,
    stack: [],
  })) as Char[];

  p.load({
    base: block("Prompt", m.prompt),
    baseUc: block("UC", m.negative),
    chars,
  });

  // ★프롬프트가 통째로 바뀐다 — 좌측 패널을 펴고 알린다 (사용자 지시 2026-08-13)
  useUi.getState().reveal("left", "prompt");
  if (what === "prompt") return;

  // 설정 — 있는 것만 덮는다. 없는 값을 기본값으로 되돌리면 사용자가 잡아 둔 것이 날아간다.
  if (m.steps !== undefined) g.set("steps", m.steps);
  if (m.cfg !== undefined) g.set("cfg", m.cfg);
  if (m.sampler) g.set("sampler", m.sampler);
  if (m.scheduler) g.set("scheduler", m.scheduler);
  if (m.width !== undefined) g.set("width", m.width);
  if (m.height !== undefined) g.set("height", m.height);
  if (m.seed !== undefined) g.set("seed", m.seed);
  // ★서버가 정규화해 준 값들 (backend/meta.py). 프롬프트에서 퀄리티 태그를, 네거티브에서
  //   UC 프리셋을 이미 떼어 냈으므로, 그 둘을 **설정으로 되돌려야** 다시 생성했을 때 같아진다.
  //   빠뜨리면 프롬프트만 짧아지고 태그가 영영 사라진다.
  if (m.uc_preset) g.set("uc_preset", m.uc_preset);
  if (m.quality_tags !== undefined) g.set("quality_tags", m.quality_tags);
  if (m.variety_plus !== undefined) g.set("variety_plus", m.variety_plus);
  if (m.nai_model) g.set("model", m.nai_model);
  // ★시드를 되살렸으면 **랜덤을 끈다** — 안 끄면 다음 생성이 새 시드로 굴러 재현이 안 된다
  if (m.seed !== undefined) g.set("seed_mode", "fixed");

  // ★바이브는 **강도만** 되살린다 (v2 도 그렇다). 그림 자체는 메타데이터에 없고
  //   인코딩만 남아 있어서, 원본 없이 다시 굽지 못한다 — 목록에 자리를 만들어
  //   "이 그림에 무엇이 걸려 있었는지"를 보이고, 그림은 사용자가 다시 넣는다.
  const vibes = m.nai_vibes;
  if (vibes?.strengths?.length) {
    const im = useImageInput.getState();
    im.setVibeOn(true);
    vibes.strengths.forEach((st, i) => {
      im.patchVibe(i, { strength: st, info_extracted: vibes.info_extracted?.[i] ?? 1 });
    });
  }
}

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
        title={v}
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
