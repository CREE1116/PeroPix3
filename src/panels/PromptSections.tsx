import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import { Icon } from "../components/Icon";
import { BlockList } from "../blocks/BlockList";
import { SectionCard } from "../blocks/SectionCard";
import {
  usePrompt,
  ucHasContent,
  thumbFromCard,
  thumbUrl,
  type Char,
  type Thumb,
} from "../store/prompt";
import type { DragImage } from "../cards/dragStore";
import { useGen } from "../store/gen";
import { useDropZone, useDragSource, useDrag } from "../cards/dragStore";
import { zoneIcon } from "../cards/CardArt";
import type { Block } from "../lib/blocks";
import type { CharCard, StyleCard } from "../store/cards";

/** 프롬프트 섹션들 — 스타일(공통) 하나 + 캐릭터 여럿.
 *  NAI 요청 구조 그대로다: 공통 `prompt/uc` 한 벌 + `characterPrompts[]`. */


/** 섹션이 위쪽(App)에 되돌리는 것 — 썸네일 위치를 잡는 창은 화면 맨 위에 떠야 한다.
 *  원본 이미지 정보만 넘긴다. 축소 사본 저장은 위치를 정한 뒤(App)에 한다 */
export type SectionProps = { onThumb: (section: string, img: DragImage) => void };

/** 저장된 Thumb 을 배너에 그릴 형태로 — 배너용 보는 방식(banner)을 쓴다 */
function useThumbView(thumb: Thumb | null) {
  const base = useGen((s) => s.base);
  if (!thumb) return null;
  return { url: thumbUrl(base, thumb), ...thumb.banner };
}

/** 배너를 **생성물 드롭 대상**으로 만든다 — 끌어다 놓으면 위치 잡는 창이 뜬다.
 *  ★섹션은 픽셀을 갖지 않고 "어느 파일을 어떻게 볼지"만 갖는다 (Thumb). */
function useThumbDrop(section: string, onAsk: (img: DragImage) => void) {
  const zone = useDropZone({
    id: `thumb-${section}`,
    kind: "image",
    dir: "image",
    prio: 5,
    onDrop: (d) => d.img && onAsk(d.img),
  });
  return zone;
}

