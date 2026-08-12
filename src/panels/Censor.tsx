import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { useCensor } from "../store/censor";
import { useFiles, type FileNode } from "../store/files";
import { useGen } from "../store/gen";
import { fileMgrImg, fileMgrThumb } from "../lib/imgUrl";
import { toast } from "../store/toast";
import { Icon } from "../components/Icon";
import { onNearBottom } from "../lib/nearBottom";

/** 검열 — 가릴 곳을 찾아 가린다 (8단계).
 *
 *  ★**찾기와 가리기 사이에 사람이 있다.** 찾은 박스를 보고 끄거나 더 그린 뒤에 적용한다 —
 *    자동으로 바로 덮으면 잘못 찾은 것을 눈으로 잡을 기회가 없다.
 *  ★결과는 **새 파일**이다 (`_censored`). 원본은 그대로 남는다.
 *  ★고를 그림은 **파일 관리와 같은 트리**에서 고른다 (`useFiles`) — 목록을 두 벌 만들지 않는다.
 */
export function Censor() {
  const t = useI18n((s) => s.t);
  const base = useGen((s) => s.base);
  const c = useCensor();
  const { tree, folder, items, open: opened, hasMore, loadTree, go, more, toggleOpen } = useFiles();
  const onScroll = onNearBottom(() => void more());
  const [draw, setDraw] = useState<{ x: number; y: number; x2: number; y2: number } | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    void c.loadModels();
    void loadTree().then(() => useFiles.getState().go(useFiles.getState().folder));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (c.saved) toast(t("censor.saved", { n: c.saved }));
  }, [c.saved, t]);

  const classes = c.models.find((m) => m.file === c.model)?.classes ?? [];

  /** 화면 좌표 → 그림 좌표 */
  const toImage = (e: React.PointerEvent) => {
    const el = imgRef.current;
    if (!el || !c.size) return null;
    const r = el.getBoundingClientRect();
    const sx = c.size.w / r.width;
    const sy = c.size.h / r.height;
    return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
  };

  const Row = ({ node, depth }: { node: FileNode; depth: number }) => (
    <>
      <div
        data-folder={node.path}
        onClick={() => void go(node.path)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: `2px var(--sp-2) 2px ${8 + depth * 12}px`,
          borderRadius: "var(--r-1)",
          fontSize: "var(--text-2xs)",
          cursor: "pointer",
          color: folder === node.path ? "var(--ink)" : "var(--ink-soft)",
          background: folder === node.path ? "var(--raise)" : undefined,
        }}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggleOpen(node.path);
          }}
          style={{
            width: 14,
            display: "grid",
            placeItems: "center",
            color: "var(--ink-faint)",
            visibility: node.children.length ? "visible" : "hidden",
          }}
        >
          {opened.has(node.path) ? Icon.chevronDown : Icon.chevronRight}
        </button>
        <span style={{ display: "grid", color: "var(--ink-faint)" }}>{Icon.folder}</span>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {node.name}
        </span>
        {!!node.count && <span style={{ color: "var(--ink-faint)" }}>{node.count}</span>}
      </div>
      {opened.has(node.path) && node.children.map((x) => <Row key={x.path} node={x} depth={depth + 1} />)}
    </>
  );

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", gap: "var(--sp-4)", padding: "var(--sp-4)" }}>
      {/* 왼쪽 — 어느 그림 */}
      <div style={{ width: 220, flexShrink: 0, display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
        <div style={{ ...card, flex: "0 0 40%", overflowY: "auto", padding: "var(--sp-2)" }}>
          {tree.map((n) => (
            <Row key={n.path} node={n} depth={0} />
          ))}
        </div>
        <div
          data-censor-picker
          onScroll={onScroll}
          style={{
            ...card,
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: "var(--sp-2)",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(60px, 1fr))",
            gridAutoRows: "min-content",
            gap: "var(--sp-2)",
            alignContent: "start",
          }}
        >
          {items.map((it) => (
            <button
              key={it.file}
              data-censor-pick={it.file}
              onClick={() => c.open(it.file)}
              title={it.name}
              style={{
                aspectRatio: "1 / 1",
                borderRadius: "var(--r-2)",
                overflow: "hidden",
                border: `2px solid ${c.target === it.file ? "var(--accent)" : "transparent"}`,
                padding: 0,
                background: "var(--bg)",
              }}
            >
              <img
                src={fileMgrThumb(base, it.file)}
                alt=""
                loading="lazy"
                decoding="async"
                style={{ width: "100%", height: "100%", objectFit: "contain" }}
              />
            </button>
          ))}
          {hasMore && (
            <span style={{ gridColumn: "1/-1", textAlign: "center", fontSize: "var(--text-2xs)", color: "var(--ink-faint)" }}>
              …
            </span>
          )}
          {!items.length && (
            <span style={{ gridColumn: "1/-1", margin: "auto", fontSize: "var(--text-2xs)", color: "var(--ink-faint)" }}>
              {t("files.empty")}
            </span>
          )}
        </div>
      </div>

      {/* 가운데 — 찾은 것을 눈으로 */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
          <span style={{ fontSize: "var(--text-xs)", color: "var(--ink-soft)", fontWeight: "var(--w-semi)" }}>
            {c.target ? c.target.split("/").pop() : t("censor.pickImage")}
          </span>
          <span style={{ flex: 1 }} />
          {!!c.boxes.length && (
            <span style={{ fontSize: "var(--text-2xs)", color: "var(--ink-faint)" }}>
              {t("censor.found", { n: c.boxes.filter((b) => !b.off).length })}
            </span>
          )}
          <button data-censor-detect onClick={() => void c.detect()} disabled={!c.target || c.busy} style={btn}>
            {t("censor.detect")}
          </button>
        </div>

        <div
          data-censor-stage
          style={{
            flex: 1,
            minHeight: 0,
            ...card,
            display: "grid",
            placeItems: "center",
            overflow: "hidden",
            position: "relative",
          }}
        >
          {c.target ? (
            <div style={{ position: "relative", maxWidth: "100%", maxHeight: "100%", lineHeight: 0 }}>
              <img
                ref={imgRef}
                data-censor-img
                src={fileMgrImg(base, c.target)}
                alt=""
                draggable={false}
                onLoad={(e) =>
                  c.set({ size: { w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight } })
                }
                style={{ maxWidth: "100%", maxHeight: "72vh", objectFit: "contain", userSelect: "none" }}
              />
              {/* 박스 층 — ★그림 위에 얹지만 그림을 가리지 않는다 (반투명 테두리만) */}
              <svg
                viewBox={c.size ? `0 0 ${c.size.w} ${c.size.h}` : undefined}
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", cursor: "crosshair" }}
                onPointerDown={(e) => {
                  const p = toImage(e);
                  if (!p) return;
                  (e.target as Element).setPointerCapture?.(e.pointerId);
                  setDraw({ x: p.x, y: p.y, x2: p.x, y2: p.y });
                }}
                onPointerMove={(e) => {
                  if (!draw) return;
                  const p = toImage(e);
                  if (p) setDraw({ ...draw, x2: p.x, y2: p.y });
                }}
                onPointerUp={() => {
                  if (!draw) return;
                  const b: [number, number, number, number] = [
                    Math.round(Math.min(draw.x, draw.x2)),
                    Math.round(Math.min(draw.y, draw.y2)),
                    Math.round(Math.max(draw.x, draw.x2)),
                    Math.round(Math.max(draw.y, draw.y2)),
                  ];
                  // ★손이 떨린 정도는 박스가 아니다 — 너무 작으면 버린다
                  if (b[2] - b[0] > 8 && b[3] - b[1] > 8) c.addBox(b);
                  setDraw(null);
                }}
              >
                {c.boxes.map((b, i) => (
                  <g key={i} opacity={b.off ? 0.3 : 1}>
                    <rect
                      data-censor-box={i}
                      x={b.box[0]}
                      y={b.box[1]}
                      width={b.box[2] - b.box[0]}
                      height={b.box[3] - b.box[1]}
                      fill={b.off ? "none" : "rgba(220,60,60,0.14)"}
                      stroke={b.manual ? "var(--accent)" : "#dc3c3c"}
                      strokeWidth={Math.max(1, (c.size?.w ?? 1000) / 400)}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        c.toggleBox(i);
                      }}
                      style={{ cursor: "pointer" }}
                    />
                    <text
                      x={b.box[0] + 4}
                      y={b.box[1] - 4}
                      fill="#dc3c3c"
                      fontSize={Math.max(10, (c.size?.w ?? 1000) / 50)}
                      style={{ pointerEvents: "none" }}
                    >
                      {b.label} {b.manual ? "" : b.confidence}
                    </text>
                  </g>
                ))}
                {draw && (
                  <rect
                    x={Math.min(draw.x, draw.x2)}
                    y={Math.min(draw.y, draw.y2)}
                    width={Math.abs(draw.x2 - draw.x)}
                    height={Math.abs(draw.y2 - draw.y)}
                    fill="rgba(90,140,255,0.2)"
                    stroke="var(--accent)"
                    strokeWidth={Math.max(1, (c.size?.w ?? 1000) / 400)}
                  />
                )}
              </svg>
            </div>
          ) : (
            <span style={{ fontSize: "var(--text-2xs)", color: "var(--ink-faint)" }}>{t("censor.pickImage")}</span>
          )}
        </div>

        <span style={{ fontSize: "var(--text-2xs)", color: "var(--ink-faint)" }}>{t("censor.boxHint")}</span>
      </div>

      {/* 오른쪽 — 어떻게 가릴까 */}
      <div style={{ width: 250, flexShrink: 0, display: "flex", flexDirection: "column", gap: "var(--sp-4)", overflowY: "auto" }}>
        <Sec label={t("censor.model")}>
          <select
            data-censor-model
            value={c.model ?? ""}
            onChange={(e) => c.setModel(e.target.value)}
            style={{ ...box, width: "100%" }}
          >
            {c.models.map((m) => (
              <option key={m.file} value={m.file}>
                {m.id} · {Math.round(m.bytes / 1e6)}MB · {m.imgsz}px
              </option>
            ))}
          </select>
          <Hint>{t("censor.modelHint")}</Hint>
        </Sec>

        <Sec label={t("censor.targets")}>
          {classes.map((k) => (
            <label key={k} style={lbl}>
              <input
                type="checkbox"
                data-censor-target={k}
                checked={c.targets.includes(k)}
                onChange={() => c.toggleTarget(k)}
              />
              {k}
            </label>
          ))}
          <Line label={t("censor.conf")}>
            <input
              type="range"
              data-censor-conf
              min={0.05}
              max={0.9}
              step={0.05}
              value={c.conf}
              onChange={(e) => c.set({ conf: Number(e.target.value) })}
              style={{ flex: 1 }}
            />
            <span style={{ width: 28, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{c.conf}</span>
          </Line>
          <Hint>{t("censor.confHint")}</Hint>
        </Sec>

        <Sec label={t("censor.method")}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-2)" }}>
            {METHODS.map(([m, key]) => (
              <button
                key={m}
                data-censor-method={m}
                onClick={() => c.set({ method: m })}
                style={{ ...box, ...(c.method === m ? on : {}) }}
              >
                {t(key)}
              </button>
            ))}
          </div>
          {c.method === "color" && (
            <input type="color" value={c.color} onChange={(e) => c.set({ color: e.target.value })} style={{ width: "100%" }} />
          )}
          {c.method === "mosaic" && (
            <>
              <Line label={t("censor.grain")}>
                <input type="range" min={2} max={60} value={c.mosaic} onChange={(e) => c.set({ mosaic: Number(e.target.value) })} style={{ flex: 1 }} />
                <span style={num}>{c.mosaic}</span>
              </Line>
              <Line label={t("censor.opacity")}>
                <input type="range" min={0} max={100} value={c.mosaicOpacity} onChange={(e) => c.set({ mosaicOpacity: Number(e.target.value) })} style={{ flex: 1 }} />
                <span style={num}>{c.mosaicOpacity}</span>
              </Line>
            </>
          )}
          {c.method === "blur" && (
            <Line label={t("censor.blur")}>
              <input type="range" min={2} max={60} value={c.blur} onChange={(e) => c.set({ blur: Number(e.target.value) })} style={{ flex: 1 }} />
              <span style={num}>{c.blur}</span>
            </Line>
          )}
          <Line label={t("censor.expand")}>
            <input type="range" min={0} max={40} value={c.expand} onChange={(e) => c.set({ expand: Number(e.target.value) })} style={{ flex: 1 }} />
            <span style={num}>{c.expand}</span>
          </Line>
          <Line label={t("censor.feather")}>
            <input type="range" min={0} max={40} value={c.feather} onChange={(e) => c.set({ feather: Number(e.target.value) })} style={{ flex: 1 }} />
            <span style={num}>{c.feather}</span>
          </Line>
        </Sec>

        {c.error && (
          <span data-censor-error style={{ fontSize: "var(--text-2xs)", color: "var(--danger)" }}>
            {c.error}
          </span>
        )}

        <button
          data-censor-apply
          onClick={() => void c.apply()}
          disabled={c.busy || !c.boxes.some((b) => !b.off)}
          style={runBtn}
        >
          {t("censor.apply")}
        </button>
        <Hint>{t("censor.applyHint")}</Hint>
      </div>
    </div>
  );
}

