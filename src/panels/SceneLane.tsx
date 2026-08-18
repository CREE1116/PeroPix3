import { Fragment, useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { useGen } from "../store/gen";
import { usePrompt } from "../store/prompt";
import { useQueue } from "../store/queue";
import { LANE_MAX, LANE_MIN, useUi } from "../store/ui";
import { allCells, useWs, takesOf, takesOfScene, type Rec, type SceneCard, type Slot } from "../store/workspace";
import { imgUrl, thumbUrlOf } from "../lib/imgUrl";
import { EnhanceDialog } from "./EnhanceDialog";
import { Icon } from "../components/Icon";
import { colorOf } from "../store/cards";
import { cardBlocks, compileBlocks, makeBlock, parseSegs } from "../lib/blocks";
import { useDragSource } from "../cards/dragStore";
import { DragGhost } from "../cards/DragGhost";
import { useLaneReorder, type LaneDrop } from "../lib/useReorder";
import { useSceneFocus } from "../store/sceneFocus";
import { usePreviews, withPreviews } from "../store/previews";
import { BANNER_BG, bannerEmptyFill } from "../cards/banner";

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
    undoSelection, setTab, setCard, addCard, removeCard, addSlot, moveScene, moveCard } = useWs();
  const pending = useQueue((s) => s.pending);
  // ★구독해서 읽는다. `getState()` 로 읽으면 진행이 바뀌어도 다시 그리지 않아
  //   「생성 중」이 영영 안 뜬다 (사용자 지적 2026-08-14)
  const progress = useQueue((s) => s.progress);
  const laneSize = useUi((u) => u.laneSize);
  const headw = useUi((u) => u.laneHeadW);
  /** ★「별표만 보기」 — 옛 싱글 캔버스에 있던 보기 전환이 여기로 왔다 (사용자 지시 2026-08-18).
   *  탭 전체를 거르는 것이라 씬마다 두지 않고 줄 머리에 하나만 둔다. */
  const starOnly = useUi((u) => u.laneStarOnly);
  /** 미저장 그림 — ★저장된 것과 **같은 목록**에 얹는다 (`store/previews.ts`) */
  const previews = usePreviews((s) => s.items);
  const startDrag = useDragSource();
  // ★씬 프롬프트 목적지 — 켜져 있는 캐릭터만 고를 수 있다 (꺼진 캐릭터는 payload 에 없다)
  const chars = usePrompt((s) => s.chars).filter((c) => c.on);
  const tab = activeTab();

  /** 지금 보고 있는 씬과 장 — ★프리뷰가 다른 컴포넌트라 스토어로 나눠 갖는다 */
  const focus = useSceneFocus();
  const setFocus = (f: { cell: string; file: string | null }) => focus.focus(f.cell, f.file);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  /** 이름을 그 자리에서 고치는 중인 씬 — ★**줄이 아니라 여기**가 들고 있다.
   *  Tab 으로 다음 씬의 이름 칸으로 건너뛰려면 누가 열려 있는지를 한 곳이 알아야 한다. */
  const [editingName, setEditingName] = useState<string | null>(null);
  /** 고른 것을 한 번에 강화 — 창에 **목록**을 넘긴다 (`EnhanceDialog` 가 배치를 안다) */
  const [enhance, setEnhance] = useState<string[] | null>(null);
  const lanePip = useUi((u) => u.lanePip);
  /** PIP 에 띄울 장 — 칸에 커서를 올리면 바뀐다 */
  const [hover, setHover] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  /** PIP 가 그 안에서만 움직이도록 가두는 상자 (줄 영역) */
  const boxRef = useRef<HTMLDivElement>(null);
  /** ★보이는 자리만 그리려고 재 두는 값 (사용자 지시 2026-08-14).
   *  칸이 560px 까지 커지고 한 줄에 수십 장이 붙으므로, 다 그리면 화면이 무거워진다. */
  const [view, setView] = useState({ x: 0, w: 0 });
  /** 머리 폭 손잡이를 잡은 자리 */
  const grip = useRef<{ x: number; w: number } | null>(null);

  /** ★씬·카드를 **줄 전체에서** 끈다 (v2 `index.html:11860-12002`, `docs/v2-port-audit.md` D2).
   *  예전에는 카드 안에서만 순서가 바뀌어, 씬을 다른 카드로 옮기거나 카드끼리 자리를 바꿀
   *  방법이 아예 없었다. 옮긴 뒤 번호가 어떻게 되는지는 `workspace.moveScene` 주석에 있다. */
  const tabIdNow = tab?.id;
  const lane = useLaneReorder({
    scrollRef,
    onMoveScene: (cellId, cardId, index) => {
      if (tabIdNow) moveScene(tabIdNow, cellId, cardId, index);
    },
    onMoveCard: (cardId, index) => {
      if (tabIdNow) moveCard(tabIdNow, cardId, index);
    },
  });

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
      // ★그립은 비켜 간다 — 순서를 바꾸려고 잡은 것이 줄 스크롤로 새면 안 된다.
      // ★★**생성물 칸(`[data-take]`)도 비켜 간다** — 카드 커버로 끌어내는 출발점이라
      //   여기서 잡으면 그림을 끄는 동안 줄이 함께 밀린다 (사용자 지적 2026-08-18).
      //   ★이 리스너는 **네이티브**라 React 핸들러의 `stopPropagation` 으로는 못 막는다
      //     (네이티브 전파가 React 의 합성 이벤트보다 먼저 지나간다). 여기서 걸러야 한다.
      if (t.closest("[data-scene-head], [data-card-grip], [data-take], input, textarea, select, [contenteditable='true']")) return;
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

  /** ★「캐릭터 전원」은 **켜진 캐릭터가 둘 이상일 때만** 낸다 (사용자 결정) —
   *  한 명이면 그 사람을 고르는 것과 같아서 뜻이 없다. */
  const canAll = chars.length > 1;
  // ★고른 캐릭터가 꺼지거나 지워졌으면 base 로 되돌린다 — 없는 곳으로 보내면 조용히 사라진다.
  //   ★판정이 `gen.ts generateAll` 과 **같아야** 화면에 뜬 것과 실제로 나가는 것이 안 갈린다
  //   (회귀 `lib/sceneDest.test.ts` 가 두 파일의 규칙 줄을 대조한다).
  const dest =
    tab.sceneDest === "all" && canAll
      ? "all"
      : chars.some((c) => c.id === tab.sceneDest)
        ? tab.sceneDest!
        : "base";

  const h = Math.min(LANE_MAX, Math.max(LANE_MIN, laneSize));
  const w = h;
  const queued = pending.filter((p) => p.tabId === tab.id);
  const running = progress.total > progress.completed;

  /** 그 씬의 결과 (숨긴 것 제외).
   *  ★갈 씬이 없는 결과는 **첫 씬**이 받는다 (`takesOfScene`, v2 이식 — 감사 D6)
   *  ★미저장 그림도 **같은 목록**에서 같은 규칙으로 갈린다 (`withPreviews`) — 저장 여부는
   *    칸의 생김새만 가르고, 어느 씬 것인지는 여전히 `takesOf` 가 판정한다.
   *  ★「별표만 보기」는 여기서 한 번만 건다. 별표는 파일 경로로 저장되므로 **미저장 그림은
   *    별표를 달 수 없고**, 그래서 거르면 함께 빠진다 (별표는 거르는 장치다). */
  const cells = allCells(tab);
  const all = withPreviews(records, ws, previews);
  const takesOfCell = (c: Slot) =>
    takesOfScene(all, tab, cells, c)
      .filter((r) => !isDeleted(r.file))
      .filter((r) => !starOnly || isStarred(r.file));
  /** 버튼 안에 적는 별표 수 — ★**이 탭 전체**다 (거르는 범위와 같아야 한다) */
  const starCount = takesOf(all, tab, undefined).filter(
    (r) => !isDeleted(r.file) && isStarred(r.file),
  ).length;
  const maxLen = Math.max(
    1,
    ...tab.cards.flatMap((k) =>
      k.cells.map((c) => takesOfCell(c).length + queued.filter((p) => p.cellId === c.id).length),
    ),
  );

  /** 카드마다 **앞선 카드들의 씬 수**.
   *  ★줄 앞 번호는 **탭 안에서 통째로** 센다 — 그 값이 곧 파일 이름 앞의 번호이기 때문이다
   *    (`gen.ts generateAll` 의 `cell_no` 는 `allCells(tab)` 에서의 자리다. CLAUDE.md:
   *    "행 앞 번호(001)는 파일 이름 앞의 번호와 같다"). 카드마다 1 로 되돌아가면 씬을
   *    다른 카드로 옮겼을 때 화면의 번호와 저장되는 번호가 갈린다. */
  const offsets: number[] = [];
  tab.cards.reduce((n, k) => (offsets.push(n), n + k.cells.length), 0);

  /** 끌고 있는 것 — ★잔상은 브라우저가 안 그려 주므로 우리가 그린다 (`useReorder` 머리 주석).
   *  ★이름표 하나로는 무엇을 들고 있는지 약해서 **그 모습**을 그린다 (사용자 지시 2026-08-18):
   *    씬이면 그 씬의 최신 장과 이름, 카드면 그 카드의 배너. */
  const dragCard = lane.drag?.kind === "card" ? tab.cards.find((k) => k.id === lane.drag!.id) : null;
  const dragCell = lane.drag?.kind === "scene" ? cells.find((c) => c.id === lane.drag!.id) : null;
  /** 레코드는 만든 차례대로 쌓이므로 **마지막이 최신**이다 (줄은 그것을 뒤집어 왼쪽에 둔다) */
  const dragTake = dragCell ? takesOfCell(dragCell).at(-1) : undefined;

  /** PIP 가 띄울 장 (커서 아래) */
  const hoverRec = hover ? all.find((r) => r.file === hover) : null;

  const pick = (file: string, add: boolean) => {
    const next = new Set(picked);
    if (!add) {
      next.has(file) ? next.delete(file) : next.add(file);
    } else if (next.has(file)) next.delete(file);
    else next.add(file);
    setPicked(next);
  };

  /** 이름 칸을 열고 닫는다 — ★닫는 쪽은 **자기 것일 때만** 닫는다.
   *  Tab 으로 옮기면 새 칸을 연 **뒤에** 옛 칸의 blur 가 오므로, 그냥 null 로 밀면
   *  방금 연 칸이 다시 닫힌다. */
  const onEditName = (id: string, v: boolean) =>
    setEditingName((cur) => (v ? id : cur === id ? null : cur));

  /** ★씬 사이 `Tab` 이동 (v2 `index.html:11809-11832`).
   *
   *  v2 는 슬롯마다 이름·태그 칸이 늘 떠 있어서 **같은 종류의 칸끼리** 건너뛰었다.
   *  3.0 은 이름은 더블클릭, 태그는 펼쳤을 때만 뜨므로 **그 칸을 열면서** 옮긴다.
   *  ★한 바퀴 돈다 (v2 와 같다) — 마지막에서 Tab 이면 첫 씬으로.
   *  ★카드를 가로질러 센다: 화면에 보이는 순서가 곧 이 순서다. */
  const stepField = (cellId: string, dir: 1 | -1, what: "name" | "text") => {
    const flat = tab.cards.flatMap((k) => k.cells);
    const i = flat.findIndex((c) => c.id === cellId);
    if (i < 0 || flat.length < 2) return;
    const next = flat[(i + dir + flat.length) % flat.length];
    if (what === "name") {
      setEditingName(next.id);
      return;
    }
    setExpandedId(next.id);
    // 편집기는 펼쳐야 생긴다 — 그려진 **다음 차례**에 커서를 넣는다
    setTimeout(() => {
      const el = document.querySelector<HTMLTextAreaElement>(
        `[data-scene-text="${CSS.escape(next.id)}"]`,
      );
      el?.focus();
      el?.select();
    }, 0);
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
            {/* ★v2 의 `promptTarget === "char"` (backend.py:2803-2833) — 씬 태그가 켜진
                캐릭터 **전부**에 붙는다. 두 명부터만 낸다 (위 `canAll` 주석) */}
            {canAll && (
              <option value="all">{t("scenes.destAll")}</option>
            )}
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
        {/* ★「별표만 보기」 — **탭 전체를 거르는 보기 전환**이다 (옛 싱글 캔버스에서 옮겨 왔다).
            별표를 켜는 자리는 그대로 썸네일 우상단이고, 여기는 **거르는 창구**다.
            별표 수를 버튼 안 괄호에 적는 것도 그때와 같다 (줄에는 글자를 두지 않는다). */}
        <button
          data-star-filter
          onClick={() => useUi.getState().setLaneStarOnly(!starOnly)}
          title={t(starOnly ? "canvas.starAll" : "canvas.starOnly")}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 3,
            height: 22,
            padding: "0 var(--sp-2)",
            borderRadius: "var(--r-1)",
            border: `1px solid ${starOnly ? "var(--warn)" : "transparent"}`,
            color: starOnly ? "var(--warn)" : "var(--ink-faint)",
            fontSize: "var(--text-2xs)",
            whiteSpace: "nowrap",
          }}
        >
          {starOnly ? Icon.star12On : Icon.star12}
          {/* ★거르는 중에는 개수를 안 적는다 — 「전체 보기 (3)」 은 3장이 전부라는 말로 읽힌다 */}
          {starOnly ? t("canvas.starAll") : `${t("canvas.starOnly")} (${starCount})`}
        </button>
        {/* ★PIP — 칸은 작게 두고 **커서를 올린 장만** 크게 본다 (v2 `pipBarBtn`).
            칸 크기를 키우면 한 줄에 몇 장 안 들어가므로, 훑기와 자세히 보기를 가른다 */}
        <button
          data-lane-pip={lanePip ? "on" : "off"}
          onClick={() => useUi.getState().setLanePip(!lanePip)}
          title={t("scenes.pip")}
          style={{
            display: "grid",
            placeItems: "center",
            width: 22,
            height: 22,
            borderRadius: "var(--r-1)",
            color: lanePip ? "var(--accent)" : "var(--ink-faint)",
            background: lanePip ? "var(--accent-bg)" : "transparent",
          }}
        >
          {Icon.pip}
        </button>
      </div>

      <div
        ref={boxRef}
        style={{ flex: 1, minHeight: 0, minWidth: 0, position: "relative", display: "flex" }}
      >
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
        /* PIP 가 켜져 있을 때만 커서 아래 장을 따라간다 (꺼져 있으면 아무 일도 안 한다) */
        onMouseOver={
          lanePip
            ? (e) => {
                const f = (e.target as HTMLElement).closest?.("[data-take]")?.getAttribute("data-take");
                if (f) setHover(f);
              }
            : undefined
        }
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

            {tab.cards.map((card, ci) => (
              <Fragment key={card.id}>
              {/* ★카드를 끌 때 놓일 자리 — **레이아웃을 안 밀도록** 높이 0 위에 띄운다
                  (CLAUDE.md: 칸 사이에 끼워 넣으면 방금 잰 좌표가 어긋난다) */}
              <DropLine on={lane.drop?.kind === "card" && lane.drop.index === ci} />
              <CardGroup
                card={card}
                offset={offsets[ci]}
                gripOf={lane.gripProps}
                drop={lane.drop}
                dragId={lane.drag?.id ?? null}
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
                /* ★씬 복제 — 태그·잠금까지 그대로 베껴 **바로 뒤에** 꽂는다 (v2 `duplicateSlot`).
                   번호는 탭의 발급기가 새로 준다 (`addSlot` 주석) */
                onDuplicate={(from, i) =>
                  addSlot(tab.id, {
                    cardId: card.id,
                    after: i,
                    from,
                    name: t("slots.copyOf", { name: from.name }),
                  })
                }
                onSeq={(n) => setTab(tab.id, { cellSeq: n })}
                nextSeq={tab.cellSeq ?? 1}
                expandedId={expandedId}
                onExpand={setExpandedId}
                editingName={editingName}
                onEditName={onEditName}
                onStepField={stepField}
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
                  }, undefined, () => setCard(tab.id, card.id, { folded: !card.folded }))
                }
                folded={!!card.folded}
                onFold={() => setCard(tab.id, card.id, { folded: !card.folded })}
              />
              </Fragment>
            ))}
            {/* 맨 끝에 놓을 때 */}
            <DropLine on={lane.drop?.kind === "card" && lane.drop.index === tab.cards.length} />

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
      {/* PIP — 줄 위에 떠 있는 작은 창. 켜 두면 커서를 올린 장이 여기 크게 뜬다 */}
      {lanePip && <LanePip boxRef={boxRef} url={hoverRec ? takeSrc(hoverRec, base, ws, false) : null} />}
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
          {/* ★고른 것을 **한 번에 강화**한다 (v2 「슬롯 전체 인핸스」). 창이 이미 강화한 것을
              걸러 내고, 못 쓰는 배율은 장마다 낮춘다 (`EnhanceDialog`) */}
          <button
            data-sel-enhance
            onClick={() => setEnhance([...picked])}
            style={{ border: "1px solid currentColor", borderRadius: "var(--r-1)", padding: "1px var(--sp-3)" }}
          >
            {t("enhance.button")}
          </button>
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

      {/* 커서를 따라오는 잔상 — **무엇을 들고 있나**. 놓일 자리는 `DropLine` 이 따로 말한다.
          ★줄을 통째로 띄우지 않는다 (v2 는 슬롯이 짧아 그럴 수 있었다). 씬 한 줄은 화면 폭만큼
            길어서 통째로 띄우면 뒤가 다 가려 어디에 놓는지가 안 보인다 — 그림 한 칸과 이름으로
            줄인다 (덱 카드 고스트를 작게 그리는 이유와 같다, `DragLayer`). */}
      {lane.ghost && (dragCard || dragCell) && (
        <DragGhost x={lane.ghost.x} y={lane.ghost.y}>
          {dragCard ? (
            /* 카드 배너를 줄여 놓은 것 — 카드 머리와 같은 재료를 쓴다 (`bannerEmptyFill`) */
            <div
              data-lane-ghost
              style={{
                position: "relative",
                width: 208,
                height: HEAD_H,
                borderRadius: "var(--r-2)",
                overflow: "hidden",
                background: BANNER_BG,
                border: "1px solid var(--line)",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: bannerEmptyFill(dragCard.color ?? colorOf(dragCard.name)),
                }}
              />
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: "linear-gradient(180deg, rgba(0,0,0,0) 20%, rgba(0,0,0,0.5) 100%)",
                }}
              />
              <span
                style={{
                  position: "absolute",
                  left: 9,
                  top: "50%",
                  transform: "translateY(-50%)",
                  display: "flex",
                  alignItems: "baseline",
                  gap: "var(--sp-3)",
                  color: "#fff",
                  textShadow: "0 1px 5px rgba(0,0,0,0.55)",
                }}
              >
                <b style={{ fontSize: "0.8rem", fontWeight: "var(--w-bold)" }}>{dragCard.name}</b>
                <span style={{ fontSize: 10, letterSpacing: "0.08em", opacity: 0.85 }}>
                  {t("scenes.cardLabel", { n: dragCard.cells.length })}
                </span>
              </span>
            </div>
          ) : (
            <div
              data-lane-ghost
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--sp-3)",
                maxWidth: 240,
                padding: 4,
                paddingRight: "var(--sp-4)",
                borderRadius: "var(--r-2)",
                border: "1px solid var(--accent)",
                background: "var(--panel)",
              }}
            >
              {/* 그림이 없는 씬이면 빈 칸 그대로 — 줄에서 보던 모습과 같다 */}
              <span
                style={{
                  flexShrink: 0,
                  width: 34,
                  height: 34,
                  borderRadius: "var(--r-1)",
                  overflow: "hidden",
                  background: "var(--bg)",
                  border: "1px solid var(--line)",
                  display: "block",
                }}
              >
                {dragTake && (
                  <img
                    src={takeSrc(dragTake, base, ws, true)}
                    alt=""
                    draggable={false}
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  />
                )}
              </span>
              <span
                style={{
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontSize: "var(--text-2xs)",
                  color: "var(--ink)",
                }}
              >
                {dragCell!.name}
              </span>
            </div>
          )}
        </DragGhost>
      )}

      {enhance && <EnhanceDialog files={enhance} onClose={() => setEnhance(null)} />}
    </div>
  );
}

