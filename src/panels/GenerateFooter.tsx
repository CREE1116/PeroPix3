import { useI18n } from "../i18n";

/** ★키를 조립하지 않는다 — i18n 검사가 동적 접두사를 잡는다 (`i18n.test.ts`) */
const SEED_LABELS = ["options.seedFixed", "options.seedRound", "options.seedScene"] as const;
const SEED_HINTS = ["options.seedFixedHint", "options.seedRoundHint", "options.seedSceneHint"] as const;
import { SEED_MODES, randomSeed, useGen } from "../store/gen";
import { useQueue } from "../store/queue";
import { allCells, useWs } from "../store/workspace";
import { useImageInput } from "../store/imageInput";
import { useUi, PER_SLOT_MAX } from "../store/ui";
import { anlasCost } from "../lib/anlas";
import { useSub } from "../store/sub";
import { Icon } from "../components/Icon";

/** 생성 푸터 — 페로픽스파이 `params-footer` 를 그대로 옮긴 것이다
 *  (`ui/src/tabs/workbench/ParamsPanel.tsx` · `styles.css` `.params-footer`).
 *
 *  ★쌓는 순서가 그쪽 구현의 핵심이다: **오류 → 큐 줄 → 시드 → 생성 버튼**.
 *    버튼은 **언제나 맨 아래**고, 위의 것들이 생겼다 사라져도 버튼은 자리를 안 옮긴다.
 *  ★큐 줄은 **돌고 있을 때만** 뜬다: `대기 n · 3/8` + `현재 중단` + `큐 비우기`.
 *    이게 없으면 눌렀는지 안 눌렀는지 알 수가 없다 (사용자 지적 2026-08-04 — 멀티에서
 *    아무 반응이 없어 보였다).
 *  ★시드는 **숫자칸 + Random 체크**다 (그쪽 `seed-row seed-pinned`). 체크를 켜면 매번
 *    새 시드로 굴리고, 숫자는 남아 있어 그대로 다시 쓸 수 있다.
 *  ★접힌 패널에서도 버튼은 남는다 — `compact` 로 부른다.
 */
