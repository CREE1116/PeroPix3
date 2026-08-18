import { useState } from "react";
import { useI18n } from "../i18n";
import { useCards, type AnyCard, type CardKind } from "../store/cards";
import { useDrag, useDragSource, useDropZone, dragSourceStyle, type DragImage, type SectionThumb } from "./dragStore";
import { saveCardWithThumb } from "./saveCard";
import { normThumb, thumbUrl } from "../store/prompt";
import { artBackground } from "./CardArt";
import { FittedImg } from "./FittedImg";
import { Icon } from "../components/Icon";
import { ask } from "../store/ask";
import { useGen } from "../store/gen";

/** 오른쪽 패널의 **카드덱** — 스타일·캐릭터·씬 세트를 여기서 꺼내고 여기에 저장한다.
 *
 *  ★예전에는 우하단 손패를 눌러 **전체 화면 덱**을 띄웠다 (사용자 지시 2026-08-16으로 옮김).
 *    덱이 화면을 덮으면 무엇에 적용하는지가 안 보이고, 끌어다 놓으려면 덱을 먼저 닫아야 했다.
 *    상시 패널이면 **왼쪽 프롬프트를 보면서** 끌어다 놓을 수 있다.
 *  ★같은 정보에 창구가 둘이 되지 않게, 손패와 전체 화면 덱은 함께 걷었다.
 *
 *  두 방향 다 여기서 된다:
 *    꺼내기  카드를 끌어 프롬프트·씬으로 (`dir: "apply"`)
 *    저장    프롬프트 카드·씬 세트 머리를 끌어 이 줄에 놓으면 덱에 들어간다 (`dir: "save"`)
 */
const KINDS: CardKind[] = ["styles", "characters", "posesets"];

export function DeckPanel({
  onAsk,
  onImageDrop,
}: {
  /** 같은 id 의 카드가 이미 있을 때 — 덮을지 새로 추가할지 묻는다 */
  onAsk: (a: {
    kind: CardKind;
    card: AnyCard;
    existing: AnyCard;
    thumb: SectionThumb | null;
  }) => void;
  /** 생성물을 덱에 놓으면 어느 카드의 그림으로 쓸지 고른다 */
  onImageDrop: (kind: CardKind, img: DragImage) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflowY: "auto" }}>
      {KINDS.map((k) => (
        <Section key={k} kind={k} onAsk={onAsk} onImageDrop={onImageDrop} />
      ))}
    </div>
  );
}

