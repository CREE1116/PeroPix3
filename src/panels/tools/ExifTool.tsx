import { useState } from "react";
import { useI18n } from "../../i18n";
import { api } from "../../lib/backend";
import { useImageDrop, type Dropped } from "../../lib/dropImages";
import { toast } from "../../store/toast";
import { Icon } from "../../components/Icon";

/** EXIF 리더 — **밖에서 가져온 그림의 설정을 읽는다** (v2 `보조 도구 › EXIF 리더`).
 *
 *  ★읽기만 한다. 저장하지도, 고치지도 않는다 — 남의 그림을 여는 자리라 그게 전부여야 한다.
 *  ★프롬프트와 설정을 **갈라 놓는다** (v2 의 2열). 한 덩어리로 쏟아 놓으면
 *    "이 그림 어떻게 뽑았지"를 눈으로 못 따라간다.
 */
const PROMPT_KEYS = ["prompt", "negative_prompt", "uc", "character_prompts"];

export function ExifTool() {
  const t = useI18n((s) => s.t);
  const [name, setName] = useState("");
  const [preview, setPreview] = useState("");
  const [meta, setMeta] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);

  const read = async (items: Dropped[]) => {
    const it = items[0];
    if (!it || busy) return;
    setBusy(true);
    try {
      const r = await api<{ meta: Record<string, unknown> }>("/api/tools/meta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(it),
      });
      setName(it.name);
      // 미리보기: base64 면 그대로, 경로면 서버가 읽어 준 것이 없으니 비워 둔다
      setPreview(it.data || "");
      setMeta(r.meta);
      if (!Object.keys(r.meta).length) toast(t("tools.exifNone"), "warn");
    } catch (e) {
      toast(String(e), "warn");
    } finally {
      setBusy(false);
    }
  };

  const { zone, over, pick } = useImageDrop(read);

  const entries = Object.entries(meta ?? {}).filter(([, v]) => v !== null && v !== "" && v !== undefined);
  const prompts = entries.filter(([k]) => PROMPT_KEYS.includes(k));
  const settings = entries.filter(([k]) => !PROMPT_KEYS.includes(k));

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
      <div
        {...zone}
        data-exif-drop
        onClick={() => void pick()}
        style={{
          border: `1px dashed ${over ? "var(--accent)" : "var(--line)"}`,
          background: over ? "var(--accent-bg)" : "var(--bg)",
          borderRadius: "var(--r-3)",
          padding: meta ? "var(--sp-3)" : "var(--sp-8)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "var(--sp-3)",
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        {preview && <img src={preview} alt="" style={{ height: 64, borderRadius: "var(--r-2)" }} />}
        <div style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: preview ? "start" : "center" }}>
          <span style={{ fontSize: "var(--text-xs)", color: "var(--ink-soft)" }}>
            {name || t("tools.exifDrop")}
          </span>
          <span style={{ fontSize: "var(--text-2xs)", color: "var(--ink-faint)" }}>{t("tools.dropHint")}</span>
        </div>
      </div>

      {meta && (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "var(--sp-4)",
            overflow: "hidden",
          }}
        >
          <Col title={t("tools.exifPrompts")} rows={prompts} mono />
          <Col title={t("tools.exifSettings")} rows={settings} />
        </div>
      )}
    </div>
  );
}

function Col({ title, rows, mono }: { title: string; rows: [string, unknown][]; mono?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, gap: "var(--sp-2)" }}>
      <span style={{ fontSize: "var(--text-xs)", fontWeight: "var(--w-semi)", color: "var(--ink-soft)" }}>
        {title}
      </span>
      <div
        data-exif-col
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          background: "var(--panel)",
          border: "1px solid var(--line)",
          borderRadius: "var(--r-3)",
          padding: "var(--sp-3)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--sp-3)",
        }}
      >
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: "var(--text-2xs)", color: "var(--ink-faint)" }}>{k}</span>
            <span
              onClick={() => void navigator.clipboard?.writeText(String(v)).then(() => toast(k))}
              title={String(v)}
              style={{
                fontSize: "var(--text-2xs)",
                color: "var(--ink)",
                fontFamily: mono ? "var(--font-mono)" : undefined,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                cursor: "copy",
              }}
            >
              {typeof v === "object" ? JSON.stringify(v) : String(v)}
            </span>
          </div>
        ))}
        {!rows.length && (
          <span style={{ fontSize: "var(--text-2xs)", color: "var(--ink-faint)", display: "flex", gap: 6 }}>
            {Icon.close12}
          </span>
        )}
      </div>
    </div>
  );
}
