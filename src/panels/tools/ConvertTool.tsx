import { useState } from "react";
import { create } from "zustand";
import { useI18n } from "../../i18n";
import { api } from "../../lib/backend";
import { useImageDrop, type Dropped } from "../../lib/dropImages";
import { useFiles } from "../../store/files";
import { toast } from "../../store/toast";
import { Icon } from "../../components/Icon";

/** 이름 변환 — **형식과 이름을 한 번에** 바꾼다 (v2 `보조 도구 › 이미지 변환`).
 *
 *  ★밖에서 떨군 그림도 받는다 (`useImageDrop`). 앱에서는 경로가 오고, 브라우저에서는
 *    바이트가 온다 — 부르는 쪽은 몰라도 되게 서버가 둘 다 받는다.
 *  ★**원본을 지우지 않는다.** 늘 새 파일을 만들고, 이름이 겹치면 번호를 붙인다.
 *  ★번호는 **목록 차례**를 따른다. 그래서 목록 순서를 바꿀 수 있어야 한다.
 */
type Q = { items: Dropped[]; add: (x: Dropped[]) => void; clear: () => void };

/** 파일 관리에서 고른 것을 여기로 보내는 통로 — 창구를 둘로 만들지 않으려는 것 */
export const useConvertQueue = create<Q>((set, get) => ({
  items: [],
  add: (x) => set({ items: [...get().items, ...x] }),
  clear: () => set({ items: [] }),
}));

