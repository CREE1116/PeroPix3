import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import { useGen } from "../store/gen";
import { enhanceScaleOptions, enhanceTargetSize } from "../lib/enhance";
import { useImageInput } from "../store/imageInput";
import { useQueue } from "../store/queue";
import { usePrompt } from "../store/prompt";
import { useWs } from "../store/workspace";
import { imgUrl } from "../lib/imgUrl";
import { Icon } from "../components/Icon";
import { anlasCost } from "../lib/anlas";
import { useSub } from "../store/sub";
import { useSceneFocus } from "../store/sceneFocus";
import { allScenes } from "../store/workspace";

/** ★Magnitude → 강도·노이즈. v2 `magnitudePresets` 원문 그대로 (index.html:23953).
 *  숫자를 바꾸면 결과가 달라진다 — "적당히 비슷한 값"으로 손대지 말 것. */
const MAGNITUDE: Record<number, { strength: number; noise: number }> = {
  1: { strength: 0.2, noise: 0 },
  2: { strength: 0.4, noise: 0 },
  3: { strength: 0.5, noise: 0 },
  4: { strength: 0.6, noise: 0 },
  5: { strength: 0.7, noise: 0.1 },
};

/** 강화(Enhance) — **그 그림을 다시 그린다**.
 *
 *  ★새 기능이 아니라 **i2i 의 프리셋**이다: 원본을 베이스 이미지로 넣고 Magnitude 가 정한
 *    강도로 굴린다. NAI 는 큰 판으로 그리는 것이지 업스케일러가 아니다.
 *  ★**원본을 미리 확대해 보내지 않는다** (`docs/nai-web-reference.md` 6절). 서버가 저장된
 *    원본을 그대로 보내고 width/height 만 키운다 — 예전 주석의 "캔버스로 먼저 키운다"는 폐기됐다.
 *  ★배율도 1.5 고정이 아니다. 원본 크기가 정한다 (`lib/enhance.ts`).
 *  ★결과는 **새 그림**이다. 어느 그림에서 나왔는지만 `enhance_of` 에 남기고, 화면은
 *    묶지 않는다 (사용자 결정 2026-08-13: v2 의 버전 스택 `1/n` 은 작업할 때 불편하다).
 */