/** 한 장의 주소 — ★**미저장이면 파일이 없으므로 data URL 이다** (`store/previews.ts`).
 *  서버 주소를 만들면 조용히 깨진 그림이 된다 (파일 이름이 표식이라 404 조차 아니다).
 *  ★규칙을 한 곳에 둔다 — 줄의 칸 · PIP · 끄는 잔상이 같은 판정을 써야 한다. */
export function takeSrc(r: Rec, base: string, ws: string, thumb: boolean): string {
  if (r.preview) return `data:image/${r.preview.fmt};base64,${r.preview.b64}`;
  return thumb ? thumbUrlOf(base, ws, r.file) : imgUrl(base, ws, r.file);
}

/** 끼울 자리 표시 — ★**높이 0 위에 띄운다.** 칸 사이에 실제로 끼워 넣으면 레이아웃이 밀려
 *  방금 잰 좌표가 어긋난다 (CLAUDE.md 의 칩 드래그 규칙과 같은 이유). */
function DropLine({ on }: { on: boolean }) {
  return (
    <div style={{ position: "relative", height: 0, minWidth: "100%", zIndex: 5 }}>
      {on && (
        <div
          data-drop-line
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: -1,
            height: 2,
            borderRadius: 1,
            background: "var(--accent)",
          }}
        />
      )}
    </div>
  );
}

