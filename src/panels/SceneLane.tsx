import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { useGen } from "../store/gen";
import { usePrompt } from "../store/prompt";
import { useQueue } from "../store/queue";
import { LANE_MAX, LANE_MIN, useUi } from "../store/ui";
import { useWs, takesOf, type Rec, type SceneCard, type Slot } from "../store/workspace";
import { thumbUrlOf } from "../lib/imgUrl";
import { BlockList } from "../blocks/BlockList";
import { Icon } from "../components/Icon";
import { colorOf } from "../store/cards";
import { cardBlocks } from "../lib/blocks";
import { useDragSource } from "../cards/dragStore";
import { useReorder } from "../lib/useReorder";
import { useSceneFocus } from "../store/sceneFocus";
import { BANNER_BG, BANNER_CUT, BANNER_IMG_W, BANNER_STEP, bannerEmptyFill } from "../cards/banner";

/** 씬 칸 — **그릇**이고, 그 위에 **씬 세트 카드**를 얹는다 (사용자 결정 2026-08-11).
 *
 *  ★층이 셋이다: 씬 칸(평면) → 카드(둥근 카드) → 씬(줄). 그릇이 둥글고 카드가 납작하면
 *    층이 뒤집혀 읽히므로, 올라온 것은 **언제나 카드**다.
 *  ★눈금 줄은 **그릇 것**이라 카드가 몇 장이든 하나로 이어진다 — 그것이 "카드가 얹혀 있다"를
 *    눈으로 만든다. 숫자는 그 줄의 **몇 번째 장**이고, 축에 이름을 붙이지 않는다
 *    (「회차」는 다른 뜻으로 읽힌다 — 사용자 지적).
 *  ★씬의 프롬프트는 **줄 머리 안**에 산다. 왼쪽 패널에 슬롯 목록을 따로 두면 같은 씬이
 *    두 곳에 있게 되어, 이름·자물쇠가 겹친다.
 *
 *  설계 정본은 `docs/timeline-mockup.html` (합의된 화면). */

/** ★칸은 **정사각**이고 크기는 연속값이다 (사용자 지시 2026-08-14).
 *  예전에는 폭을 생성 해상도 비율에서 뽑았는데, 해상도를 크게 잡으면 칸이 그만큼 길어져
 *  줄이 통째로 망가졌다 (1536×640 이면 칸 하나가 336px). 그림은 잘라서 보여 준다.
 *  ★3단 버튼도 없앴다. Ctrl+휠 한 번에 12% 씩 움직인다 (`store/ui` 의 LANE_MIN·LANE_MAX). */
const ZOOM = 1.12;
const GAP = 6;
/** ★줄 머리 폭은 **사용자가 끈다** (사용자 지시 2026-08-14). 그 씬의 프롬프트가
 *  들어가는 자리라, 넓히면 프롬프트가 잘 보이고 좁히면 장이 더 보인다. */
const RULER_H = 19;

