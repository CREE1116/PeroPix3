import { useEffect, useState } from "react";
import { useI18n } from "../../i18n";
import { api } from "../../lib/backend";
import { useImageDrop, type Dropped } from "../../lib/dropImages";
import { ask } from "../../store/ask";
import { toast } from "../../store/toast";
import { Icon } from "../../components/Icon";
import { useUi } from "../../store/ui";

/** Tagger — **아무 그림에서나 재현 태그를 뽑는다** (WD eva02, 사용자 지시 2026-08-29:
 *  *"보조도구에 넣고 아무 이미지나 태거 돌리게"*).
 *
 *  용도는 *"1girl 만 넣고 나온 캐릭터를 재현할 태그"* 다 — 그러니 워크스페이스 안일 필요가
 *  없고, EXIF 리더처럼 **밖에서 떨군 그림**을 받는다. 생성·갤러리의 「Tagger로 보내기」는
 *  그 그림을 여기로 싣고 온다 (`sendToTagger`).
 *
 *  ★읽기만 한다. 저장하지도, 프롬프트에 넣지도 않는다 — 복사해 가는 것이 전부다.
 *  ★모델(1.26GB)은 동봉하지 않는다 — **처음 돌릴 때** 내려받을지 묻는다. 내려받는 동안
 *    붙들지 않는다: 시작만 알리고 놓아 준다. 다시 떨구면 진행률을 알려 주고, 다 받아졌으면
 *    그때부터 돌아간다.
 */
type TaggerStatus = { ready: boolean; downloading: boolean; got: number; total: number; error: string };
type TagResult = { tags: { tag: string; score: number; character: boolean }[]; caption: string; preview: string };

/** ★★**결과는 탭을 옮겨도 남는다** — `Tools` 는 안 보이는 탭을 언마운트하므로 (EXIF 리더와
 *  같은 까닭) 모듈에 든다. 앱을 껐다 켜면 비는 것이 맞다. */
let kept: { name: string; result: TagResult | null } = { name: "", result: null };

/** 다른 화면에서 **실어 보낸 그림** — 마운트되면 곧장 돌린다.
 *  ★보내는 자리(생성·갤러리)에서는 이 탭이 언마운트 상태라, 값을 두고 모드를 옮기면
 *  새로 마운트되면서 집어 간다. */
let pending: Dropped | null = null;

export function sendToTagger(item: Dropped) {
  pending = item;
  useUi.getState().setMode("utility");
  useUi.getState().setView("tab", "tools", "tagger" as never);
}

