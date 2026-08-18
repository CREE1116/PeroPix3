import { create } from "zustand";
import { api, backendUrl } from "../lib/backend";
import { cliEvent } from "./llm";
import { cliCursor, takeCliSeq } from "../lib/cliCursor";
import { playDoneSound } from "../lib/notifySound";
import { useCards } from "./cards";
import { useFiles } from "./files";
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

/** ★큐에 넣은 **아직 안 나온 장**. 페로픽스파이는 큐에 넣는 순간 결과 객체를 만들어
 *  `queued` 카드를 띄운다 (`batch.ts start`) — 눌렀는지 알 수 있고 어디에 생길지도 보인다.
 *  우리 레코드는 **완료된 파일**뿐이라 이 목록이 그 자리를 대신한다.
 *  그림이 도착하면 같은 (tab_id, cell_id) 의 대기 하나를 지운다. */
export type Pending = { id: string; tabId: string | null; cellId: string | null };

type S = {
  connected: boolean;
  progress: QueueProgress;
  pending: Pending[];
  /** 이미 화면에 반영한 seq — 중복 렌더 방지의 근거 */
  seen: Set<number>;
  lastSeq: number;
  error: string;

  connect: () => Promise<void>;
  enqueue: (base: Record<string, unknown>, items?: Record<string, unknown>[], count?: number) => Promise<void>;
  /** 이 탭의 대기 목록 (슬롯 순서대로). 맨 앞이 **지금 만드는 중**이다 */
  pendingOf: (tabId: string) => Pending[];
  cancel: () => Promise<void>;
  clear: () => Promise<void>;
};

const KEY = "peropix.ws_client_id";
const EMPTY: QueueProgress = { completed: 0, total: 0, queue_length: 0 };

let sock: WebSocket | null = null;
let seqId = 1;
/** 직전에 돌고 있었나 — 멈추는 **그 순간**만 알린다 */
let wasBusy = false;
let retry = 0;

export const useQueue = create<S>((set, get) => ({
  connected: false,
  progress: EMPTY,
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
    ws.onmessage = (e) => handle(JSON.parse(e.data), set, get);
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
      throw e;
    }
  },
  pendingOf: (tabId) => get().pending.filter((p) => p.tabId === tabId),

  async cancel() {
    await api("/api/cancel-current", { method: "POST" });
  },
  async clear() {
    set({ pending: [] });
    await api("/api/clear-queue", { method: "POST" });
  },
}));

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
      if (tab.kind === "set") {
        for (let i = 0; i < count; i++) await useGen.getState().generateAll();
        const live = allCells(tab).filter((c) => !c.locked).length;
        return { ok: true, tab: tab.name, queued: live * count };
      }
      await useGen.getState().queueSingle(count);
      return { ok: true, tab: tab.name, queued: count };
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
    case "image":
      render(m, set, get);
      if (m.progress) set({ progress: m.progress });
      break;
    case "queued":
    case "job_start":
    case "job_done":
    case "job_cancelled":
    case "queue_cleared":
      if (m.progress) set({ progress: m.progress });
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
      set({ error: String(m.error ?? "생성 실패") });
      if (m.progress) set({ progress: m.progress });
      break;
  }
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
  const done = status.completed_images ?? 0;
  const total = status.total_images ?? 0;
  if (idle && wasBusy && total > 0 && done >= total) {
    if (useUi.getState().notifyDone) toast(t("queue.allDone", { n: done }));
    // ★화면을 안 보고 있을 때를 위해 소리로도 알린다 (v2 `notifySoundOnComplete`)
    if (useUi.getState().notifySound) void playDoneSound();
  }
  wasBusy = !idle;
  set({
    progress: {
      completed: status.completed_images ?? 0,
      total: status.total_images ?? 0,
      queue_length: status.queue_length ?? 0,
    },
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
