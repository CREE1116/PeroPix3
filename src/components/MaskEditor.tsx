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

export function MaskEditor({
  image,
  mask,
  strength,
  onCancel,
  onApply,
}: {
  image: string;
  mask: string;
  strength: number;
  onCancel: () => void;
  onApply: (mask: string, strength: number) => void;
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
  const drawing = useRef(false);
  const lastCell = useRef<{ gx: number; gy: number } | null>(null);

  // 그림을 올리고 판을 맞춘다
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
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
            onPointerUp={() => { drawing.current = false; lastCell.current = null; }}
            onPointerCancel={() => { drawing.current = false; lastCell.current = null; }}
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
          <span style={{ flex: 1 }} />
          <button data-mask-cancel onClick={onCancel} style={btn}>{t("imgIn.maskCancel")}</button>
          <button
            data-mask-apply
            onClick={() => onApply(maskRef.current!.toDataURL("image/png").split(",")[1], str)}
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
