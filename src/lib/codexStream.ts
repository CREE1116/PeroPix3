import type { Wire } from "../store/llm";

/** 코덱스 `codex exec --json` 한 줄을 **우리 wire 조각**으로 옮긴다.
 *
 *  ★순수 함수다 — 스토어를 안 만진다. 그래야 **저쪽이 실제로 뱉은 것**을 그대로 넣어
 *    확인할 수 있다 (`codexStream.test.ts` 는 손으로 지은 입력이 아니라 실연동 기록을 쓴다).
 *
 *  실측 2026-08-15 (v0.147.0) 로 확인한 모양:
 *
 *      {"type":"thread.started","thread_id":"…"}                  ← 다음 턴에 이어 붙일 번호
 *      {"type":"turn.started"}
 *      {"type":"item.started"  ,"item":{"id":"item_1","type":"mcp_tool_call",
 *                                       "server":"peropix","tool":"get_workspace",
 *                                       "arguments":{…},"status":"in_progress"}}
 *      {"type":"item.completed","item":{… ,"result":{"content":[{"type":"text","text":"…"}]},
 *                                          "error":null,"status":"completed"}}
 *      {"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"…"}}
 *      {"type":"turn.completed","usage":{…}}
 *
 *  ★클로드 코드와 달리 **도구 한 번이 두 이벤트**로 온다 (`started` · `completed`).
 *    부름 줄은 시작하자마자 띄우고 결과 줄만 뒤에 붙인다 — 그래야 도는 동안 화면이 빈칸이 아니다.
 *    이미 부름 줄을 낸 항목은 `open` 이 기억한다 (턴이 끝나면 비운다).
 *  ★도구 실패는 `error` 가 말해 준다. 본문을 보고 짐작하지 않는다 (claude 쪽 `is_error` 와 같다).
 *  ★모르는 항목 종류는 **버린다.** 화면에 지어내 그리지 않는다 (`unknown` 으로 알려만 준다). */
export type CodexOut = {
  /** 이어 붙일 대화 번호 */
  session?: string;
  /** 턴이 실패한 까닭 */
  error?: string;
  /** 화면에 붙일 조각 (없으면 빈 배열) */
  wire: Wire[];
  /** 다룰 줄 모르는 항목 종류 — 콘솔에만 남긴다 */
  unknown?: string;
};

const NONE: CodexOut = { wire: [] };

/** 부름 줄까지 낼 항목. ★셸(`command_execution`)도 보여 준다 — 모래상자 안이라 해도
 *  무엇을 돌렸는지는 눈에 보여야 한다. */
const SHOWN = new Set(["mcp_tool_call", "command_execution"]);

export function codexWire(ev: Record<string, unknown>, open: Set<string>): CodexOut {
  const type = String(ev.type ?? "");
  if (type === "thread.started") {
    const id = ev.thread_id;
    return id ? { session: String(id), wire: [] } : NONE;
  }
  if (type === "turn.failed") {
    const e = ev.error as { message?: string } | string | undefined;
    return { error: (typeof e === "string" ? e : e?.message) || "CLI 오류", wire: [] };
  }
  if (type !== "item.started" && type !== "item.completed") return NONE;

  const it = (ev.item ?? {}) as Record<string, any>;
  const id = String(it.id ?? "");
  const kind = String(it.type ?? "");
  const done = type === "item.completed";

  if (kind === "agent_message") {
    // ★`item.started` 에는 아직 글이 없다 — 완성된 것만 싣는다 (반쪽 글을 두 번 그리지 않게)
    const text = String(it.text ?? "");
    return done && text.trim()
      ? { wire: [{ role: "assistant", content: [{ type: "text", text }] }] }
      : NONE;
  }
  if (!SHOWN.has(kind)) return done ? { wire: [], unknown: kind } : NONE;

  const mcp = kind === "mcp_tool_call";
  const wire: Wire[] = [];
  if (!open.has(id)) {
    open.add(id);
    wire.push({
      role: "assistant",
      content: [{
        type: "tool_use",
        id,
        name: mcp ? String(it.tool ?? "?") : kind,
        // ★셸 항목은 우리가 모양을 확인하지 않았다 — 통째로 실어 **있는 그대로** 보여 준다
        input: mcp ? ((it.arguments ?? {}) as Record<string, unknown>) : it,
      }],
    });
  }
  if (!done) return { wire };

  const body = Array.isArray(it.result?.content)
    ? it.result.content.map((c: Record<string, any>) => c.text ?? "").join("")
    : JSON.stringify(it.result ?? { status: it.status ?? "" });
  wire.push({
    role: "user",
    content: [{
      type: "tool_result",
      tool_use_id: id,
      content: it.error ? JSON.stringify({ error: String(it.error.message ?? it.error) }) : body,
    }],
  });
  return { wire };
}