export function SceneLane() {
  const t = useI18n((s) => s.t);
  const base = useGen((g) => g.base);
  const { records, current: ws, activeTab, isDeleted, isStarred, toggleStar, deleteFiles,
    undoSelection, setTab, setCard, addCard, removeCard, addSlot } = useWs();
  const pending = useQueue((s) => s.pending);
  // ★구독해서 읽는다. `getState()` 로 읽으면 진행이 바뀌어도 다시 그리지 않아
  //   「생성 중」이 영영 안 뜬다 (사용자 지적 2026-08-14)
  const progress = useQueue((s) => s.progress);
  const laneSize = useUi((u) => u.laneSize);
  const headw = useUi((u) => u.laneHeadW);
  const startDrag = useDragSource();
  // ★씬 프롬프트 목적지 — 켜져 있는 캐릭터만 고를 수 있다 (꺼진 캐릭터는 payload 에 없다)
  const chars = usePrompt((s) => s.chars).filter((c) => c.on);
  const tab = activeTab();

  /** 지금 보고 있는 씬과 장 — ★프리뷰가 다른 컴포넌트라 스토어로 나눠 갖는다 */
  const focus = useSceneFocus();
  const setFocus = (f: { cell: string; file: string | null }) => focus.focus(f.cell, f.file);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  /** ★보이는 자리만 그리려고 재 두는 값 (사용자 지시 2026-08-14).
   *  칸이 560px 까지 커지고 한 줄에 수십 장이 붙으므로, 다 그리면 화면이 무거워진다. */
  const [view, setView] = useState({ x: 0, w: 0 });
  /** 머리 폭 손잡이를 잡은 자리 */
  const grip = useRef<{ x: number; w: number } | null>(null);

  // 스크롤·크기가 바뀌면 보이는 구간을 다시 잰다 (rAF 로 한 번만)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const measure = () => {
      raf = 0;
      setView((v) =>
        v.x === el.scrollLeft && v.w === el.clientWidth ? v : { x: el.scrollLeft, w: el.clientWidth },
      );
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(measure); };
    measure();
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(onScroll);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  /** ★슬롯 자리를 잡아 **좌우로 끈다** (사용자 지시 2026-08-14).
   *
   *  세로는 휠로 쉬운데 가로가 어려웠다. 사진 격자처럼 잡아 끌면 옆으로 넘어간다.
   *  ★4px 을 넘게 움직였을 때만 끄는 것으로 본다. 그보다 작으면 그냥 클릭이라
   *    장을 고르는 조작이 죽으면 안 된다.
   *  ★줄 머리는 뺀다. 거기에는 프롬프트 칸과 단추가 있어 끌면 안 된다.
   *  ★끌기로 판정되는 순간 **포인터를 잡는다**(`setPointerCapture`). 안 잡으면 줄 밖으로
   *    나가는 순간 바깥 UI 가 포인터를 받아, 끌던 것이 끊기고 거기 글자가 선택된다
   *    (사용자 지적 2026-08-15). 잡는 것은 **판정된 뒤**다: 누르자마자 잡으면 클릭의
   *    대상이 바뀌어 장을 고르는 조작이 어긋난다. */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let from: { x: number; y: number; sx: number; sy: number } | null = null;
    let moved = false;
    let held = -1;   // 잡고 있는 pointerId (없으면 -1. id 는 0 일 수 있다)
    const down = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (e.button !== 0) return;
      if (t.closest("[data-scene-head], input, textarea, select, [contenteditable='true']")) return;
      from = { x: e.clientX, y: e.clientY, sx: el.scrollLeft, sy: el.scrollTop };
      moved = false;
    };
    const move = (e: PointerEvent) => {
      if (!from) return;
      // ★버튼이 떨어졌으면 여기서 끝낸다. `pointerup` 을 못 받는 경우가 있는데
      //   (브라우저 기본 그림 끌기가 포인터를 가져가면 그렇다) 그대로 두면
      //   **버튼을 안 눌러도 마우스를 움직이는 것만으로 줄이 따라 움직인다.**
      if ((e.buttons & 1) === 0) { up(); return; }
      const dx = e.clientX - from.x;
      const dy = e.clientY - from.y;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      if (!moved) {
        moved = true;
        held = e.pointerId;
        try { el.setPointerCapture(e.pointerId); } catch { /* 이미 놓쳤으면 그냥 간다 */ }
        // 끌리는 동안 바깥 글자가 선택되지 않게
        el.style.userSelect = "none";
      }
      // 글자 선택·기본 끌기를 막는다. 이 시점에는 클릭을 이미 삼키기로 한 뒤다
      e.preventDefault();
      el.style.cursor = "grabbing";
      el.scrollLeft = from.sx - dx;
      el.scrollTop = from.sy - dy;
    };
    const up = () => {
      from = null;
      el.style.cursor = "";
      el.style.userSelect = "";
      if (held >= 0) {
        try { el.releasePointerCapture(held); } catch { /* 이미 놓였으면 그만 */ }
        held = -1;
      }
      // ★표식을 **다음 차례에** 지운다. 클릭은 손을 떼자마자 같은 차례에 오므로 그때는
      //   아직 살아 있어 삼켜지고, 그 뒤로는 깨끗해진다.
      //   ★안 지우면 끌고 난 다음의 **진짜 클릭 한 번이 통째로 죽는다** (실측 2026-08-14:
      //     끈 뒤에 다른 장을 눌러도 안 골라졌다). 끌기가 클릭 이벤트를 안 내는 경우가 있다.
      setTimeout(() => { moved = false; }, 0);
    };
    // ★끌었으면 그 뒤의 클릭을 삼킨다. 안 그러면 손을 뗀 자리의 장이 골라진다
    const click = (e: MouseEvent) => {
      if (!moved) return;
      moved = false;
      e.stopPropagation();
      e.preventDefault();
    };
    // ★기본 그림 끌기를 막는다. 시작되면 포인터 이벤트가 끊겨 끌기도 클릭도 어긋난다.
    //   ★`pointerdown` 에서 preventDefault 로 막지 말 것. 그러면 호환 click 이 사라져
    //     장을 고르는 조작이 통째로 죽는다 (CLAUDE.md 의 잊기 쉬운 것)
    const noDrag = (e: DragEvent) => e.preventDefault();
    el.addEventListener("dragstart", noDrag);
    el.addEventListener("pointerdown", down);
    // 포인터를 뺏겼으면 끌기도 거기서 끝난다 (창을 벗어나거나 다른 창으로 갔을 때)
    el.addEventListener("lostpointercapture", up);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    el.addEventListener("click", click, true);
    return () => {
      el.removeEventListener("dragstart", noDrag);
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("lostpointercapture", up);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      el.removeEventListener("click", click, true);
    };
  }, []);

  /** ★Ctrl + 휠로 칸 크기.
   *
   *  ★**네이티브 리스너로 붙인다.** React 의 `onWheel` 은 뿌리에 passive 로 달려서
   *    `preventDefault()` 가 안 먹고, 그러면 Ctrl+휠이 웹뷰 **확대**로 새어 나간다. */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const cur = useUi.getState().laneSize;
      useUi.getState().setLaneSize(e.deltaY < 0 ? cur * ZOOM : cur / ZOOM);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // 탭을 옮기면 고른 것을 놓는다 — 다른 탭의 파일을 고른 채로 두면 안 된다
  const tabId = tab?.id;
  useEffect(() => {
    setPicked(new Set());
    useSceneFocus.getState().clear();
  }, [tabId]);

  // Del = 숨김(휴지통) · Ctrl+Z = 되돌리기 · Esc = 선택 해제 (멀티 무대의 규칙 그대로)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) return;
      if (e.key === "Escape" && picked.size) return setPicked(new Set());
      if ((e.key === "Delete" || e.key === "Backspace") && picked.size) {
        e.preventDefault();
        void deleteFiles([...picked]);
        setPicked(new Set());
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z")) {
        if (undoSelection()) e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picked, deleteFiles, undoSelection]);

  if (tab?.kind !== "set") return null;

  // ★고른 캐릭터가 꺼지거나 지워졌으면 base 로 되돌린다 — 없는 곳으로 보내면 조용히 사라진다
  const dest = chars.some((c) => c.id === tab.sceneDest) ? tab.sceneDest! : "base";

  const h = Math.min(LANE_MAX, Math.max(LANE_MIN, laneSize));
  const w = h;
  const queued = pending.filter((p) => p.tabId === tab.id);
  const running = progress.total > progress.completed;

  /** 그 씬의 결과 (숨긴 것 제외) */
  const takesOfCell = (c: Slot) => takesOf(records, tab, c).filter((r) => !isDeleted(r.file));
  const maxLen = Math.max(
    1,
    ...tab.cards.flatMap((k) =>
      k.cells.map((c) => takesOfCell(c).length + queued.filter((p) => p.cellId === c.id).length),
    ),
  );

  const pick = (file: string, add: boolean) => {
    const next = new Set(picked);
    if (!add) {
      next.has(file) ? next.delete(file) : next.add(file);
    } else if (next.has(file)) next.delete(file);
    else next.add(file);
    setPicked(next);
  };

  return (
    <div
      data-scene-lane
      /* ★`minWidth: 0` 이 없으면 **가로로 넘칠 때 스크롤이 아니라 통째로 커진다**.
         칸이 넓어지자 씬 줄이 오른쪽 기둥을 뚫고 나갔다 (사용자 지적 2026-08-14).
         flex 자식의 기본 `min-width: auto` 가 내용 폭만큼 늘어나기 때문이다. */
      style={{ flex: 1, minHeight: 0, minWidth: 0, display: "flex", flexDirection: "column" }}
    >
      {/* ★머리줄 — 그릇의 것이다. 카드 이름은 카드 배너가 말한다 */}
      <div
        style={{
          flexShrink: 0,
          height: 30,
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-3)",
          padding: "0 var(--sp-3) 0 var(--sp-4)",
          borderTop: "1px solid var(--line)",
          borderBottom: "1px solid var(--line)",
          background: "var(--panel)",
        }}
      >
        <b style={{ fontSize: "var(--text-2xs)", color: "var(--ink-dim)" }}>{t("scenes.title")}</b>
        {/* ★씬 프롬프트가 payload 의 **어디로 들어가나** — 왼쪽 컨테이너 이름(베이스 프롬프트 /
            캐릭터 프롬프트)을 그대로 가리킨다. ★탭에 **하나뿐**이다 (사용자 결정) */}
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--sp-2)",
            fontSize: "var(--text-2xs)",
            color: "var(--ink-faint)",
          }}
        >
          {t("scenes.destLabel")}
          <select
            data-scene-dest
            value={dest}
            onChange={(e) => setTab(tab.id, { sceneDest: e.target.value })}
            style={{
              background: "var(--bg)",
              border: "1px solid var(--line)",
              borderRadius: "var(--r-2)",
              color: "var(--ink)",
              fontSize: "var(--text-2xs)",
              padding: "1px var(--sp-2)",
            }}
          >
            <option value="base">{t("scenes.destBase")}</option>
            {chars.map((c) => (
              <option key={c.id} value={c.id}>
                {t("scenes.destChar", { name: c.name })}
              </option>
            ))}
          </select>
        </label>
        <span style={{ flex: 1 }} />
        {/* ★칸 크기는 **Ctrl + 휠**로 바꾼다 (사용자 지시 2026-08-14). 버튼 셋이
            차지하던 자리를 돌려주고, 손이 줄 위에 있는 채로 바로 조절된다.
            지금 단계만 알려 준다 (`data-lane-step` 은 조작 테스트가 읽는다) */}
        <span
          data-lane-size={laneSize}
          style={{ fontSize: "var(--text-2xs)", color: "var(--ink-ghost)", whiteSpace: "nowrap" }}
        >
          {t("scenes.sizeHint", { s: laneSize })}
        </span>
      </div>

      <div style={{ flex: 1, minHeight: 0, minWidth: 0, position: "relative", display: "flex" }}>
      {/* ★줄 머리 폭 손잡이. 머리는 왼쪽에 붙어 있으므로(sticky left:0) 손잡이는
          스크롤과 무관하게 늘 같은 자리에 선다 */}
      <div
        data-head-grip
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          grip.current = { x: e.clientX, w: headw };
        }}
        onPointerMove={(e) => {
          const g = grip.current;
          if (!g) return;
          useUi.getState().setLaneHeadW(g.w + (e.clientX - g.x));
        }}
        onPointerUp={() => { grip.current = null; useUi.getState().commitLayout(); }}
        onPointerCancel={() => { grip.current = null; }}
        style={{ position: "absolute", left: headw - 3, top: 0, bottom: 0, width: 7, zIndex: 6, cursor: "col-resize" }}
      />
      <div
        ref={scrollRef}
        data-lane-scroll
        style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: "auto", background: "var(--bg)" }}
      >
        {!tab.cards.length ? (
          <Empty onAdd={() => addCard(tab.id)} />
        ) : (
          <div style={{ width: "max-content", minWidth: "100%" }}>
            {/* 눈금 — ★그릇 것이라 카드가 몇 장이든 이어진다 */}
            <div
              style={{
                position: "sticky",
                top: 0,
                zIndex: 3,
                display: "flex",
                alignItems: "center",
                height: RULER_H,
                background: "var(--bg)",
                borderBottom: "1px solid var(--line-soft)",
              }}
            >
              <div style={{ width: headw, flexShrink: 0 }} />
              {Array.from({ length: maxLen }, (_, k) => (
                <div
                  key={k}
                  style={{
                    width: w,
                    marginLeft: k ? GAP : 8,
                    flexShrink: 0,
                    textAlign: "center",
                    fontSize: 11,
                    fontFamily: "var(--font-mono)",
                    color: "var(--ink-ghost)",
                  }}
                >
                  {k + 1}
                </div>
              ))}
            </div>

            {tab.cards.map((card) => (
              <CardGroup
                key={card.id}
                card={card}
                only={card.cells.length === 1}
                w={w}
                h={h}
                focus={focus}
                picked={picked}
                onFocus={setFocus}
                onPick={pick}
                takes={takesOfCell}
                queuedOf={(cellId) => queued.filter((p) => p.cellId === cellId)}
                firstWaiting={running ? (queued[0]?.id ?? null) : null}
                view={view}
                headw={headw}
                base={base}
                ws={ws}
                isStarred={isStarred}
                onStar={toggleStar}
                onPatch={(patch) => setCard(tab.id, card.id, patch)}
                onRemove={() => removeCard(tab.id, card.id)}
                onAddScene={() => addSlot(tab.id, { cardId: card.id })}
                onSeq={(n) => setTab(tab.id, { cellSeq: n })}
                nextSeq={tab.cellSeq ?? 1}
                expandedId={expandedId}
                onExpand={setExpandedId}
                onDragSave={(e) =>
                  startDrag(e, {
                    dir: "save",
                    kind: "posesets",
                    card: {
                      id: "",
                      name: card.name,
                      color: card.color ?? colorOf(card.name),
                      cells: card.cells.map((c) => ({ name: c.name, blocks: cardBlocks(c.blocks) })),
                    },
                  })
                }
                onReorder={(from, to) => {
                  const next = [...card.cells];
                  const [moved] = next.splice(from, 1);
                  next.splice(to > from ? to - 1 : to, 0, moved);
                  setCard(tab.id, card.id, { cells: next });
                }}
              />
            ))}

            <div style={{ borderTop: "1px dashed var(--line)", minWidth: "100%" }}>
              <button
                data-add-card
                onClick={() => addCard(tab.id)}
                style={{
                  position: "sticky",
                  left: 0,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "var(--sp-2)",
                  padding: "var(--sp-3) var(--sp-5)",
                  color: "var(--ink-faint)",
                  fontSize: "var(--text-2xs)",
                }}
              >
                {Icon.plus}
                {t("scenes.addCard")}
              </button>
            </div>
          </div>
        )}
      </div>
      </div>

      {/* 고른 것이 있을 때만 뜨는 줄 (멀티 무대의 선택 막대와 같은 자리) */}
      {picked.size > 0 && (
        <div
          data-sel-bar
          style={{
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: "var(--sp-3)",
            padding: "var(--sp-2) var(--sp-4)",
            borderTop: "1px solid var(--warn)",
            fontSize: "var(--text-2xs)",
            color: "var(--warn)",
          }}
        >
          <span data-sel-count>{t("slots.picked", { n: picked.size })}</span>
          <span style={{ flex: 1 }} />
          <button
            data-sel-hide
            onClick={() => {
              void deleteFiles([...picked]);
              setPicked(new Set());
            }}
            style={{ border: "1px solid currentColor", borderRadius: "var(--r-1)", padding: "1px var(--sp-3)" }}
          >
            {t("slots.hide")}
          </button>
          <button
            data-sel-clear
            onClick={() => setPicked(new Set())}
            style={{ border: "1px solid currentColor", borderRadius: "var(--r-1)", padding: "1px var(--sp-3)" }}
          >
            {t("slots.clearSel")}
          </button>
        </div>
      )}
    </div>
  );
}