/** 마지막으로 놓아 둔 자리·크기 — ★모듈에 둔다 (탭별 줌·위치와 같은 취급).
 *  켰다 껐다 할 때마다 우하단으로 되돌아가면 자리를 다시 잡아야 한다. 저장하지는 않는다. */
const pipBox = { left: null as number | null, top: null as number | null, w: 320, h: 320 };

/** PIP 미리보기 — ★칸에 커서를 올리면 그 장이 여기 **원본 크기로** 뜬다 (v2 `pipFloat`).
 *
 *  ★썸네일이 아니라 원본을 쓴다. 자세히 보려고 여는 창이라 썸네일(긴 변 512)이면 뜻이 없다.
 *  ★줄 영역 **안에서만** 움직인다 — 머리를 끌면 자리, 좌상단 손잡이를 끌면 크기다
 *    (오른쪽 아래가 아니라 좌상단인 이유: 기본 자리가 우하단이라 그쪽이 붙박이여야 커진다). */
function LanePip({
  boxRef,
  url,
}: {
  boxRef: React.RefObject<HTMLDivElement | null>;
  url: string | null;
}) {
  const t = useI18n((s) => s.t);
  const [, redraw] = useState(0);
  /** 자리를 잡기 전에는 그리지 않는다 — 잡기 전 한 프레임이 좌상단에 번쩍인다 */
  const [placed, setPlaced] = useState(pipBox.left !== null);
  const drag = useRef<{ mode: "move" | "size"; x: number; y: number; box: typeof pipBox } | null>(null);

  // 처음 뜰 때 자리를 잡는다 — 우하단에서 12px 띄운 자리
  useEffect(() => {
    const r = boxRef.current?.getBoundingClientRect();
    if (!r) return;
    // 줄 영역보다 클 수는 없다 (패널을 좁혀 두었을 때)
    pipBox.w = Math.min(pipBox.w, Math.max(PIP_MIN, r.width - 24));
    pipBox.h = Math.min(pipBox.h, Math.max(PIP_MIN, r.height - 24));
    if (pipBox.left === null || pipBox.top === null) {
      pipBox.left = Math.max(0, r.width - pipBox.w - 12);
      pipBox.top = Math.max(0, r.height - pipBox.h - 12);
    }
    // 창이 줄어들어 밖으로 나가 있으면 도로 들여놓는다
    pipBox.left = Math.min(pipBox.left, Math.max(0, r.width - pipBox.w));
    pipBox.top = Math.min(pipBox.top, Math.max(0, r.height - pipBox.h));
    setPlaced(true);
    redraw((n) => n + 1);
  }, [boxRef]);

  const onDown = (mode: "move" | "size") => (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { mode, x: e.clientX, y: e.clientY, box: { ...pipBox } };
    e.preventDefault();
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const r = boxRef.current?.getBoundingClientRect();
    if (!d || !r) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (d.mode === "move") {
      pipBox.left = clamp((d.box.left ?? 0) + dx, 0, Math.max(0, r.width - pipBox.w));
      pipBox.top = clamp((d.box.top ?? 0) + dy, 0, Math.max(0, r.height - pipBox.h));
    } else {
      // 좌상단을 끌면 우하단이 제자리에 남는다 — 폭·높이가 늘어난 만큼 자리가 당겨진다
      const right = (d.box.left ?? 0) + d.box.w;
      const bottom = (d.box.top ?? 0) + d.box.h;
      const left = clamp((d.box.left ?? 0) + dx, 0, right - PIP_MIN);
      const top = clamp((d.box.top ?? 0) + dy, 0, bottom - PIP_MIN);
      pipBox.left = left;
      pipBox.top = top;
      pipBox.w = right - left;
      pipBox.h = bottom - top;
    }
    redraw((n) => n + 1);
  };
  const onUp = () => {
    drag.current = null;
  };

  return (
    <div
      data-lane-pip-panel
      style={{
        position: "absolute",
        left: pipBox.left ?? 0,
        top: pipBox.top ?? 0,
        width: pipBox.w,
        height: pipBox.h,
        visibility: placed ? "visible" : "hidden",
        zIndex: 8,
        display: "flex",
        flexDirection: "column",
        borderRadius: "var(--r-3)",
        border: "1px solid var(--line)",
        background: "var(--panel)",
        boxShadow: "var(--shadow-3)",
        overflow: "hidden",
      }}
    >
      {/* 머리 — 끌어서 자리를 옮긴다 */}
      <div
        onPointerDown={onDown("move")}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        title={t("scenes.pipMove")}
        style={{
          flexShrink: 0,
          height: 22,
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-2)",
          padding: "0 var(--sp-3)",
          borderBottom: "1px solid var(--line-soft)",
          background: "var(--bg)",
          color: "var(--ink-dim)",
          fontSize: "var(--text-2xs)",
          cursor: "grab",
          userSelect: "none",
        }}
      >
        {t("scenes.pipTitle")}
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "grid",
          placeItems: "center",
          padding: "var(--sp-2)",
          background: "var(--bg)",
        }}
      >
        {url ? (
          <img
            data-lane-pip-img
            src={url}
            alt=""
            draggable={false}
            style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
          />
        ) : (
          <span style={{ fontSize: "var(--text-2xs)", color: "var(--ink-ghost)", textAlign: "center" }}>
            {t("scenes.pipHint")}
          </span>
        )}
      </div>

      {/* 크기 손잡이 — 좌상단 */}
      <div
        data-lane-pip-resize
        onPointerDown={onDown("size")}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        title={t("scenes.pipResize")}
        style={{ position: "absolute", left: 0, top: 0, width: 14, height: 14, cursor: "nwse-resize" }}
      />
    </div>
  );
}

