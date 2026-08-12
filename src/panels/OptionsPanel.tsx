import { useI18n } from "../i18n";
import { useEffect, useState } from "react";
import { MODELS, NAI_MAX, SIZE_PRESETS, alignTo64, useGen } from "../store/gen";
import { Icon } from "../components/Icon";
import { ImageInputPanel } from "./ImageInputPanel";
import { flashStyle, useFlash } from "../store/ui";

const SAMPLERS = ["k_euler_ancestral", "k_euler", "k_dpmpp_2m", "k_dpmpp_2m_sde", "k_dpmpp_2s_ancestral", "k_dpmpp_sde"];
const SCHEDULERS = ["karras", "native", "exponential", "polyexponential"];
// ★v2 와 같은 5종. `Furry Focus` 는 ucPreset 숫자표에 없어 0(Heavy)으로 떨어지지만
//   프리셋 **태그 문자열**은 자기 것을 쓴다 — v2 와 같은 동작이다 (nai.py 참조).
const UC_PRESETS = ["Heavy", "Light", "Human Focus", "Furry Focus", "None"];

/** 우측 패널 — 생성 파라미터. */
export function OptionsPanel() {
  const p = useGen((s) => s.params);
  const set = useGen((s) => s.set);
  const t = useI18n((s) => s.t);

  return (
    <div style={{ padding: "var(--sp-4)", display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}>
      <Group label={t("options.model")}>
        {/* ★옛 워크스페이스가 없어진 모델(V4.0)을 들고 있으면 목록에 없어 빈칸으로 보인다 —
            기본값으로 되돌린다. 조용히 다른 표로 생성되는 것보다 낫다 */}
        <Select
          value={MODELS.some(([id]) => id === p.model) ? p.model : MODELS[0][0]}
          options={MODELS}
          onChange={(v) => set("model", v)}
        />
      </Group>

      <Group label={t("options.resolution")} flashKey="size">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--sp-2)" }}>
          {SIZE_PRESETS.flatMap((g) => g.items).map(([w, h, star]) => {
            const on = p.width === w && p.height === h;
            const name = w > h ? "landscape" : w === h ? "square" : "portrait";
            return (
              <button
                key={`${w}x${h}`}
                onClick={() => {
                  set("width", w);
                  set("height", h);
                }}
                // ★강조는 **테두리**로 나타낸다 (페로픽스파이 `button.active`).
                //   고른 것만 옅은 강조 배경이 깔리고, **글자는 강조색을 쓰지 않는다** —
                //   테두리·배경·글자 3중으로 칠하면 패널에서 가장 큰 색 덩어리가 된다.
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--accent)")}
                onMouseLeave={(e) =>
                  (e.currentTarget.style.borderColor = on ? "var(--accent)" : "var(--line)")
                }
                style={{
                  flex: 1,
                  padding: "var(--sp-2)",
                  borderRadius: "var(--r-2)",
                  border: `1px solid ${on ? "var(--accent)" : "var(--line)"}`,
                  // ★목록 행은 가라앉은 톤 (페로픽스파이 `.res-item`) — 패널 위에 눌러 앉는다
                  background: on ? "var(--accent-bg)" : "var(--bg)",
                  color: "var(--ink)",
                  fontSize: "var(--text-2xs)",
                  lineHeight: 1.3,
                }}
              >
                {t(`options.${name}`)}
                {star && (
                  <span title={t("options.starHint")} style={{ display: "inline-grid", verticalAlign: "-2px", marginLeft: 2 }}>
                    {Icon.spark12}
                  </span>
                )}
                <br />
                <span style={{ fontFamily: "var(--font-mono)" }}>
                  {w}×{h}
                </span>
              </button>
            );
          })}
        </div>
        {/* ★직접 입력 — NAI 는 64 배수만 받는다. 입력을 떠날 때 올려 맞추고 그 값을 보여 준다
            (서버도 같은 정렬을 하지만, 무엇이 갈지 지금 보여야 한다) */}
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
          <NumBox data-size="w" value={p.width} onCommit={(v) => set("width", alignTo64(v))} />
          <span style={{ color: "var(--ink-faint)", fontSize: "var(--text-2xs)" }}>×</span>
          <NumBox data-size="h" value={p.height} onCommit={(v) => set("height", alignTo64(v))} />
          <Hint>{t("options.sizeHint")}</Hint>
        </div>
      </Group>

      <Group label={t("options.steps")}>
        <Num value={p.steps} min={1} max={NAI_MAX.steps} onChange={(v) => set("steps", v)} />
        <Hint>{t("options.stepsHint")}</Hint>
      </Group>

      <Group label={t("options.cfg")}>
        <Num value={p.cfg} min={1} max={NAI_MAX.cfg} step={0.1} onChange={(v) => set("cfg", v)} />
      </Group>

      <Group label={t("options.cfgRescale")}>
        <Num value={p.cfg_rescale} min={0} max={1} step={0.02} onChange={(v) => set("cfg_rescale", v)} />
      </Group>

      <Group label={t("options.sampler")}>
        <Select value={p.sampler} options={SAMPLERS} onChange={(v) => set("sampler", v)} />
      </Group>

      <Group label={t("options.scheduler")}>
        <Select value={p.scheduler} options={SCHEDULERS} onChange={(v) => set("scheduler", v)} />
      </Group>

      <Group label={t("options.ucPreset")}>
        <Select value={p.uc_preset} options={UC_PRESETS} onChange={(v) => set("uc_preset", v)} />
      </Group>

      {/* ★시드는 여기 없다 — **생성 버튼 옆 하나**로 옮겼다 (사용자 지시 2026-08-04).
          매번 만지는 유일한 옵션이라 생성 버튼 곁이 맞고, 두 곳에 두면 어느 쪽이
          진짜인지 흐려진다 (하나의 정보에는 하나의 창구). → `GenerateFooter` */}

      <Group label={t("options.misc")}>
        <Check
          label={t("options.qualityTags")}
          checked={p.quality_tags}
          onChange={(v) => set("quality_tags", v)}
        />
        <Check label={t("options.varietyPlus")} checked={p.variety_plus} onChange={(v) => set("variety_plus", v)} />
        <Check label={t("options.furryMode")} checked={p.furry_mode} onChange={(v) => set("furry_mode", v)} />
      </Group>

      <Group label={t("options.saveOptions")}>
        <div style={{ display: "flex", gap: "var(--sp-2)" }}>
          <Select
            value={p.save_format}
            options={[["png", "PNG"], ["jpg", "JPG"], ["webp", "WebP"]]}
            onChange={(v) => set("save_format", v)}
          />
          {p.save_format !== "png" && (
            <NumBox value={p.jpg_quality} onCommit={(v) => set("jpg_quality", Math.min(100, Math.max(1, v)))} />
          )}
        </div>
        {/* ★그림을 공유할 때만 쓴다 — 지우면 그 그림으로 재생성할 수 없다 */}
        <Check
          label={t("options.stripMetadata")}
          checked={p.strip_metadata}
          onChange={(v) => set("strip_metadata", v)}
        />
        {p.strip_metadata && <Hint>{t("options.stripHint")}</Hint>}
      </Group>

      {/* 이미지 입력 — v2 의 `Vibe / Character Ref` 절이 있던 자리 (오른쪽 기둥 아래) */}
      <div style={{ height: 1, background: "var(--line)", margin: "var(--sp-2) 0" }} />
      <ImageInputPanel />
    </div>
  );
}

