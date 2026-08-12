import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { Icon } from "./Icon";
import { alignTo64 } from "../store/gen";

/** 인페인트 마스크 에디터 — v2 원문 이식 (index.html:10457-10495 · 23092-23430).
 *
 *  ★**8×8 그리드에 붙는 사각 브러시**다. 둥글게 보여도 사각이고, 안티앨리어싱이 없다
 *    (NAI 웹·NAIS2 와 같은 방식). "둥근 브러시가 자연스럽다"고 고치면 **결과가 달라진다** —
 *    `docs/v2-port-plan.md` 의 재구현 금지 표에 올라 있는 항목이다.
 *  ★마스크는 순흑백이다: 검정(0) 유지 · 흰색(255) 고쳐 그림. 회색이 섞이면 안 되므로
 *    칸을 통째로 칠하고, 이은 자리는 브레젠험 선으로 채운다.
 *  ★그림이 64 배수가 아니면 먼저 맞춘다 — 마스크가 **맞춰진 그림 위에** 그려져야
 *    경계에 이음매가 안 생긴다 (v2 주석 그대로).
 */
const GRID = 8;

export type Rect = { x: number; y: number; w: number; h: number };

/** 타일 한 장의 상한 — 1024×1024 (`backend/imgutil.py TILE_MAX_PX` 와 같은 값).
 *  ★넘기면 Opus 무료가 깨지고 공홈도 막는다. 아래 후보는 전부 이 턱밑이다 —
 *  작게 잡으면 아끼는 것 없이 **모델이 보는 문맥**만 줄어든다 (조사 문서 2절). */
const TILE_MAX_PX = 1_048_576;
const TILE_SIZES: [number, number][] = [
  [832, 1216],
  [1216, 832],
  [1024, 1024],
  [768, 1344],
  [1344, 768],
  [640, 1600],
  [1600, 640],
];

/** 칠한 자리를 감싸는 사각형을 **자동으로** 잡는다.
 *
 *  ★익스텐션은 사람이 직접 옮긴다. 우리는 **초안을 잡아 주고 옮길 수 있게** 한다
 *    (사용자 결정 2026-08-13) — "사각형 밖에 칠한 마스크가 조용히 버려지는" 함정이
 *    기본값에서 사라지고, 문맥을 얼마나 넣을지 고를 권한은 남는다.
 *  ★후보 중 **칠한 자리를 담을 수 있는 것**만 고르고, 그중 비율이 가장 가까운 것을 쓴다. */
export function autoRect(bbox: Rect, iw: number, ih: number): Rect {
  const fits = TILE_SIZES.filter(([w, h]) => w >= bbox.w && h >= bbox.h && w <= iw && h <= ih);
  const want = bbox.w / Math.max(1, bbox.h);
  const pick = (fits.length ? fits : TILE_SIZES.filter(([w, h]) => w <= iw && h <= ih))
    .sort((a, b) => Math.abs(a[0] / a[1] - want) - Math.abs(b[0] / b[1] - want))[0];
  // 그림이 후보보다 작으면 그림 전체 (64 배수로 내린다)
  const w = pick ? pick[0] : Math.max(64, Math.floor(iw / 64) * 64);
  const h = pick ? pick[1] : Math.max(64, Math.floor(ih / 64) * 64);
  return clampRect({ x: Math.round(bbox.x + bbox.w / 2 - w / 2), y: Math.round(bbox.y + bbox.h / 2 - h / 2), w, h }, iw, ih);
}

/** 사각형을 그림 안으로 밀어 넣는다 (크기는 그대로) */
export function clampRect(r: Rect, iw: number, ih: number): Rect {
  const w = Math.min(r.w, Math.max(64, Math.floor(iw / 64) * 64));
  const h = Math.min(r.h, Math.max(64, Math.floor(ih / 64) * 64));
  return { x: Math.max(0, Math.min(r.x, iw - w)), y: Math.max(0, Math.min(r.y, ih - h)), w, h };
}

