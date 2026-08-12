import { useEffect, useRef, useState } from "react";

/** 밖에서 떨군 그림을 받는다 — **앱과 브라우저는 받는 방법이 다르다.**
 *
 *  ★Tauri 는 창에 떨어진 파일을 **자기가 가로챈다**. 그래서 HTML5 `drop` 이벤트는
 *    **아예 오지 않는다** (`dragDropEnabled` 기본값 true, tauri-utils config.rs:1944
 *    *"Disabling it is required to use HTML5 drag and drop on the frontend on Windows"*).
 *    대신 `onDragDropEvent` 로 **진짜 경로**가 온다 — 이게 오히려 낫다: 바이트를 안 싣고
 *    경로만 보내면 서버가 직접 읽는다 (강화의 `enhance_from` 과 같은 취지).
 *  ★브라우저(개발·QA)에는 그 이벤트가 없으니 HTML5 drop 으로 받고 base64 로 싣는다.
 *
 *  두 갈래를 부르는 쪽이 몰라도 되게, 결과는 한 모양으로 준다.
 */
/** `rel` 은 **아웃풋 루트 기준** 경로 — 파일 관리에서 고른 것이 이 모양으로 온다 */
export type Dropped = { name: string; path?: string; rel?: string; data?: string };

const IMG = /\.(png|jpe?g|webp)$/i;
const inTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const readAsData = (f: File) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(new Error(f.name));
    r.readAsDataURL(f);
  });

export function useImageDrop(onDrop: (items: Dropped[]) => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [over, setOver] = useState(false);
  const cb = useRef(onDrop);
  cb.current = onDrop;

  useEffect(() => {
    if (!inTauri()) return;
    let stop: (() => void) | undefined;
    let dead = false;
    void (async () => {
      const { getCurrentWebview } = await import("@tauri-apps/api/webview");
      // ★창 하나에 드롭존이 여럿이므로 **좌표로 가려낸다** — 이벤트는 창 전체로 온다.
      //   좌표는 물리 픽셀이라 dpr 로 나눠야 CSS 좌표가 된다.
      const mine = (p: { x: number; y: number }) => {
        const dpr = window.devicePixelRatio || 1;
        const el = document.elementFromPoint(p.x / dpr, p.y / dpr);
        return !!(el && ref.current?.contains(el));
      };
      const un = await getCurrentWebview().onDragDropEvent((e) => {
        const p = e.payload;
        if (p.type === "leave") return setOver(false);
        if (p.type === "enter" || p.type === "over") return setOver(mine(p.position));
        if (p.type === "drop") {
          setOver(false);
          if (!mine(p.position)) return;
          const items = p.paths
            .filter((x) => IMG.test(x))
            .map((x) => ({ name: x.split(/[\\/]/).pop() || x, path: x }));
          if (items.length) cb.current(items);
        }
      });
      if (dead) un();
      else stop = un;
    })();
    return () => {
      dead = true;
      stop?.();
    };
  }, []);

  /** 브라우저 쪽 손잡이. Tauri 에서는 이 이벤트가 안 오므로 그냥 놀고 있는다. */
  const zone = {
    ref,
    "data-drop": true,
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      setOver(true);
    },
    onDragLeave: () => setOver(false),
    onDrop: async (e: React.DragEvent) => {
      e.preventDefault();
      setOver(false);
      const fs = [...e.dataTransfer.files].filter((f) => IMG.test(f.name));
      if (!fs.length) return;
      cb.current(await Promise.all(fs.map(async (f) => ({ name: f.name, data: await readAsData(f) }))));
    },
  } as const;

  /** 파일 고르기 대화상자 — 떨구기 말고 눌러서 고르는 길 (v2 도 둘 다 있었다) */
  const pick = () =>
    new Promise<void>((res) => {
      const inp = document.createElement("input");
      inp.type = "file";
      inp.accept = "image/png,image/jpeg,image/webp";
      inp.multiple = true;
      inp.onchange = async () => {
        const fs = [...(inp.files || [])];
        if (fs.length)
          cb.current(await Promise.all(fs.map(async (f) => ({ name: f.name, data: await readAsData(f) }))));
        res();
      };
      inp.click();
    });

  return { zone, over, pick };
}