export function GenerateFooter({ compact = false }: { compact?: boolean }) {
  const t = useI18n((s) => s.t);
  // 구독 상태는 **스토어 하나**가 들고 있다 (업스케일 값 표시도 같은 곳을 본다)
  const sub = useSub((s) => s.sub);
  const { params, set, busy, error, generateAll, queueSingle } = useGen();
  const { progress, cancel, clear } = useQueue();
  const tab = useWs((s) => s.activeTab());
  const img = useImageInput();

  const isSet = tab?.kind === "set";
  // ★락한 슬롯은 생성에서 빠진다 — 장 수도 그만큼 줄여야 값이 맞는다 (gen.ts `generateAll`)
  const perSlot = useUi((s) => s.perSlot);
  const setPerSlot = useUi((s) => s.setPerSlot);
  const slots = isSet ? allCells(tab).filter((c) => !c.locked).length : 1;
  // ★싱글도 **한 번에 여러 장**을 넣는다 (사용자 지시 2026-08-05, v2 batch count).
  //   슬롯이 없을 뿐 쓰임은 같아서 `perSlot` 을 그대로 쓴다 — 값을 둘로 나누면 어느 쪽이
  //   먹는지 헷갈린다.
  const count = isSet ? slots * perSlot : perSlot;
  /** ★인페인트 중에는 **이 버튼을 잠근다** (사용자 지적 2026-08-13).
   *
   *  이 버튼의 뜻은 언제나 「슬롯 전체」다. 인페인트는 「이 한 장」이라 단위가 다르고,
   *  그래서 실행 버튼도 마스크 편집 화면 안에 따로 있다. 여기서 뜻을 갈아 끼우면
   *  5슬롯을 열어 둔 채 인페인트했을 때 5장이 나온다. */
  const editing = img.editing;
  const cost = anlasCost({
    width: params.width,
    height: params.height,
    steps: params.steps,
    opus: (sub?.tier ?? 0) >= 3,
    uncachedVibes: img.vibeOn ? img.vibes.filter((v) => !v.encoded).length : 0,
    // ★활성 5개 초과분은 개당 +2 — 구워 둔 것도 센다 (요청당 한 번)
    activeVibes: img.vibeOn ? img.vibes.length : 0,
    refCount: img.refOn ? img.refs.length : 0,
    strength: img.baseImage ? img.baseStrength : 1,
    count,
  });
  const running = progress.total > progress.completed;

  const genBtn = (
    <button
      data-generate={isSet ? "all" : "one"}
      onClick={() => (isSet ? generateAll() : queueSingle(perSlot))}
      disabled={busy || editing}
      title={compact ? t(editing ? "focus.lockedByInpaint" : "canvas.generate") : undefined}
      style={{
        background: busy || editing ? "var(--panel)" : "var(--accent)",
        color: busy || editing ? "var(--ink-faint)" : "var(--accent-on)",
        borderRadius: "var(--r-2)",
        padding: compact ? "var(--sp-3) 0" : "var(--sp-3)",
        fontWeight: "var(--w-semi)",
        fontSize: "var(--text-sm)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--sp-2)",
        width: "100%",
      }}
    >
      {!busy && Icon.spark}
      {!compact && (busy ? t("canvas.generating") : t("canvas.generate"))}
      {/* ★몇 장을 만들지·얼마가 드는지를 **누르기 전에** 보여 준다 */}
      {!compact && (
        <span style={{ opacity: 0.82, fontVariantNumeric: "tabular-nums" }}>
          {t("gen.countCost", { n: count, a: cost.total })}
        </span>
      )}
    </button>
  );

  // 접힌 레일 — 버튼만 남긴다. 여기서도 누를 수 있어야 접어 둔 채 계속 만든다
  if (compact) {
    return (
      <div style={{ padding: "var(--sp-2)", borderTop: "1px solid var(--line)" }}>
        {genBtn}
        {running && (
          <div
            data-queue-mini
            style={{
              marginTop: 4,
              fontSize: "var(--text-2xs)",
              color: "var(--ink-dim)",
              textAlign: "center",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {progress.completed}/{progress.total}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      data-gen-footer
      style={{
        flexShrink: 0,
        borderTop: "1px solid var(--line)",
        padding: "var(--sp-3) var(--sp-4) var(--sp-4)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--sp-2)",
      }}
    >
      {error && <span style={{ fontSize: "var(--text-2xs)", color: "var(--err)" }}>{error}</span>}

      {/* 큐 줄 — 돌고 있을 때만. 눌렀다는 신호이자 멈추는 창구다 */}
      {running && (
        <div data-queue-bar style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: "var(--text-2xs)",
              color: "var(--ink-dim)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {t("queue.waiting", { n: progress.queue_length })} · {progress.completed}/{progress.total}
          </span>
          <button data-queue-cancel onClick={() => void cancel()} title={t("queue.cancelHint")} style={qbtn}>
            {t("queue.cancel")}
          </button>
          <button
            data-queue-clear
            onClick={() => void clear()}
            title={t("queue.clearHint")}
            style={{ ...qbtn, color: "var(--err)", borderColor: "var(--err)" }}
          >
            {t("queue.clear")}
          </button>
        </div>
      )}

      {/* ★몇 장 — 멀티는 슬롯당, 싱글은 그냥 장 수. 한 번에 여러 장을 뽑아 고르는 것이 본래 쓰임이다 */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
          <span style={{ fontSize: "var(--text-2xs)", color: "var(--ink-faint)", flexShrink: 0 }}>
            {isSet ? t("gen.perSlot") : t("gen.count")}
          </span>
          <input
            data-per-slot
            type="number"
            min={1}
            max={PER_SLOT_MAX}
            value={perSlot}
            onChange={(e) => setPerSlot(Number(e.target.value) || 1)}
            style={{
              width: 56,
              background: "var(--panel)",
              border: "1px solid var(--line)",
              borderRadius: "var(--r-2)",
              padding: "3px var(--sp-3)",
              fontSize: "var(--text-2xs)",
              fontFamily: "var(--font-mono)",
            }}
          />
          {isSet && (
            <span style={{ fontSize: "var(--text-2xs)", color: "var(--ink-ghost)" }}>
              {t("gen.slotsTimes", { s: slots, p: perSlot, t: count })}
            </span>
          )}
      </div>

      {/* 시드 — 매번 만지는 값이라 생성 버튼 바로 위에 고정 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-2)",
          paddingTop: "var(--sp-2)",
          borderTop: "1px solid var(--line-soft, var(--line))",
        }}
      >
        <span style={{ fontSize: "var(--text-2xs)", color: "var(--ink-faint)", flexShrink: 0 }}>
          {t("options.seed")}
        </span>
        <input
          data-seed
          value={params.seed}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            set("seed", Number.isFinite(v) ? v : 0);
          }}
          // ★★**랜덤이어도 고칠 수 있다** (사용자 지적 2026-08-16). 랜덤은 아무 숫자를
          //   넣는 게 아니라 **여기 적힌 값으로 뽑고 나서** 이 칸을 굴리는 것이라,
          //   잠그면 "이 시드로 한 장 더" 를 아예 못 한다 (`lib/seedRounds` 머리 주석).
          title={t("options.seedHint")}
          style={{
            flex: 1,
            minWidth: 0,
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: "var(--r-2)",
            padding: "3px var(--sp-3)",
            fontSize: "var(--text-2xs)",
            fontFamily: "var(--font-mono)",
          }}
        />
        {/* 주사위 — 지금 자리에서 바로 새 시드를 뽑아 본다 */}
        <button
          data-seed-roll
          onClick={() => set("seed", randomSeed())}
          title={t("options.seedRoll")}
          style={{ flexShrink: 0, color: "var(--ink-faint)", display: "grid", padding: "0 2px" }}
        >
          {Icon.dice}
        </button>
        {/* ★배타적 3택이다 — 체크박스 둘이면 「고정 + 씬마다 랜덤」 같은 뜻 없는 상태가
            생긴다 (사용자 지적 2026-08-11). v2 의 `랜덤/고정/슬롯마다 랜덤` 이관. */}
        <div
          data-seed-mode={params.seed_mode}
          style={{
            display: "flex",
            flexShrink: 0,
            border: "1px solid var(--line)",
            borderRadius: "var(--r-2)",
            overflow: "hidden",
          }}
        >
          {SEED_MODES.map((m, i) => {
            const on = params.seed_mode === m;
            return (
              <button
                key={m}
                data-seed-pick={m}
                onClick={() => set("seed_mode", m)}
                title={t(SEED_HINTS[i])}
                style={{
                  padding: "2px var(--sp-3)",
                  fontSize: "var(--text-2xs)",
                  whiteSpace: "nowrap",
                  borderRight: i < 2 ? "1px solid var(--line)" : undefined,
                  background: on ? "var(--accent-bg)" : "transparent",
                  color: on ? "var(--accent)" : "var(--ink-dim)",
                  fontWeight: on ? "var(--w-semi)" : 400,
                }}
              >
                {t(SEED_LABELS[i])}
              </button>
            );
          })}
        </div>
      </div>

      {genBtn}

      {/* 인페인트 중에는 이 버튼이 왜 잠겼는지 그 자리에서 말한다 */}
      {editing && (
        <span data-gen-locked style={{ fontSize: "var(--text-2xs)", color: "var(--accent)" }}>
          {t("focus.lockedByInpaint")}
        </span>
      )}

      <div style={{ display: "flex", alignItems: "center", fontSize: "var(--text-2xs)", color: "var(--ink-faint)" }}>
        {cost.encoding > 0 && <span>{t("gen.vibeEncode", { a: cost.encoding })}</span>}
        <span style={{ flex: 1 }} />
        {sub && (
          <span title={`tier ${sub.tier}`}>
            Anlas{" "}
            <b style={{ fontFamily: "var(--font-mono)", color: "var(--ink-soft)" }}>
              {sub.anlas.toLocaleString()}
            </b>
          </span>
        )}
      </div>
    </div>
  );
}

const qbtn: React.CSSProperties = {
  border: "1px solid var(--line)",
  borderRadius: "var(--r-2)",
  padding: "2px var(--sp-3)",
  fontSize: "var(--text-2xs)",
  color: "var(--ink-soft)",
  background: "var(--panel)",
};