/** 칠한 칸들을 감싸는 사각형 (판 좌표계). 아무것도 없으면 null */
function paintedBBox(cells: Set<string>): Rect | null {
  if (!cells.size) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const key of cells) {
    const [gx, gy] = key.split(",").map(Number);
    x0 = Math.min(x0, gx * GRID); y0 = Math.min(y0, gy * GRID);
    x1 = Math.max(x1, gx * GRID + GRID); y1 = Math.max(y1, gy * GRID + GRID);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function MaskEditor({
  image,
  mask,
  strength,
  tile,
  onCancel,
  onApply,
}: {
  image: string;
  mask: string;
  strength: number;
  /** ★타일 인페인트를 쓸 수 있는 그림인가 — **워크스페이스 파일**이어야 한다
   *  (서버가 그 파일을 열어 자른다). 밖에서 떨군 그림에는 경로가 없어 못 쓴다. */
  tile?: boolean;
  onCancel: () => void;
  /** rect 는 **원본 좌표계**의 크롭 사각형 — 없으면 지금까지의 인페인트 그대로다 */
  onApply: (mask: string, strength: number, rect: Rect | null) => void;
}) {
  const t = useI18n((s) => s.t);
  const maskRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0, dw: 0, dh: 0 });
  const [brush, setBrush] = useState(30);
  const [erase, setErase] = useState(false);
  const [str, setStr] = useState(strength);
  /** 이미 칠한 칸 — 다시 칠하지 않는다 (v2 `paintedCells`) */
  const painted = useRef(new Set<string>());
  /** 크롭 사각형 (판 좌표계). ★원본이 1MP 를 넘을 때만 뜻이 있다 */
  const [rect, setRect] = useState<Rect | null>(null);
  /** 원본 픽셀 크기 — 판은 64 배수로 맞춰져 있어 좌표를 되돌릴 때 쓴다 */
  const natural = useRef({ w: 0, h: 0 });
  const dragRect = useRef<{ x: number; y: number; rx: number; ry: number } | null>(null);
  const drawing = useRef(false);
  const lastCell = useRef<{ gx: number; gy: number } | null>(null);

  // 그림을 올리고 판을 맞춘다
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      natural.current = { w: img.width, h: img.height };
      const w = alignTo64(img.width);
      const h = alignTo64(img.height);
      const scale = Math.min((window.innerWidth * 0.8) / w, (window.innerHeight * 0.62) / h, 1);
      setSize({ w, h, dw: Math.round(w * scale), dh: Math.round(h * scale) });
      const ic = imgRef.current!;
      const mc = maskRef.current!;
      ic.width = mc.width = w;
      ic.height = mc.height = h;
      ic.getContext("2d")!.drawImage(img, 0, 0, w, h);
      const mx = mc.getContext("2d")!;
      mx.fillStyle = "black";
      mx.fillRect(0, 0, w, h);
      painted.current.clear();
      if (mask) {
        const m = new Image();
        m.onload = () => {
          mx.drawImage(m, 0, 0, w, h);
          syncPainted(mx, w, h);
        };
        m.src = "data:image/png;base64," + mask;
      }
    };
    img.src = "data:image/png;base64," + image;
  }, [image, mask]);

  /** 있는 마스크에서 칠한 칸을 되살린다 — 칸 **가운데 픽셀**로 판정한다 (v2 와 같다) */
  const syncPainted = (mx: CanvasRenderingContext2D, w: number, h: number) => {
    const d = mx.getImageData(0, 0, w, h).data;
    for (let gy = 0; gy < Math.floor(h / GRID); gy++) {
      for (let gx = 0; gx < Math.floor(w / GRID); gx++) {
        const cx = gx * GRID + (GRID >> 1);
        const cy = gy * GRID + (GRID >> 1);
        if (d[(cy * w + cx) * 4] > 128) painted.current.add(`${gx},${gy}`);
      }
    }
  };

  const cellAt = (e: React.PointerEvent) => {
    const c = maskRef.current!;
    const r = c.getBoundingClientRect();
    const x = (e.clientX - r.left) * (c.width / r.width);
    const y = (e.clientY - r.top) * (c.height / r.height);
    const maxX = Math.floor(c.width / GRID) - 1;
    const maxY = Math.floor(c.height / GRID) - 1;
    return {
      gx: Math.max(0, Math.min(Math.floor(x / GRID), maxX)),
      gy: Math.max(0, Math.min(Math.floor(y / GRID), maxY)),
    };
  };

  const fillCell = (mx: CanvasRenderingContext2D, gx: number, gy: number) => {
    const key = `${gx},${gy}`;
    if (erase) {
      mx.fillStyle = "black";
      mx.fillRect(gx * GRID, gy * GRID, GRID, GRID);
      painted.current.delete(key);
    } else {
      if (painted.current.has(key)) return;
      mx.fillStyle = "white";
      mx.fillRect(gx * GRID, gy * GRID, GRID, GRID);
      painted.current.add(key);
    }
  };

  /** 붓 굵기만큼 둘레 칸을 함께 (v2 `fillBrushArea`) */
  const fillArea = (mx: CanvasRenderingContext2D, gx: number, gy: number) => {
    const c = maskRef.current!;
    const span = Math.max(1, Math.floor(brush / GRID));
    const half = span >> 1;
    const maxX = Math.floor(c.width / GRID) - 1;
    const maxY = Math.floor(c.height / GRID) - 1;
    for (let dy = -half; dy <= half; dy++) {
      for (let dx = -half; dx <= half; dx++) {
        const x = gx + dx;
        const y = gy + dy;
        if (x >= 0 && x <= maxX && y >= 0 && y <= maxY) fillCell(mx, x, y);
      }
    }
  };

  /** 지난 칸에서 이 칸까지 이어 칠한다 — 브레젠험 (v2 `drawGridLine`).
   *  ★없으면 빨리 그을 때 점선이 된다. */
  const line = (mx: CanvasRenderingContext2D, a: { gx: number; gy: number }, b: { gx: number; gy: number }) => {
    const dx = Math.abs(b.gx - a.gx);
    const dy = Math.abs(b.gy - a.gy);
    const sx = a.gx < b.gx ? 1 : -1;
    const sy = a.gy < b.gy ? 1 : -1;
    let err = dx - dy;
    let { gx, gy } = a;
    for (;;) {
      fillArea(mx, gx, gy);
      if (gx === b.gx && gy === b.gy) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; gx += sx; }
      if (e2 < dx) { err += dx; gy += sy; }
    }
  };

  const paint = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const mx = maskRef.current!.getContext("2d")!;
    const cell = cellAt(e);
    if (lastCell.current) line(mx, lastCell.current, cell);
    else fillArea(mx, cell.gx, cell.gy);
    lastCell.current = cell;
  };

  /** 타일이 필요한 그림인가 — ★원본이 1MP 이하면 자를 이유가 없다 (통째로 보내도 같다) */
  const needTile = !!tile && natural.current.w * natural.current.h > TILE_MAX_PX;

  /** 칠한 자리를 보고 사각형을 다시 잡는다.
   *
   *  ★**손으로 옮긴 사각형을 함부로 되돌리지 않는다** — 칠한 자리가 사각형 밖으로
   *    나갔을 때만 다시 잡는다. 그래야 "문맥을 더 넣으려고 옮겨 둔" 것이 안 풀린다. */
  const refitRect = () => {
    if (!needTile) return;
    const bbox = paintedBBox(painted.current);
    if (!bbox) return;
    const inside =
      rect &&
      bbox.x >= rect.x && bbox.y >= rect.y &&
      bbox.x + bbox.w <= rect.x + rect.w && bbox.y + bbox.h <= rect.y + rect.h;
    if (inside) return;
    setRect(autoRect(bbox, size.w, size.h));
  };

  /** 사각형 크기를 다음 후보로 — 중심을 지킨 채 바꾼다 (익스텐션의 `;`/`'` 자리) */
  const cycleSize = () => {
    if (!rect) return;
    const i = TILE_SIZES.findIndex(([w, h]) => w === rect.w && h === rect.h);
    const [w, h] = TILE_SIZES[(i + 1) % TILE_SIZES.length];
    const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
    setRect(clampRect({ x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w, h }, size.w, size.h));
  };

  const clear = () => {
    const c = maskRef.current!;
    const mx = c.getContext("2d")!;
    mx.fillStyle = "black";
    mx.fillRect(0, 0, c.width, c.height);
    painted.current.clear();
  };

  /** 반전 — 칠한 칸과 아닌 칸을 맞바꾼다 */
  const invert = () => {
    const c = maskRef.current!;
    const mx = c.getContext("2d")!;
    const cols = Math.floor(c.width / GRID);
    const rows = Math.floor(c.height / GRID);
    const next = new Set<string>();
    mx.fillStyle = "black";
    mx.fillRect(0, 0, c.width, c.height);
    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        const key = `${gx},${gy}`;
        if (painted.current.has(key)) continue;
        mx.fillStyle = "white";
        mx.fillRect(gx * GRID, gy * GRID, GRID, GRID);
        next.add(key);
      }
    }
    painted.current = next;
  };

  return (
    <div
      data-mask-editor
      onPointerDown={(e) => e.target === e.currentTarget && onCancel()}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 90,
        background: "rgba(6,8,12,0.72)",
        display: "grid",
        placeItems: "center",
        padding: "var(--sp-6)",
      }}
    >
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: "var(--r-4)",
          padding: "var(--sp-5)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--sp-4)",
          maxWidth: "94vw",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
          {(["brush", "eraser"] as const).map((tool) => (
            <button
              key={tool}
              data-mask-tool={tool}
              onClick={() => setErase(tool === "eraser")}
              style={{
                ...btn,
                background: erase === (tool === "eraser") ? "var(--accent)" : "var(--panel)",
                color: erase === (tool === "eraser") ? "var(--accent-on)" : "var(--ink-soft)",
              }}
            >
              {tool === "brush" ? Icon.brush : Icon.eraser}
            </button>
          ))}
          <label style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", fontSize: "var(--text-2xs)" }}>
            <span style={{ color: "var(--ink-faint)" }}>{t("imgIn.mask")}</span>
            <input
              type="range"
              data-mask-brush
              min={5}
              max={100}
              value={brush}
              onChange={(e) => setBrush(Number(e.target.value))}
            />
            <span style={{ width: 22, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{brush}</span>
          </label>
          <span style={{ flex: 1 }} />
          <button data-mask-clear onClick={clear} style={btn}>{Icon.trash}</button>
          <button data-mask-invert onClick={invert} style={btn}>{Icon.refresh}</button>
        </div>

        <div
          style={{ position: "relative", width: size.dw, height: size.dh, margin: "0 auto", touchAction: "none" }}
        >
          <canvas ref={imgRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
          {/* ★마스크는 반투명으로 얹어 보여 준다 — 내보낼 때는 캔버스 원본(순흑백)을 쓴다 */}
          <canvas
            ref={maskRef}
            data-mask-canvas
            onPointerDown={(e) => {
              drawing.current = true;
              lastCell.current = null;
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              paint(e);
            }}
            onPointerMove={paint}
            onPointerUp={() => { drawing.current = false; lastCell.current = null; refitRect(); }}
            onPointerCancel={() => { drawing.current = false; lastCell.current = null; refitRect(); }}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              opacity: 0.55,
              mixBlendMode: "screen",
              cursor: "crosshair",
            }}
          />

          {/* ★크롭 사각형 — **이 안만 NAI 로 간다.** 밖은 원본이 그대로 남는다.
              끌면 옮겨지고, 크기 단추로 후보를 돌린다. 자동으로 잡히므로 안 건드려도 된다 */}
          {needTile && rect && (
            <div
              data-mask-rect={`${rect.x},${rect.y},${rect.w},${rect.h}`}
              onPointerDown={(e) => {
                e.stopPropagation();
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                dragRect.current = { x: e.clientX, y: e.clientY, rx: rect.x, ry: rect.y };
              }}
              onPointerMove={(e) => {
                const d = dragRect.current;
                if (!d) return;
                // 화면 좌표 → 판 좌표 (판이 축소돼 보이고 있다)
                const k = size.w / Math.max(1, size.dw);
                setRect(clampRect({
                  ...rect,
                  x: Math.round(d.rx + (e.clientX - d.x) * k),
                  y: Math.round(d.ry + (e.clientY - d.y) * k),
                }, size.w, size.h));
              }}
              onPointerUp={() => { dragRect.current = null; }}
              onPointerCancel={() => { dragRect.current = null; }}
              style={{
                position: "absolute",
                left: `${(rect.x / size.w) * 100}%`,
                top: `${(rect.y / size.h) * 100}%`,
                width: `${(rect.w / size.w) * 100}%`,
                height: `${(rect.h / size.h) * 100}%`,
                border: "2px solid var(--accent)",
                boxShadow: "0 0 0 9999px rgba(6,8,12,0.45)",
                cursor: "move",
                touchAction: "none",
              }}
            />
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", fontSize: "var(--text-2xs)" }}>
            <span style={{ color: "var(--ink-faint)" }}>{t("imgIn.strength")}</span>
            <input
              type="range"
              data-mask-strength
              min={0.01}
              max={0.99}
              step={0.01}
              value={str}
              onChange={(e) => setStr(Number(e.target.value))}
            />
            <span style={{ width: 30, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{str}</span>
          </label>
          {needTile && rect && (
            <button data-mask-size onClick={cycleSize} style={btn} title={t("imgIn.tileHint")}>
              {rect.w}×{rect.h}
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button data-mask-cancel onClick={onCancel} style={btn}>{t("imgIn.maskCancel")}</button>
          <button
            data-mask-apply
            onClick={() => {
              const png = maskRef.current!.toDataURL("image/png").split(",")[1];
              // ★사각형은 **원본 좌표계**로 돌려준다 — 판은 64 배수로 맞춰져 있어 배율이 다르다
              const k = natural.current.w / Math.max(1, size.w);
              onApply(png, str, needTile && rect ? {
                x: Math.round(rect.x * k), y: Math.round(rect.y * k),
                w: Math.round(rect.w * k), h: Math.round(rect.h * k),
              } : null);
            }}
            style={{ ...btn, background: "var(--accent)", color: "var(--accent-on)" }}
          >
            {t("imgIn.maskApply")}
          </button>
        </div>
      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: "var(--r-2)",
  padding: "var(--sp-2) var(--sp-4)",
  fontSize: "var(--text-xs)",
  color: "var(--ink-soft)",
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--sp-2)",
};
