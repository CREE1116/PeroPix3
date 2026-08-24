import { create } from "zustand";
import { api, backendUrl } from "../lib/backend";
import { cliEvent } from "./llm";
import { cliCursor, takeCliSeq } from "../lib/cliCursor";
import { playDoneSound } from "../lib/notifySound";
import { notifyByTitle } from "../lib/titleNotify";
import { useCards } from "./cards";
import { useFiles } from "./files";
import { useSub } from "./sub";
import { useAnlasMeter } from "./anlasMeter";
import { localTs } from "../lib/takes";
import type { Block } from "../lib/blocks";
import { useSceneFocus } from "./sceneFocus";
import { allCells, useWs } from "./workspace";
import { useUi } from "./ui";
import { toast } from "./toast";
import { t } from "../i18n";

/** 생성 큐 클라이언트 — v2 `index.html:15978-16369` 이식.
 *
 *  ★여기 든 방어는 전부 **실사용 사고를 겪고** 들어간 것이다 (docs/v2-port-plan.md):
 *
 *   1. **client_id 를 localStorage 에 보관**한다. 안 하면 재연결이 새 클라이언트가 되어
 *      서버가 "누가 어디까지 받았는지"를 모른다.
 *   2. **seq 리셋 감지** — 백엔드가 재시작하면 서버 seq 가 1부터 다시 시작한다. 우리가 본
 *      값보다 되돌아갔으면 렌더 집합을 비워야 한다. 안 그러면 새 이미지(seq 1..)가
 *      "이미 본 것"으로 오인되어 **전부 건너뛰어진다.**
 *   3. **중복 렌더 방지** — sync 복원과 라이브 브로드캐스트가 겹치면 같은 seq 가 두 번 온다.
 *      실제로 렌더한 집합으로 판정하므로, 브로드캐스트가 앞서도 복원분을 안 건너뛴다.
 */

export type QueueProgress = { completed: number; total: number; queue_length: number };

/** 큐가 지금 어느 상태인가 — v2 `statusText` 이식 (`index.html:16119-16127, 16467-16493`).
 *
 *  ★v2 는 `준비 / 3-8 / 완료! / 실패 / 완료 (일부 실패)` 다섯을 한 줄에 썼다. 우리는
 *    「큐 줄은 돌고 있을 때만 뜬다」(CLAUDE.md, 사용자 지시 2026-08-04)라서 `idle` 은
 *    **줄이 없는 것**으로 나타낸다 — 「준비」라는 글자를 따로 두지 않는다.
 *  ★끝난 상태(`done`·`failed`·`partial`)는 2초 뒤 `idle` 로 돌아간다 (v2 `resetTimer`). */
export type QueuePhase = "idle" | "running" | "done" | "failed" | "partial";

/** ★큐에 넣은 **아직 안 나온 장**. 페로픽스파이는 큐에 넣는 순간 결과 객체를 만들어
 *  `queued` 카드를 띄운다 (`batch.ts start`) — 눌렀는지 알 수 있고 어디에 생길지도 보인다.
 *  우리 레코드는 **완료된 파일**뿐이라 이 목록이 그 자리를 대신한다.
 *  그림이 도착하면 같은 (set_id, cell_id) 의 대기 하나를 지운다. */
export type Pending = { id: string; setId: string | null; cellId: string | null };

type S = {
  connected: boolean;
  progress: QueueProgress;
  /** 상태 문구용 — 진행률만으로는 「실패」와 「완료」를 가를 수 없다 */
  phase: QueuePhase;
  pending: Pending[];
  /** 이미 화면에 반영한 seq — 중복 렌더 방지의 근거 */
  seen: Set<number>;
  lastSeq: number;
  error: string;

  connect: () => Promise<void>;
  enqueue: (base: Record<string, unknown>, items?: Record<string, unknown>[], count?: number) => Promise<void>;
  /** 이 탭의 대기 목록 (슬롯 순서대로). 맨 앞이 **지금 만드는 중**이다 */
  pendingOf: (setId: string) => Pending[];
  /** ★취소는 **하나**다 — 지금 나간 장만 남기고 나머지를 전부 뺀다 (사용자 결정 2026-08-18) */
  cancelAll: () => Promise<void>;
};

const KEY = "peropix.ws_client_id";
const EMPTY: QueueProgress = { completed: 0, total: 0, queue_length: 0 };

let sock: WebSocket | null = null;
let seqId = 1;
/** 직전에 돌고 있었나 — 멈추는 **그 순간**만 알린다 */
let wasBusy = false;
let retry = 0;
/** 이번 배치의 성공·실패 장 수 (v2 `batchImageCount`·`batchErrorCount`). 끝날 때 문구를 가른다 */
let batchOk = 0;
let batchErr = 0;
/** 끝난 문구를 잠시 보여 준 뒤 `idle` 로 (v2 `resetTimer`, 2초) */
let phaseTimer: ReturnType<typeof setTimeout> | null = null;
/** 마지막 수신 시각 — 하트비트의 근거 (`performance.now()` 라 시계 변경과 무관하다) */
let lastActivity = 0;
let beat: ReturnType<typeof setInterval> | null = null;

