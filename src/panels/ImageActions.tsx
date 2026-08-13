import { useState } from "react";
import { useI18n } from "../i18n";
import { useGen, fitSizeToBase } from "../store/gen";
import { useImageInput } from "../store/imageInput";
import { useUi } from "../store/ui";
import { toast } from "../store/toast";
import { applyMeta } from "./GalleryMeta";
import { api } from "../lib/backend";
import { upscaleCost } from "../lib/anlas";
import { useSub } from "../store/sub";
import { useWs, type Rec } from "../store/workspace";
import type { ImageMeta } from "../store/gallery";

/** 크게 본 그림 **아래에 붙는 한 줄** — "이 장으로 무엇을 할까" (페로픽스파이 `result-meta` 이식).
 *
 *  ★**세 자리가 같은 줄을 쓴다** (싱글 · 멀티 라이트박스 · 갤러리). 크게 보는 자리마다 따로
 *    만들면 어디서는 되고 어디서는 안 되는 상태가 생긴다 — 실제로 강화·보관이 라이트박스에만
 *    있었다 (사용자 지적 2026-08-05).
 *  ★**자리마다 없는 것은 넘기지 않으면 안 나온다.** 강화·보관은 워크스페이스 파일에만 뜻이
 *    있어서 갤러리(보관함)에서는 빠진다 — 버튼을 띄워 놓고 눌러야 실패하는 것보다 낫다.
 *  ★i2i·인페인트는 **생성 모드로 데려간다.** 안 그러면 눌러도 아무 일이 없어 보인다.
 */
