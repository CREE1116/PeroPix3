import { useI18n } from "../i18n";
import { useState } from "react";
import { compileBlocks } from "../lib/blocks";
import { usePrompt } from "../store/prompt";
import { StyleSection, CharSection, JoinZone, type SectionProps } from "./PromptSections";
import { BlockLibButton } from "../blocks/BlockDrawer";

/** 좌측 패널 — 카드형 섹션 안에 블록 시퀀스.
 *  스타일 섹션(= NAI 의 공통 prompt/uc) 하나 + 캐릭터 섹션 여럿(= characterPrompts[]). */
export function PromptPanel({ onThumb }: SectionProps) {
  const { base, baseUc, chars, addChar } = usePrompt();
  const t = useI18n((s) => s.t);
  const [preview, setPreview] = useState(false);

  return (
    // ★`height: 100%` 가 아니라 `flex: 1` 이다 — 아래에 생성 푸터가 형제로 붙으므로,
    //   100% 를 잡으면 푸터가 화면 밖으로 밀려난다 (실측 2026-08-04)
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "var(--sp-4) var(--sp-4) 0" }}>
        {/* ★그릇 이름은 **payload 의 어느 칸인가**, 카드 이름은 **무엇을 저장하는가**
            (사용자 지시 2026-08-11). 그래서 베이스만 쓰는 사람은 카드를 안 꽂고 그 칸에 바로
            적으면 되고, 스타일을 저장해 두는 사람은 「스타일 카드」로 알아본다.
            ★그릇은 **평면**(이름표만)이고 그 안에 얹히는 **카드가 둥글다** — 씬 칸과 같은 규칙. */}
        <Container label={t("prompt.baseBox")} right={<BlockLibButton />}>
          <StyleSection onThumb={onThumb} />
        </Container>

        <Container label={t("prompt.charBox")}>
          {chars.map((ch, i) => (
            <CharSection key={ch.id} ch={ch} index={i} onThumb={onThumb} />
          ))}

          <JoinZone />

          <button
            onClick={() => addChar({})}
            style={{
              width: "100%",
              marginBottom: "var(--sp-5)",
              padding: "var(--sp-3)",
              border: "1px dashed var(--line)",
              borderRadius: "var(--r-3)",
              fontSize: "var(--text-2xs)",
              color: "var(--ink-faint)",
              background: "transparent",
            }}
          >
            {t("cards.addChar")}
          </button>
        </Container>
      </div>

      {/* 최종 프롬프트 미리보기 */}
      <div
        style={{ flexShrink: 0, borderTop: "1px solid var(--line)" }}
      >
        <button
          onClick={() => setPreview((v) => !v)}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: "var(--sp-2)",
            padding: "var(--sp-2) var(--sp-4)",
            fontSize: "var(--text-2xs)",
            fontWeight: "var(--w-semi)",
            color: "var(--ink-soft)",
          }}
        >
          {t("prompt.finalPrompt")}
          <span style={{ fontWeight: 400, color: "var(--ink-faint)" }}>
            {t("prompt.chars", { n: compileBlocks(base).length + compileBlocks(baseUc).length })}
          </span>
        </button>
        {preview && (
          <div style={{ padding: "0 var(--sp-4) var(--sp-3)", maxHeight: 220, overflowY: "auto" }}>
            <Pre label={t("prompt.tabPrompt")} text={compileBlocks(base)} />
            <Pre label={t("prompt.tabUc")} text={compileBlocks(baseUc)} accent="var(--uc-c)" />
            {chars
              .filter((c) => c.on)
              .map((c, i) => (
                <Pre
                  key={c.id}
                  label={c.name || t("cards.charN", { n: i + 1 })}
                  text={compileBlocks(c.prompt)}
                />
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** 그릇 — 이름표 한 줄 + 그 안의 카드들. ★상자를 그리지 않는다 (평면) */
/** 그릇 하나 — 이름표 한 줄과 그 아래 카드들.
 *  ★이름표 줄 오른쪽은 **그 그릇에 딸린 창구** 자리다 (블록 저장소 등). 패널 머리에 두면
 *    무엇에 딸린 단추인지 안 보인다 (사용자 지시 2026-08-16). */
function Container({
  label,
  right,
  children,
}: {
  label: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: "var(--sp-6)" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-2)",
          padding: "0 var(--sp-1) var(--sp-2)",
          fontSize: "var(--text-2xs)",
          fontWeight: "var(--w-semi)",
          color: "var(--ink-dim)",
        }}
      >
        <span>{label}</span>
        <span style={{ flex: 1 }} />
        {right}
      </div>
      {children}
    </div>
  );
}

function Pre({ label, text, accent }: { label: string; text: string; accent?: string }) {
  const t = useI18n((s) => s.t);
  return (
    <div style={{ marginTop: "var(--sp-2)" }}>
      <div style={{ fontSize: "var(--text-2xs)", color: accent ?? "var(--ink-dim)" }}>{label}</div>
      <pre
        style={{
          margin: "2px 0 0",
          padding: "var(--sp-2)",
          background: "var(--code-bg)",
          borderRadius: "var(--r-1)",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--text-2xs)",
          lineHeight: 1.5,
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          color: "var(--ink-soft)",
        }}
      >
        {text || t("prompt.empty")}
      </pre>
    </div>
  );
}
