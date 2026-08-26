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

  /* 첫 문구 — 언어 고르는 규칙도 앱과 같다 (`src/i18n/index.ts` 의 `detect()`):
     저장된 것 → 없으면 브라우저 언어 → 그래도 모르면 영어.
     ★★문구는 `boot.backend` 를 **옮겨 적은 것**이다. 그 세 줄을 고치면 여기도 함께 고친다 —
       딕셔너리를 불러올 수 없다. 그 번들이 오기 전에 그려야 하는 자리이기 때문이다. */
  var SAY = {
    ko: "엔진을 깨우는 중…",
    en: "Starting the engine…",
    ja: "エンジンを起動中…",
  };
  var l = "";
  try { l = localStorage.getItem("peropix.locale") || ""; } catch (e) {}
  if (l !== "ko" && l !== "en" && l !== "ja") {
    var n = (navigator.language || "").toLowerCase();
    l = n.indexOf("ko") === 0 ? "ko" : n.indexOf("ja") === 0 ? "ja" : "en";
  }
  /* ★이 파일은 `<head>` 에서 읽히므로 글자 칸이 아직 없다 — 문서를 다 읽은 뒤에 적는다.
     로컬 파일이라 그 사이가 눈에 띄지 않는다. */
  function say() {
    var el = document.getElementById("boot-say");
    if (el) el.textContent = SAY[l];
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", say);
  else say();
})();
