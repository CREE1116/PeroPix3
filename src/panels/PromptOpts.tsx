import { useI18n } from "../i18n";
import { Icon } from "../components/Icon";
import { modelCaps, useGen } from "../store/gen";

/** 프롬프트 칸 **하단에 붙는 띠** — 프롬프트의 일부가 되는 설정들.
 *
 *  ★★**공홈과 같은 자리다** (사용자 지시 2026-08-23: *"프리셋도 nai 공홈처럼 시각적으로도
 *    프롬프트의 일부인것 처럼 만들어야할거같은데. 공홈에 보면 투명여부, 프리셋설정이
 *    프롬프트 입력란 안에 하단에 있음"*). 공홈은 퀄리티·UC 프리셋과 투명 배경,
 *    그리고 anime/furry 스위치를 프롬프트 영역(`image-gen-prompt-main`) 안에 둔다
 *    (`docs/nai-web-reference.md` 의 「anime / furry 모드 스위치」 절).
 *
 *  ★★**여기 있는 것은 전부 프롬프트 문자열이 된다** (`backend/nai.py`) —
 *    퀄리티 접미사 · UC 프리셋 본문 · `transparent background` · `fur dataset, ` 접두.
 *    그래서 옵션 패널이 아니라 **글을 적는 칸 옆**이 제자리다. 담기는 자리도 같다:
 *    스타일 카드가 이 넷을 함께 든다 (`lib/styleOpts`).
 *  ★★**생성 옵션 패널에서는 뺐다** — 같은 값을 두 곳에서 만지면 어느 쪽이 진짜인지 흐려진다.
 *
 *  ★탭을 따라 갈린다: `Prompt` 를 보고 있으면 프롬프트에 붙는 것들, `UC` 를 보고 있으면
 *    네거티브에 붙는 것. 안 보이는 쪽 값을 함께 늘어놓으면 어디에 붙는 건지 흐려진다.
 */

/** 퀄리티 프리셋 이름 — ★키를 조립하지 않는다 (i18n 검사가 리터럴만 센다).
 *  ★목록 자체는 **모델이 정한다** (`lib/naiModels.ts` 의 `quality_presets`). */
const QP_LABEL: Record<string, string> = {
  standard: "options.qpStandard",
  light: "options.qpLight",
  none: "options.qpNone",
};

// ★v2 와 같은 5종. `Furry Focus` 는 ucPreset 숫자표에 없어 0(Heavy)으로 떨어지지만
//   프리셋 **태그 문자열**은 자기 것을 쓴다 — v2 와 같은 동작이다 (nai.py 참조).
const UC_PRESETS = ["Heavy", "Light", "Human Focus", "Furry Focus", "None"];

