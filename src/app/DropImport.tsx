import { useState } from "react";
import { useI18n } from "../i18n";
import { Icon } from "../components/Icon";
import { DropVeil } from "../cards/DropVeil";
import { useImageDrop, type Dropped } from "../lib/dropImages";
import { DROP_ACCEPT, KIND_LABEL, readDrop, vibeFromCachePng, type DropRead } from "../lib/dropImport";
import { hasMeta } from "../lib/metaApply";
import { isNaiVibeFile } from "../lib/naiVibeFile";
import { MAX_VIBES, processReference, pushVibe, useImageInput } from "../store/imageInput";
import { vibeDefaults } from "../lib/vibeDefaults";
import { fitSizeToBase, modelCaps, useGen } from "../store/gen";
import { useUi } from "../store/ui";
import { toast } from "../store/toast";
import { MetaBody, applyMeta } from "../panels/GalleryMeta";

/** 밖에서 떨군 그림 하나를 **무엇으로 쓸지 고르는 자리** (v2 「드롭 확인 모달」 이식).
 *
 *  ★★**떨어뜨린 뒤에 고른다.** 떨구는 순간 곧바로 적용하지 않는 까닭은, 그림 한 장이 쓰일 곳이
 *    넷이기 때문이다 — 설정·베이스 이미지·바이브·레퍼런스. 어디로 갈지 코드가 짐작하면
 *    반은 틀린다.
 *  ★★**받는 자리를 생성·갤러리 모드로 한정한다** (v2 `!isInCensorMode() && !isInUtilityMode()`).
 *    자동검열과 보조 도구에는 **자기 드롭존이 이미 있고**, 그쪽도 창 전체로 받는다
 *    (`ExifTool` 의 `wide`). 여기까지 매달면 한 번 떨군 것을 둘이 잡는다.
 *    ★그래서 이 컴포넌트는 **그 두 모드에서 아예 안 그려진다** (`App`).
 *  ★주인이 따로 있는 자리(`[data-drop-file]` — 베이스 그림 단추 등)는 비켜 간다.
 *    거기 떨구는 것은 「이걸로 하겠다」가 이미 정해진 동작이라 물어볼 것이 없다.
 */
export function DropImport() {
  const t = useI18n((s) => s.t);
  const model = useGen((g) => g.params.model);
  const cap = modelCaps(model);
  const [sheet, setSheet] = useState<DropRead | null>(null);
  const [busy, setBusy] = useState(false);

  const take = async (items: Dropped[]) => {
    const it = items[0];
    if (!it || busy) return;
    setBusy(true);
    try {
      setSheet(await readDrop(it));
      // ★여러 장은 **말하고 첫 장만** 받는다 (v2 는 말없이 `files[0]` 이었다) —
      //   조용히 버리면 나머지가 어디 갔는지 알 수 없다
      if (items.length > 1) toast(t("drop.onlyOne"), "warn");
    } catch (e) {
      toast(isNaiVibeFile(it.name) ? t("imgIn.vibeFileBad") : String(e), "warn");
    } finally {
      setBusy(false);
    }
  };

  const { over } = useImageDrop(take, true, DROP_ACCEPT);

  return (
    <>
      {/* ★★강조 양식은 **앱 전체에서 하나**다 (`cards/DropVeil`, 사용자 지시 2026-08-20:
          *"강조 스타일이 전부 다름. 통일시켜야해"*). 여기서 점선 테두리를 새로 만들지 않는다.
          ★어둠(`DragLayer`)은 안 깐다 — 그것은 「받는 자리만 밝힌다」는 뜻인데, 밖에서 온
            파일은 **창 전체가 받는 자리**라 밝힐 것과 덮을 것이 갈리지 않는다. */}
      {over && !sheet && (
        <div data-drop-overlay style={{ position: "fixed", inset: 0, zIndex: 70, pointerEvents: "none" }}>
          <DropVeil over name="import" label={t("drop.hint")} />
        </div>
      )}
      {sheet && <Sheet read={sheet} cap={cap} model={model} onClose={() => setSheet(null)} />}
    </>
  );
}

