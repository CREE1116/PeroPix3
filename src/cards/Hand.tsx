import { useState } from "react";
import { useI18n } from "../i18n";
import { useCards, type CardKind } from "../store/cards";
import { useDrag, useDropZone, type DragImage } from "./dragStore";
import { cardIcon } from "./CardArt";
import { FittedImg } from "./FittedImg";
import { useGen } from "../store/gen";
import type { SaveAsk } from "./SaveDialog";
import { saveCardWithThumb } from "./saveCard";

/** 우하단 카드 핸드 — **하단에 반쯤 파묻힌 부채꼴** (목업 그대로).
 *
 *  ★진입 경로를 강하게 노출하지 않는 것이 요구였다: 평소엔 아이콘 머리만 보이고,
 *    커서를 올린 카드만 비스듬히 떠오르며 라벨이 드러난다.
 *  ★역드래그(섹션 배너 → 같은 종류의 핸드 카드)의 드롭 대상이기도 하다. */

const KINDS: { kind: CardKind; grad: [string, string]; rot: number; y: number; mx: number }[] = [
  // ★`y` = 파묻히는 깊이. 카드가 80 이므로 **보이는 부분 = 80 - y** 다.
  //   모드바 높이(48) 를 넘지 않게 둔다 — 넘으면 모드 버튼 위로 삐져나온다.
  { kind: "styles", grad: ["#b57a2a", "#d8a34f"], rot: -9, y: 46, mx: -14 },
  { kind: "characters", grad: ["#5b3d87", "#9b6dd6"], rot: 0, y: 40, mx: 0 },
  { kind: "posesets", grad: ["#14655e", "#2aa198"], rot: 9, y: 46, mx: -14 },
];

export function Hand({
  onOpen,
  onAsk,
  onImageDrop,
}: {
  onOpen: (kind: CardKind) => void;
  onAsk: (ask: SaveAsk) => void;
  /** 생성물을 핸드 카드에 놓았다 → 그 덱을 열어 넣을 카드를 고른다 */
  onImageDrop: (kind: CardKind, img: DragImage) => void;
}) {
  // 저장 역드래그든 이미지 드래그든 핸드가 어둠 위로 떠야 드롭할 수 있다
  const saving = useDrag((s) => s.drag?.dir === "save" || s.drag?.dir === "image");
  return (
    <div
      style={{
        // ★**창 바닥에 고정**한다 (사용자 지시 2026-08-04). 예전엔 가운데 기둥 안에 있어
        //   하단 모드바가 생기자 그 뒤로 가려졌다 — 모드바보다 앞에 서야 집을 수 있다.
        position: "fixed",
        right: 14,
        bottom: 0,
        height: 92,
        display: "flex",
        alignItems: "flex-end",
        // 역드래그 중에는 어둠 위로 올라오고, 카드가 밖으로 튀어나올 수 있어야 한다
        zIndex: saving ? 60 : 30,
        overflow: saving ? "visible" : "hidden",
        padding: "0 10px",
      }}
    >
      {KINDS.map((k) => (
        <HandCard key={k.kind} {...k} onOpen={onOpen} onAsk={onAsk} onImageDrop={onImageDrop} />
      ))}
    </div>
  );
}