const PIP_MIN = 140;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

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
  /** 앞선 카드들의 씬 수 — 줄 앞 번호가 탭 전체에서 이어지게 (`offsets` 주석) */
  offset: number;
  /** 씬·카드 그립에 펴 넣을 것 (`useLaneReorder`) */
  gripOf: ReturnType<typeof useLaneReorder>["gripProps"];
  /** 지금 놓일 자리 — 그 틈에 막대를 그린다 */
  drop: LaneDrop | null;
  /** 끌고 있는 것의 id (씬이든 카드든) — 그 줄을 흐리게 */
  dragId: string | null;
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
  /** 씬 복제 — 그 씬을 그대로 베껴 바로 뒤에 꽂는다 (v2 슬롯 복제) */
  onDuplicate: (from: Slot, index: number) => void;
  onSeq: (n: number) => void;
  nextSeq: number;
  /** 펼쳐 둔 씬 id — ★한 번에 하나만 펼친다. 여럿 펼치면 다시 줄 높이가 제각각이 된다 */
  expandedId: string | null;
  onExpand: (id: string | null) => void;
  /** 이름을 고치는 중인 씬 — ★줄이 아니라 **그릇**이 든다 (Tab 으로 건너뛰기 때문에) */
  editingName: string | null;
  onEditName: (id: string, v: boolean) => void;
  /** `Tab` 으로 옆 씬의 같은 칸으로 (v2 index.html:11809-11832) */
  onStepField: (cellId: string, dir: 1 | -1, what: "name" | "text") => void;
  /** 배너 역드래그 — 덱에 씬 세트 카드로 저장 */
  onDragSave: (e: React.PointerEvent) => void;
  /** 카드째 접혔나 — ★머리를 누르면 바뀐다 (전용 단추를 두지 않는다) */
  folded: boolean;
  onFold: () => void;
};