export function ImageActions({
  url,
  name,
  seed,
  loadMeta,
  dims,
  revealPath,
  onEnhance,
  upscale,
  onKeep,
  onLeave,
  extra,
}: {
  /** 원본 주소 — i2i·인페인트가 이걸 읽어 베이스 이미지로 만든다 */
  url: string;
  name: string;
  seed?: number;
  /** 실제 해상도 — 페로픽스파이 `res-tag`. 그림을 띄우는 쪽이 `onLoad` 로 재서 준다 */
  dims?: { w: number; h: number } | null;
  /** 아웃풋 루트 기준 경로 — 있으면 「폴더 열기」가 뜬다 (페로픽스파이 📂 Folder) */
  revealPath?: string;
  /** 이 그림의 생성 설정. 없으면 「설정 불러오기」가 안 뜬다 */
  loadMeta?: () => Promise<ImageMeta | null>;
  onEnhance?: () => void;
  /** 4배 업스케일 — **워크스페이스 파일에만** 뜻이 있다 (갤러리 보관함에는 안 뜬다).
   *  ★배율을 안 받는다: 공홈이 언제나 4 로 보낸다 (`nai.py UPSCALE_SCALE`) */
  upscale?: { ws: string; file: string };
  onKeep?: () => void | Promise<void>;
  /** 생성 모드로 갈 때 이 화면을 닫는다 (라이트박스·갤러리 큰 보기) */
  onLeave?: () => void;
  /** 이 줄에 함께 두고 싶은 것 (싱글의 「별표만 보기」) */
  extra?: React.ReactNode;
}) {
  const t = useI18n((s) => s.t);
  const setParam = useGen((s) => s.set);
  const seedNow = useGen((s) => s.params.seed);
  const [busy, setBusy] = useState(false);
  const opus = useSub((s) => (s.sub?.tier ?? 0) >= 3);
  const [seen, setSeen] = useState<ImageMeta | null>(null);

  /** ★쿼리를 하나 붙여 받는다 — 같은 주소를 `<img>` 가 no-cors 로 먼저 캐시해 두면
   *  그 뒤의 `fetch` 가 CORS 로 막힌다 (실측으로 밟았다, 2026-08-04). */
  const asBase64 = async () => {
    const r = await fetch(url + (url.includes("?") ? "&" : "?") + "b64=1");
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    const blob = await r.blob();
    return await new Promise<string>((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result).split(",")[1] ?? "");
      fr.onerror = () => rej(new Error(name));
      fr.readAsDataURL(blob);
    });
  };

  const toBase = async (mode: "img2img" | "inpaint") => {
    if (busy) return;
    setBusy(true);
    try {
      const b64 = await asBase64();
      const s = useImageInput.getState();
      // ★워크스페이스 파일이면 **경로도 함께** 넘긴다 — 타일 인페인트가 그 파일을 서버에서
      //   열어 사각형 안만 잘라 보낸다 (밖에서 떨군 그림에는 경로가 없다)
      s.setBase(b64, name, upscale ?? null);
      // ★공홈처럼 **해상도를 그림에 맞춘다** — 안 맞추면 전송 직전 리샘플이 그림을 늘린다
      await fitSizeToBase(b64);
      // ★그림이 들어간 자리도 보여 준다 — 우측 패널이 접혀 있으면 펴진다
      useUi.getState().reveal("right", "base");
      s.patchBase({ baseMode: mode });
      useUi.getState().setMode("generate");
      onLeave?.();
      // ★인페인트는 **캔버스 자리에서** 칠한다 (모달이 아니다). 생성 모드로 옮긴 뒤
      //   편집을 켠다. 큰 그림이면 `startEdit` 이 Focused 를 켜 주고 알린다
      if (mode === "inpaint") {
        s.startEdit();
        return toast(t("act.sentInpaint"));
      }
      toast(t("act.sentI2i"));
    } catch (e) {
      toast(String(e), "warn");
    } finally {
      setBusy(false);
    }
  };

  /** ★가르지 않는다 — **설정으로 쓰는 것 하나**다 (사용자 지시 2026-08-05).
   *  「프롬프트만」은 적용이 아니라 **보는 것**이라, 아래 `프롬프트 보기`로 갈라 나갔다. */
  const useSettings = async () => {
    if (!loadMeta || busy) return;
    setBusy(true);
    try {
      const m = await loadMeta();
      if (!m) return toast(t("act.noMeta"), "warn");
      applyMeta(m, "all");
      toast(t("act.applied"));
    } catch (e) {
      toast(String(e), "warn");
    } finally {
      setBusy(false);
    }
  };

  /** 4배 업스케일 — 결과는 **원본의 다음 판**으로 붙는다 (원본은 그대로 남는다) */
  const cost = dims ? upscaleCost(dims.w, dims.h, opus) : -1;
  const runUpscale = async () => {
    if (!upscale || busy || cost < 0) return;
    setBusy(true);
    try {
      const r = await api<{ file: string; record: Rec }>("/api/upscale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace: upscale.ws, file: upscale.file }),
      });
      // ★목록을 **다시 읽지 않는다** — 서버가 돌려준 레코드 한 줄만 얹으면 화면이 따라온다
      useWs.getState().addRecord(r.record);
      toast(t("upscale.done"));
    } catch (e) {
      toast(String(e), "warn");
    } finally {
      setBusy(false);
    }
  };

  /** 이 그림의 프롬프트를 **읽기용**으로 연다 (설정을 건드리지 않는다) */
  const showPrompt = async () => {
    if (!loadMeta || busy) return;
    setBusy(true);
    try {
      const m = await loadMeta();
      if (!m) return toast(t("act.noMeta"), "warn");
      setSeen(m);
    } catch (e) {
      toast(String(e), "warn");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div
        data-image-actions
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-2)",
          flexWrap: "wrap",
        }}
      >
        {loadMeta && (
          <>
            <button data-act-prompt onClick={() => void showPrompt()} disabled={busy} style={btn}>
              {t("act.showPrompt")}
            </button>
            <button
              data-act-settings
              onClick={() => void useSettings()}
              disabled={busy}
              title={t("act.settingsHint")}
              style={btn}
            >
              {t("act.settings")}
            </button>
          </>
        )}

        <span style={{ width: 1, alignSelf: "stretch", background: "var(--line)" }} />

        <button data-act-i2i onClick={() => void toBase("img2img")} disabled={busy} style={btn}>
          {t("act.i2i")}
        </button>
        <button data-act-inpaint onClick={() => void toBase("inpaint")} disabled={busy} style={btn}>
          {t("act.inpaint")}
        </button>
        {onEnhance && (
          <button data-act-enhance onClick={onEnhance} style={btn}>
            {t("enhance.button")}
          </button>
        )}
        {upscale && dims && (
          <button
            data-act-upscale
            onClick={() => void runUpscale()}
            // ★1024x1024 를 넘으면 **공홈도 막는다.** 눌러야 실패하는 버튼을 두지 않는다
            disabled={busy || cost < 0}
            title={cost < 0 ? t("upscale.tooLarge") : t("upscale.hint", { a: cost })}
            style={{ ...btn, opacity: cost < 0 ? 0.45 : 1 }}
          >
            {t("upscale.button")}
            {/* 값을 버튼에 얹는다 — 누르면 얼마가 나가는지가 안전장치다 (v2 의 분해 표기와 같은 뜻) */}
            <span style={{ marginLeft: 5, color: "var(--ink-faint)" }}>
              {cost < 0 ? "—" : `${cost} Anlas`}
            </span>
          </button>
        )}
        {revealPath && (
          <button
            data-act-reveal
            onClick={() =>
              void api("/api/files/reveal", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ path: revealPath }),
              }).catch((e) => toast(String(e), "warn"))
            }
            title={t("files.reveal")}
            style={btn}
          >
            {t("files.reveal")}
          </button>
        )}
        {onKeep && (
          <button data-act-keep onClick={() => void onKeep()} title={t("gallery.keepHint")} style={btn}>
            {t("gallery.keep")}
          </button>
        )}
        {extra}

        {/* ★시드·해상도는 **맨 뒤 우측**이다 (페로픽스파이 `.result-meta .seed`,
            styles.css:380 "길이가 바뀌어도 앞 버튼들이 안 밀린다"). 시드는 테두리 없는
            글자처럼 두되 누르면 그 값으로 고정된다 — 랜덤도 함께 꺼야 실제로 쓰인다. */}
        {/* ★시드와 해상도는 **한 덩어리**로 오른쪽 끝에 — 따로 두면 줄이 넘칠 때
            해상도만 다음 줄로 떨어진다 (실측 2026-08-05) */}
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "var(--sp-2)", flexShrink: 0 }}>
        {seed !== undefined && (
          <button
            data-act-seed
            onClick={() => {
              setParam("seed", seed);
              setParam("seed_mode", "fixed");
              toast(t("act.seedSet", { n: seed }));
            }}
            title={t("slots.seedReuse")}
            style={{
              border: "none",
              background: "none",
              padding: "0 2px",
              fontSize: "var(--text-2xs)",
              fontFamily: "var(--font-mono)",
              fontVariantNumeric: "tabular-nums",
              textDecoration: seedNow === seed ? "underline" : undefined,
              color: seedNow === seed ? "var(--accent)" : "var(--ink-faint)",
            }}
          >
            seed {seed}
          </button>
        )}
        {dims && (
          <span
            data-act-res
            style={{
              flexShrink: 0,
              fontSize: "var(--text-2xs)",
              color: "var(--ink-faint)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {dims.w} × {dims.h}
          </span>
        )}
        </span>
      </div>

      {seen && <PromptView meta={seen} onClose={() => setSeen(null)} />}
    </>
  );
}