export function EnhanceDialog({
  files,
  onClose,
}: {
  /** 강화할 그림들. 여럿이면 **배치**다 — 큐로 보낸다 */
  files: string[];
  onClose: () => void;
}) {
  const t = useI18n((s) => s.t);
  const { base, params } = useGen();
  const opus = useSub((s) => (s.sub?.tier ?? 0) >= 3);
  const ws = useWs((s) => s.current);
  const records = useWs((s) => s.records);
  const tabNow = useWs((s) => s.activeTab());
  const tabName = tabNow?.name ?? "싱글";
  const charName = tabNow?.kind === "set" ? (useWs.getState().activeCharOf()?.name ?? null) : null;
  const file = files[0];
  const [mag, setMag] = useState(3);
  const [scale, setScale] = useState(1);
  const [adv, setAdv] = useState(false);
  const [strength, setStrength] = useState(0.5);
  const [noise, setNoise] = useState(0);
  const [size, setSize] = useState<[number, number] | null>(null);
  const [busy, setBusy] = useState(false);

  // 원본 크기를 읽어 목표 해상도를 낸다
  useEffect(() => {
    const im = new Image();
    im.onload = () => {
      setSize([im.naturalWidth, im.naturalHeight]);
      // ★기본 선택은 **가용 배율 중 최대** (공홈과 같다). 원본을 읽고 나서야 알 수 있다
      setScale(enhanceScaleOptions(im.naturalWidth, im.naturalHeight)[0] ?? 1);
    };
    im.src = imgUrl(base, ws, file);
  }, [base, ws, file]);

  const preset = MAGNITUDE[mag] ?? MAGNITUDE[3];
  const useStrength = adv ? strength : preset.strength;
  const useNoise = adv ? noise : preset.noise;
  // ★이 원본에 쓸 수 있는 배율 — 크기가 정한다. 목록의 첫 값이 기본 선택(가용 중 최대)
  const scales = size ? enhanceScaleOptions(size[0], size[1]) : [1];
  // ★목표 해상도는 `align64(floor(원본 × 배율))` 이다 — round 가 아니다
  const target: [number, number] = size
    ? enhanceTargetSize(size[0], size[1], scale)
    : [params.width, params.height];

  /** ★값을 **누르기 전에** 보여 준다 (사용자 지적 2026-08-14).
   *  강화는 i2i 라 강도가 값에 들어간다. 배율을 올리면 크기가 커져 값도 뛴다. */
  const cost = anlasCost({
    width: target[0], height: target[1], steps: params.steps, opus,
    uncachedVibes: 0, activeVibes: 0, refCount: 0,
    strength: useStrength, count: files.length,
  });

  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // ★그림은 **서버가 읽는다** — 화면이 4.6MB base64 를 실어 보내지 않는다 (`enhance_from`).
      //   ★뿌리를 가리킨다: 강화본을 또 강화해도 스택이 평평해야 버전 넘기기가 안 꼬인다.
      const jobs = files.map((f) => ({
        enhance_from: f,
        enhance_scale: scale,
        enhance_of: records.find((r) => r.file === f)?.enhance_of || f,
        base_strength: useStrength,
        base_noise: useNoise,
      }));
      // ★한 장이어도 **큐로 보낸다** (사용자 지적 2026-08-14).
      //   예전에는 한 장일 때만 `generate()` 로 직접 돌아서, 다 될 때까지 창이 안 닫히고
      //   조작이 막혔다. 대기 칸도 안 떴다. 큐로 보내면 누른 즉시 자리가 잡힌다.
      const { prompt, uc, chars } = usePrompt.getState().compiled();
      // ★어느 씬 칸의 그림인가. 안 실으면 씬 탭에서 결과가 어디에도 안 뜬다 (`lib/takes.ts`)
      const cellId = useSceneFocus.getState().cell;
      const found = tabNow?.kind === "set" && cellId
        ? allScenes(tabNow).find((x) => x.cell.id === cellId)
        : null;
      // ★창을 **먼저** 닫는다 (사용자 지적 2026-08-14: 다 될 때까지 안 꺼졌다).
      //   큐는 보내기 전에 대기 칸을 미리 잡아 두므로, 닫자마자 그 자리가 보인다.
      onClose();
      await useQueue.getState().enqueue(
        {
          ...useGen.getState().params,
          ...useImageInput.getState().payload(),
          prompt, negative_prompt: uc, characters: chars,
          workspace: ws, tab: tabName, tab_id: tabNow?.id ?? null, char: charName,
          ...(found ? { cell: found.cell.name, cell_id: found.cell.id } : {}),
        },
        jobs,
        1,
      );
    } catch (e) {
      // ★조용히 실패하지 않는다 — 실측으로 밟았다 (그림을 못 읽어 아무 일도 안 일어났다)
      useGen.setState({ error: String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-enhance
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 85,
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
          width: "min(420px, 92vw)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--sp-4)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
          <b style={{ fontSize: "var(--text-md)" }}>{t("enhance.title")}</b>
          <span style={{ flex: 1 }} />
          <button data-enhance-close onClick={onClose} style={{ color: "var(--ink-faint)", display: "grid" }}>
            {Icon.close}
          </button>
        </div>

        <Row label={t("enhance.size")}>
          {[...scales].reverse().map((s) => (
            <button
              key={s}
              data-enhance-scale={s}
              onClick={() => setScale(s)}
              style={{ ...chip, ...(scale === s ? on : {}) }}
            >
              {s}×
            </button>
          ))}
          <span style={{ fontSize: "var(--text-2xs)", color: "var(--ink-faint)", fontFamily: "var(--font-mono)" }}>
            {target[0]}×{target[1]}
          </span>
        </Row>

        {!adv && (
          <Row label={t("enhance.magnitude")}>
            {[1, 2, 3, 4, 5].map((m) => (
              <button
                key={m}
                data-enhance-mag={m}
                onClick={() => setMag(m)}
                style={{ ...chip, ...(mag === m ? on : {}) }}
              >
                {m}
              </button>
            ))}
          </Row>
        )}

        {adv && (
          <>
            <Row label={t("imgIn.strength")}>
              <input
                type="range"
                data-enhance-strength
                min={0.01}
                max={0.99}
                step={0.01}
                value={strength}
                onChange={(e) => setStrength(Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <span style={{ width: 34, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{strength}</span>
            </Row>
            <Row label={t("imgIn.noise")}>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={noise}
                onChange={(e) => setNoise(Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <span style={{ width: 34, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{noise}</span>
            </Row>
          </>
        )}

        <label style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", fontSize: "var(--text-2xs)", color: "var(--ink-soft)" }}>
          <input type="checkbox" data-enhance-adv checked={adv} onChange={(e) => setAdv(e.target.checked)} />
          {t("enhance.advanced")}
        </label>

        <span style={{ fontSize: "var(--text-2xs)", color: "var(--ink-faint)" }}>
          {t("enhance.hint", { s: useStrength, n: useNoise })}
        </span>

        <button
          data-enhance-run
          onClick={() => void run()}
          disabled={busy || !size}
          style={{
            background: "var(--accent)",
            color: "var(--accent-on)",
            borderRadius: "var(--r-2)",
            padding: "var(--sp-3)",
            fontWeight: "var(--w-semi)",
            fontSize: "var(--text-sm)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "var(--sp-2)",
          }}
        >
          {Icon.spark}
          {files.length > 1 ? t("enhance.runN", { n: files.length }) : t("enhance.run")}
          <span style={{ opacity: 0.82, fontVariantNumeric: "tabular-nums" }}>
            {t("focus.oneCost", { a: cost.total })}
          </span>
        </button>
      </div>
    </div>
  );
}

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
    <span style={{ width: 62, flexShrink: 0, fontSize: "var(--text-2xs)", color: "var(--ink-faint)" }}>{label}</span>
    {children}
  </div>
);

const chip: React.CSSProperties = {
  border: "1px solid var(--line)",
  borderRadius: "var(--r-2)",
  background: "var(--panel)",
  color: "var(--ink-soft)",
  padding: "3px var(--sp-4)",
  fontSize: "var(--text-2xs)",
};
const on: React.CSSProperties = {
  borderColor: "var(--accent)",
  background: "var(--accent-bg)",
  color: "var(--ink)",
};