/** 비었을 때 — ★그릇만 있는 상태. 여기서는 씬을 못 만든다 (씬은 카드에 속한다) */
function Empty({ onAdd }: { onAdd: () => void }) {
  const t = useI18n((s) => s.t);
  return (
    <div
      style={{
        height: "100%",
        minHeight: 130,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--sp-4)",
        color: "var(--ink-faint)",
        fontSize: "var(--text-2xs)",
        textAlign: "center",
      }}
    >
      <div style={{ lineHeight: 1.7 }}>{t("scenes.emptyHint")}</div>
      <button
        data-add-card
        onClick={onAdd}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--sp-2)",
          padding: "var(--sp-3) var(--sp-6)",
          border: "1px dashed var(--accent-line)",
          borderRadius: "var(--r-3)",
          background: "var(--accent-bg)",
          color: "var(--accent)",
          fontSize: "var(--text-xs)",
          fontWeight: "var(--w-semi)",
        }}
      >
        {Icon.plus}
        {t("scenes.addCardFirst")}
      </button>
    </div>
  );
}

type GroupProps = {
  card: SceneCard;
  only: boolean;
  w: number;
  h: number;
  focus: { cell: string; file: string | null };
  picked: Set<string>;
  onFocus: (f: { cell: string; file: string | null }) => void;
  onPick: (file: string, add: boolean) => void;
  takes: (c: Slot) => Rec[];
  queuedOf: (cellId: string) => { id: string }[];
  firstWaiting: string | null;
  /** 스크롤 컨테이너의 보이는 구간 (가로). 이 밖의 칸은 안 그린다 */
  view: { x: number; w: number };
  /** 줄 머리 폭 (사용자가 끄는 값) */
  headw: number;
  base: string;
  ws: string;
  isStarred: (f: string) => boolean;
  onStar: (f: string) => void;
  onPatch: (patch: Partial<SceneCard>) => void;
  onRemove: () => void;
  onAddScene: () => void;
  onSeq: (n: number) => void;
  nextSeq: number;
  /** 펼쳐 둔 씬 id — ★한 번에 하나만 펼친다. 여럿 펼치면 다시 줄 높이가 제각각이 된다 */
  expandedId: string | null;
  onExpand: (id: string | null) => void;
  /** 배너 역드래그 — 덱에 씬 세트 카드로 저장 */
  onDragSave: (e: React.PointerEvent) => void;
  /** 카드 안에서 씬 순서 바꾸기 */
  onReorder: (from: number, to: number) => void;
};

