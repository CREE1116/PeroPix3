import { useEffect, useRef, useState } from "react";
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
  /** 생성물을 카드에 놓으면 **그 카드의 그림**이 된다 */
  onImageDrop: (kind: CardKind, card: AnyCard, img: DragImage) => void;
}) {
  // ★스크롤로 밀려 안 보이는 카드는 그림을 못 받는다 — 각 카드 존을 이 칸으로 자른다
  //   (사용자 지시 2026-08-19: "해당 카드가 받을 수 있게 노출된 상태일 때만")
  const view = useRef<HTMLDivElement | null>(null);
  const t = useI18n((s) => s.t);
  /** ★셀렉터에서 **새 객체를 만들지 않는다** — 매 호출 새 참조를 돌려주면 React 가 무한
   *  렌더로 본다 (페로픽스파이 `ParamsPanel` 주석의 그 함정). 원시값만 따로 고른다. */
  const nStyles = useCards((s) => s.styles.length);
  const nChars = useCards((s) => s.characters.length);
  const nSets = useCards((s) => s.posesets.length);
  const counts: Record<CardKind, number> = { styles: nStyles, characters: nChars, posesets: nSets };
  /** ★★종류마다 **탭**이다 (사용자 지시 2026-08-19) — 셋을 한 줄에 쌓아 두면 카드가 늘수록
   *  아래 것이 안 보이고, 접었다 폈다로 관리하게 된다. 한 번에 한 종류만 본다. */
  const [tab, setTab] = useState<CardKind>("styles");
  /** 카드를 끌기 시작하면 **그 종류의 탭으로 옮긴다** — 안 보이는 탭에는 놓을 수가 없다
   *  (캐릭터 섹션이 접혀 있으면 못 넣던 것과 같은 문제, `PromptSections`) */
  const dragKind = useDrag((s) => (s.drag?.dir === "save" ? (s.drag.kind as CardKind) : null));
  useEffect(() => {
    if (dragKind && KINDS.includes(dragKind)) setTab(dragKind);
  }, [dragKind]);
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", gap: 2, padding: "var(--sp-2) var(--sp-3) 0", flexShrink: 0 }}>
        {KINDS.map((k) => {
          const on = tab === k;
          return (
            <button
              key={k}
              data-deck-tab={k}
              onClick={() => setTab(k)}
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
                padding: "4px var(--sp-2)",
                borderRadius: "var(--r-2) var(--r-2) 0 0",
                border: "1px solid var(--line)",
                borderBottomColor: on ? "transparent" : "var(--line)",
                background: on ? "var(--surface)" : "transparent",
                color: on ? "var(--ink)" : "var(--ink-dim)",
                fontSize: "var(--text-2xs)",
                fontWeight: on ? "var(--w-semi)" : 400,
              }}
            >
              {t(`cards.short.${k}`)}
              <span style={{ color: "var(--ink-ghost)", fontVariantNumeric: "tabular-nums" }}>{counts[k]}</span>
            </button>
          );
        })}
      </div>
      <div ref={view} style={{ flex: 1, minHeight: 0, overflowY: "auto", background: "var(--surface)" }}>
        <Section kind={tab} onAsk={onAsk} onImageDrop={onImageDrop} view={view} />
      </div>
    </div>
  );
}