/** 이 그림의 프롬프트를 **최종 프롬프트와 같은 모양**으로 보여준다 (읽기 전용).
 *
 *  ★적용 버튼을 달지 않는다 — 적용은 옆의 「설정 불러오기」 하나뿐이다.
 *    같은 일을 두 곳에서 하게 두면 "어느 쪽이 뭘 바꾸나"가 흐려진다. */
function PromptView({ meta, onClose }: { meta: ImageMeta; onClose: () => void }) {
  const t = useI18n((s) => s.t);
  const rows: { label: string; text: string; accent?: string }[] = [
    { label: t("prompt.tabPrompt"), text: meta.prompt ?? "" },
    { label: t("prompt.tabUc"), text: meta.negative ?? "", accent: "var(--uc-c)" },
    ...(meta.characters ?? []).map((c, i) => ({
      label: t("cards.charN", { n: i + 1 }),
      text: c.prompt,
    })),
  ];
  const all = rows.map((r) => `${r.label}\n${r.text}`).join("\n\n");

  return (
    <div
      data-prompt-view
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 88,
        background: "rgba(6,8,12,0.62)",
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
          maxHeight: "80vh",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: "var(--sp-3)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
          <b style={{ fontSize: "var(--text-md)" }}>{t("act.promptOf")}</b>
          <span style={{ flex: 1 }} />
          <button
            data-prompt-copy
            onClick={() => void navigator.clipboard?.writeText(all).then(() => toast(t("act.copied")))}
            style={btn}
          >
            {t("act.copy")}
          </button>
          <button data-prompt-close onClick={onClose} style={btn}>
            {t("act.close")}
          </button>
        </div>
        {rows.map((r, i) => (
          <div key={i}>
            <div style={{ fontSize: "var(--text-2xs)", color: r.accent ?? "var(--ink-dim)" }}>{r.label}</div>
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
    </div>
  );
}

const btn: React.CSSProperties = {
  border: "1px solid var(--line)",
  borderRadius: "var(--r-2)",
  background: "var(--panel)",
  color: "var(--ink-soft)",
  padding: "3px var(--sp-3)",
  fontSize: "var(--text-2xs)",
};