function HandCard({
  kind,
  grad,
  rot,
  y,
  mx,
  onOpen,
  onAsk,
  onImageDrop,
}: (typeof KINDS)[number] & {
  onOpen: (k: CardKind) => void;
  onAsk: (ask: SaveAsk) => void;
  onImageDrop: (kind: CardKind, img: DragImage) => void;
}) {
  const t = useI18n((s) => s.t);
  const [hover, setHover] = useState(false);
  const count = useCards((s) => s[kind].length);
  const cover = useCards((s) => s.covers[kind]);
  const base = useGen((s) => s.base);

  // 역드래그 저장: 같은 종류의 카드로 끌어오면 덱에 들어간다.
  // ★출처 카드(`id`)가 아직 덱에 있으면 **묻는다** — 덮어쓸지, 새로 추가할지.
  //   조용히 덮으면 그 카드를 쓰는 다른 워크스페이스까지 바뀌고,
  //   언제나 새로 추가만 하면 같은 이름이 끝없이 쌓인다.
  const { ref, over, active } = useDropZone({
    id: "hand-" + kind,
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

  // 생성물을 이 카드에 놓으면 덱이 열려 넣을 카드를 고른다 (덱은 드래그 중 열 수 없어서)
  const imgZone = useDropZone({
    id: "hand-img-" + kind,
    kind: "image",
    dir: "image",
    prio: 4, // 배너 존(5)보다 낮게 — 겹칠 일은 없지만 규칙을 남긴다
    onDrop: (d) => d.img && onImageDrop(kind, d.img),
  });

  const isOver = over || imgZone.over;
  const zoneActive = active || imgZone.active;
  // ★드롭 중에는 세 장이 **떨어져 나란히** 선다.
  //   예전엔 셋 다 rotate(0) 으로 겹쳐 올라와 어느 덱에 놓는지 분간이 안 됐다 (사용자 지적).
  const picking = imgZone.active;
  const lifted = hover || active || picking;
  return (
    <div
      ref={(el) => {
        ref.current = el;
        imgZone.ref.current = el;
      }}
      data-zone={"hand-" + kind}
      data-over={isOver ? "1" : "0"}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onClick={() => onOpen(kind)}
      title={t(`cards.hand.${kind}`) + (count ? ` (${count})` : "")}
      style={{
        width: 58,
        height: 80,
        borderRadius: 8,
        border: "1.5px solid rgba(255,255,255,0.5)",
        color: "#fff",
        cursor: "pointer",
        boxShadow: "0 3px 10px rgba(0,0,0,0.35)",
        position: "relative",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 0 5px",
        fontSize: "0.62rem",
        fontWeight: "var(--w-bold)",
        textShadow: "0 1px 3px rgba(0,0,0,0.6)",
        background: `linear-gradient(150deg, ${grad[0]}, ${grad[1]})`,
        // ★rotate 를 앞에 두면 translateY 가 카드의 기운 축을 따라간다 — 파묻힘·등장이 비스듬히
        // ★rotate 를 앞에 두면 translateY 가 카드의 기운 축을 따라간다 — 파묻힘·등장이 비스듬히
        transform: picking
          ? `rotate(0deg) translateY(-10px) scale(${isOver ? 1.16 : 1})`
          : lifted
            ? "rotate(0deg) translateY(-2px) scale(1.06)"
            : `rotate(${rot}deg) translateY(${y}px)`,
        transition: "transform 0.18s ease, opacity 0.18s ease",
        zIndex: isOver ? 3 : lifted ? 2 : rot === 0 ? 1 : 0,
        // 드롭 중에는 음수 마진(겹침)을 풀어 셋을 떼어 놓는다
        marginRight: picking ? 7 : rot < 0 ? mx : 0,
        marginLeft: picking ? 7 : rot > 0 ? mx : 0,
        outline: zoneActive ? `3px ${isOver ? "solid" : "dashed"} #fff` : undefined,
        outlineOffset: 3,
        // 걸리지 않은 카드는 흐리게 — 지금 어디에 놓는지가 하나로 읽힌다
        opacity: picking && !isOver ? 0.45 : 1,
        filter: isOver ? "brightness(1.15)" : undefined,
      }}
    >
      {/* 덱 커버 그림 — 이미지를 이 카드에 드롭해서 지정한다 (덱 안의 카드와 무관한 덱의 얼굴) */}
      {cover && <FittedImg url={`${base}/api/pin/${cover.tid}`} w={58} h={80} view={cover} />}
      <span
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background: cover
            ? "linear-gradient(180deg, transparent 55%, rgba(0,0,0,0.55))"
            : "radial-gradient(46px 36px at 68% 22%, rgba(255,255,255,0.4), transparent 70%)," +
              " linear-gradient(180deg, transparent 55%, rgba(0,0,0,0.4))",
        }}
      />
      <span style={{ marginTop: 8, display: "flex", position: "relative" }}>
        {!cover && cardIcon(kind)}
      </span>
      <span
        style={{
          whiteSpace: "nowrap",
          position: "relative",
          fontSize: picking && isOver ? "0.66rem" : "0.62rem",
        }}
      >
        {t(`cards.short.${kind}`)}
      </span>
    </div>
  );
}