/* ── 스타일 섹션 = Base ───────────────────────────────────────── */
export function StyleSection({ onThumb }: SectionProps) {
  const t = useI18n((s) => s.t);
  const { base, baseUc, style, update, setStyle, folded, toggleFold } = usePrompt();
  const startDrag = useDragSource();

  const { ref, over, active } = useDropZone({
    id: "sec-style",
    kind: "styles",
    onDrop: (d) => {
      const c = d.card as StyleCard;
      setStyle({
        ref: c.id,
        name: c.name,
        color: c.color,
        base: c.base,
        uc: c.uc,
        thumb: thumbFromCard(c.thumb),
      });
    },
  });
  const img = useThumbDrop("base", (di) => onThumb("base", di));

  /** ★스타일 카드를 끌기 시작하면 **접힌 것을 편다** (사용자 지적 2026-08-19: 둘 다 접혀
   *  있으면 아예 못 넣었다). 캐릭터 섹션과 같은 규칙 — 놓을 자리가 보여야 놓는다. */
  useEffect(() => {
    if (active && folded["base"]) toggleFold("base");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return (
    <SectionCard
      innerRef={(el) => {
        ref.current = el;
        img.ref.current = el;
      }}
      name={style.name}
      sub={t("prompt.styleCard")}
      /* ★스타일 카드에는 이름 바꾸기가 아예 없었다 (사용자 지적 2026-08-19) */
      onRename={(v) => setStyle({ ...style, name: v })}
      gradient={style.color}
      thumb={useThumbView(style.thumb)}
      zone="thumb-base"
      folded={!!folded["base"]}
      onFold={() => toggleFold("base")}
      hoverLift
      outline={
        active ? (over ? "solid" : "dashed") : img.active ? (img.over ? "solid" : "dashed") : "none"
      }
      onBannerPointerDown={(e) =>
        startDrag(e, {
          dir: "save",
          kind: "styles",
          card: { id: style.ref ?? "", name: style.name, color: style.color, base, uc: baseUc },
          thumb: style.thumb,
        }, undefined, () => toggleFold("base"))
      }
    >
      <SectionBody
        id="base"
        prompt={base}
        uc={baseUc}
        onPrompt={(b) => update("base", () => b)}
        onUc={(b) => update("baseUc", () => b)}
      />
    </SectionCard>
  );
}

/* ── 캐릭터 섹션 ──────────────────────────────────────────────── */
export function CharSection({ ch, index, onThumb }: { ch: Char; index: number } & SectionProps) {
  const t = useI18n((s) => s.t);
  const { updateChar, swapChar, stackChar, removeChar, toggleChar, renameChar, folded, toggleFold } =
    usePrompt();
  const startDrag = useDragSource();
  const active = useDrag((s) => s.drag?.kind === "characters" && s.drag.dir === "apply");

  // ★위 = 스택(순차 생성), 아래 = 교체. 스택 카드가 배너 **위쪽**으로 겹치는 모양과 방향을 맞춘다
  const swap = useDropZone({
    id: `sec-char-${ch.id}-swap`,
    kind: "characters",
    prio: 2,
    onDrop: (d) => {
      const c = d.card as CharCard;
      swapChar(ch.id, {
        ref: c.id,
        name: c.name,
        color: c.color,
        prompt: c.prompt,
        uc: c.uc,
        thumb: thumbFromCard(c.thumb),
      });
    },
  });
  const stack = useDropZone({
    id: `sec-char-${ch.id}-stack`,
    kind: "characters",
    prio: 3,
    onDrop: (d) => {
      const c = d.card as CharCard;
      stackChar(ch.id, { ref: c.id, name: c.name, color: c.color });
    },
  });

  const img = useThumbDrop(ch.id, (di) => onThumb(ch.id, di));

  /** ★★캐릭터 카드를 끌기 시작하면 **접힌 것을 편다** (사용자 지시 2026-08-19).
   *  접으면 배너만 남고, 놓는 자리(위=스택·아래=교체)가 그 안에서 반씩 나뉘어 손톱만 해진다 —
   *  사실상 못 넣는 상태였다. 편 채로 두는 것이 맞다: 어디에 놓는지가 보여야 한다. */
  useEffect(() => {
    if (active && folded[ch.id]) toggleFold(ch.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const name = ch.name || t("cards.charN", { n: index + 1 });
  return (
    <>
      {ch.stack.length > 0 && <StackPeek ch={ch} />}
      <SectionCard
        innerRef={(el) => (img.ref.current = el)}
        name={name}
        sub={t("cards.charCardLabel")}
        gradient={ch.color}
        thumb={useThumbView(ch.thumb)}
        zone={`thumb-${ch.id}`}
        folded={!!folded[ch.id]}
        onFold={() => toggleFold(ch.id)}
        dim={!ch.on}
        outline={
          active ? "dashed" : img.active ? (img.over ? "solid" : "dashed") : "none"
        }
        onBannerPointerDown={(e) =>
          startDrag(e, {
            dir: "save",
            kind: "characters",
            card: { id: ch.ref ?? "", name, color: ch.color, prompt: ch.prompt, uc: ch.uc },
            thumb: ch.thumb,
          }, undefined, () => toggleFold(ch.id))
        }
        /* ★이름은 **카드 안에서** 고친다 (사용자 지시 2026-08-19) — 시스템 `prompt()` 창을
           띄우던 자리다. 연필 단추는 `SectionCard` 가 스스로 단다. */
        onRename={(v) => renameChar(ch.id, v)}
        bannerActions={
          <>
            {/* ★아이콘은 언제나 SVG (CLAUDE.md) — 여기는 `● ○ × ✎` 글자를 쓰고 있었다 */}
            <BannerBtn
              title={ch.on ? t("block.toggleOff") : t("block.toggleOn")}
              onClick={() => toggleChar(ch.id)}
            >
              {ch.on ? Icon.dotOn : Icon.dotOff}
            </BannerBtn>
            <BannerBtn title={t("cards.removeChar")} onClick={() => removeChar(ch.id)}>
              {Icon.close12}
            </BannerBtn>
          </>
        }
        hoverLift
        overlay={
          active && (
            // ★카드 **전체**를 위아래 반으로 나눈다 (사용자 지적).
            //   위 = 스택 — 스택 카드가 배너 위쪽으로 겹치는 모양과 방향을 맞춘 것이다.
            <>
              <Zone
                innerRef={stack.ref}
                over={stack.over}
                top="0"
                height="50%"
                noBottom
                name="stack"
                label={t("cards.zoneStack")}
              >
                {zoneIcon.stack()}
              </Zone>
              <Zone
                innerRef={swap.ref}
                over={swap.over}
                top="50%"
                height="50%"
                name="swap"
                label={t("cards.zoneSwap")}
              >
                {zoneIcon.swap()}
              </Zone>
            </>
          )
        }
      >
        <SectionBody
          id={ch.id}
          prompt={ch.prompt}
          uc={ch.uc}
          onPrompt={(b) => updateChar(ch.id, "prompt", () => b)}
          onUc={(b) => updateChar(ch.id, "uc", () => b)}
        />
      </SectionCard>
    </>
  );
}

/** 순차 생성 더미 — 섹션 **뒤에 겹쳐** 윗변만 빼꼼 나온다.
 *  ★다음 차례가 누구인지 눈으로 알 수 있어야 한다는 것이 요구였다. 클릭하면 펼쳐진다.
 *
 *  겹침은 음수 마진으로 만든다. 앞(다음 차례) 카드가 DOM 마지막이라 뒤 카드를 덮고,
 *  마지막 카드의 음수 마진이 곧 **섹션이 덮고 남기는 높이**(PEEK)가 된다. */
const CARD_H = 48; // 접힌 스택 카드의 실제 높이
const PEEK = 22; // 섹션 위로 드러나는 높이 — 이름이 잘리지 않을 만큼
const STEP = 6; // 뒤에 더 쌓인 카드가 한 장씩 더 드러나는 양

function StackPeek({ ch }: { ch: Char }) {
  const t = useI18n((s) => s.t);
  const [open, setOpen] = useState(false);
  // 맨 앞(다음 차례)이 섹션에 가장 가까이 = DOM 마지막
  const cards = [...ch.stack].reverse();
  return (
    <div onClick={() => setOpen((v) => !v)} style={{ cursor: "pointer" }}>
      {cards.map((c, i) => {
        const front = i === cards.length - 1;
        return (
          <div
            key={i}
            style={{
              height: open ? 56 : CARD_H,
              marginBottom: open ? -18 : -(CARD_H - (front ? PEEK : STEP)),
              borderRadius: 12,
              border: "1px solid var(--line)",
              position: "relative",
              color: "#fff",
              fontSize: "0.68rem",
              fontWeight: "var(--w-bold)",
              lineHeight: 1.1,
              textShadow: "0 1px 3px rgba(0,0,0,0.6)",
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: open ? "0 12px" : `0 12px ${CARD_H - PEEK}px`,
              boxShadow: "0 -3px 12px rgba(0,0,0,0.4)",
              background: `radial-gradient(120px 45px at 82% 20%, rgba(255,255,255,0.3), transparent 70%), linear-gradient(100deg, ${c.color[0]}, ${c.color[1]} 60%)`,
            }}
          >
            <span>{c.name}</span>
            {front && (
              <span
                style={{
                  background: "rgba(0,0,0,0.4)",
                  borderRadius: 4,
                  padding: "0 5px",
                  fontSize: "0.56rem",
                }}
              >
                {t("cards.nextUp")}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** 캐릭터 카드를 **새 슬롯으로** 받는 자리 — 같이 등장하는 인원이 는다.
 *  캐릭터 드래그 중에만 나타난다. */
export function JoinZone() {
  const t = useI18n((s) => s.t);
  const addChar = usePrompt((s) => s.addChar);
  const { ref, over, active } = useDropZone({
    id: "char-join",
    kind: "characters",
    prio: 1,
    onDrop: (d) => {
      const c = d.card as CharCard;
      addChar({
        ref: c.id,
        name: c.name,
        color: c.color,
        prompt: c.prompt,
        uc: c.uc,
        thumb: thumbFromCard(c.thumb),
      });
    },
  });
  if (!active) return null;
  return (
    <div
      ref={ref}
      data-zone="join"
      data-tip={t("cards.zoneJoin")}
      style={{
        position: "relative",
        zIndex: 31,
        margin: "0 0 var(--sp-5)",
        height: 46,
        borderWidth: 2,
        borderStyle: over ? "solid" : "dashed",
        borderColor: "#fff",
        borderRadius: 12,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "0.74rem",
        fontWeight: "var(--w-bold)",
        color: "#fff",
        boxSizing: "border-box",
        background: over ? "rgba(0,0,0,0.78)" : "rgba(0,0,0,0.45)",
      }}
    >
      {zoneIcon.add(20)}
    </div>
  );
}

/* ── 조각 ─────────────────────────────────────────────────────── */
function Zone({
  innerRef,
  over,
  top,
  height,
  noBottom,
  name,
  label,
  children,
}: {
  innerRef: React.MutableRefObject<HTMLDivElement | null>;
  over: boolean;
  top: string;
  height: string;
  noBottom?: boolean;
  /** 테스트가 존을 찾는 손잡이 — 그림만 있어서 글자로는 못 찾는다 */
  name: string;
  /** 그림이 무슨 뜻인지는 툴팁에 남긴다 */
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      ref={innerRef}
      data-zone={name}
      data-tip={label}
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top,
        height,
        zIndex: 12,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        fontSize: "0.72rem",
        fontWeight: "var(--w-bold)",
        color: "#fff",
        letterSpacing: "0.04em",
        boxSizing: "border-box",
        background: over ? "rgba(0,0,0,0.78)" : "rgba(0,0,0,0.45)",
        // ★축약형(border)과 개별 속성(borderBottom)을 섞으면 React 가 재렌더에서
        //   어느 쪽이 이길지 보장하지 않는다고 경고한다. 네 변을 따로 쓴다.
        borderWidth: 2,
        borderStyle: over ? "solid" : "dashed",
        borderColor: "rgba(255,255,255,0.85)",
        borderBottomWidth: noBottom ? 0 : 2,
      }}
    >
      {children}
    </div>
  );
}

function BannerBtn({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      data-tip={title}
      onPointerDown={(e) => e.stopPropagation()} // 배너의 역드래그가 걸리지 않게
      onClick={onClick}
      style={{
        width: 20,
        height: 20,
        borderRadius: 5,
        background: "rgba(0,0,0,0.42)",
        color: "#fff",
        fontSize: 11,
        lineHeight: 1,
      }}
    >
      {children}
    </button>
  );
}

/** 섹션 본문 — Prompt / Undesired Content 탭 짝 + 블록 목록.
 *  ★UC 에 내용이 있으면 탭 이름이 빨개진다 (v2.x 동작 계승). */
function SectionBody({
  id,
  prompt,
  uc,
  onPrompt,
  onUc,
}: {
  id: string;
  prompt: Block[];
  uc: Block[];
  onPrompt: (b: Block[]) => void;
  onUc: (b: Block[]) => void;
}) {
  const t = useI18n((s) => s.t);
  const tab = usePrompt((s) => s.tabs[id] ?? "p");
  const setTab = usePrompt((s) => s.setTab);
  const ucFull = ucHasContent(uc);
  const showUc = tab === "u";

  return (
    <>
      <div style={{ display: "flex", gap: "var(--sp-5)", marginLeft: 10 }}>
        <Tab on={!showUc} onClick={() => setTab(id, "p")}>
          {t("prompt.tabPrompt")}
        </Tab>
        <Tab on={showUc} onClick={() => setTab(id, "u")} full={ucFull}>
          {t("prompt.tabUc")}
        </Tab>
      </div>
      {/* ★존 id 에 **지금 보고 있는 탭**을 넣는다 — 프롬프트와 UC 는 같은 자리에 겹쳐
          뜨므로, id 가 같으면 UC 를 보는 중에 프롬프트 쪽으로 떨어질 수 있다 */}
      <BlockList
        blocks={showUc ? uc : prompt}
        onChange={showUc ? onUc : onPrompt}
        libZone={`${id}-${showUc ? "uc" : "p"}`}
      />
    </>
  );
}

function Tab({
  on,
  full,
  onClick,
  children,
}: {
  on: boolean;
  full?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const t = useI18n((s) => s.t);
  return (
    <button
      onClick={onClick}
      data-tip={full ? t("prompt.ucHasContent") : undefined}
      style={{
        padding: "2px 1px 3px",
        fontSize: "0.72rem",
        fontWeight: on ? 700 : 400,
        color: full ? "var(--uc-c)" : on ? "var(--ink)" : "var(--ink-soft)",
        borderBottom: `2px solid ${on ? (full ? "var(--uc-c)" : "var(--accent)") : "transparent"}`,
      }}
    >
      {children}
    </button>
  );
}
