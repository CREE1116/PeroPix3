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
type TaggerStatus = {
  ready: boolean;
  downloading: boolean;
  got: number;
  total: number;
  error: string;
};
type TagResult = {
  tags: { tag: string; score: number; character: boolean }[];
  caption: string;
  preview: string;
};

/** ★★**결과는 탭을 옮겨도 남는다** — `Tools` 는 안 보이는 탭을 언마운트하므로 (EXIF 리더와
 *  같은 까닭) 모듈에 든다. 앱을 껐다 켜면 비는 것이 맞다. */
let kept: { name: string; result: TagResult | null } = {
  name: "",
  result: null,
};

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

  /** 모델 상태 — 탭에 들어올 때 한 번 묻고, 받는 중이면 끝날 때까지 몇 초마다 다시 묻는다
   *  (사용자 승인 2026-08-29: 모델 없이 들어오면 무엇을 해야 하는지 보여야 한다).
   *  `null` 은 아직 못 물어봤다는 뜻이다. */
  const [st, setSt] = useState<TaggerStatus | null>(null);
  const refresh = async () => {
    try {
      setSt(await api<TaggerStatus>("/api/tagger/status"));
    } catch (e) {
      toast(String(e), "warn");
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
  useEffect(() => {
    if (!st?.downloading) return;
    const id = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(id);
  }, [st?.downloading]);

  /** 내려받기 시작 — 상자의 단추와, 모델 없이 떨궜을 때의 확인창이 같이 쓴다.
   *  ★붙들지 않는다: 시작만 알리고 놓아 준다. 진행률은 위의 폴링이 상자에 그린다. */
  const startDownload = async () => {
    await api("/api/tagger/download", { method: "POST" });
    toast(t("tagger.dlStarted"));
    await refresh();
  };

  const run = async (items: Dropped[]) => {
    const it = items[0];
    if (!it || busy) return;
    setBusy(true);
    try {
      const cur = await api<TaggerStatus>("/api/tagger/status");
      setSt(cur);
      if (cur.error) return void toast(cur.error, "warn");
      if (!cur.ready) {
        if (cur.downloading)
          return void toast(
            t("tagger.downloading", {
              pct: Math.round((cur.got / cur.total) * 100),
            }),
          );
        if (
          await ask({
            title: t("tagger.dlTitle"),
            body: t("tagger.dlBody"),
            ok: t("tagger.dlOk"),
            cancel: t("common.cancel"),
          })
        )
          await startDownload();
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
        ...(chars.length
          ? [
              {
                label: t("tagger.charTags"),
                text: chars.join(", "),
                accent: "var(--accent)",
              },
            ]
          : []),
        {
          label: t("tagger.generalTags"),
          text: result.tags
            .filter((x) => !x.character)
            .map((x) => x.tag)
            .join(", "),
        },
      ]
    : [];

  return (
    /* ★★**가운데 기둥**으로 모은다 (사용자 지시 2026-08-29: *"필요한 UI 는 적은데 화면 전체를
       쓰고 있어서 가독성이 안 좋다. 중앙부 위주로"*). EXIF 리더는 두 열을 펼치느라 판 전체가
       필요하지만, 여기는 태그 두 절이 전부다 — 넓게 펴면 한 줄이 길어져 오히려 읽기 힘들다.
       ★그래도 **창 어디에 떨궈도 받는다** (`useImageDrop(run, true)`) — 기둥은 보이는 폭이지
       받는 폭이 아니다. */
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: result ? "flex-start" : "center",
        paddingTop: result ? "var(--sp-6)" : 0,
      }}
    >
      {!result ? (
        /* 그림이 없으면 가운데의 점선 상자 하나 */
        <div
          {...zone}
          data-tagger-drop
          onClick={() => void pick()}
          style={{
            width: COL,
            maxWidth: "100%",
            height: 220,
            border: `1px dashed ${over ? "var(--accent)" : "var(--line)"}`,
            background: over ? "var(--accent-bg)" : "var(--bg)",
            borderRadius: "var(--r-3)",
            display: "grid",
            placeItems: "center",
            gap: 2,
            cursor: "pointer",
          }}
        >
          <span
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 4,
            }}
          >
            <span
              style={{
                color: over ? "var(--accent)" : "var(--ink-ghost)",
                display: "grid",
              }}
            >
              {Icon.tag}
            </span>
            {st && !st.ready && !st.error ? (
              /* 모델이 없다 — 떨구기 전에 무엇을 해야 하는지 상자 안에서 보여 준다 */
              st.downloading ? (
                <span
                  data-tagger-dl-progress
                  style={{
                    fontSize: "var(--text-sm)",
                    color: "var(--ink-soft)",
                  }}
                >
                  {t("tagger.dlProgress", {
                    pct: st.total ? Math.round((st.got / st.total) * 100) : 0,
                  })}
                </span>
              ) : (
                <button
                  data-tagger-dl
                  onClick={(e) => {
                    e.stopPropagation();
                    void startDownload().catch((err) =>
                      toast(String(err), "warn"),
                    );
                  }}
                  style={{ ...hbtn, marginTop: 4 }}
                >
                  {t("tagger.dlButton")}
                </button>
              )
            ) : (
              <>
                <span
                  style={{
                    fontSize: "var(--text-sm)",
                    color: st?.error
                      ? "var(--warn)"
                      : over
                        ? "var(--accent)"
                        : "var(--ink-soft)",
                  }}
                >
                  {busy
                    ? t("tagger.running")
                    : st?.error
                      ? st.error
                      : t("tools.taggerDrop")}
                </span>
                {!busy && !st?.error && (
                  <span
                    style={{
                      fontSize: "var(--text-2xs)",
                      color: "var(--ink-faint)",
                    }}
                  >
                    {t("tools.dropHint")}
                  </span>
                )}
              </>
            )}
          </span>
        </div>
      ) : (
        <div
          style={{
            width: COL,
            maxWidth: "100%",
            display: "flex",
            flexDirection: "column",
            gap: "var(--sp-3)",
          }}
        >
          {/* 머리 — 미리보기 + 이름 + 부제, 복사·교체·닫기. 여기에 떨구면 다른 그림으로 바꾼다.
              ★복사는 **여기 하나**다 (사용자 지적 2026-08-29: 줄마다 있던 것과 겹쳤다). 캐릭터·일반을
              합친 전체(`caption`)를 복사한다 — 용도가 "그 모습을 재현할 태그"라 전부가 필요하다. */}
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
                style={{
                  height: 72,
                  borderRadius: "var(--r-2)",
                  background: "var(--bg)",
                }}
              />
            )}
            <div
              style={{
                flex: 1,
                minWidth: 0,
                display: "flex",
                flexDirection: "column",
                gap: 3,
              }}
            >
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
              <span
                style={{ fontSize: "var(--text-2xs)", color: "var(--ink-dim)" }}
              >
                {busy ? t("tagger.running") : t("tagger.subtitle")}
              </span>
            </div>
            <button
              data-tagger-copy
              disabled={!result.caption}
              onClick={() =>
                void navigator.clipboard
                  ?.writeText(result.caption)
                  .then(() => toast(t("act.copied")))
              }
              style={hbtn}
            >
              {Icon.copy}
              {t("act.copy")}
            </button>
            <button
              data-tagger-pick
              onClick={() => void pick()}
              disabled={busy}
              style={hbtn}
            >
              {Icon.refresh}
              {t("tools.exifReplace")}
            </button>
            <button data-tagger-clear onClick={clear} style={hbtn}>
              {Icon.close12}
              {t("common.close")}
            </button>
          </div>

          {rows.map((r, i) => (
            <div key={i}>
              <div
                style={{
                  fontSize: "var(--text-2xs)",
                  color: r.accent ?? "var(--ink-dim)",
                }}
              >
                {r.label}
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
      )}
    </div>
  );
}

/** 기둥 폭 — 프롬프트 보기 모달(560px)과 같다 */
const COL = 560;

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