/** 씬 세트 머리의 높이 — ★절반으로 줄였다 (사용자 지적 2026-08-16: 56 은 너무 두꺼웠다) */
const HEAD_H = 28;
/** 머리에서 그림이 보이는 폭 — 줄 머리(이름·단추)가 얹히는 자리와 같다 */
const HEAD_W = 302;
/** ★자르지 않고 **끝만 부드럽게 뺀다** — 잘라 두면 줄 가운데서 뚝 끊긴 것처럼 보인다 */
const HEAD_FADE = "linear-gradient(90deg, #000 0 72%, transparent 100%)";

/** 씬 세트 카드 하나 — ★스타일·캐릭터 카드와 **같은 생김새**다 (둥근 모서리 + 그라데이션 배너).
 *  ★`overflow: hidden` 을 주지 않는다 — 주면 스크롤 컨테이너가 새로 생겨서 줄 머리의
 *    `position: sticky; left: 0` 이 씬 칸이 아니라 **이 카드**에 붙는다. */
function CardGroup(p: GroupProps) {
  const t = useI18n((s) => s.t);
  const grad = p.card.color ?? colorOf(p.card.name);
  /** ★블록과 **같은 포인터 드래그**로 순서를 바꾼다 — HTML5 드래그를 쓰면 안의 칩을
   *  끄는 순간 씬이 딸려 끌리고, WebView2 가 그걸 파일 드롭으로 가로챈다.
   *  ★판은 **줄 전체**다 (`useLaneReorder`) — 카드를 넘어 씬을 옮길 수 있어야 하고,
   *    같은 하나로 카드 자체의 자리도 바꾼다 */
  const cardGrip = p.gripOf("card", p.card.id);
  /** 이 카드 안에서 씬이 놓일 자리 (없으면 null) */
  const sceneAt =
    p.drop?.kind === "scene" && p.drop.cardId === p.card.id ? p.drop.index : null;
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
        // ★머리를 누르면 **카드째 접힌다** (사용자 지적 2026-08-16: 씬 세트가 안 접혔다).
        //   끌면 덱에 저장하는 역드래그다 — 4px 문턱으로 가른다 (`useDragSource` 의 `onTap`).
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          p.onDragSave(e);
        }}
        style={{
          cursor: "grab",
          minWidth: "100%",
          // ★높이를 절반으로 (사용자 지적 2026-08-16: 56 은 너무 두꺼웠다)
          height: HEAD_H,
          background: BANNER_BG,
          // ★접히면 머리가 카드의 **마지막 조각**이다 — 아래 모서리도 둥글어야 하고
          //   아래 테두리는 없어야 한다 (안 그러면 좌우 하단이 각지고 선이 남는다)
          borderRadius: p.folded ? "11px" : "11px 11px 0 0",
          borderBottom: p.folded ? undefined : "1px solid var(--line)",
        }}
      >
        <div
          style={{
            position: "sticky",
            left: 0,
            // ★줄 머리 폭에 맞춘다 — 이름·단추가 여기 얹힌다
            width: HEAD_W,
            height: HEAD_H,
            overflow: "hidden",
            borderRadius: p.folded ? "11px 0 0 11px" : "11px 0 0 0",
          }}
        >
          {/* ★★그림은 **끝까지 이어진다** (사용자 지적 2026-08-16).
              덱 카드는 좁아서 240px 에서 비스듬히 잘리는 것이 곧 모양이지만, 이 머리는
              줄 전체 폭이라 그 자리에서 잘리면 **가운데서 뚝 끊긴 것처럼** 보였다.
              그래서 여기서는 자르지 않고(`BANNER_CUT` 미사용) 오른쪽 끝을 부드럽게 뺀다. */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              maskImage: HEAD_FADE,
              WebkitMaskImage: HEAD_FADE,
              background: bannerEmptyFill(grad),
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              background: "linear-gradient(180deg, rgba(0,0,0,0) 20%, rgba(0,0,0,0.5) 100%)",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 11,
              top: "50%",
              transform: "translateY(-50%)",
              display: "flex",
              alignItems: "baseline",
              gap: "var(--sp-3)",
              color: "#fff",
              textShadow: "0 1px 5px rgba(0,0,0,0.55)",
            }}
          >
            {/* ★카드 순서 그립 — 머리 누르기(접기)·머리 끌기(덱에 저장)와 뜻이 달라 **전용 손잡이**를
                둔다. 셋을 한 자리에 얹으면 무엇이 될지 알 수 없다 */}
            <span
              data-card-grip={p.card.id}
              {...cardGrip}
              title={t("scenes.dragCard")}
              style={{ ...cardGrip.style, display: "grid", alignSelf: "center", color: "rgba(255,255,255,0.78)" }}
            >
              {Icon.grip}
            </span>
            <b style={{ fontSize: "0.8rem", fontWeight: "var(--w-bold)" }}>{p.card.name}</b>
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
              alignItems: "center",
              gap: 2,
            }}
          >
            <button
              data-card-lock={p.card.id}
              onClick={() => p.onPatch({ locked: !p.card.locked })}
              title={t("scenes.lockCard")}
              style={{ ...bannerBtn, color: p.card.locked ? "var(--warn)" : "rgba(255,255,255,0.72)" }}
            >
              {/* ★블록의 켜기/끄기와 **같은 모양**이다 (사용자 지시 2026-08-16) —
                  "이번 생성에서 뺀다"는 뜻이 같으므로 생김새도 같아야 한다.
                  ★잠김 = **꺼짐**이다 (자물쇠와 반대로 읽히지 않게) */}
              {p.card.locked ? Icon.dotOff : Icon.dotOn}
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

      {/* ★접으면 머리만 남는다 */}
      {p.folded ? null : (
      <>
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
        <Fragment key={c.id}>
          <DropLine on={sceneAt === i} />
          <SceneRow {...p} cell={c} index={i} grip={p.gripOf("scene", c.id)} />
        </Fragment>
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
      </>
      )}
      {/* 이 카드의 **끝**에 놓을 때. ★접혀 있으면 줄이 없어 **언제나 끝**이라, 접힌 카드에도
          이 표시만은 뜬다 (`useLaneReorder` 의 `index: -1`) */}
      <DropLine on={sceneAt !== null && (sceneAt < 0 || sceneAt >= p.card.cells.length)} />
    </div>
  );
}

