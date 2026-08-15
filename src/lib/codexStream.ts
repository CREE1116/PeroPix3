import type { Wire } from "../store/llm";

/** 코덱스 **app-server** 알림 한 줄을 우리 wire 조각으로 옮긴다.
 *
 *  ★순수 함수다 — 스토어를 안 만진다. 그래야 **저쪽이 실제로 뱉은 것**을 그대로 넣어
 *    확인할 수 있다 (`codexStream.test.ts` 는 손으로 지은 입력이 아니라 실연동 기록을 쓴다).
 *
 *  실측 2026-08-15 (v0.147.0) 로 확인한 모양. 백엔드가 알림 이름을 `type` 에, 나머지를
 *  그대로 펴서 넘긴다 (`backend/agentsession.py`):
 *
 *      {"type":"item/started"  ,"item":{"id":"exec-…","type":"mcpToolCall",
 *                                       "server":"peropix","tool":"search_tags",
 *                                       "arguments":{…},"status":"inProgress"}}
 *      {"type":"item/completed","item":{… ,"result":{"content":[{"type":"text","text":"…"}]},
 *                                          "status":"completed"}}
 *      {"type":"item/completed","item":{"id":"msg_…","type":"agentMessage",
 *                                       "text":"…","phase":"commentary"|"final_answer"}}
 *      {"type":"turn/completed","turn":{…}}
 *
 *  ★`exec --json` 의 밑줄 이름(`agent_message`)과 다르다. `exec` 로는 **도중에 끼어들 수가
 *    없어서** app-server 로 옮겼다 (사용자 결정 2026-08-15).
 *  ★`userMessage` 는 **버린다.** 사용자가 친 말은 화면이 이미 올려 두었다 — 도중에 끼워
 *    넣은 말도 마찬가지다. 여기서 또 올리면 같은 말이 두 번 뜬다.
 *  ★도구 한 번이 **두 알림**으로 온다 (`started`·`completed`). 부름 줄은 시작하자마자
 *    띄우고 결과 줄만 뒤에 붙인다 — 그래야 도는 동안 화면이 빈칸이 아니다.
 *  ★모르는 항목 종류는 **버린다.** 화면에 지어내 그리지 않는다 (`unknown` 으로 알려만 준다). */
export type CodexOut = {
  /** 턴이 실패한 까닭 */
  error?: string;
  /** 화면에 붙일 조각 (없으면 빈 배열) */
  wire: Wire[];
  /** 다룰 줄 모르는 항목 종류 — 콘솔에만 남긴다 */
  unknown?: string;
};

const NONE: CodexOut = { wire: [] };

/** 부름 줄까지 낼 항목. ★셸(`commandExecution`)도 보여 준다 — 지금은 꺼 두었지만
 *  (`backend/codexapp.thread_config`), 켜지면 무엇을 돌렸는지는 눈에 보여야 한다. */
const SHOWN = new Set(["mcpToolCall", "commandExecution"]);

/** 화면에 안 그리는 항목 — 모르는 것과 구분한다 (콘솔을 시끄럽게 만들지 않으려고).
 *  `reasoning` 은 지금 알맹이가 비어 온다. 켜는 것은 따로 정할 일이다. */
const SKIP = new Set(["userMessage", "reasoning"]);

export function codexWire(ev: Record<string, unknown>, open: Set<string>): CodexOut {
  const type = String(ev.type ?? "");
  if (type === "turn/failed") {
    const e = ev.error as { message?: string } | string | undefined;
    return { error: (typeof e === "string" ? e : e?.message) || "CLI 오류", wire: [] };
  }
  if (type !== "item/started" && type !== "item/completed") return NONE;

  const it = (ev.item ?? {}) as Record<string, any>;
  const id = String(it.id ?? "");
  const kind = String(it.type ?? "");
  const done = type === "item/completed";

  if (SKIP.has(kind)) return NONE;

  if (kind === "agentMessage") {
    // ★`item/started` 에는 아직 글이 없다 (`text: ""`) — 완성된 것만 싣는다
    const text = String(it.text ?? "");
    return done && text.trim()
      ? { wire: [{ role: "assistant", content: [{ type: "text", text }] }] }
      : NONE;
  }
  if (!SHOWN.has(kind)) return done ? { wire: [], unknown: kind } : NONE;

  const mcp = kind === "mcpToolCall";
  const wire: Wire[] = [];
  if (!open.has(id)) {
    open.add(id);
    wire.push({
      role: "assistant",
      content: [{
        type: "tool_use",
        id,
        name: mcp ? String(it.tool ?? "?") : kind,
        // ★셸 항목은 통째로 실어 **있는 그대로** 보여 준다 (우리가 모양을 정하지 않는다)
        input: mcp ? ((it.arguments ?? {}) as Record<string, unknown>) : it,
      }],
    });
  }
  if (!done) return { wire };

  const body = Array.isArray(it.result?.content)
    ? it.result.content.map((c: Record<string, any>) => c.text ?? "").join("")
    : JSON.stringify(it.result ?? { status: it.status ?? "" });
  // ★실패는 `error` 나 `status` 가 말해 준다 — 본문을 보고 짐작하지 않는다
  const bad = it.error ?? (it.status && it.status !== "completed" ? { message: String(it.status) } : null);
  wire.push({
    role: "user",
    content: [{
      type: "tool_result",
      tool_use_id: id,
      content: bad ? JSON.stringify({ error: String(bad.message ?? bad) }) : body,
    }],
  });
  return { wire };
}
