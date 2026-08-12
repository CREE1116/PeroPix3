import { useI18n } from "../i18n";
import type { AnyCard, CardKind } from "../store/cards";
import type { SectionThumb } from "./dragStore";

/** 역드래그 저장에서 **같은 카드가 이미 덱에 있을 때** 묻는 자리.
 *
 *  ★조용히 덮지 않는다. 카드는 공용 저장소라 덮어쓰면 그 카드를 쓰는 다른 워크스페이스까지
 *    바뀐다. 그렇다고 언제나 새로 추가만 하면 같은 이름이 끝없이 쌓인다 —
 *    그래서 **원본 id 를 들고 와서 물어본다**(사용자 지시). */
export type SaveAsk = {
  kind: CardKind;
  card: AnyCard;
  existing: AnyCard;
  /** 섹션에 꽂혀 있던 그림 — 저장이 확정되면 카드로 복사한다 */
  thumb: SectionThumb | null;
};

export function SaveDialog({
  ask,
  onOverwrite,
  onAddNew,
  onCancel,
}: {
  ask: SaveAsk | null;
  onOverwrite: () => void;
  onAddNew: () => void;
  onCancel: () => void;
}) {
  const t = useI18n((s) => s.t);
  if (!ask) return null;

  return (
    <div
      onPointerDown={(e) => e.target === e.currentTarget && onCancel()}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 70,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(10,14,19,0.55)",
        backdropFilter: "blur(2px)",
      }}
    >
      <div
        style={{
          width: 380,
          padding: "var(--sp-5)",
          borderRadius: "var(--r-4)",
          background: "var(--surface)",
          border: "1px solid var(--line)",
          boxShadow: "0 20px 50px rgba(0,0,0,0.45)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--sp-4)",
        }}
      >
        <b style={{ fontSize: "var(--text-sm)" }}>{t("cards.saveTitle")}</b>
        <div style={{ fontSize: "var(--text-xs)", color: "var(--ink-soft)", lineHeight: 1.6 }}>
          {t("cards.saveExists", { name: ask.existing.name })}
          <br />
          <span style={{ color: "var(--ink-faint)" }}>{t("cards.saveExistsHint")}</span>
        </div>
        <div style={{ display: "flex", gap: "var(--sp-2)", justifyContent: "flex-end" }}>
          <Btn onClick={onCancel}>{t("cards.cancel")}</Btn>
          <Btn onClick={onAddNew}>{t("cards.saveAsNew")}</Btn>
          <Btn onClick={onOverwrite} primary>
            {t("cards.saveOverwrite")}
          </Btn>
        </div>
      </div>
    </div>
  );
}

function Btn({
  onClick,
  primary,
  children,
}: {
  onClick: () => void;
  primary?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "var(--sp-2) var(--sp-5)",
        borderRadius: "var(--r-2)",
        fontSize: "var(--text-xs)",
        fontWeight: primary ? 600 : 400,
        border: primary ? "none" : "1px solid var(--line)",
        background: primary ? "var(--accent)" : "transparent",
        color: primary ? "var(--accent-on)" : "var(--ink-soft)",
      }}
    >
      {children}
    </button>
  );
}