/** 씬 한 줄 — 머리에 **그 씬의 프롬프트**(블록 편집기), 오른쪽에 그 씬의 장들 */
function SceneRow(
  p: GroupProps & {
    cell: Slot;
    index: number;
    grip: ReturnType<ReturnType<typeof useLaneReorder>["gripProps"]>;
  },
) {
  const t = useI18n((s) => s.t);
  /** 생성물을 카드 커버로 끄는 출발점 (`dir: "image"`). 덱·손패·프롬프트 배너가 받는다 */
  const startTakeDrag = useDragSource();
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
        // ★끌고 있는 줄은 흐리게 — 자리는 지킨 채다 (칩 드래그와 같은 규칙, CLAUDE.md)
        opacity: p.dragId === c.id ? 0.4 : c.locked || p.card.locked ? 0.62 : 1,
      }}
    >
      <div
        data-scene-head
        // ★머리를 누르면 펴진다. 단추·입력칸은 비켜 간다 — 안 비키면 잠금·삭제가 죽는다
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("button, input, textarea, [data-head-action]")) return;
          p.onExpand(expanded ? null : c.id);
        }}
        title={t(expanded ? "scenes.fold" : "scenes.unfold")}
        style={{
          cursor: "pointer",
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
            title={t("scenes.dragScene")}
            style={{ color: "var(--ink-faint)", display: "grid", ...p.grip.style }}
          >
            {Icon.grip}
          </span>
          {/* ★번호는 **탭 안에서 통째로** 센다 — 파일 이름 앞에 붙는 번호와 같은 값이라야
              한다 (`offsets` 주석 · `gen.ts` 의 `cell_no`). 카드마다 1 로 되돌아가면
              씬을 다른 카드로 옮겼을 때 화면과 저장 이름이 갈린다 */}
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-ghost)" }}>
            {String(p.offset + p.index + 1).padStart(3, "0")}
          </span>
          <NameCell
            name={c.name}
            editing={p.editingName === c.id}
            onEditing={(v) => p.onEditName(c.id, v)}
            onRename={(v) => patchCell({ name: v })}
            onTab={(dir) => p.onStepField(c.id, dir, "name")}
          />
          <span style={{ fontSize: 11, color: "var(--ink-ghost)", fontVariantNumeric: "tabular-nums" }}>
            {takes.length}
          </span>
          <button
            data-scene-lock={c.id}
            onClick={(e) => {
              e.stopPropagation();
              patchCell({ locked: !c.locked });
            }}
            title={t("slots.lock")}
            style={{ ...iconBtn, color: c.locked ? "var(--warn)" : "var(--ink-faint)" }}
          >
            {/* 블록의 켜기/끄기와 같은 모양 (카드 잠금 주석 참조) */}
            {c.locked ? Icon.dotOff : Icon.dotOn}
          </button>
          {/* ★복제 — 태그를 조금씩 바꿔 가며 비교하는 것이 씬의 쓰임이라, 베껴 놓고
              고치는 길이 있어야 한다 (v2 슬롯 머리의 복제 단추 그대로) */}
          <button
            data-scene-duplicate={c.id}
            onClick={(e) => {
              e.stopPropagation();
              p.onDuplicate(c, p.index);
            }}
            title={t("slots.duplicate")}
            style={iconBtn}
          >
            {Icon.duplicate}
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
            {/* ★블록 편집기가 아니라 **글 상자**다 (사용자 지시 2026-08-16) — 줄 안은 좁아서
                칩을 놓을 자리가 안 나온다. 저장은 그대로 블록이라 컴파일·카드 저장은 그대로.
                ★고치는 순간 켜진 블록이 **한 줄로 합쳐진다** (꺼진 것은 버린다). */}
            <textarea
              data-scene-text={c.id}
              value={compileBlocks(c.blocks)}
              onChange={(e) =>
                patchCell({
                  blocks: [
                    makeBlock(c.name, [], { on: true, open: true, tags: parseSegs(e.target.value) }),
                  ],
                })
              }
              /* ★`Tab` 으로 **옆 씬의 같은 칸**으로 (v2 index.html:11821-11832).
                  기본 동작(다음 단추로 이동)을 막고 씬 사이를 오간다 — 여러 씬의 태그를
                  이어서 적어 나가는 것이 이 칸의 쓰임이다 */
              onKeyDown={(e) => {
                if (e.key !== "Tab") return;
                e.preventDefault();
                p.onStepField(c.id, e.shiftKey ? -1 : 1, "text");
              }}
              title={t("scenes.tabHint")}
              placeholder={t("slots.textPlaceholder")}
              rows={3}
              style={{
                width: "100%",
                minWidth: 0,
                resize: "vertical",
                background: "var(--panel)",
                border: "1px solid var(--line)",
                borderRadius: "var(--r-2)",
                padding: "5px var(--sp-3)",
                fontSize: "var(--text-2xs)",
                lineHeight: 1.5,
                color: "var(--ink)",
              }}
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
          /** ★미저장 — 파일이 없는 그림이다 (자동 저장 끔). 칸 자리는 저장된 것과 **같고**,
           *  다른 것은 셋뿐이다: 그림을 data URL 로 그린다 · 「미저장」 표가 붙는다 ·
           *  별표를 못 켠다 (별표는 파일 경로로 저장되므로 없는 파일을 담으면 안 된다). */
          const un = r.preview ?? null;
          return (
            <button
              key={r.file}
              data-take={r.file}
              data-take-unsaved={un ? "" : undefined}
              title={un ? undefined : t("canvas.takeDragHint", { seed: r.seed })}
              // ★★**생성물을 끌면 카드 그림(커버)이 된다** — 덱·손패·프롬프트 배너가 받는다
              //   (`dir: "image"` 드롭존들). 싱글 캔버스를 걷을 때 이 출발점이 함께 사라져
              //   드래그가 통째로 죽어 있었다 (사용자 지적 2026-08-18).
              // ★클릭(선택)은 `onClick` 이 아니라 **`onTap`** 으로 받는다 — pointerdown 의
              //   `preventDefault` 가 브라우저의 호환 click 을 삼킨다 (CLAUDE.md 「잊기 쉬운 것」).
              // ★미저장은 **못 끈다.** 파일이 없어서 커버로 쓸 수 없다 (받는 쪽이 경로를 쓴다).
              onPointerDown={(e) => {
                const tap = () => {
                  // ★미저장은 **여러 장 고르기에서 뺀다.** 고른 것에 걸리는 일(휴지통·강화)이
                  //   전부 파일 경로를 서버로 보내는 것이라, 섞이면 조용히 실패한다.
                  //   버리는 것도 저장하는 것도 큰 그림 아래 줄에서 한다 (`SceneActions`)
                  if (!un && (e.ctrlKey || e.metaKey || e.shiftKey)) p.onPick(r.file, true);
                  else p.onFocus({ cell: c.id, file: r.file });
                };
                if (un) return tap();
                e.stopPropagation();
                startTakeDrag(
                  e,
                  { dir: "image", kind: "image", img: { ws: p.ws, file: r.file, url: takeSrc(r, p.base, p.ws, true) } },
                  undefined,
                  tap,
                );
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
                src={takeSrc(r, p.base, p.ws, true)}
                alt=""
                draggable={false}
                loading="lazy"
                decoding="async"
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", opacity: sel ? 0.6 : 1 }}
              />
              {un ? (
                /* ★「미저장」이 칸에서 바로 보여야 한다 (v2 는 파일명 자리에 `미저장` 을 넣었다 —
                    `index.html:12156`). 우리 칸에는 파일명 줄이 없으므로 아래에 작은 표로 얹는다. */
                <span
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    bottom: 0,
                    padding: "1px 3px",
                    background: "rgba(0,0,0,0.55)",
                    color: "var(--warn)",
                    fontSize: 10,
                    lineHeight: 1.4,
                    textAlign: "center",
                    letterSpacing: "0.02em",
                  }}
                >
                  {t("scenes.unsaved")}
                </span>
              ) : (
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
                  {/* ★썸네일 위라 12px 은 작았다 → 18px (사용자 지시 2026-08-18) */}
                  {p.isStarred(r.file) ? Icon.star18On : Icon.star18}
                </span>
              )}
            </button>
          );
        })}
        {tail > 0 && <div style={{ width: tail, flexShrink: 0 }} />}
      </div>
    </div>
  );
}

