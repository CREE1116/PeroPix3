/** 생성물의 주소 — **원본과 썸네일을 한 군데서 정한다.**
 *
 *  ★어느 쪽을 쓸지가 곧 성능이다. 56×76 짜리 히스토리 칸에 832×1216 PNG 를 내려받으면
 *    (예전 코드가 그랬다) 썸네일이 수십 장 뜨는 화면에서 무너진다.
 *
 *      큰 화면·라이트박스·드래그한 그림의 원본  →  imgUrl   (원본 PNG)
 *      히스토리 줄·셀 그리드                    →  thumbUrlOf (512px WebP)
 *
 *  썸네일은 서버가 원본에서 굽고 캐시한다 (backend/thumbs.py). 지워도 다시 생긴다.
 *
 *  ★★`v` = 그 그림의 레코드 `ts` — **같은 경로에 다른 그림이 앉아도 주소가 갈리게** 한다
 *    (사용자 보고 2026-08-28: 새 탭으로 복제한 그림에 전혀 다른 썸네일이 떴다). 응답에
 *    `immutable` 캐시가 붙는데, 지운 파일의 번호를 다음 생성·복제가 재발급하면 같은 주소에
 *    다른 그림이 온다 — 웹뷰는 재검증 없이 옛 캐시를 보여 준다. 레코드가 새로 적히면 `ts` 가
 *    다르므로 주소가 갈린다. 서버는 쿼리를 안 보므로 아무것도 안 바뀐다.
 *    레코드가 없는 자리(경로만 든 폴백)는 비워 둔다 — 그때는 그냥 경로 주소다. */
const ver = (v?: string) => (v ? `?v=${encodeURIComponent(v)}` : "");

export const imgUrl = (base: string, ws: string, file: string, v?: string) =>
  `${base}/api/file/${encodeURIComponent(ws)}/${file}${ver(v)}`;

export const thumbUrlOf = (base: string, ws: string, file: string, v?: string) =>
  `${base}/api/thumb/${encodeURIComponent(ws)}/${file}${ver(v)}`;

/** 보관함(갤러리)의 그림 — 워크스페이스를 안 낀다 (`/api/keep/file/...`) */
export const keepUrl = (base: string, rel: string) =>
  `${base}/api/keep/file/${rel.split("/").map(encodeURIComponent).join("/")}`;

/** 보관함의 **썸네일** — 격자가 쓴다. 크게 볼 때만 `keepUrl`(원본)을 받는다.
 *  ★파일 관리·캔버스가 쓰던 층을 갤러리도 쓴다. 격자에 원본 PNG 를 걸면 수백 장이
 *    뜨는 화면이 그것만으로 무너진다 (`docs/v2-port-audit.md` A3). */
export const keepThumb = (base: string, rel: string) =>
  `${base}/api/keep/thumb/${rel.split("/").map(encodeURIComponent).join("/")}`;

/** 파일 관리의 그림 — 뿌리가 **아웃풋 루트**라 워크스페이스가 경로 첫 칸이다 */
const enc = (rel: string) => rel.split("/").map(encodeURIComponent).join("/");
export const fileMgrThumb = (base: string, rel: string) => `${base}/api/files/thumb/${enc(rel)}`;
export const fileMgrImg = (base: string, rel: string) => `${base}/api/files/img/${enc(rel)}`;