/** ★활동 기반 WS 하트비트 — v2 `index.html:16217-16234` 이식.
 *
 *  25초 동안 아무것도 못 받으면 `ping` 을 던져 보고, 50초까지 감감무소식이면 죽은 연결로
 *  보고 닫는다 (`onclose` 가 재연결을 건다). **소켓이 조용히 죽으면 `onclose` 가 아예
 *  안 와서** 영영 다시 안 붙는다 — 그때는 생성이 끝나도 화면에 아무것도 안 뜬다.
 *  서버는 `ping` 을 받아 `pong` 을 돌려줄 준비가 이미 돼 있다 (`backend/server.py`).
 *
 *  ★프로브는 **`ping` 만** 보낸다. `sync` 를 주기로 보내면 이미 그린 그림이 다시 흘러와
 *    라이브 브로드캐스트와 겹칠 때 같은 카드가 두 번 그려진다. 누락분 복원은 재연결
 *    시점의 `sync` 하나에만 맡긴다. */
function startHeartbeat() {
  if (beat) return;
  beat = setInterval(() => {
    if (!sock || sock.readyState !== WebSocket.OPEN) return;
    const idle = performance.now() - lastActivity;
    if (idle < 25000) return; // 최근 수신 있음
    if (idle > 50000) {
      try {
        sock.close();
      } catch {
        /* 이미 닫힌 소켓 */
      }
      return;
    }
    try {
      sock.send(JSON.stringify({ type: "ping" }));
    } catch {
      /* 보내지 못하면 다음 회차에 50초를 넘겨 닫힌다 */
    }
  }, 20000);
}

/** 지금 붙는 중인가 — `connect()` 가 `await` 를 만나기 **전에** 세우는 표식.
 *  ★소켓이 생기기 전 구간을 이것이 지킨다 (`connect` 의 ★주) */
let connecting = false;

export const useQueue = create<S>((set, get) => ({
  connected: false,
  progress: EMPTY,
  phase: "idle",
  pending: [],
  seen: new Set(),
  lastSeq: 0,
  error: "",

  async connect() {
    /* ★★**자리를 먼저 잡고 기다린다** (사용자 지적 2026-08-20: 워크스페이스를 만들다
       `Failed to fetch`). 예전에는 아래 `await` 를 건너 **소켓을 만든 뒤에야** `sock` 이
       채워졌다. 그 사이에 `connect()` 가 한 번 더 불리면(개발 모드의 StrictMode 이중 마운트가
       그렇다) **둘 다 문을 통과해 소켓이 두 개** 생긴다.
       서버는 같은 `clientId` 로 새로 붙으면 옛 소켓을 닫으므로(`server.py` 의 `/ws`),
       닫힌 쪽이 다시 붙고 → 그게 다른 쪽을 닫고 → …가 **끝없이 돈다.**
       실측(2026-08-20 로그): 90분 동안 재연결 **58,120번**, 오류 로그 7.5MB.
       그 소음 속에서 평범한 요청이 간헐적으로 거절돼 `Failed to fetch` 로 보였다. */
    if (connecting) return;
    if (sock && (sock.readyState === WebSocket.OPEN || sock.readyState === WebSocket.CONNECTING)) return;
    connecting = true;
    const base = await backendUrl().catch(() => {
      connecting = false;
      return "";
    });
    if (!base) return;
    const id = localStorage.getItem(KEY) || "";
    const url = base.replace(/^http/, "ws") + "/ws" + (id ? `?clientId=${encodeURIComponent(id)}` : "");

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      // ★표식을 반드시 내린다 — 여기서 새면 앱이 사는 동안 **다시는 안 붙는다**
      connecting = false;
      return;
    }
    sock = ws;
    connecting = false;

    ws.onopen = () => {
      retry = 0;
      // ★새 연결을 곧바로 「유휴」로 오판하지 않게 여기서 한 번 찍는다
      lastActivity = performance.now();
      startHeartbeat();
      set({ connected: true, error: "" });
      // 붙자마자 **놓친 것부터 달라고 한다** (새로고침·끊김 복원)
      ws.send(JSON.stringify({ type: "sync", last_seq: get().lastSeq, ...cliCursor() }));
    };
    ws.onclose = () => {
      // ★**지금 것이 아니면 아무것도 안 한다** — 옛 소켓이 닫힌 것으로 「끊겼다」를 켜거나
      //   재연결을 걸면, 살아 있는 연결을 두고 다시 붙는 고리가 생긴다 (위 ★주)
      if (sock !== ws) return;
      sock = null;
      set({ connected: false });
      // 지수 백오프 재연결 (최대 10초)
      retry = Math.min(retry + 1, 10);
      setTimeout(() => void get().connect(), Math.min(500 * retry, 10000));
    };
    ws.onmessage = (e) => {
      // 어떤 수신이든 **연결 생존 신호**로 본다 (진행률·브로드캐스트·pong 전부)
      lastActivity = performance.now();
      handle(JSON.parse(e.data), set, get);
    };
  },

  async enqueue(base, items = [], count = 1) {
    // ★보내기 **전에** 자리를 잡는다 — 누른 즉시 카드가 떠야 눌린 것을 안다
    const setId = (base.set_id as string) ?? null;
    const add: Pending[] = [];
    const units = items.length ? items : [{}];
    // ★대기 칸의 순서는 **서버가 만드는 순서와 같아야 한다** (`server.py` 의 큐 루프).
    //   서버가 한 바퀴씩 도는데 여기서 씬별로 몰아 넣으면, "지금 만드는 중"이 엉뚱한 줄에 뜬다.
    for (let i = 0; i < Math.max(1, count); i++) {
      for (const it of units) {
        // ★칸은 **항목에 없으면 base 에서** 가져온다. 강화처럼 항목이 파일만 들고 오는
        //   경우가 있는데, 그때 null 로 두면 대기 칸이 어느 씬에도 안 뜬다
        //   (사용자 지적 2026-08-14: 눌러도 아무 반응이 없어 보였다)
        add.push({
          id: `p${seqId++}`,
          setId,
          cellId: ((it.cell_id as string) ?? (base.cell_id as string)) ?? null,
        });
      }
    }
    set({ pending: [...get().pending, ...add] });
    try {
      await api("/api/generate/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base, items, count }),
      });
    } catch (e) {
      // 보내지 못했으면 잡아 둔 자리를 도로 뺀다
      const ids = new Set(add.map((x) => x.id));
      set({ pending: get().pending.filter((x) => !ids.has(x.id)) });
      // ★재려고 적어 둔 기준선도 버린다. 안 버리면 **다음 배치**가 이 기준선으로 재진다
      useAnlasMeter.getState().disarm();
      throw e;
    }
  },
  pendingOf: (setId) => get().pending.filter((p) => p.setId === setId),

  /** ★★**대기 칸을 여기서 비우지 않는다** (감사 D5). 예전 `clear()` 는 부르자마자
   *  `pending` 을 통째로 비웠는데, 서버는 이미 나간 한 장을 끝까지 받아 낸다 —
   *  **카드는 사라지는데 그림은 계속 나오는** 상태가 됐다.
   *  실제로 멈춘 것이 몇 장인지는 서버만 알고, `queue_cancelled` 가 그것을 실어 온다. */
  async cancelAll() {
    await api("/api/cancel-queue", { method: "POST" });
  },
}));