function Group({
  label,
  flashKey,
  children,
}: {
  label: string;
  /** 방금 이 자리가 바뀌었으면 강조한다 (`useUi.reveal`) */
  flashKey?: string;
  children: React.ReactNode;
}) {
  const on = useFlash(flashKey ?? "");
  return (
    <div
      data-flash={flashKey && on ? "" : undefined}
      style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)", ...flashStyle(!!flashKey && on) }}
    >
      <span style={{ fontSize: "var(--text-xs)", fontWeight: "var(--w-semi)", color: "var(--ink-soft)" }}>
        {label}
      </span>
      {children}
    </div>
  );
}

const Hint = ({ children }: { children: React.ReactNode }) => (
  <span style={{ fontSize: "var(--text-2xs)", color: "var(--ink-faint)" }}>{children}</span>
);

/** ★페로픽스파이의 `input, select, textarea, button` 규칙과 같은 모양
 *  (panel 바탕 + border 1px + radius 6). 포커스는 globals.css 가 테두리 색으로 처리한다. */
const input: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: "var(--r-2)",
  padding: "var(--sp-2) var(--sp-3)",
  fontSize: "var(--text-sm)",
};

/** 생성 옵션의 수치 — ★**슬라이더가 아니라 입력칸**이다 (사용자 지시 2026-08-04).
 *
 *  Steps·CFG 는 "28", "5.5" 처럼 **아는 값을 그대로 넣는** 항목이라, 끌어서 맞추면
 *  오히려 느리고 정확하지 않다. 슬라이더는 값을 모른 채 훑는 것에 쓴다 (썸네일 크기 같은).
 *
 *  ★타이핑 중에는 고치지 않는다 — 글자를 그대로 두고 **떠날 때(blur)·Enter 에** 반영한다.
 *    매 글자마다 clamp 하면 "5" 를 지우고 "12" 를 치는 도중에 값이 튄다. */
function Num({
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const v = parseFloat(text);
    if (Number.isNaN(v)) return setText(String(value));
    const clamped = Math.min(max, Math.max(min, v));
    onChange(clamped);
    setText(String(clamped));
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        style={{ ...input, width: 88, fontFamily: "var(--font-mono)", textAlign: "right" }}
      />
      <span style={{ fontSize: "var(--text-2xs)", color: "var(--ink-faint)" }}>
        {unit ?? `${min} ~ ${max}`}
      </span>
    </div>
  );
}

function Select({
  value,
  options,
  onChange,
}: {
  value: string;
  /** 문자열이면 값=라벨, 쌍이면 [값, 라벨] */
  options: (string | [string, string])[];
  onChange: (v: string) => void;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={input}>
      {options.map((o) => {
        const [val, label] = typeof o === "string" ? [o, o] : o;
        return (
          <option key={val} value={val}>
            {label}
          </option>
        );
      })}
    </select>
  );
}

/** 숫자 직접 입력 — **떠날 때 확정한다.** 타이핑 중 정렬하면 "8" 을 치는 순간 64 로
 *  튀어 이어서 못 친다 (v2 도 input 이 아니라 change 에서 맞춘다). */
function NumBox({
  value,
  onCommit,
  ...rest
}: { value: number; onCommit: (v: number) => void } & Record<string, unknown>) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <input
      {...rest}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onCommit(parseInt(text) || value)}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      style={{ ...input, width: 74, fontFamily: "var(--font-mono)", textAlign: "center" }}
    />
  );
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-2)",
        fontSize: "var(--text-xs)",
        color: "var(--ink-soft)",
        cursor: "pointer",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ accentColor: "var(--accent)" }}
      />
      {label}
    </label>
  );
}
