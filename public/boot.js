/* 첫 화면(스플래시)이 **번들보다 먼저** 서게 하는 최소한의 코드.
 *
 * ★★**인라인으로 못 쓴다.** `tauri.conf.json` 의 CSP 가 `script-src 'self'` 라 문서 안에
 *   박아 넣은 `<script>` 는 통째로 막힌다 (스타일은 `'unsafe-inline'` 이라 통과한다 —
 *   그래서 모양은 떴는데 글자만 안 뜨는 모습이 된다). 파일로 두면 같은 출처라 통과한다.
 * ★★**번들(`main.tsx`)을 기다리면 안 되는 일**만 여기 둔다: 바탕색과 첫 문구. 나머지는
 *   전부 앱이 켜진 뒤에 한다.
 * ★실패해도 조용히 넘어간다 — 스플래시 때문에 앱이 안 뜨는 일은 없어야 한다.
 */
(function () {
  /* 테마 — 저장된 것을 먼저 본다. 규칙은 앱과 같다 (`src/store/theme.ts` 의 `apply`).
     ★`system` 이면 아무것도 안 붙인다: `index.html` 의 `prefers-color-scheme` 가 받는다. */
  try {
    var t = localStorage.getItem("peropix.theme");
    if (t === "dark" || t === "light") document.documentElement.setAttribute("data-theme", t);
  } catch (e) {}

  /* 언어 — 규칙은 앱과 같다 (`src/i18n/index.ts` 의 `detect()`):
     저장된 것 → 없으면 브라우저 언어 → 그래도 모르면 영어.

     ★★**글자를 여기서 적지 않는다** (2026-08-27, 한 번 그렇게 했다가 못 뜬 자리).
       이 파일은 `<head>` 에서 읽히므로 글자 칸이 아직 없어 `DOMContentLoaded` 를 기다렸는데,
       그 사건은 **모듈 스크립트가 다 돌고 난 뒤**에 온다 (명세가 그렇다). 개발 중에는 그것이
       10초 뒤이고, 그때는 이미 리액트가 `#root` 를 비워 **글자 칸 자체가 없다.**
       그래서 화면에는 막대만 10초 동안 떠 있었다.
     ★★대신 **표식만 남긴다.** 문구 세 줄은 `index.html` 에 처음부터 적혀 있고, 어느 것을
       보일지는 CSS 가 이 표식으로 고른다 — 자바스크립트가 아예 안 돌아도 한 줄은 뜬다. */
  var l = "";
  try { l = localStorage.getItem("peropix.locale") || ""; } catch (e) {}
  if (l !== "ko" && l !== "en" && l !== "ja") {
    var n = (navigator.language || "").toLowerCase();
    l = n.indexOf("ko") === 0 ? "ko" : n.indexOf("ja") === 0 ? "ja" : "en";
  }
  document.documentElement.setAttribute("data-boot-locale", l);
})();