/** 큐가 낸 실패를 **사람 말로** (v2 `formatGenerationError`, `index.html:16245`).
 *  ★그대로 던지면 `HTTP 402` 같은 것만 뜬다 — 무엇을 해야 하는지가 안 보인다. */
function queueErrorText(raw: string): string {
  if (/402/.test(raw)) return t("queue.err402");
  if (/401/.test(raw)) return t("queue.err401");
  if (/429/.test(raw)) return t("queue.err429");
  return t("queue.errOther", { m: raw.slice(0, 120) });
}

type Setter = (p: Partial<S> | ((s: S) => Partial<S>)) => void;

/** ★★조수가 고친 자리는 **사람의 `Ctrl+Z` 에서 뺀다** (사용자 결정 2026-08-24:
 *    *"LLM 이 수정한 걸 Ctrl+Z 로 되돌리면 혼란스러울 것 같다. Ctrl+Z 는 유저 본인이
 *    수정한 것만."*). 담아 둔 되돌리기는 통째 복원이라, 그대로 두면 한 번에 조수의 편집까지
 *    지운다. 조수가 한 일은 조수에게 말해서 되돌린다 (`undo_change`). */
async function dropHumanUndo(zone: string): Promise<void> {
  const { dropUndoZone } = await import("../lib/undo");
  dropUndoZone(zone);
}