/** ★키를 **문자열로 이어 만들지 않는다** — i18n 회귀가 잡고, 무엇보다 키가 조용히 빠져도
 *  아무도 모른다 (Settings.tsx 의 THEMES 와 같은 이유). */
const METHODS = [
  ["mosaic", "censor.m_mosaic"],
  ["blur", "censor.m_blur"],
  ["black", "censor.m_black"],
  ["white", "censor.m_white"],
  ["color", "censor.m_color"],
] as const;

const Sec = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
    <span style={{ fontSize: "var(--text-xs)", fontWeight: "var(--w-semi)", color: "var(--ink-soft)" }}>{label}</span>
    {children}
  </div>
);

const Line = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
    <span style={{ width: 46, flexShrink: 0, fontSize: "var(--text-2xs)", color: "var(--ink-faint)" }}>{label}</span>
    {children}
  </div>
);

const Hint = ({ children }: { children: React.ReactNode }) => (
  <span style={{ fontSize: "var(--text-2xs)", color: "var(--ink-faint)" }}>{children}</span>
);

const card: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: "var(--r-3)",
};
const box: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: "var(--r-2)",
  padding: "3px var(--sp-3)",
  fontSize: "var(--text-2xs)",
  color: "var(--ink-soft)",
};
const btn: React.CSSProperties = { ...box, fontWeight: "var(--w-semi)" };
const on: React.CSSProperties = { borderColor: "var(--accent)", background: "var(--accent-bg)", color: "var(--ink)" };
const lbl: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--sp-2)",
  fontSize: "var(--text-2xs)",
  color: "var(--ink-soft)",
};
const num: React.CSSProperties = { width: 28, textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: "var(--text-2xs)" };
const runBtn: React.CSSProperties = {
  background: "var(--accent)",
  color: "var(--accent-on)",
  borderRadius: "var(--r-2)",
  padding: "var(--sp-2)",
  fontSize: "var(--text-xs)",
  fontWeight: "var(--w-semi)",
};
