/** 화면에서 터진 것을 **로그에 남긴다** (사용자 지시 2026-08-27:
 *  *"앱 실행 중에 오류 같은 게 생기면 상세 로그 남기게 해 놔. 그럼 유저 제보받기 편함"*).
 *
 *  ★★**배포판에는 개발자 도구가 없다.** 화면에서 난 오류는 `console` 에만 남고 아무도
 *    못 본다 — 쓰는 사람이 「갑자기 안 돼요」라고 해도 보낼 것이 없었다. 백엔드로 보내면
 *    `logs/peropix.log` 한 파일에 백엔드 자취와 **같은 줄기로** 쌓인다.
 *  ★잡는 것은 둘이다: 잡히지 않은 예외(`error`)와 버려진 약속(`unhandledrejection`).
 *    둘 다 「우리가 미처 안 받은 것」이라, 여기 걸리는 것은 전부 결함의 자취다.
 *  ★★**같은 줄을 되풀이해 보내지 않는다.** 렌더 고리 안에서 터지면 초당 수백 번 온다 —
 *    그대로 보내면 로그가 그 한 줄로 덮이고, 정작 앞뒤가 밀려난다.
 *  ★보내다 실패하면 그냥 넘어간다. 로그를 남기려다 앱이 시끄러워지면 안 된다.
 */
import { api } from "./backend";

const seen = new Map<string, number>();

/** 한 줄 남긴다. `where` 는 어디서 났는지 (`boot`·`gen`…), `msg` 는 사람이 읽을 내용. */
export function logLine(level: "error" | "warn" | "info", where: string, msg: string) {
  const key = `${level}\u0000${where}\u0000${msg}`;
  const now = Date.now();
  const last = seen.get(key) ?? 0;
  // 같은 줄은 10초에 한 번만
  if (now - last < 10_000) return;
  seen.set(key, now);
  if (seen.size > 200) seen.clear();
  void api("/api/log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ level, line: `${where}: ${msg}` }),
  }).catch(() => {});
}

/** 오류 하나를 자취까지 함께 적는다. */
export function logError(where: string, e: unknown) {
  const err = e instanceof Error ? e : null;
  const msg = err ? `${err.name}: ${err.message}\n${err.stack ?? ""}` : String(e);
  logLine("error", where, msg.slice(0, 1800));
}

/** 부팅 때 한 번 매단다 (`App.tsx`). */
export function watchErrors() {
  window.addEventListener("error", (e) => {
    // ★그림·글꼴이 못 뜬 것도 이 사건으로 온다 — 그때는 `error` 가 없다. 그것도 적는다:
    //   자산 하나가 빠져 화면이 깨지는 것이야말로 제보로 오는 종류다.
    if (e.error) logError("화면", e.error);
    else logLine("warn", "자산", `못 읽음: ${(e.target as HTMLElement)?.getAttribute?.("src") ?? e.message}`);
  }, true);
  window.addEventListener("unhandledrejection", (e) => logError("약속", e.reason));
}