/** AI 가 시킬 수 있는 **행동 표** — 여기 없는 이름은 안 한다. */
async function runAction(action: string, args: Record<string, any>): Promise<Record<string, unknown>> {
  try {
    if (action === "generate") {
      const { useGen } = await import("./gen");
      const ws = useWs.getState();
      const count = Math.max(1, Math.min(50, Number(args.count) || 1));
      // ★다른 워크스페이스·다른 탭도 넣을 수 있다 (사용자 지시 2026-08-08).
      //   ★화면은 안 옮긴다 — 그쪽 spec 을 읽어 컴파일해서 큐에만 넣는다 (genRemote.ts)
      const target = String(args.workspace ?? "").trim();
      /* ★★도구가 받는 이름은 **`set`** 이다 (`backend/agent.py` 의 generate 스키마).
         여기서 `args.tab` 만 읽고 있어서, 조수가 스키마대로 `set` 을 보내면 **조용히 버려지고**
         활성 세트에 생성됐다 — 오류도 안 나고 Anlas 는 엉뚱한 곳에 나간다 (적대 검토 2026-08-24).
         ★옛 이름 `tab` 도 받아 준다: 입력은 너그럽게, 내보내는 이름은 하나로 (`docs/terms.md`). */
      const wantSet = String(args.set ?? args.tab ?? "").trim();
      if ((target && target !== ws.current) || wantSet) {
        const { queueToWorkspace } = await import("./genRemote");
        return (await queueToWorkspace(target || ws.current, count, wantSet || undefined)) as Record<
          string,
          unknown
        >;
      }
      const tab = ws.activeSet();
      if (!tab) return { error: "열려 있는 탭이 없습니다." };
      // ★★**`count` 는 「몇 바퀴」다** (싱글 폐기 2026-08-11 이후로는 그것 하나뿐이다).
      //   예전에는 싱글 탭이면 `queueSingle(count)` 로 **count 장**이었는데, 탭이 전부
      //   씬 탭이 되면서 그 갈래가 도달 불가가 됐다. 한 바퀴 = 잠기지 않은 씬 전부이고,
      //   씬 하나짜리 탭(새 워크스페이스의 기본)에서는 옛 싱글과 결과가 같다.
      //   ★한 바퀴가 만드는 장 수는 여기가 아니라 화면의 `슬롯당`(`useUi.perSlot`)이 정한다 —
      //     `generateAll` 이 그 값으로 `rounds` 를 편다. 그래서 아래 `queued` 도 그것을 곱한다.
      if (tab.kind !== "set")
        return { error: `'${tab.name}' 탭은 씬 탭이 아니라 생성에 쓸 수 없습니다.` };
      for (let i = 0; i < count; i++) await useGen.getState().generateAll();
      const live = allCells(tab).filter((c) => !c.locked).length;
      /* ★돌려주는 열쇠는 `set` 이다 — 그림이 쌓이는 자리는 **세트**다.
         (도구 인자의 `tab` 은 **탭 이름**이라 다른 것이다 — `shared/terms.json`) */
      return { ok: true, set: tab.name, queued: live * count * useUi.getState().perSlot };
    }
    // ★물음은 **답이 올 때까지** 안 끝난다 — 도구가 기다리고 있다
    if (action === "ask_user") {
      const { useLlm } = await import("./llm");
      const options = (args.options ?? []).map((o: Record<string, string>) => ({
        label: String(o.label ?? ""),
        description: o.description ? String(o.description) : undefined,
      }));
      if (!options.length) return { error: "선택지가 없습니다." };
      const multi = !!args.multi;
      return await new Promise((resolve) => {
        useLlm.setState({
          ask: {
            question: String(args.question ?? ""),
            header: args.header ? String(args.header) : undefined,
            options,
            multi,
            answer: (labels: string[]) => {
              useLlm.setState({ ask: null });
              // ★모양을 갈라 준다 — 하나 고른 것과 여럿 고른 것은 다른 답이다
              resolve(multi ? { answers: labels } : { answer: labels[0] ?? "" });
            },
          },
        });
      });
    }

    /* ★★**보고 있는 것을 고친다** — 덱의 카드가 아니라 지금 화면의 프롬프트다.
         사용자 지시 2026-08-24: *"「키키 의상을 바꿔 줘」는 보통 카드가 아니라 지금 씬에
         올려둔 캐릭터를 바꿔 달라는 것이다. 저장은 본인이 따로 한다."*
       ★고친 자리(`at`)와 **고치기 전 값**(`before`)을 함께 돌려준다 — 채팅 줄이 그 자리를
         열고(`lib/agentAt`), 조수가 되돌릴 수 있다(`backend/agentlog.py`). */
    if (action === "edit_current_prompt") {
      const { usePrompt } = await import("./prompt");
      const { makeBlock, parseSegs } = await import("../lib/blocks");
      /* ★대상 세트를 **먼저 연다.** 프롬프트 편집기는 지금 열린 세트의 **사본**이라
         (`workspace.setActiveTab` 이 담고 꺼낸다), 다른 세트를 몰래 고칠 길이 없다.
         여는 편이 옳기도 하다 — 사용자가 바뀐 자리를 그 자리에서 본다. */
      const want = String(args.set ?? "").trim();
      if (want) {
        const hit = useWs.getState().spec?.sets.find((x) => x.id === want || x.name === want);
        if (!hit) return { error: `그런 세트가 없습니다: ${want}` };
        /* ★세트는 **탭에 속한다**(`tabId`). 다른 탭의 세트를 열면서 탭을 안 옮기면
           화면의 윗줄과 아랫줄이 어긋난 채로 남는다 (`workspace.switchTab` 참조). */
        const owner = (hit as { tabId?: string }).tabId;
        if (owner && owner !== useWs.getState().spec?.activeTab) useWs.getState().switchTab(owner);
        useWs.getState().setActiveTab(hit.id);
      }
      const ws = useWs.getState();
      const spec = ws.spec;
      const set = spec?.sets.find((x) => x.id === spec?.activeSet);
      if (!set) return { error: "열려 있는 세트가 없습니다." };

      const area = String(args.area ?? "base");
      const label = String(args.label ?? "블록");
      const tags = parseSegs(String(args.tags ?? ""));
      /* ★**씬 칸**은 프롬프트 편집기가 아니라 세트 안에 산다 (`sets[].cards[].cells`).
         칸 하나에 블록도 하나뿐이라 (`slotBlocksOf`), 이름표 없이 태그만 갈아 끼운다. */
      const wantScene = String(args.scene ?? "").trim();
      if (wantScene) {
        const { slotBlocksOf, makeBlock: mk } = await import("../lib/blocks");
        const cards = (set as { cards?: { id: string; cells: { id: string; name: string; blocks?: Block[] }[] }[] }).cards ?? [];
        let found: { id: string; name: string; blocks?: Block[] } | null = null;
        const next = cards.map((k) => ({
          ...k,
          cells: k.cells.map((c) => {
            if (c.id !== wantScene && c.name !== wantScene) return c;
            found = c;
            const cur = c.blocks?.[0] ?? mk("", [], { open: true, tags: [] });
            return { ...c, blocks: slotBlocksOf({ ...cur, tags }) };
          }),
        }));
        if (!found) return { error: `그런 씬이 없습니다: ${wantScene}` };
        useWs.getState().patchSet(set.id, { cards: next } as never);
        dropHumanUndo(`scene-${(found as { id: string }).id}`);
        const did = `「${set.name}」 세트의 씬 「${(found as { name: string }).name}」을 고침`;
        return {
          ok: true, scene: (found as { name: string }).name, did,
          at: { kind: "prompt" as const, workspace: ws.current ?? undefined,
                tab: spec?.activeTab, set: set.id, area: "scene",
                scene: (found as { id: string }).id, label: (found as { name: string }).name },
          before: { set: set.id, scene: (found as { id: string }).id, blocks: (found as { blocks?: Block[] }).blocks ?? [] },
          after: { set: set.id, scene: (found as { id: string }).id },
        };
      }
      const replace = String(args.mode ?? "add") === "replace";
      const apply = (cur: Block[]): Block[] => {
        const at = cur.findIndex((b) => b.label === label);
        if (replace && at >= 0) return cur.map((b, i) => (i === at ? { ...b, tags } : b));
        return [...cur, makeBlock(label, [], { open: true, tags })];
      };
      const at = {
        kind: "prompt" as const,
        workspace: ws.current ?? undefined,
        tab: spec?.activeTab,
        set: set.id,
        area,
        label,
      };
      const verb = replace ? "갈아 끼움" : "더함";

      if (area === "base" || area === "baseUc") {
        const before = usePrompt.getState()[area];
        usePrompt.getState().update(area, apply);
        dropHumanUndo(area === "base" ? "base-p" : "base-uc");
        const what = area === "base" ? "베이스 프롬프트" : "베이스 UC";
        return {
          ok: true, area, label, at,
          did: `「${set.name}」 세트의 ${what}에 「${label}」을 ${verb}`,
          before: { set: set.id, area, blocks: before },
          after: { set: set.id, area, blocks: usePrompt.getState()[area] },
        };
      }

      const [name, part] = area.split(":");
      const field = part === "uc" ? ("uc" as const) : ("prompt" as const);
      let ch = usePrompt.getState().chars.find((c) => c.id === name || c.name === name);
      /* ★**없으면 만든다** (사용자 지시 2026-08-24). 예전에는 「그런 자리가 없습니다」로
         끝나서, 조수가 인물을 더하려면 사람이 먼저 빈 칸을 만들어 줘야 했다.
         ★만든 것은 `created` 로 남긴다 — 되돌릴 때는 블록이 아니라 **그 칸을 지운다.** */
      let created = "";
      if (!ch) {
        created = usePrompt.getState().addChar({ name });
        ch = usePrompt.getState().chars.find((c) => c.id === created);
        if (!ch) return { error: `자리를 만들지 못했습니다: ${area}` };
      }
      const before = ch[field];
      usePrompt.getState().updateChar(ch.id, field, apply);
      dropHumanUndo(`${ch.id}-${field === "uc" ? "uc" : "p"}`);
      const now = usePrompt.getState().chars.find((c) => c.id === ch!.id);
      const what = field === "uc" ? `${ch.name} UC` : ch.name;
      return {
        ok: true, area: ch.name, label, at: { ...at, area: ch.name },
        did: created
          ? `「${set.name}」 세트에 캐릭터 「${ch.name}」을 만들고 「${label}」을 ${verb}`
          : `「${set.name}」 세트의 ${what}에 「${label}」을 ${verb}`,
        before: { set: set.id, area: ch.id, part: field, blocks: before, created },
        after: { set: set.id, area: ch.id, part: field, blocks: now?.[field] ?? [] },
      };
    }

    /* ★★**탭·세트·씬 만들기는 앱이 한다** (사용자 지시 2026-08-24: *"앱을 켠 상태로도
         쓸 수 있어야 할 것 같은데"*).

       워크스페이스 설정(`workspace.json`)의 주인은 **화면**이다 — 앱이 통째로 들고 있다가
       통째로 저장하므로, 백엔드가 파일에 끼어들어 쓰면 다음 저장에 덮인다. 그래서
       `edit_current_prompt` 와 같은 길을 쓴다: 조수가 시키고, **앱이 자기 창구로** 만든다.
       그러면 화면도 그 자리에서 따라온다.
       ★새 창구를 만들지 않는다 — 사람이 `+` 를 눌렀을 때와 **같은 함수**를 부른다
         (`addTab`·`addSet`·`addSlot`). 두 벌이 되면 이름 겹침 처리·번호 발급이 갈린다. */
    if (action === "create_tab") {
      const name = String(args.name ?? "").trim();
      useWs.getState().addTab(name || undefined);
      const spec = useWs.getState().spec;
      // ★`addTab` 은 만들고 **그리로 옮긴다** — 그래서 지금 활성 탭이 방금 만든 것이다
      const made = (spec?.tabs ?? []).find((c) => c.id === spec?.activeTab);
      if (!made) return { error: "탭을 만들지 못했습니다." };
      return {
        ok: true, tab: made.name, tab_id: made.id,
        did: `탭 「${made.name}」 을 만듦`,
        at: { kind: "prompt" as const, workspace: useWs.getState().current ?? undefined, tab: made.id },
      };
    }

    if (action === "create_set") {
      const ws2 = useWs.getState();
      const before = new Set((ws2.spec?.sets ?? []).map((x) => x.id));
      // ★씬을 안 주면 **빈 세트**다 (사람이 `+` 로 만들 때와 같다). 이름을 주면 그 씬 하나로 연다
      const scenes = (args.scenes as string[] | undefined)?.map((x) => String(x)) ?? [];
      ws2.addSet(String(args.name ?? "").trim() || t("set.newSet"), scenes);
      const spec = useWs.getState().spec;
      const made = (spec?.sets ?? []).find((x) => !before.has(x.id));
      if (!made) return { error: "세트를 만들지 못했습니다." };
      return {
        ok: true, set: made.name, set_id: made.id,
        did: `세트 「${made.name}」 을 만듦`,
        at: { kind: "prompt" as const, workspace: useWs.getState().current ?? undefined,
              tab: spec?.activeTab, set: made.id },
      };
    }

    if (action === "create_scene") {
      const ws2 = useWs.getState();
      const spec = ws2.spec;
      const want = String(args.set ?? "").trim();
      const set = want
        ? spec?.sets.find((x) => x.id === want || x.name === want)
        : spec?.sets.find((x) => x.id === spec?.activeSet);
      if (!set || set.kind !== "set") return { error: "세트를 찾지 못했습니다." };
      /* ★씬은 **카드 안**에 산다. 카드가 하나도 없으면 씬을 놓을 자리가 없으므로 먼저 만든다
         (씬 줄의 「씬 세트 만들기」와 같은 길이다). */
      const name = String(args.name ?? "").trim();
      const had = new Set(allCells(set).map((c) => c.id));
      if (!set.cards.length) ws2.addCard(set.id, name ? { cells: [{ id: "", name, blocks: [] }] } : {});
      else ws2.addSlot(set.id, name ? { name } : {});
      const now = useWs.getState().spec?.sets.find((x) => x.id === set.id);
      const made = now?.kind === "set" ? allCells(now).find((c) => !had.has(c.id)) : undefined;
      if (!made) return { error: "씬을 만들지 못했습니다." };
      return {
        ok: true, scene: made.name, scene_id: made.id, set: set.name, set_id: set.id,
        did: `「${set.name}」 세트에 씬 「${made.name}」 을 만듦`,
        at: { kind: "prompt" as const, workspace: useWs.getState().current ?? undefined,
              tab: useWs.getState().spec?.activeTab, set: set.id, scene: made.id, label: made.name },
      };
    }

    /* 되돌리기 — ★조수 전용 통로다. 사람의 `Ctrl+Z` 와 섞지 않는다 (`lib/undo.ts`).
       ★도구 표에 없다 (`backend/agent.py` `_table`) — LLM 이 직접 부르는 것이 아니라
         `undo_change` 가 이력의 `before` 를 그대로 실어 부른다. */
    if (action === "restore_prompt") {
      const { usePrompt } = await import("./prompt");
      const setId = String(args.set ?? "");
      const hit = useWs.getState().spec?.sets.find((x) => x.id === setId);
      if (!hit) return { error: "그 세트가 이미 없습니다." };
      useWs.getState().setActiveTab(hit.id);
      const area = String(args.area ?? "base");
      const blocks = (args.blocks ?? []) as Block[];
      if (args.scene) {
        const cards = (hit as { cards?: { cells: { id: string }[] }[] }).cards ?? [];
        useWs.getState().patchSet(hit.id, {
          cards: cards.map((k) => ({
            ...k,
            cells: k.cells.map((c) => (c.id === args.scene ? { ...c, blocks } : c)),
          })),
        } as never);
        return { ok: true };
      }
      if (args.created) {
        usePrompt.getState().removeChar(String(args.created));
        return { ok: true };
      }
      if (area === "base" || area === "baseUc") {
        usePrompt.getState().update(area, () => blocks);
        return { ok: true };
      }
      const ch = usePrompt.getState().chars.find((c) => c.id === area || c.name === area);
      if (!ch) return { error: "그 캐릭터 자리가 이미 없습니다." };
      usePrompt.getState().updateChar(ch.id, args.part === "uc" ? "uc" : "prompt", () => blocks);
      return { ok: true };
    }
    return { error: `모르는 행동: ${action}` };
  } catch (e) {
    return { error: String((e as Error).message ?? e) };
  }
}

