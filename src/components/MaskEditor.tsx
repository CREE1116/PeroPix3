import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { Icon } from "./Icon";
import { alignTo64 } from "../store/gen";
import { useImageInput } from "../store/imageInput";
import {
  MIN_RECT,
  SAFE_MARGIN,
  canFocus,
  clampRect,
  focusedPlan,
  innerRect,
  type Rect,
} from "../lib/focused";

/** 인페인트 마스크 에디터. **캔버스 자리를 대신한다** (모달이 아니다).
 *
 *  ★★여기는 **마스크를 만드는 곳일 뿐**이다 (사용자 지시 2026-08-19).
 *    인페인트 자체는 i2i 와 똑같이 왼쪽 생성부의 **베이스 이미지 옵션**이고, 생성은
 *    아래 「생성」 버튼이 한다. 예전에는 이 화면 안에 실행 버튼·강도·비용이 따로 있어서
 *    같은 값을 두 곳에서 만졌고, 인페인트만 씬 파이프라인 밖으로 나가 있었다.
 *
 *  ★그린 것은 **Ctrl+Z 로 되돌린다** (사용자 지시 2026-08-19). 되돌림 단위는 **한 획**이고,
 *    지우기·반전도 한 단계다.
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

/** 칠한 자리를 보여 주는 색. ★보내는 마스크와 무관하다 (그쪽은 순흑백이다).
 *  파랑 계열은 사각형 테두리와 겹쳐서 빨강을 쓴다. */
const PAINT_COLOR = "rgba(255,64,96,0.55)";