export function PromptOptsBar({ uc }: { uc: boolean }) {
  const t = useI18n((s) => s.t);
  const p = useGen((s) => s.params);
  const set = useGen((s) => s.set);
  const cap = modelCaps(p.model);

  return (
    <div
      data-prompt-opts={uc ? "uc" : "p"}
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "var(--sp-2)",
        /* ★★**칸 안의 아래쪽**이다 — 가르는 실선을 긋지 않는다 (공홈도 안 긋는다).
           선을 그으면 「글 칸 밖에 딸린 줄」로 보여서, 프롬프트의 일부라는 뜻이 흐려진다. */
        marginTop: "var(--sp-3)",
      }}
    >
      {uc ? (
        <Pick label={t("options.ucPreset")} value={p.uc_preset} options={UC_PRESETS.map((v) => [v, v])} onChange={(v) => set("uc_preset", v)} />
      ) : (
        <>
          {/* ★투명 배경은 V5 부터다 — 못 하는 모델에서는 아예 안 낸다 */}
          {cap.transparency && (
            <Toggle
              label={t("options.transparentBg")}
              help={t("options.transparentBgHint")}
              on={p.transparent_bg}
              onChange={(v) => set("transparent_bg", v)}
            />
          )}
          {/* ★★퍼리 모드는 프롬프트 **맨 앞**에 `fur dataset, ` 를 붙인다 — 공홈도 같은 접두를
              쓰고, 스위치를 프롬프트 영역에 둔다 (`hasFurryMode`, V4.5·V5 계열 전부 참이라
              우리 모델 목록에서는 언제나 뜬다). */}
          <Toggle label={t("options.furryMode")} on={p.furry_mode} onChange={(v) => set("furry_mode", v)} />
          {/* ★고르기는 **오른쪽 끝**에 선다 (공홈과 같다) — 켬/끔 칩과 성질이 달라 섞어 두면
              어느 것이 눌러 바뀌는 것인지 한눈에 안 들어온다 */}
          <span style={{ flex: 1 }} />
          {/* ★고를 수 있는 값은 **모델이 정한다**. 없는 것을 고른 채 모델을 바꾸면
              서버가 `standard` 로 내린다 (`nai.quality_preset_id`). */}
          <Pick
            label={t("options.qualityPreset")}
            value={cap.quality_presets.includes(p.quality_preset) ? p.quality_preset : "standard"}
            options={cap.quality_presets.map((id) => [id, t(QP_LABEL[id])] as [string, string])}
            onChange={(v) => set("quality_preset", v)}
          />
        </>
      )}
    </div>
  );
}

/** 칩 공통 — 글 칸 안에 앉는 작은 알약. ★**내용만큼만** 차지한다 */
const chip: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--sp-2)",
  height: 24,
  padding: "0 var(--sp-3)",
  borderRadius: "var(--r-2)",
  fontSize: "var(--text-2xs)",
  border: "1px solid var(--line)",
  background: "var(--panel)",
};

/** 고르기 칩 — ★**이름표가 칩 안에 있다** (`퀄리티 프리셋: 표준`). 옆에 따로 붙이면
 *  글 칸 아래가 「이름표 + 컨트롤」 두 겹이 되어 설정 패널처럼 보인다.
 *  ★네이티브 `select` 를 그대로 쓴다 — 목록을 직접 그리면 키보드 조작이 사라진다. */
function Pick({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  const shown = options.find(([v]) => v === value)?.[1] ?? value;
  return (
    <label data-prompt-pick style={{ ...chip, position: "relative", color: "var(--ink-soft)", cursor: "pointer" }}>
      <span>
        {label}: <b style={{ fontWeight: "var(--w-semi)", color: "var(--ink)" }}>{shown}</b>
      </span>
      {Icon.chevronDown12}
      {/* ★진짜 `select` 는 칩 위에 투명하게 덮어 둔다 — 보이는 것은 우리 글자이고,
          누르면 브라우저의 목록이 그대로 뜬다 (모양과 조작을 둘 다 지킨다) */}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }}
      >
        {options.map(([v, name]) => (
          <option key={v} value={v}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** 켬/끔 칩 — ★상태를 **아이콘으로** 말한다 (공홈도 그렇다: 꺼지면 `✕`).
 *  네모 체크박스를 두면 글 칸 안에서 설정 목록처럼 보인다. */
function Toggle({
  label,
  on,
  onChange,
  help,
}: {
  label: string;
  on: boolean;
  onChange: (v: boolean) => void;
  help?: string;
}) {
  return (
    <button
      data-prompt-toggle={label}
      data-on={on ? "" : undefined}
      onClick={() => onChange(!on)}
      data-tip={help}
      style={{
        ...chip,
        gap: "var(--sp-1)",
        borderColor: on ? "var(--accent)" : "var(--line)",
        background: on ? "var(--accent-bg)" : "var(--panel)",
        color: on ? "var(--accent)" : "var(--ink-faint)",
      }}
    >
      <span style={{ display: "grid", placeItems: "center", width: 12, height: 12 }}>
        {on ? Icon.check : Icon.close12}
      </span>
      {label}
    </button>
  );
}