function handle(m: Record<string, any>, set: Setter, get: () => S) {
  switch (m.type) {
    case "connected": {
      if (m.client_id) localStorage.setItem(KEY, m.client_id);
      applyStatus(m.status, set, get);
      break;
    }
    case "sync": {
      applyStatus(m.status, set, get);
      for (const im of m.images ?? []) render(im, set, get);
      // ★끊긴 사이 흘러간 CLI 줄 — **순서 그대로** 다시 태운다. 서버가 우리 턴 것만 보낸다
      for (const c of m.cli ?? []) takeCli(c);
      break;
    }
    // ★자동 저장을 껐을 때 — **디스크에 기록을 안 남기고** 메모리에만 담는다.
    //   ★그래도 **자리는 같다**: 씬 줄의 그 씬 칸에 「미저장」 칸으로 들어간다
    //     (v2 `index.html:12146` — 미저장도 저장된 것과 같은 슬롯 카드다).
    case "image_preview": {
      void import("./previews").then(({ usePreviews }) => usePreviews.getState().add(m));
      // ★대기 칸도 **똑같이** 지운다. 안 지우면 그림이 나왔는데 「생성 중」 칸이 배치가
      //   끝날 때까지 남는다 (`settleBatch` 가 마지막에야 비운다)
      consumePending(m, set, get);
      takeProgress(m.progress, set);
      batchOk++;
      break;
    }
    case "image":
      render(m, set, get);
      batchOk++;
      takeProgress(m.progress, set);
      break;
    case "queued":
    case "job_start":
      takeProgress(m.progress, set);
      break;
    case "job_done":
      takeProgress(m.progress, set);
      // ★생성이 끝났으면 **잔액을 다시 묻는다** (v2 `index.html:16429-16432`).
      //   안 물으면 화면의 Anlas 는 앱을 켠 순간 값에 영영 멈춰 있다
      void useSub.getState().load();
      // 대기 잡이 남아 있으면 아직 배치가 안 끝났다 (v2 도 `queue_length === 0` 으로 갈랐다)
      if ((m.progress?.queue_length ?? 0) === 0) settleBatch(false, set, get);
      break;
    case "job_cancelled":
      takeProgress(m.progress, set);
      // ★취소는 **끝난 문구를 안 남긴다** — v2 도 상태를 「준비」로 되돌리기만 했다
      if ((m.progress?.queue_length ?? 0) === 0) settleBatch(true, set, get);
      break;
    // ★취소 — **실제로 멈춘 것만** 걷어낸다 (감사 D5).
    //   `remaining` 은 아직 올 장 수다: 돌고 있었으면 지금 NAI 로 나간 한 장, 아니면 0.
    //   대기 칸은 서버가 만드는 순서 그대로 쌓이므로(`enqueue`), 남길 것은 **맨 앞** 것이다.
    case "queue_cancelled": {
      takeProgress(m.progress, set);
      const keep = Math.max(0, Number(m.remaining ?? 0));
      const pend = get().pending;
      if (pend.length > keep) set({ pending: pend.slice(0, keep) });
      // 남은 장이 없으면 여기서 배치가 끝난 것이다 — 돌고 있으면 그 장이 온 뒤
      // `job_cancelled` 가 마무리한다 (거기서도 같은 `settleBatch` 를 부른다)
      if (keep === 0) settleBatch(true, set, get);
      else {
        // 배치 회계만 되돌린다 (v2 `index.html:16542-16544`)
        batchOk = 0;
        batchErr = 0;
      }
      break;
    }
    // 하트비트 응답 — 받은 것 자체가 생존 신호라 따로 할 일이 없다
    case "pong":
      break;
    // ★AI 가 **데이터를 고쳤다** — 화면은 다시 읽는다. 사용자가 새로고침할 일이 없어야 한다
    case "data_changed":
      if (m.what === "cards") void useCards.getState().load();
      if (m.what === "files") void useFiles.getState().reload();
      break;

    // ★AI 가 시킨 **행동** — 이름 붙은 것만 한다 (도구 목록은 백엔드가 갖는다).
    //   생성은 프롬프트 조립·시드 규칙이 전부 화면에 있어서 여기서 해야 한다
    case "do": {
      void runAction(m.action, m.args ?? {}).then((result) =>
        sock?.send(JSON.stringify({ type: "done", id: m.id, result })),
      );
      break;
    }
    // 로컬 CLI 가 흘려보내는 것 — 채팅 스토어가 wire 조각으로 옮긴다
    case "cli":
      takeCli(m);
      break;
    case "image_error":
    case "job_error":
      // ★★큐 실패를 **토스트로 알린다** — 예전에는 `error` 에 담기만 하고 그것을 읽는
      //   화면이 하나도 없어서, 20장이 전부 실패해도 아무 일도 안 일어났다 (감사 2026-08-16).
      set({ error: String(m.error ?? "") });
      toast(queueErrorText(String(m.error ?? "")), "warn");
      batchErr++;
      takeProgress(m.progress, set);
      break;
  }
}

