/** 부팅이 **어디서** 오래 걸리는지 재는 자 (2026-08-27, 사용자 지적: *"엔진을 깨우는 중이
 *  10초쯤 걸림"*).
 *
 *  ★★**재야 할 구간이 화면 바깥에 있다.** 실측으로 백엔드는 띄운 지 **1.13초**면 답한다
 *    (`/api/health` 까지). 그런데 사용자가 보는 것은 10초다 — 나머지는 껍데기가 창을 만들고
 *    웹뷰가 문서를 받아 번들을 돌리기까지의 구간인데, 그 구간은 화면이 스스로 못 잰다
 *    (`performance.timeOrigin` 은 **문서가 생긴 뒤**부터 흐른다). 그래서 껍데기에게 묻는다
 *    (`uptime_ms`) — 그 값이 곧 「내가 처음 돌기까지 흐른 시간」이다.
 *  ★★**남는 자리는 `logs/peropix.log`** 다. 배포판에는 개발자 도구가 없어 `console` 은
 *    아무 데도 안 남는다 — 화면이 남기는 것은 전부 `lib/report` 를 지나 그 파일로 간다.
 *  ★한 번만 보낸다. 실패는 삼킨다 — 재려다 앱이 시끄러워지면 안 된다.
 */
import { logLine } from "./report";

const marks: [string, number][] = [];
let sent = false;

/** 단계 하나를 찍는다. `performance.now()` 기준(문서가 생긴 때부터 ms). */
export function mark(stage: string) {
  marks.push([stage, Math.round(performance.now())]);
}

/** 시간표를 한 줄로 만들어 백엔드에 남긴다. ★부팅이 다 끝난 뒤에 부른다. */
export async function flushBootTime() {
  if (sent) return;
  sent = true;
  try {
    let shell = -1;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      shell = await invoke<number>("uptime_ms");
    } catch {
      /* 브라우저(vite dev)에는 껍데기가 없다 */
    }
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    /* 화면이 처음 돈 순간, 껍데기는 이미 얼마나 흘렀나 — **창·웹뷰·번들**이 여기 다 들어 있다.
       ★`shell` 은 지금 시각이므로 `performance.now()` 를 빼야 그 순간이 나온다. */
    const before = shell < 0 ? -1 : Math.round(shell - performance.now());
    const parts = [
      `껍데기→화면 ${before}ms`,
      nav ? `문서 ${Math.round(nav.responseStart)}→${Math.round(nav.domContentLoadedEventEnd)}ms` : "",
      ...marks.map(([s, t]) => `${s} ${t}ms`),
    ].filter(Boolean);
    logLine("info", "부팅", parts.join(" · "));
  } catch {
    /* 못 남겨도 그만 */
  }
}
