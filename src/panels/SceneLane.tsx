import { Fragment, useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { useGen } from "../store/gen";
import { usePrompt } from "../store/prompt";
import { useQueue } from "../store/queue";
import { LANE_MAX, LANE_MIN, useUi } from "../store/ui";
import { allCells, useWs, takesOf, takesOfScene, type Rec, type SceneCard, type Slot } from "../store/workspace";
import { newestFirst } from "../lib/takes";
import { imgUrl, thumbUrlOf } from "../lib/imgUrl";
import { EnhanceDialog } from "./EnhanceDialog";
import { Icon } from "../components/Icon";
import { kindColor } from "../cards/kindColor";
import { slotBlock, slotBlocksOf } from "../lib/blocks";
import { BlockList } from "../blocks/BlockList";
import { DropVeil } from "../cards/DropVeil";
import { useDragSource, useDropZone } from "../cards/dragStore";
import { DragGhost } from "../cards/DragGhost";
import { useLaneReorder, type LaneDrop } from "../lib/useReorder";
import { useSceneFocus } from "../store/sceneFocus";
import { useRename } from "../components/useRename";
import { ask } from "../store/ask";
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
  /** 씬 세트 카드를 받는 자리 — **줄 전체**다. 놓으면 카드가 아래에 하나 더 붙는다 */
  const setDrop = useDropZone({
    id: "lane-setzone",
    kind: "posesets",
    prio: 5,
    onDrop: (d) => {
      const c = d.card as { name: string; color?: [string, string]; cells?: Slot[] } | undefined;
      const cur = useWs.getState().activeTab();
      if (!c?.cells?.length || cur?.kind !== "set") return;
      addCard(cur.id, { name: c.name, color: c.color, cells: c.cells });
    },
  });

  /** ★★씬을 고르면 **그 씬의 맨 앞(최신) 장**이 함께 골라진다 (사용자 지시 2026-08-19).
   *  씬만 고르고 그림이 안 골라지면 큰 자리가 비어, 한 번 더 눌러야 뭔가 보였다.
   *  ★파일을 **딱 집어** 넘긴 경우(썸네일 클릭)는 그대로 둔다. */
  const setFocus = (f: { cell: string; file: string | null }) => {
    const cell = tab?.kind === "set" ? allCells(tab).find((c) => c.id === f.cell) : undefined;
    const takes = cell ? [...takesOfCell(cell)].sort(newestFirst) : [];
    // ★★**그 씬에 없는 파일은 고른 것이 아니다** (조작 테스트에서 잡았다 2026-08-19).
    //   씬 id 는 탭·워크스페이스마다 다시 `c0` 부터 나가므로, 앞 화면에서 고른 파일이
    //   같은 id 의 다른 씬에 그대로 얹혀 **아무것도 안 골라진 상태**가 됐다 —
    //   그러면 「씬을 고르면 맨 앞 장이 함께 골라진다」가 그 씬에서만 조용히 안 돌았다.
    if (f.file && takes.some((r) => r.file === f.file)) return focus.focus(f.cell, f.file);
    focus.focus(f.cell, takes[0]?.file ?? null);
  };
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  /** ★★펼치면서 **곧장 치려는** 것인가 (사용자 지시 2026-08-19: 한 번 눌러 바로 친다).
   *  씬 칸은 이제 블록이라 펼치면 **칩**이 보인다 — 그런데 요약 글자를 누른 것은 거기서부터
   *  적으려는 것이라, 그때만 글 상자를 열어 커서를 넣는다. 머리를 눌러 편 것은 보려는 것이다. */
  const [typingId, setTypingId] = useState<string | null>(null);
  const expand = (id: string | null, typing = false) => {
    setExpandedId(id);
    setTypingId(typing ? id : null);
  };

  /** ★★**글 상자 밖을 누르면 편집이 끝난다** (사용자 지시 2026-08-18).
   *  예전에는 닫는 길이 그 씬의 머리를 다시 누르는 것뿐이라 어디를 눌러도 펼친 채였다.
   *
   *  ★`pointerdown` 을 **잡기 단계**(capture)로 듣는다 — 씬 줄의 가로 스크롤도, 칩 드래그도
   *    pointerdown 에서 시작하므로 버블을 기다리면 그것들이 먼저 삼킨다.
   *  ★★예외는 **글 상자 자신뿐**이다. 처음에는 그 씬 줄(`[data-scene]`) 전체를 예외로 뒀는데,
   *    그러면 **같은 씬의 결과를 골라도 편집이 안 끝났다** (사용자 지적 2026-08-19).
   *    머리를 눌러도 닫힌다 — 내 처리가 먼저 돌아 `null` 이 되고, 뒤이은 머리의 토글은
   *    그 시점에 「펼쳐져 있음」이라 다시 `null` 을 넣는다. 다른 씬을 누르면 그 씬이 열린다. */
  useEffect(() => {
    if (!expandedId) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      /* ★★**열려 있는 그 칸**일 때만 비켜 간다. 접힌 줄에도 같은 블록이 있으므로
         (`clamp`) 그냥 `[data-slot-block]` 으로 보면 **다른 씬을 눌러도 안 닫힌다.** */
      if (t?.closest("[data-slot-block]")?.getAttribute("data-slot-block") === expandedId) return;
      /* ★★서랍에서 블록을 끌어오는 중이면 닫지 않는다. 닫으면 받는 자리가 그 자리에서
         **사라져** 아예 놓을 수 없다 — 끌기는 서랍 쪽 `pointerdown` 으로 시작한다. */
      if (t?.closest("[data-block-drawer]")) return;
      expand(null);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [expandedId]);
  /** 이름을 그 자리에서 고치는 중인 씬 — ★**줄이 아니라 여기**가 들고 있다.
   *  Tab 으로 다음 씬의 이름 칸으로 건너뛰려면 누가 열려 있는지를 한 곳이 알아야 한다. */
  const [editingName, setEditingName] = useState<string | null>(null);
  /** 고른 것을 한 번에 강화 — 창에 **목록**을 넘긴다 (`EnhanceDialog` 가 배치를 안다) */
  const [enhance, setEnhance] = useState<string[] | null>(null);
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
  /** ★★**처음 뜰 때는 놓지 않는다** (사용자 지적 2026-08-19: 인페인트에 들어갔다 나오면
   *  고른 것이 풀려 있었다). 마스크 편집기는 캔버스 자리를 통째로 차지해서 이 줄이 **언마운트**
   *  되고, 돌아올 때 다시 마운트된다 — 그때마다 이 효과가 돌아 골라 둔 장을 지웠다.
   *  탭이 **실제로 바뀐 때만** 놓는다. */
  const lastTab = useRef(tabId);
  useEffect(() => {
    if (lastTab.current === tabId) return;
    lastTab.current = tabId;
    setPicked(new Set());
    useSceneFocus.getState().clear();
  }, [tabId]);

  // Del = 숨김(휴지통) · Ctrl+Z = 되돌리기 · Esc = 선택 해제 (멀티 무대의 규칙 그대로)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) return;
      if (e.key === "Escape" && picked.size) return setPicked(new Set());
      if (e.key === "Delete" || e.key === "Backspace") {
        if (picked.size) {
          e.preventDefault();
          void deleteFiles([...picked]);
          setPicked(new Set());
          return;
        }
        // ★★고른 **한 장**도 Del 로 지운다 (사용자 지시 2026-08-19). 지운 뒤에는
        //   **오른쪽 장**으로 옮겨 간다 (없으면 왼쪽, 그것도 없으면 아무것도 안 고른 상태) —
        //   줄은 최신이 왼쪽이라, 오른쪽이 '그 다음으로 옛것'이다.
        const cur = useSceneFocus.getState();
        if (!cur.file) return;
        const cell = tab?.kind === "set" ? allCells(tab).find((c) => c.id === cur.cell) : undefined;
        const list = cell ? [...takesOfCell(cell)].sort(newestFirst) : [];
        const at = list.findIndex((r) => r.file === cur.file);
        e.preventDefault();
        void deleteFiles([cur.file]);
        const next = list[at + 1] ?? list[at - 1] ?? null;
        useSceneFocus.getState().focus(cur.cell, next?.file ?? null);
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
    // ★건너뛴 자리는 **곧장 치는** 자리다 — 태그를 이어 적어 나가는 흐름이라
    //   거기서 칩을 한 번 더 눌러야 하면 조작이 끊긴다.
    expand(next.id, true);
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
            {/* ★이름이 비어 있으면 **화면에 뜨는 이름**을 그대로 쓴다 (사용자 지적 2026-08-19:
                갓 만든 캐릭터가 공백으로 떴다). 카드 머리도 같은 규칙이다 (`CharSection`) */}
            {chars.map((c, i) => (
              <option key={c.id} value={c.id}>
                {t("scenes.destChar", { name: c.name || t("cards.charN", { n: i + 1 }) })}
              </option>
            ))}
          </select>
        </label>
        <span style={{ flex: 1 }} />
        {/* ★칸 크기는 **Ctrl + 휠**로 바꾼다 (사용자 지시 2026-08-14). 버튼 셋이
            차지하던 자리를 돌려주고, 손이 줄 위에 있는 채로 바로 조절된다.
            ★안내 문구를 두지 않는다 (사용자 지시 2026-08-19) — 휠로 조절되는 것은
              적어 두지 않아도 안다. 지금 크기도 칸을 보면 보인다. */}
        {/* ★「별표만 보기」 — **탭 전체를 거르는 보기 전환**이다 (옛 싱글 캔버스에서 옮겨 왔다).
            별표를 켜는 자리는 그대로 썸네일 우상단이고, 여기는 **거르는 창구**다.
            별표 수를 버튼 안 괄호에 적는 것도 그때와 같다 (줄에는 글자를 두지 않는다). */}
        <button
          data-star-filter
          onClick={() => useUi.getState().setLaneStarOnly(!starOnly)}
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
      </div>

      <div
        ref={boxRef}
        style={{
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          position: "relative",
          display: "flex",
          /* ★★씬 세트를 끌고 있으면 **줄 전체**가 어둠 위로 올라온다 (사용자 지적 2026-08-20).
             스크롤 칸만 올리면 머리 손잡이·여백이 어두운 채라 영역으로 안 읽힌다. */
          ...(setDrop.active ? { zIndex: 31, background: "var(--bg)" } : {}),
        }}
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
      {/* ★★씬 세트 카드는 **이 줄이 받는다** (사용자 지시 2026-08-19).
          예전에는 캔버스에 고정 크기 판을 띄웠는데, 씬이 사는 자리와 다른 데다 받는 넓이가
          화면 크기에 매여 있었다. 이제 **씬 줄 그대로가 받는 자리**다 — 줄이 늘고 줄면 받는
          자리도 같이 변한다.
          ★놓으면 **아래에 카드가 하나 더 붙는다** — 탭을 새로 만들거나 있는 것을 갈아
            끼우지 않는다 (카드를 겹쳐 쌓는 것이 이 화면의 문법이다). */}
      <div
        ref={(el) => {
          scrollRef.current = el;
          // ★드롭존의 ref 는 **객체**다 (`useDropZone`) — 여기서는 스크롤 ref 와 둘 다 걸어야 해서
          //   콜백 ref 로 받아 손으로 채운다
          (setDrop.ref as React.MutableRefObject<HTMLDivElement | null>).current = el;
        }}
        data-lane-scroll
        data-set-drop={setDrop.over ? "over" : setDrop.active ? "on" : undefined}
        style={{
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          overflow: "auto",
          /* ★올리는 것은 **줄 전체**다 (위 `boxRef`) — 물들이는 것은 카드 위에 뜨는
             겹이 한다 (`data-set-drop-hint`), 바탕을 칠하면 카드에 가린다 */
          background: "var(--bg)",
        }}
      >
        {!tab.cards.length ? (
          <Empty onAdd={() => addCard(tab.id)} />
        ) : (
          <div style={{ width: "max-content", minWidth: "100%" }}>
            {/* ★눈금 줄(1·2·3…)을 걷었다 (사용자 지시 2026-08-19) — 몇 번째 장인지는
                세어서 쓸 일이 없고, 줄마다 자리를 하나씩 먹고 있었다. */}
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
                typingId={typingId}
                onExpand={expand}
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
                      color: kindColor("posesets"),
                      cells: card.cells.map((c) => ({ name: c.name, blocks: c.blocks })),
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
      {/* ★★표시는 **공통**이다 (`DropVeil`) — 영역이 밝아지고, 그 위에 오면 물들면서
          무슨 일이 일어나는지 알약으로 적는다 (사용자 지시 2026-08-20: 강조 방식 통일). */}
      {setDrop.active && <DropVeil over={setDrop.over} label={t("scenes.addCard")} name="set" />}
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
                  background: bannerEmptyFill(kindColor("posesets")),
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
                padding: "4px var(--sp-4) 4px 4px",
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
  /** 그 칸을 **치려고** 편 것인가 (요약 클릭·Tab 이동). 머리를 눌러 편 것은 아니다 */
  typingId: string | null;
  onExpand: (id: string | null, typing?: boolean) => void;
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
/** ★자르지 않고 **끝만 부드럽게 뺀다** — 잘라 두면 줄 가운데서 뚝 끊긴 것처럼 보인다 */
const HEAD_FADE = "linear-gradient(90deg, #000 0 72%, transparent 100%)";

/** 씬 세트 카드 하나 — ★스타일·캐릭터 카드와 **같은 생김새**다 (둥근 모서리 + 그라데이션 배너).
 *  ★`overflow: hidden` 을 주지 않는다 — 주면 스크롤 컨테이너가 새로 생겨서 줄 머리의
 *    `position: sticky; left: 0` 이 씬 칸이 아니라 **이 카드**에 붙는다. */
function CardGroup(p: GroupProps) {
  const t = useI18n((s) => s.t);
  /* ★★색은 **종류가 정한다** (사용자 결정 2026-08-20) — 카드에 박힌 옛 색도 안 본다.
     예전에는 이름을 해시해서 뽑았고, 새 세트는 이름이 늘 「새 세트」라 언제나 같은 색인데
     기본 씬 세트만 다른 색이 되어 있었다. 카드끼리 가르는 것은 **그림**이 한다. */
  const grad = kindColor("posesets");
  /** 이름을 그 자리에서 고치는 중 — `null` 이면 아니다 (프롬프트 카드와 같은 방식) */
  /** 이름 고치기 — ★규칙은 **앱에 하나**다 (`useRename`): 단추를 다시 누르면 저장하고 끝 */
  const rename = useRename(p.card.name, (v) => p.onPatch({ name: v }));
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
        /* ★위아래로 **숨 쉴 자리**를 둔다 (사용자 지시 2026-08-20: 씬 머리줄과 카드가
           딱 붙어 있었다). 카드는 둥근 상자라, 붙어 있으면 머리줄의 선과 모서리가
           한 덩어리로 읽힌다. */
        margin: "var(--sp-2) 0 var(--sp-4)",
        border: "1px solid var(--line)",
        borderRadius: "var(--r-4)",
        background: "var(--surface)",
      }}
    >
      {/* 배너 — ★그림 자리다. 값 넣는 칸을 얹지 않는다 (`cards/banner.ts` 규격 그대로).
          ★배너를 우하단 핸드로 끌면 **씬 세트 카드로 덱에 저장**된다 (역드래그).
            칸 하나가 곧 블록 하나라 그대로 담긴다 (`slotBlock`). */}
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
            /* ★★폭은 **줄 머리와 같은 값**이어야 한다 (사용자 지적 2026-08-19).
               상수 302 로 박혀 있었는데 줄 머리는 사용자가 끄는 값이라(`laneHeadW`, 기본 286),
               그림이 끝나는 자리와 아래 줄들의 경계가 어긋나 **가운데서 잘린 것처럼** 보였다. */
            width: p.headw,
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
          {/* ★어둡게 눕히는 겹도 **같은 마스크**를 쓴다 — 안 그러면 그림은 사라졌는데 이 겹만
              끝에서 뚝 끊겨 세로 이음매가 보인다 (사용자 지적 2026-08-19) */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              maskImage: HEAD_FADE,
              WebkitMaskImage: HEAD_FADE,
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
              style={{ ...cardGrip.style, display: "grid", alignSelf: "center", color: "rgba(255,255,255,0.78)" }}
            >
              {Icon.grip}
            </span>
            {/* ★★이름을 **카드 안에서** 고친다 (사용자 지시 2026-08-19) — 프롬프트 카드·덱 카드와
                같은 방식이다 (두 번 누르거나 연필 단추, 다시 누르면 저장하고 끝난다). */}
            {!rename.editing ? (
              <b
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  rename.toggle();
                }}
                style={{ fontSize: "0.8rem", fontWeight: "var(--w-bold)", cursor: "text" }}
              >
                {p.card.name}
              </b>
            ) : (
              <input
                data-card-name={p.card.id}
                {...rename.inputProps}
                style={{
                  width: 130,
                  background: "rgba(0,0,0,0.45)",
                  border: "1px solid rgba(255,255,255,0.5)",
                  borderRadius: "var(--r-1)",
                  padding: "0 4px",
                  color: "#fff",
                  fontSize: "0.8rem",
                  fontWeight: "var(--w-bold)",
                }}
              />
            )}
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
              data-card-rename={p.card.id}
              data-tip={t("cards.rename")}
              onPointerDown={(e) => e.stopPropagation()}
              {...rename.btnProps}
              style={bannerBtn}
            >
              {Icon.pencil}
            </button>
            <button
              data-card-lock={p.card.id}
              onClick={() => p.onPatch({ locked: !p.card.locked })}
              data-tip={t("scenes.lockCard")}
              style={{ ...bannerBtn, color: p.card.locked ? "var(--warn)" : "rgba(255,255,255,0.72)" }}
            >
              {/* ★블록의 켜기/끄기와 **같은 모양**이다 (사용자 지시 2026-08-16) —
                  "이번 생성에서 뺀다"는 뜻이 같으므로 생김새도 같아야 한다.
                  ★잠김 = **꺼짐**이다 (자물쇠와 반대로 읽히지 않게) */}
              {p.card.locked ? Icon.dotOff : Icon.dotOn}
            </button>
            <button
              data-card-remove={p.card.id}
              /* ★★**생성물이 화면에서 사라지는 삭제는 전부 묻는다** (사용자 지시 2026-08-19).
                 카드를 빼면 그 안의 씬이 통째로 빠지므로, 씬 하나를 지우는 것보다 범위가 넓다.
                 ★`Ctrl+Z` 로 되돌아가는 자리여도 묻는다 — 되돌릴 수 있다는 것이 안 묻는 이유가
                 되면, 사라진 줄 모르고 지나가는 일이 그대로 남는다. */
              onClick={() => {
                const n = p.card.cells.reduce((sum, c) => sum + p.takes(c).length, 0);
                if (!n) return p.onRemove();
                void (async () => {
                  if (
                    await ask({
                      title: t("scenes.removeCardConfirm", { name: p.card.name, c: p.card.cells.length, n }),
                      body: t("scenes.removeConfirmBody"),
                      ok: t("common.delete"),
                      cancel: t("common.cancel"),
                    })
                  )
                    p.onRemove();
                })();
              }}
              data-tip={t("scenes.removeCard")}
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
  /** ★★이 칸의 블록 — **하나뿐**이다 (`slotBlock`). 여럿이 든 옛 카드를 얹었으면
   *  켜진 것들을 이어 붙여 보여 준다. */
  const blk = slotBlock(c.blocks, c.id);
  /** ★줄은 **최신이 왼쪽**이다 (사용자 지시 2026-08-14, 싱글 히스토리 줄과 같은 규칙).
   *  방금 나온 것을 찾아 눈이 끝까지 갈 이유가 없다. 대기 칸도 같은 규칙이라
   *  **새로 넣은 큐가 맨 왼쪽**이고, 지금 만드는 중인 것은 결과 바로 옆에 선다.
   *  ★★결과의 자리는 **`ts` 가 정한다** (`newestFirst`) — 도착한 차례를 뒤집어 쓰면
   *    경로에 따라 순서가 갈린다 (사용자 지적 2026-08-19). 대기 칸은 우리가 넣은 차례가
   *    곧 만들 차례라 그대로 뒤집는다. */
  const takes = [...p.takes(c)].sort(newestFirst);
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
            id={c.id}
            name={c.name}
            editing={p.editingName === c.id}
            onEditing={(v) => p.onEditName(c.id, v)}
            onRename={(v) => patchCell({ name: v })}
            onTab={(dir) => p.onStepField(c.id, dir, "name")}
          />
          {/* ★그림 수를 적지 않는다 (사용자 지시 2026-08-19) — 오른쪽에 그 그림들이 그대로
              늘어서 있어서 세어 줄 이유가 없다 */}
          <button
            data-scene-lock={c.id}
            onClick={(e) => {
              e.stopPropagation();
              patchCell({ locked: !c.locked });
            }}
            data-tip={t("slots.lock")}
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
            data-tip={t("slots.duplicate")}
            style={iconBtn}
          >
            {Icon.duplicate}
          </button>
          {!p.only && (
            <button
              data-scene-remove={c.id}
              /* ★★그림이 든 씬은 **묻고 지운다** (사용자 지시 2026-08-19). 씬을 지워도 파일은
                 남지만, 그 그림들이 화면에서 통째로 사라지는 것은 같다 (묶는 키가 `cell_id` 다). */
              onClick={(e) => {
                e.stopPropagation();
                const n = takes.length;
                if (!n) return p.onPatch({ cells: p.card.cells.filter((x) => x.id !== c.id) });
                void (async () => {
                  if (
                    await ask({
                      title: t("scenes.removeConfirm", { name: c.name, n }),
                      body: t("scenes.removeConfirmBody"),
                      ok: t("common.delete"),
                      cancel: t("common.cancel"),
                    })
                  )
                    p.onPatch({ cells: p.card.cells.filter((x) => x.id !== c.id) });
                })();
              }}
              data-tip={t("slots.remove")}
              style={iconBtn}
            >
              {Icon.close12}
            </button>
          )}
        </span>
        {/* ★★프롬프트 쪽과 **같은 블록**이다 (사용자 결정 2026-08-20) — 칸 하나가 블록
            하나라(`slotBlock`) 머리는 안 그리고 칩만 남긴다. 칩 클릭으로 글 상자, 칩 휠로
            가중치, 칩 끌기로 자리 옮기기, 서랍에서 끌어다 놓으면 태그가 뒤에 붙는다.
            ★★**접혀 있어도 이것 하나다.** 다른 것은 **높이뿐**이다(`clamp`) — 넘치는 만큼
              자르고 `+n` 으로 알린다. 한 판 앞에서는 접힌 줄에 모양만 같은 칩을 따로 그렸는데,
              끌 수도 서랍에서 받지도 못하는 **다른 물건**이었다 (사용자 지적 2026-08-20:
              *"그냥 비슷하게 생긴건 최악임"*). 통일은 생김새가 아니라 **조작**이다.
            ★글 상자가 열리면 줄이 **스스로 자리를 낸다**(`onOpen`) — 잘린 채로 치면 안 보인다. */}
        <div
          /* ★★여기서 클릭을 멈춘다 — 안 멈추면 줄 머리의 「눌러 접기」가 뒤이어 돈다.
             ★대신 줄이 하던 **「씬을 고르면 맨 앞 장도 고른다」를 여기서 직접 한다.**
               안 하면 프롬프트 자리를 눌러 씬을 골랐을 때 큰 자리가 빈 채다
               (조작 테스트에서 잡았다 2026-08-19). */
          onClick={(e) => {
            e.stopPropagation();
            p.onFocus({ cell: c.id, file: p.focus.cell === c.id ? p.focus.file : null });
          }}
          style={{ display: "contents" }}
        >
          <BlockList
            /* ★★블록을 고치는 자리는 앱에 **이것 하나**다 (사용자 지적 2026-08-20:
               *"동일한 컴포넌트를 쓰는게 아니고 복제해서 만드니까 불일치가 계속 생김"*).
               씬 칸은 그 목록의 `single` 모드일 뿐이라, 칩 끌기·서랍 드롭·중복 표시가
               프롬프트 쪽과 **같은 배선**을 지난다. */
            single
            id={c.id}
            blocks={[blk]}
            onChange={(b) => patchCell({ blocks: slotBlocksOf(b[0] ?? blk) })}
            libZone={`scene-${c.id}`}
            clamp={!expanded}
            bg={on ? "var(--accent-bg)" : "var(--surface)"}
            autoEdit={p.typingId === c.id}
            /* 칩을 눌러 글 상자가 열렸다 — 그 자리를 내준다 (`clamp` 해제) */
            onOpen={() => p.onExpand(c.id)}
            // `+n` 은 치려는 게 아니라 **다 보려는** 것이다 — 펴기만 한다
            onMore={() => p.onExpand(c.id)}
            // ★`Enter` 로 끝내면 도로 접는다 · `Shift+Enter`·`Tab` 은 **옆 씬**으로
            onDone={() => p.onExpand(null)}
            onNext={() => p.onStepField(c.id, 1, "text")}
            onTab={(dir) => p.onStepField(c.id, dir, "text")}
          />
        </div>
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
              // ★★**생성물을 끌면 카드 그림(커버)이 된다** — 덱·손패·프롬프트 배너가 받는다
              //   (`dir: "image"` 드롭존들). 싱글 캔버스를 걷을 때 이 출발점이 함께 사라져
              //   드래그가 통째로 죽어 있었다 (사용자 지적 2026-08-18).
              // ★클릭(선택)은 `onClick` 이 아니라 **`onTap`** 으로 받는다 — pointerdown 의
              //   `preventDefault` 가 브라우저의 호환 click 을 삼킨다 (CLAUDE.md 「잊기 쉬운 것」).
              // ★미저장은 **못 끈다.** 파일이 없어서 커버로 쓸 수 없다 (받는 쪽이 경로를 쓴다).
              onPointerDown={(e) => {
                // ★★별표는 **여기서 비켜 간다** (사용자 지적 2026-08-19). 끌기가 pointerdown 에서
                //   기본 동작을 막아 **호환 click 을 삼키는** 바람에 별표의 onClick 이 통째로
                //   안 왔다 (CLAUDE.md 「잊기 쉬운 것」의 그 자리다). 블록 머리의 단추들이
                //   같은 이유로 한 번 죽었던 것과 같은 함정이다.
                if ((e.target as HTMLElement).closest("[data-take-star]")) return;
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
                /* ★★고른 장이 **한눈에** 보여야 한다 (사용자 지적 2026-08-19: 2px 테두리로는
                   어느 것을 보고 있는지 안 보였다). 테두리를 굵히고, 바깥에 어두운 링을
                   둘러 밝은 그림에서도 테두리가 묻히지 않게 한다. 자리는 안 밀린다
                   (`box-shadow` 는 레이아웃을 안 건드린다). */
                border: `2px solid ${sel ? "var(--warn)" : cur ? "var(--accent)" : "transparent"}`,
                boxShadow: cur
                  ? "0 0 0 2px var(--accent), 0 0 0 4px rgba(0,0,0,0.55)"
                  : sel
                    ? "0 0 0 2px var(--warn), 0 0 0 4px rgba(0,0,0,0.55)"
                    : undefined,
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
  id,
  name,
  editing,
  onEditing,
  onRename,
  onTab,
}: {
  /** 조작 테스트가 잡는 손잡이 */
  id: string;
  name: string;
  editing: boolean;
  onEditing: (v: boolean) => void;
  onRename: (v: string) => void;
  onTab: (dir: 1 | -1) => void;
}) {
  const t = useI18n((s) => s.t);
  /** ★규칙은 **앱에 하나**다 (`useRename`): 단추를 다시 누르면 저장하고 끝난다.
   *  ★다만 여닫는 상태는 **줄이 들고 있다** — `Tab` 으로 옆 씬의 이름 칸으로 건너뛰려면
   *    누가 열려 있는지를 한 곳이 알아야 한다.
   *  ★★연필 단추를 **여기서** 단다. 줄 쪽에 따로 두면 그 단추가 훅을 못 봐서 「다시 누르면
   *    끝」을 흉내 내게 되고, 그게 곧 자리마다 다른 동작이 된다 (사용자 지적 2026-08-20). */
  const rename = useRename(name, onRename, { editing, setEditing: onEditing });

  return (
    <>
      {rename.editing ? (
        <input
          data-scene-name={id}
          {...rename.inputProps}
          onKeyDown={(e) => {
            // ★고친 값을 **먼저 넣고** 옮긴다 (v2 index.html:11809-11820 과 같은 이동).
            //   뒤따라 오는 blur 는 이미 연 다음 칸을 닫지 않는다 (`onEditName` 주석)
            if (e.key === "Tab") {
              e.preventDefault();
              rename.commit();
              onTab(e.shiftKey ? -1 : 1);
              return;
            }
            rename.inputProps.onKeyDown(e);
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
      ) : (
        <span
          onDoubleClick={(e) => {
            e.stopPropagation();
            rename.toggle();
          }}
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
      )}
      {/* ★★단추 차례는 앱 전체에서 하나다: **이름변경 · 온오프(잠금) · 삭제** */}
      <button data-scene-rename={id} {...rename.btnProps} data-tip={t("cards.rename")} style={iconBtn}>
        {Icon.pencil}
      </button>
    </>
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