/** 브로드캐스트가 실어 온 진행률을 그대로 받는다.
 *  ★남은 것이 있으면 **돌고 있는 중**으로 표시해 둔다 — 멈추는 순간을 잡는 근거다. */
function takeProgress(p: QueueProgress | undefined, set: Setter) {
  if (!p) return;
  const running = p.total > p.completed || p.queue_length > 0;
  if (running) wasBusy = true;
  set({ progress: p, ...(running ? { phase: "running" as QueuePhase } : {}) });
}

/** 배치가 끝났다 — **브로드캐스트로 오는 끝**을 받는 자리.
 *
 *  ★예전에는 이 청소가 `applyStatus()` 안에만 있었는데 그 함수는 `connected`·`sync` 에서만
 *    돌아서, 취소·실패로 큐가 끝나면 **대기 카드가 유령으로 남고** 완료 알림도 안 울렸다
 *    (감사 A7). v2 는 `job_done`·`job_cancelled` 에서 각각 정리했다
 *    (`index.html:16460, 16483, 16504-16511`). */
function settleBatch(cancelled: boolean, set: Setter, get: () => S) {
  // ★큐가 다 비면 남은 대기는 **오지 않는다** (취소·실패). 자리를 계속 잡고 있으면 유령이 된다
  if (get().pending.length) set({ pending: [] });

  // 취소는 성패를 따지지 않는다 — 그냥 「준비」로 돌아간다
  const phase: QueuePhase = cancelled
    ? "idle"
    : batchErr > 0 && batchOk === 0
      ? "failed"
      : batchErr > 0
        ? "partial"
        : "done";
  const done = batchOk;
  batchOk = 0;
  batchErr = 0;
  set({ phase });

  // ★**실제로 청구된 Anlas 를 잰다** (`store/anlasMeter`). 잰다는 것은 잔액 차이다.
  //   ★온전히 끝난 배치에서만 잰다. 취소·실패·일부 실패는 몇 장이 실제로 나갔는지
  //     알 수 없어 숫자가 틀리게 나온다. 그때는 아무 말도 하지 않는다.
  if (phase === "done") void useAnlasMeter.getState().settle();
  else useAnlasMeter.getState().disarm();

  if (!cancelled) announceDone(done);

  if (phaseTimer) clearTimeout(phaseTimer);
  if (phase !== "idle") {
    // ★끝난 문구를 2초만 보여 준다 (v2 `resetTimer`). 그 사이 새로 돌기 시작했으면 그대로 둔다
    phaseTimer = setTimeout(() => {
      if (get().phase === phase) set({ phase: "idle" });
    }, 2000);
  }
}

