import { useI18n } from "../i18n";
import { Category } from "./Category";
import { useEffect, useState } from "react";
import { MODELS, NAI_MAX, SIZE_PRESETS, alignTo64, useGen } from "../store/gen";
import { Icon } from "../components/Icon";
import { Help } from "../components/Tip";
import { ImageInputPanel } from "./ImageInputPanel";
import { flashStyle, useFlash } from "../store/ui";

const SAMPLERS = ["k_euler_ancestral", "k_euler", "k_dpmpp_2m", "k_dpmpp_2m_sde", "k_dpmpp_2s_ancestral", "k_dpmpp_sde"];
const SCHEDULERS = ["karras", "native", "exponential", "polyexponential"];
// ★v2 와 같은 5종. `Furry Focus` 는 ucPreset 숫자표에 없어 0(Heavy)으로 떨어지지만
//   프리셋 **태그 문자열**은 자기 것을 쓴다 — v2 와 같은 동작이다 (nai.py 참조).
const UC_PRESETS = ["Heavy", "Light", "Human Focus", "Furry Focus", "None"];

/** 우측 패널 — 생성 파라미터. */
/** 생성 옵션 — ★**왼쪽 프롬프트 아래**에 산다 (사용자 지시 2026-08-16).
 *  오른쪽 기둥은 카드덱이 쓴다. 여기 있는 것들은 프롬프트와 함께 보면서 만지는 값이다.
 *  ★묶음마다 접힌다 — 한 기둥에 프롬프트까지 들어오므로 다 펴 두면 훑을 수가 없다.
 *    접기 단추는 따로 두지 않는다. **묶음 이름을 누르면** 접힌다. */
