/** 창 제목으로 알린다 — **창을 안 보고 있을 때만** (v2 `index.html:17517-17540` 이식).
 *
 *  v2 는 브라우저 탭이라 `document.title` 하나로 끝났다. 우리는 시스템 타이틀바를 끈
 *  Tauri 창이라 그 값이 화면 어디에도 안 뜬다 — 그래서 **창 제목까지 함께** 바꾼다
 *  (`appWindow.setTitle`). 작업 표시줄과 Alt+Tab 에 보이는 것이 그 값이다.
 *  브라우저(vite dev)에서는 `setTitle` 이 조용히 무시되고 탭 제목만 바뀐다.
 *
 *  ★v2 는 `PeroPix ✦` 였는데 우리는 기호를 안 쓴다. 화면에 뜨는 글은 낱말로 적는다.
 *  ★v2 에서 **항상 켜져** 있던 알림이라 설정으로 끄지 않는다 (소리·토스트와 다르다).
 */
import { appWindow } from "./window";

const ORIGINAL = "PeroPix";
/** 이미 걸어 뒀나 — 여러 번 부르면 리스너가 쌓인다 */
let armed = false;

function put(title: string) {
  document.title = title;
  void appWindow.setTitle(title);
}

export function notifyByTitle(text: string) {
  // 보고 있으면 알릴 것이 없다
  if (document.hasFocus()) return;
  if (armed) return;
  armed = true;
  put(text);

  const reset = () => {
    armed = false;
    put(ORIGINAL);
    window.removeEventListener("focus", reset);
    document.removeEventListener("visibilitychange", onVisible);
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") reset();
  };
  window.addEventListener("focus", reset);
  document.addEventListener("visibilitychange", onVisible);
}