function Section({
  kind,
  onAsk,
  onImageDrop,
  view,
}: {
  kind: CardKind;
  view: React.RefObject<HTMLDivElement | null>;
  onAsk: (a: {
    kind: CardKind;
    card: AnyCard;
    existing: AnyCard;
    thumb: SectionThumb | null;
  }) => void;
  /** 생성물을 카드에 놓으면 **그 카드의 그림**이 된다 */
  onImageDrop: (kind: CardKind, card: AnyCard, img: DragImage) => void;
}) {
  const t = useI18n((s) => s.t);
  const all = useCards((s) => s[kind]) as AnyCard[];
  const remove = useCards((s) => s.remove);
  /** ★★종류 안의 **서브탭 = 폴더** (사용자 지시 2026-08-19). 빈 값이 뿌리다.
   *  ★목록은 **카드에서 뽑는다** — 폴더는 카드에 적힌 값이라 따로 저장할 것이 없다.
   *    새로 만든 빈 폴더만 화면이 잠깐 들고 있는다 (`extra`), 카드가 들어가면 그때부터 자동이다. */
  const [extra, setExtra] = useState<string[]>([]);
  const [adding, setAdding] = useState<string | null>(null);
  const folders = [...new Set(["", ...all.map((c) => c.folder ?? ""), ...extra])];
  const [folder, setFolder] = useState("");
  const here = folders.includes(folder) ? folder : "";
  const cards = all.filter((c) => (c.folder ?? "") === here);
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
      // ★★있는 카드인지는 **이름으로** 본다 (사용자 지시 2026-08-19) — id 로 보던 때는
      //   같은 이름이 폴더 안에 얼마든지 쌓였다. 지금 열어 둔 폴더 안에서만 찾는다.
      const existing = useCards
        .getState()
        [kind].find((c) => (c.folder ?? "") === here && c.name === card.name);
      if (existing) onAsk({ kind, card: { ...card, folder: here }, existing, thumb: d.thumb ?? null });
      else void saveCardWithThumb(kind, { ...card, id: undefined, folder: here }, d.thumb ?? null);
    },
  });
  // ★★그림은 **카드 한 장 한 장**이 받는다 (`PanelCard`), 섹션이 아니다.
  //   예전에는 섹션이 받아 종류당 하나인 「덱 커버」가 됐는데, 그것을 그리던 손패가
  //   화면에서 빠진 뒤로 보여 주는 곳이 없어 **성공하고도 눈에는 아무 일도 없었다.**
  //   그 계통은 2026-08-19 에 통째로 걷었다 (사용자 지시: 죽은 것은 그때그때 정리).
  const over = save.over;
  const active = save.active;

  return (
    <div
      ref={save.ref}
      data-deck-section={kind}
      data-over={over ? "1" : "0"}
      style={{
        minHeight: "100%",
        background: over ? "var(--accent-bg)" : undefined,
        outline: active ? `1px dashed ${over ? "var(--accent)" : "var(--line-strong)"}` : undefined,
        outlineOffset: -3,
      }}
    >
        {/* ★서브탭 — 폴더처럼 쓴다. 카드를 여기 끌어다 놓으면 **그 폴더로 옮겨진다** */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 3, padding: "var(--sp-2) var(--sp-3) 0" }}>
          {folders.map((f) => (
            <FolderTab
              key={f || "-"}
              kind={kind}
              folder={f}
              label={f || t("cards.rootFolder")}
              on={here === f}
              n={all.filter((c) => (c.folder ?? "") === f).length}
              onPick={() => setFolder(f)}
            />
          ))}
          {adding === null ? (
            <button
              data-deck-newfolder
              onClick={() => setAdding("")}
              data-tip={t("cards.newFolder")}
              style={{ ...subTab, color: "var(--ink-faint)" }}
            >
              {Icon.plus}
            </button>
          ) : (
            <input
              autoFocus
              data-deck-newfolder-input
              value={adding}
              onChange={(e) => setAdding(e.target.value)}
              onBlur={() => {
                const v = adding.trim();
                if (v && !folders.includes(v)) {
                  setExtra((x) => [...x, v]);
                  setFolder(v);
                }
                setAdding(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") setAdding(null);
              }}
              placeholder={t("cards.newFolder")}
              style={{ ...subTab, width: 90, background: "var(--panel)", color: "var(--ink)" }}
            />
          )}
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))",
            gap: "var(--sp-3)",
            padding: "var(--sp-3) var(--sp-4) var(--sp-4)",
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
              <PanelCard
              key={c.id}
              kind={kind}
              card={c}
              view={view}
              onDelete={() => remove(kind, c.id)}
              onImageDrop={onImageDrop}
            />
            ))
          )}
        </div>
    </div>
  );
}

const subTab: React.CSSProperties = {
  padding: "2px var(--sp-2)",
  borderRadius: "var(--r-1)",
  border: "1px solid var(--line)",
  background: "transparent",
  color: "var(--ink-dim)",
  fontSize: "var(--text-2xs)",
  display: "inline-flex",
  alignItems: "center",
  gap: 3,
};

/** 서브탭 한 칸 — 누르면 그 폴더를 보고, **카드를 끌어다 놓으면 그리로 옮긴다**.
 *  ★옮기는 것도 **적용 끌기와 같은 몸짓**이다 (`dir: "apply"`) — 카드에 끌기가 하나뿐이라
 *    새 몸짓을 만들면 무엇이 무엇인지 알 수 없다. */
function FolderTab({
  kind,
  folder,
  label,
  on,
  n,
  onPick,
}: {
  kind: CardKind;
  folder: string;
  label: string;
  on: boolean;
  n: number;
  onPick: () => void;
}) {
  const zone = useDropZone({
    id: `deck-folder-${kind}-${folder}`,
    kind,
    prio: 30,
    onDrop: (d) => {
      const c = d.card as AnyCard | undefined;
      if (!c?.id || (c.folder ?? "") === folder) return;
      void useCards.getState().save(kind, { ...c, folder });
    },
  });
  return (
    // ★드롭존은 `div` 를 잡는다 (`useDropZone` 의 ref 형이 그렇다). 누르는 것은 안쪽 단추다.
    <div ref={zone.ref} style={{ display: "inline-flex" }}>
    <button
      data-deck-folder={folder}
      onClick={onPick}
      style={{
        ...subTab,
        background: zone.over ? "var(--accent-bg)" : on ? "var(--panel)" : "transparent",
        borderColor: zone.over || on ? "var(--accent)" : "var(--line)",
        color: on ? "var(--ink)" : "var(--ink-dim)",
        fontWeight: on ? "var(--w-semi)" : 400,
      }}
    >
      {label}
      <span style={{ color: "var(--ink-ghost)", fontVariantNumeric: "tabular-nums" }}>{n}</span>
    </button>
    </div>
  );
}