/** 이름 — 더블클릭으로 그 자리 편집 (한 번 클릭은 줄 고르기).
 *
 *  ★열려 있는 것이 누구인지는 **그릇이 든다** (`editingName`) — `Tab` 으로 옆 씬의 이름 칸으로
 *    건너뛰려면 한 곳이 알아야 하기 때문이다. 여기서 들고 있으면 자기 것만 열고 닫을 수 있다. */
function NameCell({
  name,
  editing,
  onEditing,
  onRename,
  onTab,
}: {
  name: string;
  editing: boolean;
  onEditing: (v: boolean) => void;
  onRename: (v: string) => void;
  onTab: (dir: 1 | -1) => void;
}) {
  const t = useI18n((s) => s.t);
  if (editing)
    return (
      <input
        autoFocus
        // ★씬이 바뀌면 **입력칸도 새로 만든다** — 같은 요소를 물려주면 Tab 으로 옮겼을 때
        //   옛 씬의 글자가 그대로 남는다 (`defaultValue` 는 처음 한 번만 먹는다)
        key={name}
        defaultValue={name}
        onClick={(e) => e.stopPropagation()}
        onBlur={(e) => {
          const v = e.target.value.trim();
          if (v) onRename(v);
          onEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") onEditing(false);
          if (e.key === "Tab") {
            // ★고친 값을 **먼저 넣고** 옮긴다 (v2 index.html:11809-11820 과 같은 이동).
            //   뒤따라 오는 blur 는 이미 연 다음 칸을 닫지 않는다 (`onEditName` 주석)
            e.preventDefault();
            const v = (e.target as HTMLInputElement).value.trim();
            if (v) onRename(v);
            onTab(e.shiftKey ? -1 : 1);
          }
        }}
        title={t("scenes.tabHint")}
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
        onEditing(true);
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