/** 「다 됐다」를 한 번만 알린다 — **돌다가 멈춘 그 순간**에만.
 *  ★두 경로가 함께 쓴다: 브로드캐스트(`job_done`)와 재접속 복원(`applyStatus`). */
function announceDone(n: number) {
  if (!wasBusy) return;
  wasBusy = false;
  const ui = useUi.getState();
  if (ui.notifyDone) toast(t("queue.allDone", { n }));
  // ★화면을 안 보고 있을 때를 위해 소리로도 알린다 (v2 `notifySoundOnComplete`)
  if (ui.notifySound) void playDoneSound();
  // ★창을 안 보고 있으면 **창 제목**으로도 알린다. v2 에서 **항상 켜져** 있던 알림이라
  //   설정으로 끄지 않는다 (`index.html:17502-17503`)
  notifyByTitle(t("queue.titleDone"));
}

/** CLI 줄 하나를 화면에 태운다 — **실시간분·복원분 공통 창구**.
 *  이미 태운 번호는 `takeCliSeq` 가 거른다 (`lib/cliCursor.ts`). */
function takeCli(m: Record<string, any>) {
  if (!takeCliSeq(String(m.run ?? ""), Number(m.seq ?? 0))) return;
  // ★어느 CLI 가 뱉은 것인지 함께 온다 — 모양이 서로 다르다
  cliEvent(m.event ?? {}, String(m.agent ?? "claude-code"));
}