export function OptionsPanel() {
  const p = useGen((s) => s.params);
  const set = useGen((s) => s.set);
  const t = useI18n((s) => s.t);

  return (
    /* ★★좌우 여백을 주지 않는다 (사용자 지적 2026-08-19) — 이 패널은 프롬프트와 **같은
       스크롤 칸 안**에 산다 (`PromptPanel`). 여기서 또 주면 「NAI 설정」부터 한 칸씩
       들여쓰기가 되어, 위의 「베이스 프롬프트」와 시작점이 어긋난다. */
    <div style={{ paddingBottom: "var(--sp-4)", display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
      {/* ★★묶음은 **페로픽스 v2 의 절 그대로**다 (`index.html` 통째로 대조 2026-08-16):
            NAI Settings · Generation · Vibe / Character Ref · Base Image · Save Options.
          ★접는 층은 **카테고리 하나뿐**이다 — 항목마다 접으면 훑을 수가 없다. */}
      <Category id="opt-nai" label={t("options.catNai")} flashKey="params">
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
              <Group label={t("options.model")}>
                {/* ★옛 워크스페이스가 없어진 모델(V4.0)을 들고 있으면 목록에 없어 빈칸으로 보인다 —
                    기본값으로 되돌린다. 조용히 다른 표로 생성되는 것보다 낫다 */}
                <Select
                  value={MODELS.some(([id]) => id === p.model) ? p.model : MODELS[0][0]}
                  options={MODELS}
                  onChange={(v) => set("model", v)}
                />
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
        </div>
      </Category>

      {/* ★★해상도는 **따로 선 카테고리**다 (사용자 지시 2026-08-19). 생성 옵션 안에 있으면
          설정을 얹을 때 강조 테두리가 **겹쳐 그려진다** (묶음 하나와 카테고리 하나가 서로
          안쪽·바깥쪽으로). 강조 자리가 겹치지 않으려면 층이 하나여야 한다. */}
      <Category id="opt-size" label={t("options.resolution")} flashKey="size">
        {/* ★★모양이 곧 목록이다 (페로픽스파이 `.res-item` 이식). 전부 늘어놓으면 열넷이라
            훑을 수가 없어서 **가로·세로·정방 탭**으로 가르고, 줄마다 그 비율의 사각형을
            함께 그린다 — 숫자보다 모양이 먼저 읽힌다. */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
          <SizePicker w={p.width} h={p.height} onPick={(w, h) => { set("width", w); set("height", h); }} />
          {/* ★직접 입력 — NAI 는 64 배수만 받는다. 입력을 떠날 때 올려 맞추고 그 값을 보여 준다
              (서버도 같은 정렬을 하지만, 무엇이 갈지 지금 보여야 한다) */}
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
            <NumBox data-size="w" value={p.width} onCommit={(v) => set("width", alignTo64(v))} />
            <span style={{ color: "var(--ink-faint)", fontSize: "var(--text-2xs)" }}>×</span>
            <NumBox data-size="h" value={p.height} onCommit={(v) => set("height", alignTo64(v))} />
          </div>
        </div>
      </Category>

      <Category id="opt-gen" label={t("options.catGeneration")} flashKey="params">
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
              <Group label={t("options.steps")} help={t("options.stepsHint")}>
                <Num value={p.steps} min={1} max={NAI_MAX.steps} onChange={(v) => set("steps", v)} />
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
        </div>
      </Category>

      <Category id="opt-save" label={t("options.catSave")} defaultFolded>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
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
                  help={t("options.stripHint")}
                  checked={p.strip_metadata}
                  onChange={(v) => set("strip_metadata", v)}
                />
        {/* ★v2 `autoSaveToggle` — 끄면 파일도 기록도 안 남기고 미리보기만 (대조 2026-08-16) */}
        <Check
          label={t("options.autoSave")}
          help={t("options.autoSaveHint")}
          checked={p.auto_save}
          onChange={(v) => set("auto_save", v)}
        />
        {/* ★v2 `excludeSlotNumber` — 옮기다 빠져 있었다 (대조 2026-08-16).
            번호는 탐색기에서 씬 순서를 만드는 것이라, 순서가 필요 없을 때만 끈다. */}
        <Check
          label={t("options.excludeSlotNo")}
          checked={p.exclude_slot_number}
          onChange={(v) => set("exclude_slot_number", v)}
        />
              </Group>
        </div>
      </Category>

      {/* v2 의 `Vibe / Character Ref` + `Base Image` 절 */}
      <Category id="opt-img" label={t("options.catImage")} defaultFolded flashKey="base">
        <ImageInputPanel />
      </Category>
    </div>
  );
}

/** 해상도 고르기 — **가로·세로·정방 탭** + 그 비율을 그린 목록 (사용자 지시 2026-08-19).
 *
 *  ★페로픽스파이의 `.res-item` 을 옮긴 것이다: [비율 사각형][W × H][묶음 이름].
 *  ★탭은 **지금 값이 있는 쪽**이 열린 채로 시작한다 — 고른 것이 안 보이는 채로 열리면
 *    무엇이 골라져 있는지 알 수 없다. 다른 탭에 있으면 그 탭에 점을 찍어 알린다.
 *  ★묶음(Small·Large·Wallpaper)은 지우지 않고 **줄 오른쪽에 이름으로** 남긴다 — 가르는
 *    축은 방향 하나뿐이어야 훑을 수 있다. */
function SizePicker({ w, h, onPick }: { w: number; h: number; onPick: (w: number, h: number) => void }) {
  const t = useI18n((s) => s.t);
  const dirOf = (a: number, b: number) => (a > b ? "landscape" : a === b ? "square" : "portrait");
  const cur = dirOf(w, h);
  const [tab, setTab] = useState(cur);
  const shown = SIZE_PRESETS.flatMap((g) => g.items.map((it) => ({ group: g.group, item: it })))
    .filter((x) => dirOf(x.item[0], x.item[1]) === tab);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
      <div style={{ display: "flex", gap: "var(--sp-2)" }}>
        {(["landscape", "portrait", "square"] as const).map((d) => {
          const on = tab === d;
          return (
            <button
              key={d}
              data-size-tab={d}
              onClick={() => setTab(d)}
              style={{
                flex: 1,
                padding: "3px var(--sp-2)",
                borderRadius: "var(--r-2)",
                border: `1px solid ${on ? "var(--accent)" : "var(--line)"}`,
                background: on ? "var(--accent-bg)" : "var(--panel)",
                color: on ? "var(--ink)" : "var(--ink-dim)",
                fontSize: "var(--text-2xs)",
                fontWeight: on ? "var(--w-semi)" : 400,
              }}
            >
              {t(`options.${d}`)}
              {cur === d && !on && <span style={{ marginLeft: 4, color: "var(--accent)" }}>·</span>}
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {shown.map(({ group, item: [pw, ph, star] }) => {
          const on = w === pw && h === ph;
          // 긴 변을 26px 로 맞춘 사각형 — 비율이 한눈에 들어온다
          const k = 26 / Math.max(pw, ph);
          return (
            <button
              key={`${pw}x${ph}`}
              data-size-preset={`${pw}x${ph}`}
              onClick={() => onPick(pw, ph)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--sp-3)",
                padding: "3px var(--sp-2)",
                borderRadius: "var(--r-2)",
                border: `1px solid ${on ? "var(--accent)" : "var(--line)"}`,
                background: on ? "var(--accent-bg)" : "var(--bg)",
                color: "var(--ink)",
                fontSize: "var(--text-2xs)",
                textAlign: "left",
              }}
            >
              <span style={{ width: 28, height: 28, display: "grid", placeItems: "center", flexShrink: 0 }}>
                <span
                  style={{
                    width: Math.round(pw * k),
                    height: Math.round(ph * k),
                    borderRadius: 2,
                    background: on ? "var(--accent)" : "var(--ink-ghost)",
                  }}
                />
              </span>
              <span style={{ flex: 1, fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>
                {pw}×{ph}
              </span>
              {star && (
                <span data-tip={t("options.starHint")} style={{ display: "inline-grid", color: "var(--ink-faint)" }}>
                  {Icon.spark12}
                </span>
              )}
              <span style={{ width: 62, textAlign: "right", color: "var(--ink-faint)" }}>
                {t(`options.sizeGroup.${group}`)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Group({
  label,
  flashKey,
  help,
  children,
}: {
  label: string;
  /** 방금 이 자리가 바뀌었으면 강조한다 (`useUi.reveal`) */
  flashKey?: string;
  /** ★설명은 **라벨 옆 `?`** 로만 나온다 (사용자 지시 2026-08-19) — 화면에 펼쳐 두지 않는다 */
  help?: string;
  children: React.ReactNode;
}) {
  const on = useFlash(flashKey ?? "");
  // ★★항목은 **안 접힌다.** 접는 층은 카테고리 하나뿐이다 (`Category` 머리 주석) —
  //   항목마다 접히면 훑을 수가 없고, 위(카드)와 아래(항목)가 따로 노는 화면이 된다
  //   (사용자 지적 2026-08-16).
  return (
    <div
      data-flash={flashKey && on ? "" : undefined}
      data-opt-group={label}
      style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)", ...flashStyle(!!flashKey && on) }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", fontSize: "var(--text-xs)", fontWeight: "var(--w-semi)", color: "var(--ink-soft)" }}>
        {label}
        {help && <Help tip={help} />}
      </span>
      {children}
    </div>
  );
}

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
  help,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  help?: string;
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
      {help && <Help tip={help} />}
    </label>
  );
}
