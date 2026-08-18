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
import type { Block } from "../lib/blocks";
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
 *  그림이 도착하면 같은 (tab_id, cell_id) 의 대기 하나를 지운다. */
export type Pending = { id: string; tabId: string | null; cellId: string | null };

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
  pendingOf: (tabId: string) => Pending[];
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

export const useQueue = create<S>((set, get) => ({
  connected: false,
  progress: EMPTY,
  phase: "idle",
  pending: [],
  seen: new Set(),
  lastSeq: 0,
  error: "",

  async connect() {
    if (sock && (sock.readyState === WebSocket.OPEN || sock.readyState === WebSocket.CONNECTING)) return;
    const base = await backendUrl();
    const id = localStorage.getItem(KEY) || "";
    const url = base.replace(/^http/, "ws") + "/ws" + (id ? `?clientId=${encodeURIComponent(id)}` : "");

    const ws = new WebSocket(url);
    sock = ws;

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
      set({ connected: false });
      if (sock === ws) sock = null;
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
    const tabId = (base.tab_id as string) ?? null;
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
          tabId,
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
  pendingOf: (tabId) => get().pending.filter((p) => p.tabId === tabId),

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
      const wantTab = String(args.tab ?? "").trim();
      if ((target && target !== ws.current) || wantTab) {
        const { queueToWorkspace } = await import("./genRemote");
        return (await queueToWorkspace(target || ws.current, count, wantTab || undefined)) as Record<
          string,
          unknown
        >;
      }
      const tab = ws.activeTab();
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
      return { ok: true, tab: tab.name, queued: live * count * useUi.getState().perSlot };
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

    if (action === "edit_current_prompt") {
      const { usePrompt } = await import("./prompt");
      const { makeBlock, parseSegs } = await import("../lib/blocks");
      const area = String(args.area ?? "base");
      const label = String(args.label ?? "블록");
      const tags = parseSegs(String(args.tags ?? ""));
      const replace = String(args.mode ?? "add") === "replace";
      const p = usePrompt.getState();

      const apply = (cur: Block[]): Block[] => {
        const at = cur.findIndex((b) => b.label === label);
        if (replace && at >= 0) return cur.map((b, i) => (i === at ? { ...b, tags } : b));
        return [...cur, makeBlock(label, [], { open: true, tags })];
      };

      if (area === "base" || area === "baseUc") {
        p.update(area, apply);
        return { ok: true, area, label };
      }
      const [name, part] = area.split(":");
      const ch = p.chars.find((c) => c.id === name || c.name === name);
      if (!ch) return { error: `그런 자리가 없습니다: ${area}` };
      p.updateChar(ch.id, part === "uc" ? "uc" : "prompt", apply);
      return { ok: true, area: ch.name, label };
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
    // ★자동 저장을 껐을 때 — **기록을 안 남기고** 미리보기만 갈아 끼운다 (`useGen.preview`)
    case "image_preview": {
      void import("./gen").then(({ useGen }) =>
        useGen.setState({ preview: `data:image/${m.fmt ?? "png"};base64,${m.b64}`, current: null }),
      );
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

/** 한 장을 화면(워크스페이스 records)에 반영한다. ★같은 seq 는 두 번 반영하지 않는다. */
function render(m: Record<string, any>, set: Setter, get: () => S) {
  const seq = Number(m.seq ?? 0);
  if (seq && get().seen.has(seq)) return;

  const ws = useWs.getState();
  // 다른 워크스페이스의 결과는 이 화면과 무관하다 (큐는 앱 전체가 공유한다)
  if (m.workspace && m.workspace !== ws.current) return;

  ws.addRecord({
    ts: new Date().toISOString(),
    file: m.file,
    tab: m.tab,
    cell: m.cell ?? null,
    tab_id: m.tab_id ?? null,
    cell_id: m.cell_id ?? null,
    enhance_of: m.enhance_of ?? null,
    seed: m.seed,
  });

  // 이 장에 해당하는 대기 하나를 지운다 (같은 슬롯의 맨 앞 것)
  const pend = get().pending;
  const at = pend.findIndex(
    (p) => p.tabId === (m.tab_id ?? null) && p.cellId === (m.cell_id ?? null),
  );
  if (at >= 0) set({ pending: pend.filter((_, i) => i !== at) });

  if (seq) {
    const seen = new Set(get().seen);
    seen.add(seq);
    set({ seen, lastSeq: Math.max(get().lastSeq, seq) });
  }
}