/** 씬 세트 카드 하나 — ★스타일·캐릭터 카드와 **같은 생김새**다 (둥근 모서리 + 그라데이션 배너).
 *  ★`overflow: hidden` 을 주지 않는다 — 주면 스크롤 컨테이너가 새로 생겨서 줄 머리의
 *    `position: sticky; left: 0` 이 씬 칸이 아니라 **이 카드**에 붙는다. */
function CardGroup(p: GroupProps) {
  const t = useI18n((s) => s.t);
  const grad = p.card.color ?? colorOf(p.card.name);
  /** ★블록과 **같은 포인터 드래그**로 순서를 바꾼다 — HTML5 드래그를 쓰면 안의 칩을
   *  끄는 순간 씬이 딸려 끌리고, WebView2 가 그걸 파일 드롭으로 가로챈다 */
  const { register, handleProps } = useReorder(p.card.cells.length, p.onReorder);
  return (
    <div
      data-scene-card={p.card.id}
      style={{
        minWidth: "100%",
        marginBottom: "var(--sp-4)",
        border: "1px solid var(--line)",
        borderRadius: "var(--r-4)",
        background: "var(--surface)",
      }}
    >
      {/* 배너 — ★그림 자리다. 값 넣는 칸을 얹지 않는다 (`cards/banner.ts` 규격 그대로).
          ★배너를 우하단 핸드로 끌면 **씬 세트 카드로 덱에 저장**된다 (역드래그).
            「추가」 블록은 담기지 않는다 — 그건 이 탭 것이다 (`cardBlocks`). */}
      <div
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          p.onDragSave(e);
        }}
        style={{
          cursor: "grab",
          minWidth: "100%",
          height: 56,
          background: BANNER_BG,
          borderRadius: "11px 11px 0 0",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <div
          style={{
            position: "sticky",
            left: 0,
            width: 302,
            height: 56,
            overflow: "hidden",
            borderRadius: "11px 0 0 0",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              width: BANNER_IMG_W,
              pointerEvents: "none",
              maskImage: BANNER_CUT,
              WebkitMaskImage: BANNER_CUT,
              background: bannerEmptyFill(grad),
            }}
          />
          <div style={{ position: "absolute", inset: 0, background: BANNER_STEP, pointerEvents: "none" }} />
          <div
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              background: "linear-gradient(180deg, rgba(0,0,0,0) 30%, rgba(0,0,0,0.58) 100%)",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 11,
              bottom: 6,
              display: "flex",
              alignItems: "baseline",
              gap: "var(--sp-3)",
              color: "#fff",
              textShadow: "0 1px 5px rgba(0,0,0,0.55)",
            }}
          >
            <b style={{ fontSize: "0.86rem", fontWeight: "var(--w-bold)" }}>{p.card.name}</b>
            <span style={{ fontSize: 10, letterSpacing: "0.08em", opacity: 0.85 }}>
              {t("scenes.cardLabel", { n: p.card.cells.length })}
            </span>
          </div>
          {/* ★잠금은 **카드째**다 — 옛 「전체 잠금」이 이 자리로 왔다 (사용자 결정) */}
          <div
            style={{
              position: "absolute",
              right: 5,
              top: "50%",
              transform: "translateY(-50%)",
              display: "flex",
              gap: 2,
            }}
          >
            <button
              data-card-lock={p.card.id}
              onClick={() => p.onPatch({ locked: !p.card.locked })}
              title={t("scenes.lockCard")}
              style={{ ...bannerBtn, color: p.card.locked ? "var(--warn)" : "rgba(255,255,255,0.72)" }}
            >
              {p.card.locked ? Icon.lock : Icon.unlock}
            </button>
            <button
              data-card-remove={p.card.id}
              onClick={p.onRemove}
              title={t("scenes.removeCard")}
              style={bannerBtn}
            >
              {Icon.close12}
            </button>
          </div>
        </div>
      </div>

      {/* 공통 접두 — ★**첫 씬 바로 위**. 이 카드의 모든 씬에 걸리는 값이라 그 자리가 맞다 */}
      <div style={{ minWidth: "100%", borderBottom: "1px solid var(--line-soft)" }}>
        <span
          style={{
            position: "sticky",
            left: 0,
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--sp-3)",
            padding: "5px var(--sp-3)",
          }}
        >
          <span style={{ fontSize: 11, color: "var(--ink-faint)", whiteSpace: "nowrap" }}>
            {t("scenes.prefix")}
          </span>
          <input
            data-card-prefix={p.card.id}
            value={p.card.prefix ?? ""}
            onChange={(e) => p.onPatch({ prefix: e.target.value })}
            placeholder={t("scenes.prefixPlaceholder")}
            style={{
              width: 230,
              background: "var(--bg)",
              border: "1px solid var(--line)",
              borderRadius: "var(--r-2)",
              padding: "3px var(--sp-3)",
              fontSize: "var(--text-2xs)",
              color: "var(--ink-soft)",
            }}
          />
        </span>
      </div>

      {p.card.cells.map((c, i) => (
        <SceneRow key={c.id} {...p} cell={c} index={i} grip={handleProps(i)} rowRef={register(i)} />
      ))}

      <div style={{ borderTop: "1px dashed var(--line)", minWidth: "100%" }}>
        <button
          data-add-scene={p.card.id}
          onClick={p.onAddScene}
          style={{
            position: "sticky",
            left: 0,
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--sp-2)",
            padding: "var(--sp-3) var(--sp-5)",
            color: "var(--ink-faint)",
            fontSize: "var(--text-2xs)",
          }}
        >
          {Icon.plus}
          {t("scenes.addScene")}
        </button>
      </div>
    </div>
  );
}