function Sheet({
  read,
  cap,
  model,
  onClose,
}: {
  read: DropRead;
  cap: ReturnType<typeof modelCaps>;
  model: string;
  onClose: () => void;
}) {
  const t = useI18n((s) => s.t);
  const [busy, setBusy] = useState(false);
  const vibeFile = read.kind === "vibefile" ? read.vibe : null;
  const m = read.kind === "image" ? read.meta : null;
  const name = read.name;
  /** 바이브 캐시 PNG 면 **구워 둔 인코딩**이 함께 온다 — 그대로 쓰면 Anlas 가 안 나간다 */
  const cached = m ? vibeFromCachePng(m, name) : null;
  const canApply = hasMeta(m);

  const preview = vibeFile
    ? vibeFile.image && `data:image/png;base64,${vibeFile.image}`
    : m?.preview || (m?.data && `data:image/png;base64,${m.data}`);

  /** ★적용한 것은 **생성 화면**에 나타난다 — 갤러리에서 떨궜으면 데려가야 보인다 */
  const leave = () => {
    useUi.getState().setMode("generate");
    onClose();
  };

  /** 「설정 적용」 — 그림 아래 「설정 불러오기」와 **같은 것**이다 (`ImageActions.useSettings`).
   *  ★밖에서 온 그림에는 생성 시점 스냅샷(`env`)도 기록된 베이스도 없다. 되돌릴 수 있는 것은
   *    그림에 남은 것 전부다 — 프롬프트·캐릭터·생성 옵션·해상도·시드·바이브. */
  const applySettings = () => {
    if (!m) return;
    applyMeta(m, "all");
    toast(t("act.applied"));
    leave();
  };

  const asBase = async () => {
    if (!m?.data || busy) return;
    setBusy(true);
    try {
      useImageInput.getState().setBase(m.data, name);
      await fitSizeToBase(m.data);
      useUi.getState().reveal("left", "base", false);
      leave();
    } finally {
      setBusy(false);
    }
  };

  /** 바이브 한 장. ★구워 둔 인코딩이 있으면 그것까지 싣는다 (`.naiv4vibe` · 바이브 캐시 PNG).
   *  ★맨 그림은 **모델별 기본값**으로 넣는다 (`lib/vibeDefaults` — 공홈과 같은 인코딩을 굽는다). */
  const asVibe = () => {
    const d = vibeDefaults(model);
    const v =
      vibeFile ?? cached ?? (m?.data ? { name, image: m.data, strength: d.strength, info_extracted: d.infoExtracted } : null);
    if (!v) return;
    if (!pushVibe(v)) return toast(t("imgIn.vibeFull", { n: MAX_VIBES }), "warn");
    toast(v.encoded ? t("imgIn.vibeFileCached") : t("imgIn.vibeFileAdded"));
    leave();
  };

  const asRef = async () => {
    if (!m?.data || busy) return;
    setBusy(true);
    try {
      useImageInput.getState().setRefOn(true);
      useImageInput.getState().addRef({
        // ★보내는 것은 **다듬은 판**, 보여 주는 것은 원본이다 (`processReference` 의 ★주)
        image: await processReference(m.data),
        preview: m.data,
        name,
        mode: "character&style",
        strength: 1,
        fidelity: 1,
      });
      leave();
    } catch (e) {
      toast(String(e), "warn");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-drop-sheet
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 80,
        background: "rgba(6,8,12,0.6)",
        display: "grid",
        placeItems: "center",
        padding: "var(--sp-6)",
      }}
    >
      <div
        style={{
          background: "var(--bg)",
          border: "1px solid var(--line)",
          borderRadius: "var(--r-4)",
          padding: "var(--sp-5)",
          width: "min(560px, 92vw)",
          maxHeight: "86vh",
          display: "flex",
          flexDirection: "column",
          gap: "var(--sp-4)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
          <b style={{ fontSize: "var(--text-md)" }}>{t("drop.title")}</b>
          <span
            data-drop-kind
            style={{
              padding: "1px var(--sp-2)",
              borderRadius: "var(--r-1)",
              background: "var(--surface2)",
              fontSize: "var(--text-2xs)",
              color: "var(--ink-soft)",
            }}
          >
            {vibeFile ? "NAI Vibe" : (KIND_LABEL[m?.kind || ""] ?? t("tools.exifUnknown"))}
          </span>
          <span style={{ flex: 1 }} />
          <button data-drop-close onClick={onClose} style={{ color: "var(--ink-faint)", display: "grid" }}>
            {Icon.close}
          </button>
        </div>

        <div style={{ display: "flex", gap: "var(--sp-4)", minHeight: 0, flex: 1 }}>
          <div style={{ flexShrink: 0, width: 160 }}>
            {preview ? (
              <img
                src={preview}
                alt=""
                style={{
                  width: "100%",
                  borderRadius: "var(--r-2)",
                  border: "1px solid var(--line)",
                  background: "var(--surface2)",
                }}
              />
            ) : (
              <div
                style={{
                  height: 120,
                  borderRadius: "var(--r-2)",
                  border: "1px solid var(--line)",
                  background: "var(--surface2)",
                }}
              />
            )}
            <div
              style={{
                marginTop: "var(--sp-2)",
                fontSize: "var(--text-2xs)",
                color: "var(--ink-faint)",
                wordBreak: "break-all",
              }}
            >
              {name}
            </div>
          </div>

          <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflowY: "auto" }}>
            {vibeFile ? (
              <VibeInfo
                strength={vibeFile.strength}
                info={vibeFile.info_extracted}
                model={vibeFile.encoded_model}
                cached={!!vibeFile.encoded}
              />
            ) : cached ? (
              <VibeInfo
                strength={cached.strength}
                info={cached.info_extracted}
                model={cached.encoded_model}
                cached={!!cached.encoded}
              />
            ) : canApply ? (
              <MetaBody m={m!} />
            ) : (
              <div style={{ fontSize: "var(--text-2xs)", color: "var(--ink-faint)", lineHeight: 1.6 }}>
                {t("drop.noMeta")}
              </div>
            )}
          </div>
        </div>

        {/* 무엇으로 쓸까 — ★**이 그림에 뜻이 있는 것만** 낸다. 눌러야 실패하는 단추를 두지 않는다 */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-2)" }}>
          {canApply && (
            <button
              data-drop-apply
              disabled={busy}
              onClick={applySettings}
              data-tip={t("drop.applyHint")}
              style={{ ...btn, background: "var(--accent)", color: "var(--accent-on)", borderColor: "var(--accent)" }}
            >
              {t("drop.apply")}
            </button>
          )}
          {/* ★바이브 파일은 그림이 아니다 — 베이스·레퍼런스로 못 쓴다.
              ★원본 바이트가 안 왔으면 눌러도 아무 일이 없으므로 아예 안 낸다 */}
          {!vibeFile && !!m?.data && (
            <button data-drop-base disabled={busy} onClick={() => void asBase()} style={btn}>
              {t("imgIn.base")}
            </button>
          )}
          {/* ★모델이 못 하는 것은 안 낸다 — V5 에는 Vibe 도 Precise Reference 도 없다 */}
          {cap.vibe && (vibeFile || !!m?.data) && (
            <button data-drop-vibe disabled={busy} onClick={asVibe} style={btn}>
              {t("imgIn.vibeAdd")}
            </button>
          )}
          {cap.char_ref && !vibeFile && !!m?.data && (
            <button data-drop-ref disabled={busy} onClick={() => void asRef()} style={btn}>
              {t("imgIn.ref")}
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button data-drop-cancel onClick={onClose} style={{ ...btn, color: "var(--ink-faint)" }}>
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 바이브 한 장의 값 — ★**구워 둠**을 눈에 띄게 말한다. 그것이 Anlas 를 가르는 유일한 정보다 */
function VibeInfo({
  strength,
  info,
  model,
  cached,
}: {
  strength: number;
  info: number;
  model?: string;
  cached: boolean;
}) {
  const t = useI18n((s) => s.t);
  const row = (k: string, v: string) => (
    <div style={{ display: "flex", gap: "var(--sp-2)", padding: "2px 0" }}>
      <span style={{ width: 120, flexShrink: 0, color: "var(--ink-faint)" }}>{k}</span>
      <span style={{ color: "var(--ink-soft)", fontFamily: "var(--font-mono)" }}>{v}</span>
    </div>
  );
  return (
    <div style={{ fontSize: "var(--text-2xs)" }}>
      {row(t("imgIn.strength"), String(strength))}
      {row(t("imgIn.info"), String(info))}
      {!!model && row(t("gallery.fieldModel"), model)}
      <div style={{ marginTop: "var(--sp-2)", color: cached ? "var(--ok)" : "var(--warn)" }}>
        {cached ? t("drop.vibeCached") : t("drop.vibeRaw")}
      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  padding: "var(--sp-2) var(--sp-3)",
  borderRadius: "var(--r-2)",
  border: "1px solid var(--line)",
  fontSize: "var(--text-xs)",
  color: "var(--ink-soft)",
};
