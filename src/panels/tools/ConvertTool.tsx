import { useEffect, useState } from "react";
import { create } from "zustand";
import { useI18n } from "../../i18n";
import { api } from "../../lib/backend";
import { useImageDrop, type Dropped } from "../../lib/dropImages";
import { useReorder } from "../../lib/useReorder";
import { useFiles } from "../../store/files";
import { useUi } from "../../store/ui";
import { toast } from "../../store/toast";
import { Icon } from "../../components/Icon";

/** 이름 변환 — **형식과 이름을 한 번에** 바꾼다 (v2 `보조 도구 › 이미지 변환`).
 *
 *  ★밖에서 떨군 그림도 받는다 (`useImageDrop`). 앱에서는 경로가 오고, 브라우저에서는
 *    바이트가 온다 — 부르는 쪽은 몰라도 되게 서버가 둘 다 받는다.
 *  ★**원본을 지우지 않는다.** 늘 새 파일을 만들고, 이름이 겹치면 번호를 붙인다.
 *  ★번호는 **목록 차례**를 따른다. 그래서 목록 순서를 바꿀 수 있어야 한다 —
 *    ↑↓ 단추와 **그립 드래그** 둘 다 둔다 (한 칸 옮기기와 멀리 옮기기는 다른 일이다).
 *  ★**한 장씩 보낸다** (v2 `runConversion` 과 같다). 한 번에 묶어 보내면 진행률을 알 수
 *    없고, 어느 장이 실패했는지도 끝나서야 안다. 번호는 `start + i` 를 그때그때 실어 보낸다.
 */
type Q = { items: Dropped[]; add: (x: Dropped[]) => void; clear: () => void };

/** 파일 관리에서 고른 것을 여기로 보내는 통로 — 창구를 둘로 만들지 않으려는 것 */
export const useConvertQueue = create<Q>((set, get) => ({
  items: [],
  add: (x) => set({ items: [...get().items, ...x] }),
  clear: () => set({ items: [] }),
}));

/** 목록에 보여 줄 것 — 서버가 준다 (`/api/tools/probe`). 앱에는 경로만 와서
 *  화면이 그 파일을 가리킬 주소가 없다. 키는 `name` 이 아니라 **차례**다 (같은 이름이 있다). */
type Probe = { name: string; bytes?: number; width?: number; height?: number; thumb?: string; error?: string };

/** 한 장의 결과 — 끝나면 그 줄에 그대로 남는다 (v2 `updateConvertFileListWithResults`) */
type Row = { saved?: string; error?: string };

