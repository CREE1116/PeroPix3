/** 바깥 주소를 **기본 브라우저로** 연다.
 *
 *  ★Tauri 웹뷰에서 `<a target="_blank">` 는 안 열린다 — opener 플러그인이 넘겨 준다
 *    (권한은 이미 열려 있다: `capabilities/default.json` 의 `opener:default`).
 *  ★브라우저(Vite)로 열었을 때는 그냥 새 탭이다.
 *  ★부르는 자리가 둘 이상이 되어(설정의 모델 요청·버그 건의) 한 곳으로 모았다. */
export function openExternal(url: string): void {
  if (!url) return;
  void import("@tauri-apps/api/core")
    .then((m) => m.invoke("plugin:opener|open_url", { url }))
    .catch(() => window.open(url, "_blank", "noreferrer"));
}