function applyStatus(status: Record<string, any> | undefined, set: Setter, get: () => S) {
  if (!status) return;
  // ★큐가 다 비면 남은 대기는 **오지 않는다** (취소·오류). 자리를 계속 잡고 있으면 유령이 된다
  const idle = (status.queue_length ?? 0) === 0 && !status.is_processing;
  if (idle && get().pending.length) set({ pending: [] });
  // ★다 끝났으면 한 번만 알린다 — 여러 장 돌려 놓고 다른 일을 하다 놓치는 것을 막는다.
  //   `wasBusy` 로 **돌다가 멈춘 순간**만 잡는다 (가만히 있을 때 계속 울리지 않게).
  //   ★평소의 끝은 `settleBatch` 가 받는다. 이 자리는 **끊겼다 다시 붙었더니 그 사이
  //     끝나 있던** 경우를 위한 것이다 — 알리는 창구는 `announceDone` 하나로 모았다.
  const done = status.completed_images ?? 0;
  const total = status.total_images ?? 0;
  if (idle && total > 0 && done >= total) announceDone(done);
  wasBusy = !idle;
  set({
    progress: {
      completed: status.completed_images ?? 0,
      total: status.total_images ?? 0,
      queue_length: status.queue_length ?? 0,
    },
    phase: idle ? "idle" : "running",
  });
  // ★백엔드 재시작 감지 — 서버 seq 가 우리가 본 값보다 **되돌아갔으면** 렌더 집합을 비운다.
  //   안 하면 새 이미지(seq 1..)가 옛 seq 와 충돌해 '이미 본 것'으로 오인되어 전부 건너뛰어진다.
  const srv = status.image_sequence;
  if (typeof srv === "number" && srv < get().lastSeq) {
    set({ seen: new Set(), lastSeq: srv });
  }
}

/** 이 장에 해당하는 대기 하나를 지운다 (같은 슬롯의 맨 앞 것).
 *  ★저장된 그림과 미저장 그림이 **같이 쓴다** — 어느 쪽이든 대기 칸은 하나 줄어야 한다. */
function consumePending(m: Record<string, any>, set: Setter, get: () => S) {
  const pend = get().pending;
  const at = pend.findIndex(
    (p) => p.setId === (m.set_id ?? null) && p.cellId === (m.cell_id ?? null),
  );
  if (at < 0) return;
  const gone = pend[at];
  set({ pending: pend.filter((_, i) => i !== at) });

  /* ★★**그 칸을 골라 두고 기다리던 것이면, 나온 그림으로 옮겨 간다** (사용자 지적
     2026-08-23: *"생성 중인 거 클릭했는데 생성 완료되면 클릭이 풀림"*).
     대기 칸을 고르는 것은 **나올 자리를 미리 잡아 두는 일**이라, 나왔는데 놓아 버리면
     그 목적이 통째로 무너진다 (한때는 「놓기만 한다」로 두었다).
     ★화면이 저 혼자 굴러가는 것과는 다른 이야기다 — 그쪽은 **스크롤**이고 여기는
       **고른 것**이다. 고르지 않고 있었으면 아무 일도 일어나지 않는다. */
  const f = useSceneFocus.getState();
  if (f.pending && f.pending === gone.id && m.file) {
    f.focus(gone.cellId ?? f.cell, String(m.file));
  }
}

/** 한 장을 화면(워크스페이스 records)에 반영한다. ★같은 seq 는 두 번 반영하지 않는다. */
function render(m: Record<string, any>, set: Setter, get: () => S) {
  const seq = Number(m.seq ?? 0);
  if (seq && get().seen.has(seq)) return;

  const ws = useWs.getState();
  // 다른 워크스페이스의 결과는 이 화면과 무관하다 (큐는 앱 전체가 공유한다)
  if (m.workspace && m.workspace !== ws.current) return;

  ws.addRecord({
    // ★시각은 **서버가 찍은 것**이다 (`_generate_one` 의 `ts`). 화면이 자기 시계로 찍으면
    //   UTC 와 지역시각이 섞여 줄 차례가 어긋난다 (`lib/takes.localTs` 주석)
    ts: (m.ts as string) || localTs(),
    file: m.file,
    set: m.set,
    cell: m.cell ?? null,
    set_id: m.set_id ?? null,
    cell_id: m.cell_id ?? null,
    enhance_of: m.enhance_of ?? null,
    seed: m.seed,
  });

  consumePending(m, set, get);

  if (seq) {
    const seen = new Set(get().seen);
    seen.add(seq);
    set({ seen, lastSeq: Math.max(get().lastSeq, seq) });
  }
}
