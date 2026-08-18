import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import { useGen } from "../store/gen";
import {
  clampEnhanceScale,
  enhanceScaleOptions,
  enhanceTargets,
  enhanceTargetSize,
} from "../lib/enhance";
import { useUi } from "../store/ui";
import { useImageInput } from "../store/imageInput";
import { useQueue } from "../store/queue";
import { usePrompt } from "../store/prompt";
import { useWs } from "../store/workspace";
import { imgUrl } from "../lib/imgUrl";
import { Icon } from "../components/Icon";
import { anlasCost, MAX_PER_IMAGE } from "../lib/anlas";
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
  /** 실제로 돌릴 것과 뺀 것 — ★**열 때 한 번** 정한다 (v2 도 모달을 열 때 목록을 굳힌다).
   *  돌아가는 사이에 새 레코드가 들어와도 대상이 바뀌면 안 된다.
   *  ★한 장짜리는 거르지 않는다 — 걸러 내는 것은 **배치**의 규칙이다 (v2 단일 모달도 안 거른다). */
  const [{ targets, skipped }] = useState(() =>
    files.length > 1
      ? enhanceTargets(useWs.getState().records, files)
      : { targets: files, skipped: [] as string[] },
  );
  // ★강도는 **마지막에 쓴 값**으로 연다 (v2 `enhanceLast`). 열 때마다 3 으로 되돌아가던 자리
  const last = useUi.getState().enhanceLast;
  const [mag, setMag] = useState(last.mag);
  const [scale, setScale] = useState(1);
  const [adv, setAdv] = useState(last.adv);
  const [strength, setStrength] = useState(last.strength);
  const [noise, setNoise] = useState(last.noise);
  /** 대상마다 원본 크기 — 배치는 크기가 섞여 있어 **장마다** 재야 한다 */
  const [sizes, setSizes] = useState<Record<string, [number, number]> | null>(null);
  const [busy, setBusy] = useState(false);

  // 원본 크기를 읽어 목표 해상도를 낸다 (배치면 전부)
  useEffect(() => {
    let dead = false;
    setSizes(null);
    void Promise.all(
      targets.map(
        (f) =>
          new Promise<[string, [number, number]]>((res) => {
            const im = new Image();
            im.onload = () => res([f, [im.naturalWidth, im.naturalHeight]]);
            // 못 읽으면 화면 값으로 둔다 — 목표 크기는 어차피 서버가 원본에서 다시 잰다
            im.onerror = () => res([f, [params.width, params.height]]);
            im.src = imgUrl(base, ws, f);
          }),
      ),
    ).then((pairs) => {
      if (dead) return;
      const m = Object.fromEntries(pairs);
      setSizes(m);
      // ★기본 선택은 **전부가 쓸 수 있는 가장 큰 배율**이다. 한 장이면 그 장의 최대라
      //   단일 강화의 동작이 그대로다 (공홈과 같다).
      const opts = Object.values(m).map(([w, h]) => enhanceScaleOptions(w, h));
      setScale([2, 1.5, 1].find((s) => opts.every((o) => o.includes(s))) ?? 1);
    });
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, ws, targets]);

  const preset = MAGNITUDE[mag] ?? MAGNITUDE[3];
  const useStrength = adv ? strength : preset.strength;
  const useNoise = adv ? noise : preset.noise;
  // ★고른 강도를 기억해 둔다 — 다음에 열 때 이 값으로 뜬다
  useEffect(() => {
    useUi.getState().setEnhanceLast({ mag, adv, strength, noise });
  }, [mag, adv, strength, noise]);

  /** 이 장에 실제로 나갈 배율 — ★못 쓰는 배율이면 **쓸 수 있는 가장 큰 것으로 내린다**.
   *  배치는 크기가 섞여 있어 한 배율이 전부에 맞는 일이 드물다 (v2 규칙, `lib/enhance.ts`). */
  const scaleOf = (f: string) => {
    const d = sizes?.[f];
    return d ? clampEnhanceScale(d[0], d[1], scale) : scale;
  };
  /** 배율이 내려간 장 수 — ★**누르기 전에** 알린다 (v2 는 큐에 넣고 나서 토스트로 알렸다) */
  const adjusted = sizes ? targets.filter((f) => scaleOf(f) !== scale).length : 0;
  // ★배율 선택지는 대상 **아무나** 쓸 수 있는 것까지 보여 준다. 한 장이면 그 장의 목록 그대로다
  const scales = sizes
    ? [2, 1.5, 1].filter((s) =>
        targets.some((f) => {
          const d = sizes[f];
          return d ? enhanceScaleOptions(d[0], d[1]).includes(s) : s === 1;
        }),
      )
    : [1];
  // ★목표 해상도는 `align64(floor(원본 × 배율))` 이다 — round 가 아니다
  const one = targets.length === 1 && sizes ? sizes[targets[0]] : null;
  const target: [number, number] = one
    ? enhanceTargetSize(one[0], one[1], scaleOf(targets[0]))
    : [params.width, params.height];

  /** ★값을 **누르기 전에** 보여 준다 (사용자 지적 2026-08-14).
   *  강화는 i2i 라 강도가 값에 들어간다. 배율을 올리면 크기가 커져 값도 뛴다.
   *  ★배치는 크기가 장마다 달라 **장마다 세서 더한다** — 한 장 값에 장 수를 곱하면 어긋난다. */
  const each = targets.map((f) => {
    const d = sizes?.[f];
    const [w, h] = d ? enhanceTargetSize(d[0], d[1], scaleOf(f)) : [params.width, params.height];
    return anlasCost({
      width: w, height: h, steps: params.steps, opus,
      uncachedVibes: 0, activeVibes: 0, refCount: 0,
      strength: useStrength, count: 1,
    });
  });
  const cost = {
    perImage: each[0]?.perImage ?? 0,
    total: each.reduce((s, c) => s + c.total, 0),
    encoding: 0,
    free: each.length > 0 && each.every((c) => c.free),
    overLimit: each.some((c) => c.overLimit),
  };

  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // ★한 장이어도 **큐로 보낸다** (사용자 지적 2026-08-14).
      //   예전에는 한 장일 때만 `generate()` 로 직접 돌아서, 다 될 때까지 창이 안 닫히고
      //   조작이 막혔다. 대기 칸도 안 떴다. 큐로 보내면 누른 즉시 자리가 잡힌다.
      const { prompt, uc, chars } = usePrompt.getState().compiled();
      // ★어느 씬 칸의 그림인가. 안 실으면 씬 탭에서 결과가 어디에도 안 뜬다 (`lib/takes.ts`)
      const cellId = useSceneFocus.getState().cell;
      const scenes = tabNow?.kind === "set" ? allScenes(tabNow) : [];
      const found = cellId ? scenes.find((x) => x.cell.id === cellId) : null;
      /** 그 그림이 원래 있던 씬 칸 — ★배치는 **여러 씬에 걸쳐** 고른다. 보고 있는 칸 하나로
       *  전부 보내면 다른 줄의 그림을 강화한 결과가 엉뚱한 줄에 붙는다.
       *  칸을 못 찾으면 base 의 것(지금 보는 칸)이 그대로 쓰인다 (`store/queue` enqueue 주석). */
      const cellOf = (f: string) => {
        const id = records.find((r) => r.file === f)?.cell_id;
        const at = id ? scenes.find((x) => x.cell.id === id) : null;
        return at ? { cell: at.cell.name, cell_id: at.cell.id } : {};
      };
      // ★그림은 **서버가 읽는다** — 화면이 4.6MB base64 를 실어 보내지 않는다 (`enhance_from`).
      //   ★뿌리를 가리킨다: 강화본을 또 강화해도 스택이 평평해야 버전 넘기기가 안 꼬인다.
      //   ★배율은 **장마다** 다를 수 있다 (`scaleOf` — 못 쓰는 배율은 내려간다).
      const jobs = targets.map((f) => ({
        enhance_from: f,
        enhance_scale: scaleOf(f),
        enhance_of: records.find((r) => r.file === f)?.enhance_of || f,
        base_strength: useStrength,
        base_noise: useNoise,
        ...cellOf(f),
      }));
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

        {/* 배치일 때만 — 몇 장을 돌리고 몇 장을 뺐나 */}
        {files.length > 1 && (
          <Row label={t("enhance.targets")}>
            <span data-enhance-targets={targets.length} style={{ fontSize: "var(--text-2xs)", color: "var(--ink)" }}>
              {t("slots.count", { n: targets.length })}
            </span>
            {skipped.length > 0 && (
              <span
                data-enhance-skipped={skipped.length}
                title={t("slots.enhanceSkip")}
                style={{ fontSize: "var(--text-2xs)", color: "var(--ink-faint)" }}
              >
                {t("enhance.excluded", { n: skipped.length })}
              </span>
            )}
          </Row>
        )}

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
            {!sizes ? t("enhance.measuring") : one ? `${target[0]}×${target[1]}` : ""}
          </span>
        </Row>

        {/* ★배율이 내려가는 장이 있으면 **누르기 전에** 알린다 (v2 는 큐에 넣은 뒤 토스트였다) */}
        {adjusted > 0 && (
          <span
            data-enhance-adjusted={adjusted}
            style={{ fontSize: "var(--text-2xs)", color: "var(--warn)" }}
          >
            {t("enhance.scaleAdjusted", { n: adjusted, s: scale })}
          </span>
        )}

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

        {/* ★한 장이 140 Anlas 를 넘으면 실행을 막는다 — 생성 쪽과 **같은 판정**이다
            (v2 `index.html:24419-24438`. 인핸스는 언제나 한 장이라 그대로 개별 비용 기준).
            배율을 올리면 해상도가 뛰어 여기서 자주 걸린다 */}
        {cost.overLimit && (
          <span data-enhance-over-limit style={{ fontSize: "var(--text-2xs)", color: "var(--err)" }}>
            {t("gen.overLimit", { a: MAX_PER_IMAGE })}
          </span>
        )}

        {/* 고른 것이 전부 이미 강화한 그림이면 돌릴 것이 없다 */}
        {!targets.length && (
          <span data-enhance-no-target style={{ fontSize: "var(--text-2xs)", color: "var(--warn)" }}>
            {t("enhance.noTarget")}
          </span>
        )}

        <button
          data-enhance-run
          onClick={() => void run()}
          disabled={busy || !sizes || !targets.length || cost.overLimit}
          style={{
            background: cost.overLimit || !targets.length ? "var(--panel)" : "var(--accent)",
            color: cost.overLimit || !targets.length ? "var(--ink-faint)" : "var(--accent-on)",
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
          {targets.length > 1 ? t("enhance.runN", { n: targets.length }) : t("enhance.run")}
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
