import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import { api, backendUrl } from "../lib/backend";
import { useImageInput } from "../store/imageInput";
import { Icon } from "../components/Icon";

type Entry = {
  file: string;
  cache_key: string;
  model: string;
  info_extracted: number;
  strength: number;
  size: [number, number];
};

/** 바이브 캐시 뷰어 — **구워 둔 인코딩**을 보고 다시 쓰는 자리 (v2 6단계).
 *
 *  ★인코딩은 **돈이 나가는 호출**이다 (바이브당 2 Anlas). 같은 그림·같은 모델·같은 정보추출이면
 *    다시 굽지 않는데(`vibe.reuse_ok`), 그 판정이 보이지 않으면 사용자는 "또 돈이 나가나"를
 *    알 수 없다. 여기서 **무엇이 구워져 있는지**를 보이고, 눌러서 그대로 꺼내 쓴다.
 *  ★캐시에 남는 것은 **인코딩과 미리보기 PNG** 다. 원본 그림은 없다 — 그래서 꺼내 쓸 때
 *    `encoded` 를 채워 넣는다 (서버가 그 값을 보고 네트워크를 안 탄다).
 */
export function VibeCache({ onClose }: { onClose: () => void }) {
  const t = useI18n((s) => s.t);
  const [items, setItems] = useState<Entry[] | null>(null);
  const [base, setBase] = useState("");
  const img = useImageInput();

  useEffect(() => {
    let alive = true;
    void (async () => {
      setBase(await backendUrl());
      try {
        const r = await api<{ items: Entry[] }>("/api/vibe-cache");
        if (alive) setItems(r.items);
      } catch {
        if (alive) setItems([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div
      data-vibe-cache
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
          width: "min(760px, 92vw)",
          maxHeight: "82vh",
          display: "flex",
          flexDirection: "column",
          gap: "var(--sp-4)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
          <b style={{ fontSize: "var(--text-md)" }}>{t("imgIn.cacheTitle")}</b>
          <span style={{ fontSize: "var(--text-2xs)", color: "var(--ink-faint)" }}>
            {t("imgIn.cacheHint")}
          </span>
          <span style={{ flex: 1 }} />
          <button data-vibe-cache-close onClick={onClose} style={{ color: "var(--ink-faint)", display: "grid" }}>
            {Icon.close}
          </button>
        </div>

        {items === null ? (
          <div style={{ padding: "var(--sp-6)", color: "var(--ink-faint)", fontSize: "var(--text-2xs)" }}>…</div>
        ) : items.length === 0 ? (
          <div style={{ padding: "var(--sp-6)", color: "var(--ink-faint)", fontSize: "var(--text-2xs)" }}>
            {t("imgIn.cacheEmpty")}
          </div>
        ) : (
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill,150px)",
              gap: "var(--sp-4)",
              justifyContent: "start",
            }}
          >
            {items.map((it) => (
              <button
                key={it.file}
                data-vibe-cache-item={it.file}
                onClick={() => {
                  // ★구워 둔 것을 그대로 쓴다 — 원본 그림이 없으므로 미리보기 PNG 를 그림 자리에 둔다.
                  //   서버는 `encoded` 가 있고 모델·정보추출이 맞으면 **네트워크를 안 탄다**.
                  img.setVibeOn(true);
                  img.addVibe("", it.file.replace(/\.png$/, ""));
                  const i = useImageInput.getState().vibes.length - 1;
                  img.patchVibe(i, {
                    strength: it.strength,
                    info_extracted: it.info_extracted,
                    encoded_model: it.model,
                    encoded_info_extracted: it.info_extracted,
                  });
                  onClose();
                }}
                title={t("imgIn.cacheUse")}
                style={{
                  border: "1px solid var(--line)",
                  borderRadius: "var(--r-2)",
                  overflow: "hidden",
                  background: "var(--panel)",
                  padding: 0,
                  textAlign: "left",
                }}
              >
                <img
                  src={`${base}/api/vibe-cache/${encodeURIComponent(it.file)}`}
                  alt=""
                  loading="lazy"
                  style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", display: "block" }}
                />
                <div style={{ padding: "var(--sp-2) var(--sp-3)", fontSize: "var(--text-2xs)" }}>
                  <div style={{ color: "var(--ink-soft)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {it.model.replace("nai-diffusion-", "")}
                  </div>
                  <div style={{ color: "var(--ink-faint)", fontFamily: "var(--font-mono)" }}>
                    {t("imgIn.strength")} {it.strength} · {t("imgIn.info")} {it.info_extracted}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