export function TaggerTool() {
  const t = useI18n((s) => s.t);
  const [name, setName] = useState(kept.name);
  const [result, setResult] = useState<TagResult | null>(kept.result);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    kept = { name, result };
  }, [name, result]);

  const run = async (items: Dropped[]) => {
    const it = items[0];
    if (!it || busy) return;
    setBusy(true);
    try {
      const st = await api<TaggerStatus>("/api/tagger/status");
      if (st.error) return void toast(st.error, "warn");
      if (!st.ready) {
        if (st.downloading)
          return void toast(t("tagger.downloading", { pct: Math.round((st.got / st.total) * 100) }));
        if (
          await ask({
            title: t("tagger.dlTitle"),
            body: t("tagger.dlBody"),
            ok: t("tagger.dlOk"),
            cancel: t("common.cancel"),
          })
        ) {
          await api("/api/tagger/download", { method: "POST" });
          toast(t("tagger.dlStarted"));
        }
        return;
      }
      const r = await api<TagResult>("/api/tagger/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(it),
      });
      setName(it.name);
      setResult(r);
    } catch (e) {
      toast(String(e), "warn");
    } finally {
      setBusy(false);
    }
  };

  // 실어 보낸 그림을 집어 간다 (한 번만)
  useEffect(() => {
    if (!pending) return;
    const it = pending;
    pending = null;
    void run([it]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 창 어디에 떨궈도 받는다 (EXIF 리더와 같다). */
  const { zone, over, pick } = useImageDrop(run, true);
  const clear = () => {
    setResult(null);
    setName("");
  };

  const chars = result?.tags.filter((x) => x.character).map((x) => x.tag) ?? [];
  const rows: { label: string; text: string; accent?: string }[] = result
    ? [
        ...(chars.length ? [{ label: t("tagger.charTags"), text: chars.join(", "), accent: "var(--accent)" }] : []),
        {
          label: t("tagger.generalTags"),
          text: result.tags.filter((x) => !x.character).map((x) => x.tag).join(", "),
        },
      ]
    : [];

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
      {!result ? (
        /* 받는 자리가 화면 전체 — 안내는 가운데 (EXIF 리더와 같은 어법) */
        <div
          {...zone}
          data-tagger-drop
          onClick={() => void pick()}
          style={{
            flex: 1,
            minHeight: 0,
            border: `1px dashed ${over ? "var(--accent)" : "var(--line)"}`,
            background: over ? "var(--accent-bg)" : "var(--bg)",
            borderRadius: "var(--r-3)",
            display: "grid",
            placeItems: "center",
            gap: 2,
            cursor: "pointer",
          }}
        >
          <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <span style={{ color: over ? "var(--accent)" : "var(--ink-ghost)", display: "grid" }}>{Icon.tag}</span>
            <span style={{ fontSize: "var(--text-sm)", color: over ? "var(--accent)" : "var(--ink-soft)" }}>
              {busy ? t("tagger.running") : t("tools.taggerDrop")}
            </span>
            {!busy && <span style={{ fontSize: "var(--text-2xs)", color: "var(--ink-faint)" }}>{t("tools.dropHint")}</span>}
          </span>
        </div>
      ) : (
        <>
          {/* 머리 — 미리보기 + 이름 + 부제, 전체 복사·닫기. 여기에 떨구면 다른 그림으로 바꾼다 */}
          <div
            {...zone}
            data-tagger-drop
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--sp-3)",
              border: `1px solid ${over ? "var(--accent)" : "var(--line)"}`,
              background: over ? "var(--accent-bg)" : "var(--panel)",
              borderRadius: "var(--r-3)",
              padding: "var(--sp-3)",
              flexShrink: 0,
            }}
          >
            {result.preview && (
              <img
                data-tagger-preview
                src={result.preview}
                alt=""
                style={{ height: 72, borderRadius: "var(--r-2)", background: "var(--bg)" }}
              />
            )}
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
              <span
                style={{
                  fontSize: "var(--text-xs)",
                  color: "var(--ink)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {name}
              </span>
              {/* ★무엇인지 한 줄로 밝힌다 (사용자 지시 2026-08-29: "이미지에서 자동 추출했다고") */}
              <span style={{ fontSize: "var(--text-2xs)", color: "var(--ink-dim)" }}>
                {busy ? t("tagger.running") : t("tagger.subtitle")}
              </span>
            </div>
            <button
              data-tagger-copy
              disabled={!result.caption}
              onClick={() => void navigator.clipboard?.writeText(result.caption).then(() => toast(t("act.copied")))}
              style={hbtn}
            >
              {Icon.copy}
              {t("act.copy")}
            </button>
            <button data-tagger-pick onClick={() => void pick()} disabled={busy} style={hbtn}>
              {Icon.refresh}
              {t("tools.exifReplace")}
            </button>
            <button data-tagger-clear onClick={clear} style={hbtn}>
              {Icon.close12}
              {t("common.close")}
            </button>
          </div>

          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
            {rows.map((r, i) => (
              <div key={i}>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
                  <div style={{ flex: 1, fontSize: "var(--text-2xs)", color: r.accent ?? "var(--ink-dim)" }}>
                    {r.label}
                  </div>
                  <button
                    data-tagger-copy-one={i}
                    disabled={!r.text}
                    onClick={() => void navigator.clipboard?.writeText(r.text).then(() => toast(t("act.copied")))}
                    style={{
                      display: "grid",
                      placeItems: "center",
                      padding: 2,
                      borderRadius: "var(--r-1)",
                      color: r.text ? "var(--ink-faint)" : "var(--ink-ghost)",
                    }}
                    data-tip={t("act.copy")}
                  >
                    {Icon.copy}
                  </button>
                </div>
                <pre
                  style={{
                    margin: "2px 0 0",
                    padding: "var(--sp-2)",
                    background: "var(--code-bg)",
                    borderRadius: "var(--r-1)",
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--text-2xs)",
                    lineHeight: 1.5,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                    color: "var(--ink-soft)",
                  }}
                >
                  {r.text || t("prompt.empty")}
                </pre>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** EXIF 리더의 머리 단추와 같은 꼴 */
const hbtn: React.CSSProperties = {
  flexShrink: 0,
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--sp-2)",
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: "var(--r-2)",
  padding: "3px var(--sp-3)",
  fontSize: "var(--text-2xs)",
  color: "var(--ink-soft)",
};