export function MaskEditor() {
  const t = useI18n((s) => s.t);
  const image = useImageInput((s) => s.baseImage);
  const baseName = useImageInput((s) => s.baseName);
  const savedMask = useImageInput((s) => s.baseMask);
  const focused = useImageInput((s) => s.focused);
  const rectNatural = useImageInput((s) => s.tileRect);
  const baseSize = useImageInput((s) => s.baseSize);

  const maskRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLCanvasElement>(null);
  const showRef = useRef<HTMLCanvasElement>(null);
  const overRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [brush, setBrush] = useState(30);
  const [erase, setErase] = useState(false);
  /** 이미 칠한 칸 — 다시 칠하지 않는다 (v2 `paintedCells`) */
  const painted = useRef(new Set<string>());
  const [count, setCount] = useState(0);
  /** ★되돌리기 더미. **칠한 칸이 곧 마스크**라(칸은 8px 순흑백) 판을 통째로 떠 두지 않고
   *  칸마다 1바이트로 얼려 둔다 — 2048² 짜리도 한 걸음이 64KB 다 (256×256 칸). */
  const [undos, setUndos] = useState<Uint8Array[]>([]);
  /** 원본 픽셀 크기 — 판은 64 배수로 맞춰져 있어 좌표를 되돌릴 때 쓴다 */
  const natural = useRef({ w: 0, h: 0 });
  const drag = useRef<{ kind: "move" | "size"; corner?: string; sx: number; sy: number; r0: Rect } | null>(null);
  const drawing = useRef(false);
  const lastCell = useRef<{ gx: number; gy: number } | null>(null);

  /** 판 좌표계의 사각형. 저장은 원본 좌표계라 여기서 갈아 신는다 */
  const kx = size.w ? natural.current.w / size.w : 1;
  const ky = size.h ? natural.current.h / size.h : 1;
  const rect: Rect | null =
    focused && rectNatural && size.w
      ? {
          x: Math.round(rectNatural.x / kx),
          y: Math.round(rectNatural.y / ky),
          w: Math.round(rectNatural.w / kx),
          h: Math.round(rectNatural.h / ky),
        }
      : null;

  // 그림을 올리고 판을 맞춘다
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      natural.current = { w: img.width, h: img.height };
      const w = alignTo64(img.width);
      const h = alignTo64(img.height);
      setSize({ w, h });
      const ic = imgRef.current!;
      const mc = maskRef.current!;
      const sc = showRef.current!;
      const oc = overRef.current!;
      ic.width = mc.width = sc.width = oc.width = w;
      ic.height = mc.height = sc.height = oc.height = h;
      ic.getContext("2d")!.drawImage(img, 0, 0, w, h);
      const mx = mc.getContext("2d")!;
      mx.fillStyle = "black";
      mx.fillRect(0, 0, w, h);
      sc.getContext("2d")!.clearRect(0, 0, w, h);
      painted.current.clear();
      setCount(0);
      // 다른 그림으로 갈아탔으면 되돌릴 것도 그 그림 것이 아니다
      setUndos([]);
      if (savedMask) {
        const m = new Image();
        m.onload = () => {
          mx.drawImage(m, 0, 0, w, h);
          syncPainted(mx, w, h);
          repaintShow();
          setCount(painted.current.size);
        };
        m.src = "data:image/png;base64," + savedMask;
      }
    };
    img.src = "data:image/png;base64," + image;
    // ★마스크는 **들어올 때 한 번만** 읽는다. 칠할 때마다 저장하므로, savedMask 를 따라
    //   다시 그리면 칠하는 도중에 판이 갈아 끼워진다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image]);

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

  /** 보여 주는 판을 칠한 칸에서 다시 그린다 (되읽기·반전·지우기 뒤) */
  const repaintShow = () => {
    const sc = showRef.current;
    if (!sc) return;
    const sx = sc.getContext("2d")!;
    sx.clearRect(0, 0, sc.width, sc.height);
    sx.fillStyle = PAINT_COLOR;
    for (const key of painted.current) {
      const [gx, gy] = key.split(",").map(Number);
      sx.fillRect(gx * GRID, gy * GRID, GRID, GRID);
    }
  };

  /** 칠한 것을 스토어에 넣는다. ★빈 판은 **빈 문자열**로 둔다. 그래야 「아무것도 안 칠하면
   *  사각형 안쪽 전체」가 보낼 때 만들어진다 (`lib/focused.wholeRectMask`) */
  const commit = () => {
    const s = useImageInput.getState();
    s.patchBase({ baseMask: painted.current.size ? maskRef.current!.toDataURL("image/png").split(",")[1] : "" });
    setCount(painted.current.size);
  };

  /** ★되돌리기 — 한 걸음은 **한 획**이다 (긋는 동안이 아니라 시작할 때 찍는다).
   *  지우기·반전도 같은 한 걸음이다. 더미가 깊어지면 오래된 것부터 버린다. */
  const UNDO_MAX = 40;
  const cols = () => Math.floor(size.w / GRID);
  const mark = () => {
    const c = cols();
    const rows = Math.floor(size.h / GRID);
    const a = new Uint8Array(c * rows);
    for (const k of painted.current) {
      const i = k.indexOf(",");
      const gx = +k.slice(0, i);
      const gy = +k.slice(i + 1);
      if (gx < c && gy < rows) a[gy * c + gx] = 1;
    }
    setUndos((u) => [...u.slice(-(UNDO_MAX - 1)), a]);
  };
  const undo = () => {
    const prev = undos[undos.length - 1];
    const canvas = maskRef.current;
    if (!prev || !canvas) return;
    setUndos((u) => u.slice(0, -1));
    const mx = canvas.getContext("2d")!;
    mx.fillStyle = "black";
    mx.fillRect(0, 0, canvas.width, canvas.height);
    painted.current.clear();
    const c = cols();
    mx.fillStyle = "white";
    for (let i = 0; i < prev.length; i++) {
      if (!prev[i]) continue;
      const gx = i % c;
      const gy = (i / c) | 0;
      mx.fillRect(gx * GRID, gy * GRID, GRID, GRID);
      painted.current.add(`${gx},${gy}`);
    }
    repaintShow();
    commit();
  };

  /** ★`Ctrl+Z` (사용자 지시 2026-08-19). 글 상자 안에서 누른 것은 그 칸 것이라 비켜 간다 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "z" || !(e.ctrlKey || e.metaKey) || e.shiftKey) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest("input, textarea, [contenteditable='true']")) return;
      e.preventDefault();
      undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undos, size.w, size.h]);

  /** 화면 좌표 → 판 좌표.
   *  ★자를 대는 것은 **화면에 보이는 판**(overlay)이다. 데이터 판(mask)은 `display:none` 이라
   *    `getBoundingClientRect()` 가 전부 0 이고, 그러면 칠하기도 사각형 끌기도 통째로 죽는다
   *    (실측 2026-08-14: 조작 테스트가 잡았다. 사각형이 아예 안 움직였다). */
  const at = (e: React.PointerEvent) => {
    const c = overRef.current!;
    const r = c.getBoundingClientRect();
    if (!r.width || !r.height) return { x: 0, y: 0 };
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) };
  };

  const cellAt = (e: React.PointerEvent) => {
    const c = overRef.current!;
    const p = at(e);
    const maxX = Math.floor(c.width / GRID) - 1;
    const maxY = Math.floor(c.height / GRID) - 1;
    return {
      gx: Math.max(0, Math.min(Math.floor(p.x / GRID), maxX)),
      gy: Math.max(0, Math.min(Math.floor(p.y / GRID), maxY)),
    };
  };

  /** 한 칸을 칠한다 (지우개와 무관). ★사각형 **안쪽**만 칠한다: 테두리 96px 은 문맥으로만
   *  나가고 밖은 아예 안 나간다. 여기서 막지 않으면 "칠했는데 안 고쳐지는" 자리가 생긴다. */
  const paintCell = (mx: CanvasRenderingContext2D, gx: number, gy: number) => {
    const key = `${gx},${gy}`;
    if (rect) {
      const i = innerRect(rect);
      const cx = gx * GRID + GRID / 2;
      const cy = gy * GRID + GRID / 2;
      if (cx < i.x || cy < i.y || cx > i.x + i.w || cy > i.y + i.h) return;
    }
    if (painted.current.has(key)) return;
    // ★두 판을 **함께** 칠한다: 보내는 것은 순흑백(mx), 보이는 것은 빨강(show).
    //   한 판으로 겸하면 흰 마스크가 밝은 그림 위에서 안 보인다 (사용자 지적 2026-08-13)
    mx.fillStyle = "white";
    mx.fillRect(gx * GRID, gy * GRID, GRID, GRID);
    const sx = showRef.current!.getContext("2d")!;
    sx.fillStyle = PAINT_COLOR;
    sx.fillRect(gx * GRID, gy * GRID, GRID, GRID);
    painted.current.add(key);
  };

  const fillCell = (mx: CanvasRenderingContext2D, gx: number, gy: number) => {
    if (!erase) return paintCell(mx, gx, gy);
    mx.fillStyle = "black";
    mx.fillRect(gx * GRID, gy * GRID, GRID, GRID);
    showRef.current!.getContext("2d")!.clearRect(gx * GRID, gy * GRID, GRID, GRID);
    painted.current.delete(`${gx},${gy}`);
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

  /** 사각형을 원본 좌표계로 되돌려 저장한다 */
  const putRect = (r: Rect) =>
    useImageInput.getState().setTileRect({
      x: Math.round(r.x * kx), y: Math.round(r.y * ky),
      w: Math.round(r.w * kx), h: Math.round(r.h * ky),
    });

  /** 모서리를 잡았나 · 띠를 잡았나 · 칠하는가 */
  const hitOf = (p: { x: number; y: number }) => {
    if (!rect) return "paint";
    const grab = Math.max(18, 44 / Math.max(kx, 1));
    for (const [hx, hy, k] of [
      [rect.x, rect.y, "nw"], [rect.x + rect.w, rect.y, "ne"],
      [rect.x, rect.y + rect.h, "sw"], [rect.x + rect.w, rect.y + rect.h, "se"],
    ] as [number, number, string][])
      if (Math.abs(p.x - hx) < grab && Math.abs(p.y - hy) < grab) return k;
    const i = innerRect(rect);
    if (p.x >= i.x && p.x <= i.x + i.w && p.y >= i.y && p.y <= i.y + i.h) return "paint";
    if (p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h) return "move";
    return "outside";
  };

  // 사각형·테두리·안내를 겹쳐 그린다 (칠은 마스크 판이 따로 그린다)
  useEffect(() => {
    const oc = overRef.current;
    if (!oc || !size.w) return;
    const o = oc.getContext("2d")!;
    o.clearRect(0, 0, size.w, size.h);
    if (!rect) return;
    const i = innerRect(rect);
    o.fillStyle = "rgba(6,8,12,0.5)";
    o.fillRect(0, 0, size.w, rect.y);
    o.fillRect(0, rect.y + rect.h, size.w, size.h - rect.y - rect.h);
    o.fillRect(0, rect.y, rect.x, rect.h);
    o.fillRect(rect.x + rect.w, rect.y, size.w - rect.x - rect.w, rect.h);
    // 여백 띠. 여기는 문맥으로만 간다 (칠이 안 된다)
    o.fillStyle = "rgba(106,166,255,0.14)";
    o.fillRect(rect.x, rect.y, rect.w, SAFE_MARGIN);
    o.fillRect(rect.x, rect.y + rect.h - SAFE_MARGIN, rect.w, SAFE_MARGIN);
    o.fillRect(rect.x, i.y, SAFE_MARGIN, i.h);
    o.fillRect(rect.x + rect.w - SAFE_MARGIN, i.y, SAFE_MARGIN, i.h);
    o.strokeStyle = "#6aa6ff";
    o.lineWidth = Math.max(2, Math.round(size.w / 420));
    o.strokeRect(rect.x, rect.y, rect.w, rect.h);
    const hs = Math.max(8, Math.round(size.w / 120));
    o.fillStyle = "#6aa6ff";
    for (const [hx, hy] of [
      [rect.x, rect.y], [rect.x + rect.w, rect.y],
      [rect.x, rect.y + rect.h], [rect.x + rect.w, rect.y + rect.h],
    ])
      o.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
    // ★보내는 크기와 확대율은 **사각형에 붙여** 적는다. 그림을 안 가리게 테두리 바깥쪽에
    const plan = focusedPlan({ ...rect, w: Math.round(rect.w * kx), h: Math.round(rect.h * ky) });
    const label = `${plan.req.width}×${plan.req.height}${plan.scale >= 1.05 ? `  ×${plan.scale.toFixed(1)}` : ""}`;
    const fs = Math.max(13, Math.round(size.w / 52));
    o.font = `${fs}px ui-monospace, Consolas, monospace`;
    o.fillStyle = "#6aa6ff";
    const tw = o.measureText(label).width;
    const lx = Math.max(2, Math.min(rect.x, size.w - tw - 4));
    o.fillText(label, lx, rect.y - fs * 0.4 > fs ? rect.y - fs * 0.4 : rect.y + rect.h + fs);
  }, [rect?.x, rect?.y, rect?.w, rect?.h, size.w, size.h, kx, ky]);

  const clear = () => {
    mark();
    const c = maskRef.current!;
    const mx = c.getContext("2d")!;
    mx.fillStyle = "black";
    mx.fillRect(0, 0, c.width, c.height);
    painted.current.clear();
    repaintShow();
    commit();
  };

  /** 반전 — 칠한 칸과 아닌 칸을 맞바꾼다 */
  const invert = () => {
    mark();
    const c = maskRef.current!;
    const mx = c.getContext("2d")!;
    const cols = Math.floor(c.width / GRID);
    const rows = Math.floor(c.height / GRID);
    const keep = new Set(painted.current);
    mx.fillStyle = "black";
    mx.fillRect(0, 0, c.width, c.height);
    showRef.current!.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    painted.current.clear();
    // ★`paintCell` 을 쓴다: 사각형 안쪽 제한이 반전에도 걸려야 하고, **지우개가 켜져 있어도
    //   반전은 칠해야 한다** (`fillCell` 은 지우개를 본다)
    for (let gy = 0; gy < rows; gy++)
      for (let gx = 0; gx < cols; gx++) if (!keep.has(`${gx},${gy}`)) paintCell(mx, gx, gy);
    commit();
  };

  const ready = size.w > 0;
  const plan = rectNatural && focused ? focusedPlan(rectNatural) : null;
  const big = !!baseSize && canFocus(baseSize.w, baseSize.h);

  return (
    <div
      data-mask-editor
      style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", padding: "0 var(--sp-4)" }}>
        {/* ★지금 무슨 상황인지 **맨 앞에서** 말한다. 화면이 통째로 바뀌는 자리라,
            무엇을 하는 중인지와 어느 그림인지가 한눈에 보여야 한다 */}
        <span
          data-mask-title
          style={{
            display: "inline-flex", alignItems: "center", gap: "var(--sp-2)",
            padding: "3px var(--sp-3)", borderRadius: "var(--r-2)",
            background: "var(--accent-bg, var(--panel))", border: "1px solid var(--accent)",
            fontSize: "var(--text-2xs)", color: "var(--accent)", fontWeight: "var(--w-semi)",
            flexShrink: 0, maxWidth: 260,
          }}
        >
          {Icon.brush}
          {t("imgIn.inpaint")}
          <span style={{ color: "var(--ink-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {baseName}
          </span>
        </span>
        <span style={{ width: 1, alignSelf: "stretch", background: "var(--line)" }} />
        {(["brush", "eraser"] as const).map((tool) => (
          <button
            key={tool}
            data-mask-tool={tool}
            onClick={() => setErase(tool === "eraser")}
            title={t(tool === "brush" ? "imgIn.brush" : "imgIn.eraser")}
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
          <span style={{ color: "var(--ink-faint)" }}>{t("imgIn.brushSize")}</span>
          <input type="range" data-mask-brush min={5} max={100} value={brush} style={{ width: 84 }}
                 onChange={(e) => setBrush(Number(e.target.value))} />
          <span style={{ width: 22, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{brush}</span>
        </label>
        {/* ★강도 슬라이더는 여기 없다 — **왼쪽 생성부의 베이스 이미지 옵션 하나**다
            (사용자 지시 2026-08-19, 하나의 정보에는 하나의 창구). 그 패널은 칠하는 동안에도
            그대로 보이므로, 여기 또 두면 같은 값을 두 곳에서 만지는 화면이 된다. */}
        <button
          data-mask-undo
          onClick={undo}
          disabled={!undos.length}
          style={{ ...btn, color: undos.length ? "var(--ink-soft)" : "var(--ink-ghost)" }}
          title={t("imgIn.maskUndo")}
        >
          {Icon.undo}
        </button>
        <button data-mask-clear onClick={clear} style={btn} title={t("imgIn.maskClear")}>{Icon.trash}</button>
        <button data-mask-invert onClick={invert} style={btn} title={t("imgIn.maskInvert")}>{Icon.refresh}</button>

        <span style={{ flex: 1 }} />
        {/* 지금 무엇이 나가는지 한 줄. 칠한 것이 없으면 사각형 안쪽 전체다 */}
        <span data-mask-report style={{ fontSize: "var(--text-2xs)", color: "var(--ink-faint)" }}>
          {plan
            ? count
              ? t("focus.willSend", { w: plan.req.width, h: plan.req.height, s: plan.scale.toFixed(1) })
              : t("focus.willSendWhole", { w: plan.req.width, h: plan.req.height })
            : big
              ? t("focus.offWarn")
              : count
                ? ""
                : t("focus.paintFirst")}
        </span>
        {/* ★실행 버튼은 여기 없다 — 「생성」이 한다 (사용자 지시 2026-08-19).
            칠하기를 끝내지 않아도 눌리므로, 이 단추는 화면을 닫는 것뿐이다. */}
        <button
          data-mask-done
          onClick={() => useImageInput.getState().endEdit()}
          title={t("imgIn.maskDoneBtn")}
          style={{ ...btn, background: "var(--panel)", padding: "var(--sp-2)" }}
        >
          {Icon.close}
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "grid", placeItems: "center", padding: "0 var(--sp-4) var(--sp-2)" }}>
        <div
          style={{
            position: "relative",
            // ★비율은 `aspect-ratio` 가 지킨다. 높이를 채우고 넘치면 max-width 가 줄인다
            aspectRatio: ready ? `${size.w} / ${size.h}` : "1",
            width: "auto",
            height: "100%",
            maxWidth: "100%",
            touchAction: "none",
            border: "1px solid var(--line)",
            borderRadius: "var(--r-2)",
            overflow: "hidden",
            background: "var(--panel)",
          }}
        >
          <canvas ref={imgRef} style={layer} />
          {/* ★보내는 마스크는 순흑백이라 화면에 그대로 얹으면 밝은 그림 위에서 안 보인다.
              그래서 **데이터 판은 숨기고**(mask) 보여 주는 판을 따로 둔다(show). */}
          <canvas ref={maskRef} data-mask-canvas style={{ display: "none" }} />
          <canvas ref={showRef} data-mask-show style={layer} />
          <canvas
            ref={overRef}
            data-mask-overlay
            /* 사각형을 표식으로도 내놓는다. 조작 테스트가 픽셀을 재지 않고 값을 본다 */
            data-mask-rect={rectNatural && focused ? `${rectNatural.x},${rectNatural.y},${rectNatural.w},${rectNatural.h}` : undefined}
            style={{ ...layer, cursor: "crosshair" }}
            onPointerDown={(e) => {
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              const p = at(e);
              if (rect) {
                const hit = hitOf(p);
                if (hit === "outside") return;
                if (hit === "move") { drag.current = { kind: "move", sx: p.x, sy: p.y, r0: rect }; return; }
                if (hit !== "paint") { drag.current = { kind: "size", corner: hit, sx: p.x, sy: p.y, r0: rect }; return; }
              }
              // 한 획이 한 걸음이다 — 긋기 **전에** 지금 상태를 얼려 둔다
              mark();
              drawing.current = true;
              lastCell.current = null;
              paint(e);
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (d) {
                const p = at(e);
                if (d.kind === "move") {
                  putRect(clampRect(
                    { ...d.r0, x: d.r0.x + (p.x - d.sx), y: d.r0.y + (p.y - d.sy) },
                    size.w, size.h,
                    { x: d.r0.x + (p.x - d.sx), y: d.r0.y + (p.y - d.sy) },
                  ));
                } else {
                  // ★잡은 모서리만 움직인다. 맞은편은 못 박혀 있다 (사용자 지적 2026-08-13)
                  const ax = d.corner!.includes("e") ? d.r0.x : d.r0.x + d.r0.w;
                  const ay = d.corner!.includes("s") ? d.r0.y : d.r0.y + d.r0.h;
                  const cx = Math.max(0, Math.min(size.w, p.x));
                  const cy = Math.max(0, Math.min(size.h, p.y));
                  let w = Math.max(MIN_RECT, Math.abs(cx - ax));
                  let h = Math.max(MIN_RECT, Math.abs(cy - ay));
                  w = Math.min(w, cx < ax ? ax : size.w - ax);
                  h = Math.min(h, cy < ay ? ay : size.h - ay);
                  const fit = clampRect({ x: 0, y: 0, w, h }, size.w, size.h);
                  putRect(clampRect(
                    { ...fit, x: cx < ax ? ax - fit.w : ax, y: cy < ay ? ay - fit.h : ay },
                    size.w, size.h,
                    { x: cx < ax ? ax - fit.w : ax, y: cy < ay ? ay - fit.h : ay },
                  ));
                }
                return;
              }
              if (e.buttons & 1) paint(e);
            }}
            onPointerUp={() => {
              drag.current = null;
              if (drawing.current) { drawing.current = false; lastCell.current = null; commit(); }
            }}
            onPointerCancel={() => {
              drag.current = null;
              if (drawing.current) { drawing.current = false; lastCell.current = null; commit(); }
            }}
          />
        </div>
      </div>
    </div>
  );
}

const layer: React.CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%" };

const btn: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: "var(--r-2)",
  padding: "var(--sp-2) var(--sp-3)",
  fontSize: "var(--text-xs)",
  color: "var(--ink-soft)",
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--sp-2)",
};