function Section({
  kind,
  onAsk,
  onImageDrop,
}: {
  kind: CardKind;
  onAsk: (a: {
    kind: CardKind;
    card: AnyCard;
    existing: AnyCard;
    thumb: SectionThumb | null;
  }) => void;
  onImageDrop: (kind: CardKind, img: DragImage) => void;
}) {
  const t = useI18n((s) => s.t);
  const cards = useCards((s) => s[kind]);
  const remove = useCards((s) => s.remove);
  const [folded, setFolded] = useState(false);

  // ★저장 — 손패가 하던 것을 그대로 옮겼다 (그쪽 주석): 같은 id 가 이미 있으면 **묻는다**.
  //   조용히 덮으면 그 카드를 쓰는 다른 워크스페이스까지 바뀌고, 언제나 새로 추가만 하면
  //   같은 이름이 끝없이 쌓인다.
  const save = useDropZone({
    id: "deckpanel-" + kind,
    kind,
    dir: "save",
    prio: 10,
    onDrop: (d) => {
      const card = d.card;
      if (!card) return;
      const existing = card.id ? useCards.getState()[kind].find((c) => c.id === card.id) : null;
      if (existing) onAsk({ kind, card, existing, thumb: d.thumb ?? null });
      else void saveCardWithThumb(kind, { ...card, id: undefined }, d.thumb ?? null);
    },
  });
  // 생성물을 놓으면 그 그림을 어느 카드의 표지로 쓸지 고른다
  const img = useDropZone({
    id: "deckpanel-img-" + kind,
    kind: "image",
    dir: "image",
    prio: 4,
    onDrop: (d) => d.img && onImageDrop(kind, d.img),
  });

  const over = save.over || img.over;
  const active = save.active || img.active;

  return (
    <div
      ref={(el) => {
        save.ref.current = el;
        img.ref.current = el;
      }}
      data-deck-section={kind}
      data-over={over ? "1" : "0"}
      style={{
        borderBottom: "1px solid var(--line)",
        background: over ? "var(--accent-bg)" : undefined,
        outline: active ? `1px dashed ${over ? "var(--accent)" : "var(--line-strong)"}` : undefined,
        outlineOffset: -3,
      }}
    >
      {/* ★머리를 누르면 접힌다 — 접기 단추를 따로 두지 않는다 (사용자 지시 2026-08-16) */}
      <div
        onClick={() => setFolded((v) => !v)}
        title={t(`cards.hint.${kind}`)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-2)",
          padding: "5px var(--sp-4)",
          cursor: "pointer",
          fontSize: "var(--text-2xs)",
          fontWeight: "var(--w-semi)",
          color: "var(--ink-dim)",
        }}
      >
        <span>{t(`cards.short.${kind}`)}</span>
        <span style={{ color: "var(--ink-ghost)", fontVariantNumeric: "tabular-nums" }}>
          {cards.length}
        </span>
      </div>

      {!folded && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))",
            gap: "var(--sp-3)",
            padding: "0 var(--sp-4) var(--sp-4)",
          }}
        >
          {cards.length === 0 ? (
            <div
              style={{
                gridColumn: "1 / -1",
                padding: "var(--sp-4) 0",
                textAlign: "center",
                fontSize: "var(--text-2xs)",
                color: "var(--ink-ghost)",
                lineHeight: 1.6,
              }}
            >
              {t("cards.dropToSave")}
            </div>
          ) : (
            cards.map((c) => (
              <PanelCard key={c.id} kind={kind} card={c} onDelete={() => remove(kind, c.id)} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** 덱의 카드 한 장 — 끌면 프롬프트·씬에 적용된다 */
function PanelCard({
  kind,
  card,
  onDelete,
}: {
  kind: CardKind;
  card: AnyCard;
  onDelete: () => void;
}) {
  const t = useI18n((s) => s.t);
  const startDrag = useDragSource();
  const me = useDrag((s) => s.drag?.card?.id === card.id);
  const [hover, setHover] = useState(false);
  const fv = normThumb(card.thumb);

  return (
    <div
      data-deck-card={card.id}
      onPointerDown={(e) => startDrag(e, { dir: "apply", kind, card })}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onContextMenu={(e) => {
        e.preventDefault();
        void (async () => {
          if (
            await ask({
              title: t("cards.deleteConfirm", { name: card.name }),
              body: t("common.toTrash"),
              ok: t("common.delete"),
              cancel: t("cards.cancel"),
            })
          )
            onDelete();
        })();
      }}
      title={card.name}
      style={{
        position: "relative",
        aspectRatio: "3 / 4",
        borderRadius: "var(--r-3)",
        overflow: "hidden",
        border: "1px solid var(--line)",
        cursor: "grab",
        opacity: me ? 0.35 : 1,
        transform: hover ? "translateY(-2px)" : undefined,
        boxShadow: hover ? "0 4px 12px rgba(0,0,0,0.3)" : undefined,
        transition: "transform 0.14s ease, box-shadow 0.14s ease",
        ...dragSourceStyle,
      }}
    >
      <div style={{ position: "absolute", inset: 0, background: artBackground(card.color) }} />
      {/* 덱 오버레이와 **같은 그림**이다 — 배너·커버가 공유하는 고정 썸네일(tid) */}
      {fv && <FittedImg url={thumbUrl(useGen.getState().base, fv)} w={110} h={146} view={fv.face} />}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          padding: "10px 5px 4px",
          background: "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.72) 60%)",
          color: "#fff",
          fontSize: "0.62rem",
          fontWeight: "var(--w-semi)",
          lineHeight: 1.2,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {card.name}
      </div>
      {hover && (
        <span
          style={{
            position: "absolute",
            top: 3,
            right: 3,
            color: "rgba(255,255,255,0.7)",
            display: "grid",
          }}
        >
          {Icon.grip}
        </span>
      )}
    </div>
  );
}