/** 씬 한 줄 — 머리에 **그 씬의 프롬프트**(블록 편집기), 오른쪽에 그 씬의 장들 */
function SceneRow(
  p: GroupProps & {
    cell: Slot;
    index: number;
    grip: React.HTMLAttributes<HTMLSpanElement>;
    rowRef: (el: HTMLElement | null) => void;
  },
) {
  const t = useI18n((s) => s.t);
  const c = p.cell;
  const on = p.focus.cell === c.id;
  const expanded = p.expandedId === c.id;
  /** ★줄은 **최신이 왼쪽**이다 (사용자 지시 2026-08-14, 싱글 히스토리 줄과 같은 규칙).
   *  방금 나온 것을 찾아 눈이 끝까지 갈 이유가 없다. 대기 칸도 같은 규칙이라
   *  **새로 넣은 큐가 맨 왼쪽**이고, 지금 만드는 중인 것은 결과 바로 옆에 선다. */
  const takes = [...p.takes(c)].reverse();
  const waits = [...p.queuedOf(c.id)].reverse();
  /** 보이는 구간의 칸 번호. 앞뒤로 2칸씩 더 그려 스크롤이 끊겨 보이지 않게 한다 */
  const STEP = p.w + GAP;
  const total = waits.length + takes.length;
  const from = p.view.w
    ? Math.max(0, Math.floor((p.view.x - p.headw - 8) / STEP) - 2)
    : 0;
  const to = p.view.w
    ? Math.min(total, Math.ceil((p.view.x + p.view.w - p.headw - 8) / STEP) + 2)
    : total;
  const lead = from > 0 ? from * STEP - GAP : 0;
  const tail = total - to > 0 ? (total - to) * STEP - GAP : 0;
  const patchCell = (patch: Partial<Slot>) =>
    p.onPatch({ cells: p.card.cells.map((x) => (x.id === c.id ? { ...x, ...patch } : x)) });
  /** 접혀 있을 때 보이는 한 줄 — ★켜진 블록의 태그만 (컴파일에서 빠지는 것을 보여 주면 헷갈린다) */
  const summary = c.blocks
    .filter((b) => b.on)
    .flatMap((b) => b.tags.map((x) => x.t))
    .join(", ");

  return (
    <div
      ref={p.rowRef}
      data-scene={c.id}
      onClick={() => p.onFocus({ cell: c.id, file: p.focus.cell === c.id ? p.focus.file : null })}
      style={{
        display: "flex",
        alignItems: "stretch",
        /* ★줄 높이는 **오른쪽 썸네일이 정한다** (사용자 지시 2026-08-11). 프롬프트가 길다고
           줄이 늘어나면 줄마다 키가 달라져 눈이 훑을 기준을 잃는다. 그래서 블록은
           **펼쳤을 때만** 자리를 차지한다 — 접혀 있을 때는 한 줄 요약이다. */
        ...(expanded ? { minHeight: p.h + 12 } : { height: p.h + 12 }),
        borderBottom: "1px solid var(--line-soft)",
        opacity: c.locked || p.card.locked ? 0.62 : 1,
      }}
    >
      <div
        data-scene-head
        style={{
          position: "sticky",
          left: 0,
          zIndex: 2,
          width: p.headw,
          flexShrink: 0,
          background: on ? "var(--accent-bg)" : "var(--surface)",
          borderRight: "1px solid var(--line)",
          display: "flex",
          flexDirection: "column",
          gap: 4,
          padding: "6px var(--sp-3)",
          overflow: "hidden",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
          <span
            {...p.grip}
            onClick={(e) => e.stopPropagation()}
            title={t("block.dragToReorder")}
            style={{ color: "var(--ink-faint)", display: "grid", cursor: "grab", ...(p.grip.style ?? {}) }}
          >
            {Icon.grip}
          </span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-ghost)" }}>
            {String(p.index + 1).padStart(3, "0")}
          </span>
          <NameCell name={c.name} onRename={(v) => patchCell({ name: v })} />
          <span style={{ fontSize: 11, color: "var(--ink-ghost)", fontVariantNumeric: "tabular-nums" }}>
            {takes.length}
          </span>
          <button
            data-scene-expand={c.id}
            onClick={(e) => {
              e.stopPropagation();
              p.onExpand(expanded ? null : c.id);
            }}
            title={t(expanded ? "scenes.fold" : "scenes.unfold")}
            style={iconBtn}
          >
            {expanded ? Icon.chevronUp : Icon.chevronDown}
          </button>
          <button
            data-scene-lock={c.id}
            onClick={(e) => {
              e.stopPropagation();
              patchCell({ locked: !c.locked });
            }}
            title={t("slots.lock")}
            style={{ ...iconBtn, color: c.locked ? "var(--warn)" : "var(--ink-faint)" }}
          >
            {c.locked ? Icon.lock : Icon.unlock}
          </button>
          {!p.only && (
            <button
              data-scene-remove={c.id}
              onClick={(e) => {
                e.stopPropagation();
                p.onPatch({ cells: p.card.cells.filter((x) => x.id !== c.id) });
              }}
              title={t("slots.remove")}
              style={iconBtn}
            >
              {Icon.close12}
            </button>
          )}
        </span>
        {/* ★펼쳤을 때만 편집기가 뜬다 — 접혀 있으면 한 줄 요약이라 줄 높이가 안 흔들린다.
            펼치면 프롬프트와 **같은 편집기**다 (칩 드래그·휠 가중치·Enter·자동완성 그대로). */}
        {expanded ? (
          <div onClick={(e) => e.stopPropagation()} style={{ minWidth: 0 }}>
            <BlockList
              blocks={c.blocks}
              onChange={(b) => patchCell({ blocks: b })}
              libZone={`scene-${c.id}`}
            />
          </div>
        ) : (
          <span
            data-scene-summary={c.id}
            onClick={(e) => {
              e.stopPropagation();
              p.onExpand(c.id);
            }}
            title={t("scenes.unfold")}
            style={{
              flex: 1,
              minHeight: 0,
              fontSize: "var(--text-2xs)",
              color: "var(--ink-dim)",
              overflow: "hidden",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              lineHeight: 1.5,
              cursor: "text",
            }}
          >
            {summary || t("block.emptySummary")}
          </span>
        )}
      </div>

      <div style={{ flex: 1, display: "flex", alignItems: "center", gap: GAP, padding: "6px 0 6px 8px" }}>
        {!takes.length && !waits.length && (
          <span style={{ fontSize: "var(--text-2xs)", color: "var(--ink-ghost)" }}>
            {t("scenes.noneYet")}
          </span>
        )}
        {/* ★보이는 구간 앞뒤는 **빈 자리**로 때운다 (사용자 지시 2026-08-14).
            폭을 그대로 채워야 스크롤 길이와 눈금이 안 어긋난다. flex 의 gap 때문에
            빈 자리 하나가 간격 하나를 더 만들므로 그만큼 뺀다. */}
        {lead > 0 && <div style={{ width: lead, flexShrink: 0 }} />}
        {waits.slice(from, to).map((q) => (
          <div
            key={q.id}
            data-pending-cell
            style={{
              flexShrink: 0,
              width: p.w,
              height: p.h,
              borderRadius: "var(--r-1)",
              border: `2px dashed ${q.id === p.firstWaiting ? "var(--accent)" : "var(--line)"}`,
              background: "var(--bg)",
              display: "grid",
              placeItems: "center",
              fontSize: 11,
              color: q.id === p.firstWaiting ? "var(--accent)" : "var(--ink-faint)",
            }}
          >
            {q.id === p.firstWaiting ? t("slots.running") : t("slots.queued")}
          </div>
        ))}
        {takes.slice(Math.max(0, from - waits.length), Math.max(0, to - waits.length)).map((r) => {
          const sel = p.picked.has(r.file);
          const cur = p.focus.cell === c.id && p.focus.file === r.file;
          return (
            <button
              key={r.file}
              data-take={r.file}
              onClick={(e) => {
                e.stopPropagation();
                if (e.ctrlKey || e.metaKey || e.shiftKey) p.onPick(r.file, true);
                else p.onFocus({ cell: c.id, file: r.file });
              }}
              style={{
                position: "relative",
                flexShrink: 0,
                width: p.w,
                height: p.h,
                borderRadius: "var(--r-1)",
                border: `2px solid ${sel ? "var(--warn)" : cur ? "var(--accent)" : "transparent"}`,
                overflow: "hidden",
                background: "var(--surface2)",
                padding: 0,
                lineHeight: 0,
              }}
            >
              <img
                src={thumbUrlOf(p.base, p.ws, r.file)}
                alt=""
                draggable={false}
                loading="lazy"
                decoding="async"
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", opacity: sel ? 0.6 : 1 }}
              />
              <span
                data-take-star={r.file}
                onClick={(e) => {
                  e.stopPropagation();
                  p.onStar(r.file);
                }}
                style={{
                  position: "absolute",
                  right: 1,
                  top: 0,
                  display: "grid",
                  color: p.isStarred(r.file) ? "var(--warn)" : "rgba(255,255,255,0.8)",
                  opacity: p.isStarred(r.file) ? 1 : 0,
                  filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.7))",
                }}
                className="thumb-star"
              >
                {p.isStarred(r.file) ? Icon.star12On : Icon.star12}
              </span>
            </button>
          );
        })}
        {tail > 0 && <div style={{ width: tail, flexShrink: 0 }} />}
      </div>
    </div>
  );
}