/** 덱의 카드 한 장 — 끌면 프롬프트·씬에 적용된다 */
function PanelCard({
  kind,
  card,
  view,
  onDelete,
  onImageDrop,
}: {
  kind: CardKind;
  card: AnyCard;
  view: React.RefObject<HTMLDivElement | null>;
  onDelete: () => void;
  onImageDrop: (kind: CardKind, card: AnyCard, img: DragImage) => void;
}) {
  const t = useI18n((s) => s.t);
  const startDrag = useDragSource();
  const me = useDrag((s) => s.drag?.card?.id === card.id);
  const [hover, setHover] = useState(false);
  /** 이름을 그 자리에서 고치는 중 (사용자 지시 2026-08-19: 카드마다 수정 단추) */
  const [renaming, setRenaming] = useState<string | null>(null);
  const fv = normThumb(card.thumb);
  /** ★생성물을 이 카드에 떨구면 **이 카드의 그림**이 된다 (사용자 결정 2026-08-19).
   *  ★`clip` 으로 **덱 칸에 보이는 만큼만** 받는다 — 스크롤로 밀려 안 보이는 카드가
   *    자기 자리에서 계속 받으면, 덱 밖에 떨군 것이 엉뚱한 카드에 걸린다. */
  const drop = useDropZone({
    id: "deckcard-" + card.id,
    kind: "image",
    dir: "image",
    prio: 20,
    clip: view,
    onDrop: (d) => d.img && onImageDrop(kind, card, d.img),
  });

  return (
    <div
      ref={drop.ref}
      data-deck-card={card.id}
      data-over={drop.over ? "1" : "0"}
      // ★지우기 단추는 **끌기에서 비켜 간다** — pointerdown 의 기본 동작 막기가 호환 click 을
      //   삼켜서, 안 비키면 단추가 통째로 죽는다 (CLAUDE.md 「잊기 쉬운 것」)
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest("[data-card-del],[data-card-rename]")) return;
        startDrag(e, { dir: "apply", kind, card });
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "relative",
        aspectRatio: "3 / 4",
        borderRadius: "var(--r-3)",
        overflow: "hidden",
        border: `1px solid ${drop.over ? "var(--accent)" : "var(--line)"}`,
        outline: drop.active ? `2px dashed ${drop.over ? "var(--accent)" : "var(--line-strong)"}` : undefined,
        outlineOffset: -2,
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
        {renaming === null ? (
          card.name
        ) : (
          <input
            autoFocus
            data-deck-rename={card.id}
            value={renaming}
            onChange={(e) => setRenaming(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onBlur={() => {
              const v = renaming.trim();
              if (v && v !== card.name) void useCards.getState().save(kind, { ...card, name: v });
              setRenaming(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setRenaming(null);
            }}
            style={{
              width: "100%",
              background: "rgba(0,0,0,0.5)",
              border: "1px solid rgba(255,255,255,0.5)",
              borderRadius: 3,
              color: "#fff",
              fontSize: "0.62rem",
              padding: "0 2px",
            }}
          />
        )}
      </div>
      {/* ★★끌기 손잡이 아이콘을 걷고 그 자리에 **지우기**를 뒀다 (사용자 지시 2026-08-19).
          카드는 통째로 잡아 끄는 것이라 손잡이가 없어도 끌리는 줄 알고, 지우는 길은
          **우클릭뿐이라 보이지 않았다.** 보이는 단추가 하나 필요한 자리였다. */}
      {hover && (
        <button
          data-card-rename={card.id}
          data-tip={t("cards.rename")}
          onPointerDown={(e) => e.stopPropagation()}
          /* ★입력칸이 안 흐려지게 (SectionCard 의 같은 주석) */
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            // 고치는 중이면 **저장하고 끝낸다** (사용자 지시 2026-08-19)
            if (renaming === null) return setRenaming(card.name);
            const v = renaming.trim();
            if (v && v !== card.name) void useCards.getState().save(kind, { ...card, name: v });
            setRenaming(null);
          }}
          style={{
            position: "absolute",
            top: 3,
            right: 25,
            display: "grid",
            placeItems: "center",
            width: 18,
            height: 18,
            borderRadius: "var(--r-1)",
            background: "rgba(10,14,20,0.55)",
            color: "#fff",
          }}
        >
          {Icon.pencil}
        </button>
      )}
      {hover && (
        <button
          data-card-del={card.id}
          data-tip={t("common.delete")}
          onClick={(e) => {
            e.stopPropagation();
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
          style={{
            position: "absolute",
            top: 3,
            right: 3,
            display: "grid",
            placeItems: "center",
            width: 18,
            height: 18,
            borderRadius: "var(--r-1)",
            background: "rgba(10,14,20,0.55)",
            color: "#fff",
          }}
        >
          {Icon.close12}
        </button>
      )}
    </div>
  );
}
