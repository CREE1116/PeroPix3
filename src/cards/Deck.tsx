import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import { ask } from "../store/ask";
import { useCards, type AnyCard, type CardKind } from "../store/cards";
import { normThumb, thumbUrl } from "../store/prompt";
import { useDrag, useDragSource, dragSourceStyle } from "./dragStore";
import { artBackground } from "./CardArt";
import { FittedImg } from "./FittedImg";
import { useGen } from "../store/gen";

/** 덱 오버레이 — 저장된 카드 전부를 펼쳐 보여준다.
 *
 *  ★드래그가 시작되면 덱은 **반투명·통과 상태(ghost)** 가 된다. 뒤에 있는 목적지가 보여야
 *    어디에 놓을지 알 수 있기 때문이다.
 *  ★드롭 없이 놓으면 덱을 닫지 않는다 — 사용자가 취소한 것이지 끝낸 게 아니다. */
/** ★셀렉터가 매번 새 배열을 만들면 zustand v5 가 무한 렌더에 빠진다
 *  ("The result of getSnapshot should be cached"). 빈 목록은 고정 상수를 쓴다. */
const NONE: AnyCard[] = [];

export function Deck({ kind, onClose }: { kind: CardKind | null; onClose: () => void }) {
  const t = useI18n((s) => s.t);
  const cards = useCards((s) => (kind ? s[kind] : NONE));
  const remove = useCards((s) => s.remove);
  const dragging = useDrag((s) => s.drag?.dir === "apply");

  useEffect(() => {
    if (!kind) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [kind, onClose]);

  if (!kind) return null;

  return (
    <div
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 40,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 18,
        background: dragging ? "transparent" : "rgba(10,14,19,0.55)",
        backdropFilter: dragging ? "none" : "blur(2px)",
        pointerEvents: dragging ? "none" : "auto",
      }}
    >
      <div
        style={{
          color: "#fff",
          fontSize: "0.95rem",
          fontWeight: "var(--w-bold)",
          textShadow: "0 1px 6px rgba(0,0,0,0.6)",
          opacity: dragging ? 0.12 : 1,
        }}
      >
        {t(`cards.hand.${kind}`)}
        <small style={{ fontWeight: 400, opacity: 0.8, marginLeft: 10, fontSize: "0.75rem" }}>
          {t(`cards.hint.${kind}`)} · {t("cards.escClose")}
        </small>
      </div>

      {cards.length === 0 ? (
        <div
          style={{
            color: "rgba(255,255,255,0.75)",
            fontSize: "0.78rem",
            textAlign: "center",
            lineHeight: 1.7,
            opacity: dragging ? 0.12 : 1,
          }}
        >
          {t("cards.empty")}
          <br />
          {t("cards.emptyHint")}
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            gap: 16,
            flexWrap: "wrap",
            justifyContent: "center",
            maxWidth: "80vw",
            maxHeight: "70vh",
            overflowY: "auto",
            padding: 4,
          }}
        >
          {cards.map((c) => (
            <DeckCard
              key={c.id}
              kind={kind}
              card={c}
              onClose={onClose}
              onDelete={() => remove(kind, c.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DeckCard({
  kind,
  card,
  onClose,
  onDelete,
}: {
  kind: CardKind;
  card: AnyCard;
  onClose: () => void;
  onDelete: () => void;
}) {
  const t = useI18n((s) => s.t);
  const startDrag = useDragSource();
  const me = useDrag((s) => s.drag?.card?.id === card.id);
  const [hover, setHover] = useState(false);

  // 덱 앞면은 face 뷰. 그림은 공용 고정 썸네일(tid) — 배너·커버와 **같은 파일**이다
  const fv = normThumb(card.thumb);

  const info =
    "cells" in card
      ? t("cards.info.cells", { n: card.cells.length })
      : "base" in card
        ? t("cards.info.blocks", { n: card.base.length })
        : t("cards.info.blocks", { n: (card as { prompt: unknown[] }).prompt.length });

  return (
    <div
      onPointerDown={(e) => {
        startDrag(e, { dir: "apply", kind, card }, (dropped) => dropped && onClose());
      }}
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
              danger: true,
            })
          )
            onDelete();
        })();
      }}
      title={t("cards.cardHint")}
      style={{
        width: 138,
        height: 190,
        borderRadius: 12,
        overflow: "hidden",
        cursor: "grab",
        position: "relative",
        flexShrink: 0,
        // ★호버하면 살짝 떠오른다 — 이 카드를 끌 수 있다는 신호다 (사용자 요청).
        //   크게 띄우면 옆 카드를 가려 어느 것을 잡는지 헷갈린다
        borderWidth: 1.5,
        borderStyle: "solid",
        borderColor: hover ? "#fff" : "rgba(255,255,255,0.4)",
        transform: hover && !me ? "translateY(-5px) scale(1.02)" : undefined,
        transition: "transform 0.14s ease, box-shadow 0.14s ease, border-color 0.14s ease",
        boxShadow: hover ? "0 14px 30px rgba(0,0,0,0.5)" : "0 8px 24px rgba(0,0,0,0.45)",
        background: "var(--surface)",
        opacity: me ? 0.4 : 1,
        ...dragSourceStyle,
      }}
    >
      <div
        style={{
          height: "62%",
          position: "relative",
          overflow: "hidden",
          background: artBackground(card.color),
        }}
      >
        {fv && (
          <FittedImg url={thumbUrl(useGen.getState().base, fv)} w={138} h={118} view={fv.face} />
        )}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(180deg, transparent 50%, rgba(0,0,0,0.35))",
          }}
        />
      </div>
      <div
        style={{
          height: "38%",
          padding: "7px 10px",
          display: "flex",
          flexDirection: "column",
          gap: 2,
          background: "var(--surface)",
        }}
      >
        <b style={{ fontSize: "0.8rem" }}>{card.name}</b>
        <span style={{ fontSize: "0.66rem", color: "var(--ink-soft)" }}>{info}</span>
      </div>
    </div>
  );
}