export function ConvertTool() {
  const t = useI18n((s) => s.t);
  const { items, add } = useConvertQueue();
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
  /** 몇 장까지 끝났나 — 진행바가 이것만 본다 (v2 `convertProgressText` 의 `n / total`) */
  const [done, setDone] = useState(0);
  const [rows, setRows] = useState<Row[]>([]);
  const [probes, setProbes] = useState<Probe[]>([]);
  const openAfter = useUi((s) => s.convertOpenFolder);
  const setOpenAfter = useUi((s) => s.setConvertOpenFolder);
  const { zone, over, pick } = useImageDrop(add);

  // ★경로를 모르는 그림(브라우저 드롭)은 **원본 옆에** 둘 수가 없다 — 자리를 골라야 한다
  const needDest = items.some((i) => !i.path && !i.rel);
  const flat = flatten(tree);

  /** 썸네일·크기는 **목록이 바뀔 때 한 번** 물어본다. 순서만 바꾼 것은 화면에서 같이 옮긴다 */
  useEffect(() => {
    let alive = true;
    if (!items.length) return setProbes([]);
    void api<{ items: Probe[] }>("/api/tools/probe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    })
      .then((r) => alive && setProbes(r.items))
      .catch(() => alive && setProbes([]));
    return () => {
      alive = false;
    };
  }, [items]);

  const setItems = (next: Dropped[], nextProbes?: Probe[]) => {
    useConvertQueue.setState({ items: next });
    if (nextProbes) setProbes(nextProbes);
    setRows([]);
  };

  const drop = (i: number) =>
    setItems(items.filter((_, n) => n !== i), probes.filter((_, n) => n !== i));

  const swap = (i: number, j: number) => {
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    const np = [...probes];
    [next[i], next[j]] = [next[j], next[i]];
    [np[i], np[j]] = [np[j], np[i]];
    setItems(next, np);
  };

  /** 그립 드래그 — `to` 는 **틈 번호**다 (0..n). `useReorder` 규약 그대로 */
  const move = (from: number, to: number) => {
    const at = to > from ? to - 1 : to;
    const next = [...items];
    const np = [...probes];
    const [it] = next.splice(from, 1);
    const [pb] = np.splice(from, 1);
    next.splice(at, 0, it);
    np.splice(at, 0, pb);
    setItems(next, np);
  };
  const { register, handleProps, dragIdx, overIdx, ghost } = useReorder(items.length, move);

  const run = async () => {
    if (busy || !items.length) return;
    if (needDest && !dest) return toast(t("tools.needDest"), "warn");
    setBusy(true);
    setDone(0);
    setRows([]);
    const out: Row[] = [];
    try {
      for (let i = 0; i < items.length; i++) {
        // ★마지막 장에서만 폴더를 연다 — 장마다 열면 창이 쌓인다
        const last = i === items.length - 1;
        try {
          const r = await api<{ results: { saved?: string; error?: string; ok: boolean }[]; ok: number }>(
            "/api/tools/convert",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                items: [items[i]],
                fmt,
                quality,
                strip_metadata: strip,
                prefix: ren ? prefix : null,
                // ★번호는 화면이 정한다 — 한 장씩 보내므로 `start + i` 를 그때그때 싣는다
                start: start + i,
                pad,
                dest,
                open_folder: openAfter && last,
              }),
            },
          );
          const one = r.results[0];
          out.push(one?.ok ? { saved: one.saved } : { error: one?.error || "" });
        } catch (e) {
          out.push({ error: String(e) });
        }
        setDone(i + 1);
        setRows([...out]);
      }
      const ok = out.filter((r) => !r.error).length;
      toast(t("tools.converted", { n: ok, f: out.length - ok }), ok === out.length ? "ok" : "warn");
      if (ok) void useFiles.getState().reload();
    } finally {
      setBusy(false);
    }
  };

  const nameOf = (i: number) => (ren ? `${prefix}${String(start + i).padStart(pad, "0")}.${fmt}` : "");
  const example = ren ? nameOf(0) : t("tools.keepName", { f: fmt });

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
          <div style={{ fontSize: "var(--text-2xs)", color: "var(--ink-faint)" }}>
            {items.length > 1 ? t("tools.reorderHint") : t("tools.dropHint")}
          </div>
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
          {items.map((it, i) => {
            const p = probes[i];
            const row = rows[i];
            return (
              <div key={`${it.name}-${i}`}>
                {/* 끼울 자리 — 드래그 중에만 */}
                <div
                  style={{
                    height: 2,
                    borderRadius: 1,
                    background:
                      dragIdx != null && overIdx === i && i !== dragIdx && i !== dragIdx + 1
                        ? "var(--accent)"
                        : "transparent",
                  }}
                />
                <div
                  ref={register(i)}
                  data-convert-row
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--sp-2)",
                    padding: "3px var(--sp-2)",
                    borderRadius: "var(--r-1)",
                    fontSize: "var(--text-2xs)",
                    opacity: dragIdx === i ? 0.35 : 1,
                  }}
                >
                  <span {...handleProps(i)} style={{ ...handleProps(i).style, color: "var(--ink-ghost)", display: "grid" }}>
                    {Icon.grip}
                  </span>
                  <span
                    style={{
                      width: 30,
                      flexShrink: 0,
                      color: "var(--ink-faint)",
                      fontFamily: "var(--font-mono)",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {ren ? String(start + i).padStart(pad, "0") : i + 1}
                  </span>
                  {/* 썸네일 — 서버가 96px 로 줄여 준다. 못 읽은 것은 빈 칸으로 자리만 지킨다 */}
                  <span
                    style={{
                      width: 28,
                      height: 28,
                      flexShrink: 0,
                      borderRadius: "var(--r-1)",
                      background: "var(--bg)",
                      overflow: "hidden",
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    {p?.thumb && (
                      <img
                        src={p.thumb}
                        alt=""
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                    )}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {it.name}
                    </span>
                    <span style={{ color: row?.error ? "var(--err)" : "var(--ink-faint)" }}>
                      {row?.error
                        ? t("tools.rowFailed")
                        : row?.saved
                          ? row.saved
                          : [
                              p?.bytes ? fmtSize(p.bytes) : "",
                              p?.width && p?.height ? `${p.width} × ${p.height}` : "",
                              nameOf(i),
                            ]
                              .filter(Boolean)
                              .join("  ")}
                    </span>
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
              </div>
            );
          })}
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
          {/* ★여는 것은 **방금 우리가 쓴 자리**뿐이다 (backend/files.py `open_dir` 주석) */}
          <label style={lbl}>
            <input
              type="checkbox"
              data-open-after
              checked={openAfter}
              onChange={(e) => setOpenAfter(e.target.checked)}
            />
            {t("tools.openAfter")}
          </label>
        </Section>

        {/* 진행바 — 돌 때만. 눌렀다는 신호이자 어디까지 갔는지다 (v2 `convertProgress`) */}
        {busy && (
          <div data-convert-progress style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ height: 4, borderRadius: 2, background: "var(--bg)", overflow: "hidden" }}>
              <div
                style={{
                  width: `${items.length ? Math.round((done / items.length) * 100) : 0}%`,
                  height: "100%",
                  background: "var(--accent)",
                  transition: "width 0.15s",
                }}
              />
            </div>
            <span
              style={{
                fontSize: "var(--text-2xs)",
                color: "var(--ink-faint)",
                textAlign: "right",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {done} / {items.length}
            </span>
          </div>
        )}

        <button data-convert-run onClick={() => void run()} disabled={busy || !items.length} style={runBtn}>
          {Icon.refresh}
          {t("tools.runConvert", { n: items.length })}
        </button>
        <button data-convert-clear onClick={() => setItems([], [])} disabled={busy || !items.length} style={box}>
          {t("tools.clearList")}
        </button>
      </div>

      {/* 끌고 있는 줄의 잔상 — 브라우저가 안 만들어 주므로 우리가 그린다 (useReorder 주석) */}
      {ghost && dragIdx != null && (
        <div
          style={{
            position: "fixed",
            left: ghost.x,
            top: ghost.y,
            width: ghost.w,
            height: ghost.h,
            pointerEvents: "none",
            zIndex: 80,
            borderRadius: "var(--r-2)",
            border: "1px solid var(--accent)",
            background: "var(--panel)",
            display: "flex",
            alignItems: "center",
            padding: "0 var(--sp-3)",
            fontSize: "var(--text-2xs)",
            color: "var(--ink)",
            overflow: "hidden",
          }}
        >
          {items[dragIdx]?.name}
        </div>
      )}
    </div>
  );
}

const fmtSize = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;

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