/** 이름 — 더블클릭으로 그 자리 편집 (한 번 클릭은 줄 고르기) */
function NameCell({ name, onRename }: { name: string; onRename: (v: string) => void }) {
  const t = useI18n((s) => s.t);
  const [editing, setEditing] = useState(false);
  if (editing)
    return (
      <input
        autoFocus
        defaultValue={name}
        onClick={(e) => e.stopPropagation()}
        onBlur={(e) => {
          const v = e.target.value.trim();
          if (v) onRename(v);
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setEditing(false);
        }}
        style={{
          flex: 1,
          minWidth: 0,
          background: "var(--panel)",
          border: "1px solid var(--accent)",
          borderRadius: "var(--r-1)",
          padding: "0 4px",
          fontSize: "var(--text-xs)",
        }}
      />
    );
  return (
    <span
      onDoubleClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
      title={t("block.renameHint")}
      style={{
        flex: 1,
        minWidth: 0,
        fontSize: "var(--text-xs)",
        color: "var(--ink)",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        userSelect: "none",
      }}
    >
      {name}
    </span>
  );
}

const bannerBtn: React.CSSProperties = {
  display: "grid",
  placeItems: "center",
  width: 18,
  height: 18,
  borderRadius: "var(--r-1)",
  color: "rgba(255,255,255,0.72)",
};

const iconBtn: React.CSSProperties = {
  display: "grid",
  placeItems: "center",
  width: 17,
  height: 17,
  borderRadius: "var(--r-1)",
  color: "var(--ink-faint)",
  flexShrink: 0,
};
