/** 생성물의 주소 — **원본과 썸네일을 한 군데서 정한다.**
 *
 *  ★어느 쪽을 쓸지가 곧 성능이다. 56×76 짜리 히스토리 칸에 832×1216 PNG 를 내려받으면
 *    (예전 코드가 그랬다) 썸네일이 수십 장 뜨는 화면에서 무너진다.
 *
 *      큰 화면·라이트박스·드래그한 그림의 원본  →  imgUrl   (원본 PNG)
 *      히스토리 줄·셀 그리드                    →  thumbUrlOf (512px WebP)
 *
 *  썸네일은 서버가 원본에서 굽고 캐시한다 (backend/thumbs.py). 지워도 다시 생긴다. */
export const imgUrl = (base: string, ws: string, file: string) =>
  `${base}/api/file/${encodeURIComponent(ws)}/${file}`;

export const thumbUrlOf = (base: string, ws: string, file: string) =>
  `${base}/api/thumb/${encodeURIComponent(ws)}/${file}`;

/** 보관함(갤러리)의 그림 — 워크스페이스를 안 낀다 (`/api/keep/file/...`) */
export const keepUrl = (base: string, rel: string) =>
  `${base}/api/keep/file/${rel.split("/").map(encodeURIComponent).join("/")}`;

/** 파일 관리의 그림 — 뿌리가 **아웃풋 루트**라 워크스페이스가 경로 첫 칸이다 */
const enc = (rel: string) => rel.split("/").map(encodeURIComponent).join("/");
export const fileMgrThumb = (base: string, rel: string) => `${base}/api/files/thumb/${enc(rel)}`;
export const fileMgrImg = (base: string, rel: string) => `${base}/api/files/img/${enc(rel)}`;