export function ConvertTool() {
  const t = useI18n((s) => s.t);
  const { items, add, clear } = useConvertQueue();
  const tree = useFiles((s) => s.tree);
  const [fmt, setFmt] = useState("png");
  const [quality, setQuality] = useState(95);
  const [strip, setStrip] = useState(false);
  const [ren, setRen] = useState(false);
  const [prefix, setPrefix] = useState("image");
  const [start, setStart] = useState(1);
  const [pad, setPad] = useState(3);
  const [dest, setDest] = useState("");
  const [busy, setBusy] = useState(false);
  const { zone, over, pick } = useImageDrop(add);

  // ★경로를 모르는 그림(브라우저 드롭)은 **원본 옆에** 둘 수가 없다 — 자리를 골라야 한다
  const needDest = items.some((i) => !i.path && !i.rel);
  const flat = flatten(tree);

  const drop = (i: number) => useConvertQueue.setState({ items: items.filter((_, n) => n !== i) });
  const swap = (i: number, j: number) => {
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    useConvertQueue.setState({ items: next });
  };

  const run = async () => {
    if (busy || !items.length) return;
    if (needDest && !dest) return toast(t("tools.needDest"), "warn");
    setBusy(true);
    try {
      const r = await api<{ results: { name: string; ok: boolean; error?: string }[]; ok: number }>(
        "/api/tools/convert",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items,
            fmt,
            quality,
            strip_metadata: strip,
            prefix: ren ? prefix : null,
            start,
            pad,
            dest,
          }),
        },
      );
      const bad = r.results.length - r.ok;
      toast(t("tools.converted", { n: r.ok, f: bad }), bad ? "warn" : "ok");
      if (r.ok) {
        clear();
        void useFiles.getState().reload();
      }
    } catch (e) {
      toast(String(e), "warn");
    } finally {
      setBusy(false);
    }
  };

  const example = ren ? `${prefix}${String(start).padStart(pad, "0")}.${fmt}` : `<원래 이름>.${fmt}`;

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", gap: "var(--sp-4)" }}>
      {/* 왼쪽 — 무엇을 */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
        <div
          {...zone}
          data-convert-drop
          onClick={() => void pick()}
          style={{
            border: `1px dashed ${over ? "var(--accent)" : "var(--line)"}`,
            background: over ? "var(--accent-bg)" : "var(--bg)",
            borderRadius: "var(--r-3)",
            padding: items.length ? "var(--sp-3)" : "var(--sp-8)",
            textAlign: "center",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <div style={{ fontSize: "var(--text-xs)", color: "var(--ink-soft)" }}>{t("tools.convertDrop")}</div>
          <div style={{ fontSize: "var(--text-2xs)", color: "var(--ink-faint)" }}>{t("tools.dropHint")}</div>
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: "var(--r-3)",
            padding: "var(--sp-2)",
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          {items.map((it, i) => (
            <div
              key={`${it.name}-${i}`}
              data-convert-row
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--sp-2)",
                padding: "3px var(--sp-2)",
                borderRadius: "var(--r-1)",
                fontSize: "var(--text-2xs)",
              }}
            >
              <span
                style={{
                  width: 30,
                  color: "var(--ink-faint)",
                  fontFamily: "var(--font-mono)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {ren ? String(start + i).padStart(pad, "0") : i + 1}
              </span>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {it.name}
              </span>
              <button onClick={() => swap(i, i - 1)} style={mini} title={t("tools.up")}>
                {Icon.chevronUp}
              </button>
              <button onClick={() => swap(i, i + 1)} style={mini} title={t("tools.down")}>
                {Icon.chevronDown}
              </button>
              <button onClick={() => drop(i)} style={mini} title={t("common.delete")}>
                {Icon.close12}
              </button>
            </div>
          ))}
          {!items.length && (
            <span style={{ margin: "auto", fontSize: "var(--text-2xs)", color: "var(--ink-faint)" }}>
              {t("tools.empty")}
            </span>
          )}
        </div>
      </div>

      {/* 오른쪽 — 어떻게 */}
      <div style={{ width: 260, flexShrink: 0, display: "flex", flexDirection: "column", gap: "var(--sp-4)", overflowY: "auto" }}>
        <Section label={t("tools.format")}>
          <div style={{ display: "flex", gap: "var(--sp-2)" }}>
            {["png", "jpg", "webp"].map((f) => (
              <button key={f} data-fmt={f} onClick={() => setFmt(f)} style={{ ...box, flex: 1, ...(fmt === f ? onSt : {}) }}>
                {f.toUpperCase()}
              </button>
            ))}
          </div>
          {fmt !== "png" && (
            <Line label={t("tools.quality")}>
              <input
                type="range"
                min={1}
                max={100}
                value={quality}
                onChange={(e) => setQuality(Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <span style={{ width: 24, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{quality}</span>
            </Line>
          )}
          <label style={lbl}>
            <input type="checkbox" data-strip checked={strip} onChange={(e) => setStrip(e.target.checked)} />
            {t("tools.strip")}
          </label>
          <Hint>{strip ? t("tools.stripHint") : t("tools.keepHint")}</Hint>
        </Section>

        <Section label={t("tools.rename")}>
          <label style={lbl}>
            <input type="checkbox" data-ren checked={ren} onChange={(e) => setRen(e.target.checked)} />
            {t("tools.renameOn")}
          </label>
          {ren && (
            <>
              <Line label={t("tools.prefix")}>
                <input value={prefix} onChange={(e) => setPrefix(e.target.value)} style={{ ...box, flex: 1, minWidth: 0 }} />
              </Line>
              <Line label={t("tools.start")}>
                <input
                  type="number"
                  min={0}
                  value={start}
                  onChange={(e) => setStart(Number(e.target.value) || 0)}
                  style={{ ...box, width: 64 }}
                />
              </Line>
              <Line label={t("tools.pad")}>
                <input
                  type="number"
                  min={0}
                  max={8}
                  value={pad}
                  onChange={(e) => setPad(Number(e.target.value) || 0)}
                  style={{ ...box, width: 64 }}
                />
              </Line>
            </>
          )}
          <Hint>{t("tools.preview", { s: example })}</Hint>
        </Section>

        <Section label={t("tools.dest")}>
          <select data-dest value={dest} onChange={(e) => setDest(e.target.value)} style={{ ...box, width: "100%" }}>
            <option value="">{t("tools.destBeside")}</option>
            {flat.map((f) => (
              <option key={f.path} value={f.path}>
                {"  ".repeat(f.depth)}
                {f.path}
              </option>
            ))}
          </select>
          <Hint>{needDest && !dest ? t("tools.needDest") : t("tools.destHint")}</Hint>
        </Section>

        <button data-convert-run onClick={() => void run()} disabled={busy || !items.length} style={runBtn}>
          {Icon.refresh}
          {t("tools.runConvert", { n: items.length })}
        </button>
      </div>
    </div>
  );
}

type Flat = { path: string; depth: number };
function flatten(nodes: { path: string; children: unknown[] }[], depth = 0, out: Flat[] = []): Flat[] {
  for (const n of nodes as { path: string; children: { path: string; children: unknown[] }[] }[]) {
    out.push({ path: n.path, depth });
    flatten(n.children, depth + 1, out);
  }
  return out;
}

const Section = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
    <span style={{ fontSize: "var(--text-xs)", fontWeight: "var(--w-semi)", color: "var(--ink-soft)" }}>{label}</span>
    {children}
  </div>
);

const Line = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
    <span style={{ width: 48, flexShrink: 0, fontSize: "var(--text-2xs)", color: "var(--ink-faint)" }}>{label}</span>
    {children}
  </div>
);

const Hint = ({ children }: { children: React.ReactNode }) => (
  <span style={{ fontSize: "var(--text-2xs)", color: "var(--ink-faint)" }}>{children}</span>
);

const box: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: "var(--r-2)",
  padding: "3px var(--sp-3)",
  fontSize: "var(--text-2xs)",
  color: "var(--ink-soft)",
};
const onSt: React.CSSProperties = { borderColor: "var(--accent)", background: "var(--accent-bg)", color: "var(--ink)" };
const lbl: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--sp-2)",
  fontSize: "var(--text-2xs)",
  color: "var(--ink-soft)",
};
const mini: React.CSSProperties = { color: "var(--ink-faint)", display: "grid", padding: 2 };
const runBtn: React.CSSProperties = {
  background: "var(--accent)",
  color: "var(--accent-on)",
  borderRadius: "var(--r-2)",
  padding: "var(--sp-2)",
  fontSize: "var(--text-xs)",
  fontWeight: "var(--w-semi)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "var(--sp-2)",
};
