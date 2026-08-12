import { useRef, useState } from "react";
import { useI18n } from "../i18n";
import { Icon } from "../components/Icon";
import {
  MAX_VIBES,
  fileToBase64,
  processReference,
  useImageInput,
  type BaseMode,
} from "../store/imageInput";
import { MaskEditor } from "../components/MaskEditor";
import { fitSizeToBase } from "../store/gen";
import { VibeCache } from "./VibeCache";

/** 이미지 입력 — Vibe Transfer · Precise Reference · 베이스 이미지.
 *
 *  ★v2 의 `Vibe / Character Ref` 절과 베이스 이미지 절을 옮긴 것이다
 *    (index.html:8998-9063 · 18362-18700). 값·범위·배타 규칙은 **원문 그대로**다. */
export function ImageInputPanel() {
  const t = useI18n((s) => s.t);
  const s = useImageInput();
  const [mask, setMask] = useState(false);
  const [cache, setCache] = useState(false);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}>
      <Section
        label={t("imgIn.vibe")}
        on={s.vibeOn}
        onToggle={s.setVibeOn}
        data-sec="vibe"
      >
        <Hint>{t("imgIn.vibeHint")}</Hint>
        {s.vibes.map((v, i) => (
          <Card
            key={i}
            src={`data:image/png;base64,${v.image}`}
            name={v.name}
            badge={v.encoded ? t("imgIn.cached") : ""}
            onRemove={() => s.removeVibe(i)}
            data-vibe={i}
          >
            <Slide
              label={t("imgIn.strength")}
              value={v.strength}
              min={0}
              max={1}
              step={0.05}
              onChange={(x) => s.patchVibe(i, { strength: x })}
            />
            {/* ★정보 추출은 인코딩 캐시의 **키**다 — 바꾸면 다시 굽는다(유료). 그래서 눈에 보이게 둔다 */}
            <Slide
              label={t("imgIn.info")}
              value={v.info_extracted}
              min={0.01}
              max={1}
              step={0.01}
              onChange={(x) => s.patchVibe(i, { info_extracted: x })}
            />
          </Card>
        ))}
        <div style={{ display: "flex", gap: "var(--sp-2)" }}>
          <Pick
            label={t("imgIn.vibeAdd")}
            disabled={s.vibes.length >= MAX_VIBES}
            data-add="vibe"
            onFile={async (f) => s.addVibe(await fileToBase64(f), f.name)}
          />
          {/* ★구워 둔 것에서 꺼내 쓰면 **돈이 안 나간다** (인코딩은 바이브당 2 Anlas) */}
          <button
            data-vibe-cache-open
            onClick={() => setCache(true)}
            title={t("imgIn.cacheTitle")}
            style={{ ...box, flexShrink: 0, color: "var(--ink-soft)" }}
          >
            {Icon.duplicate}
          </button>
        </div>
      </Section>

      <Section label={t("imgIn.ref")} on={s.refOn} onToggle={s.setRefOn} data-sec="ref">
        <Hint>{t("imgIn.refHint")}</Hint>
        {s.refs.map((r, i) => (
          <Card
            key={i}
            src={`data:image/png;base64,${r.preview}`}
            name={r.name}
            onRemove={() => s.removeRef(i)}
            data-ref={i}
          >
            <select
              value={r.mode}
              data-ref-mode={i}
              onChange={(e) => s.patchRef(i, { mode: e.target.value as typeof r.mode })}
              style={box}
            >
              <option value="character&style">{t("imgIn.modeCharStyle")}</option>
              <option value="character">{t("imgIn.modeChar")}</option>
              <option value="style">{t("imgIn.modeStyle")}</option>
            </select>
            <Slide
              label={t("imgIn.strength")}
              value={r.strength}
              min={0}
              max={1}
              step={0.05}
              onChange={(x) => s.patchRef(i, { strength: x })}
            />
            <Slide
              label={t("imgIn.fidelity")}
              value={r.fidelity}
              min={0}
              max={1}
              step={0.05}
              onChange={(x) => s.patchRef(i, { fidelity: x })}
            />
          </Card>
        ))}
        <Pick
          label={t("imgIn.refAdd")}
          data-add="ref"
          onFile={async (f) => {
            const raw = await fileToBase64(f);
            // ★보내는 그림은 다듬은 것, 보여 주는 그림은 원본이다
            s.addRef({
              image: await processReference(raw),
              preview: raw,
              name: f.name,
              mode: "character&style",
              strength: 1,
              fidelity: 1,
            });
          }}
        />
      </Section>

      <Section label={t("imgIn.base")} data-sec="base">
        {s.baseImage ? (
          <Card
            src={`data:image/png;base64,${s.baseImage}`}
            name={s.baseName}
            badge={s.baseMode === "inpaint" && s.baseMask ? t("imgIn.maskDone") : ""}
            onRemove={s.clearBase}
            data-base
          >
            <div style={{ display: "flex", gap: "var(--sp-2)" }}>
              {(["img2img", "inpaint"] as BaseMode[]).map((m) => (
                <button
                  key={m}
                  data-base-mode={m}
                  onClick={() => s.patchBase({ baseMode: m })}
                  style={{
                    ...box,
                    flex: 1,
                    background: s.baseMode === m ? "var(--accent)" : "var(--panel)",
                    color: s.baseMode === m ? "var(--accent-on)" : "var(--ink-soft)",
                  }}
                >
                  {t(m === "img2img" ? "imgIn.i2i" : "imgIn.inpaint")}
                </button>
              ))}
            </div>
            <Slide
              label={t("imgIn.strength")}
              value={s.baseStrength}
              min={0.01}
              max={0.99}
              step={0.01}
              onChange={(x) => s.patchBase({ baseStrength: x })}
            />
            {/* ★노이즈는 이어 그리기에만 붙는다 — 인페인트에는 NAI 가 안 받는다 (nai.py) */}
            {s.baseMode === "img2img" && (
              <Slide
                label={t("imgIn.noise")}
                value={s.baseNoise}
                min={0}
                max={1}
                step={0.01}
                onChange={(x) => s.patchBase({ baseNoise: x })}
              />
            )}
            {s.baseMode === "inpaint" && (
              <button data-mask-open onClick={() => setMask(true)} style={{ ...box, width: "100%" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-2)" }}>
                  {Icon.brush}
                  {t("imgIn.mask")}
                </span>
              </button>
            )}
          </Card>
        ) : (
          <>
            <Hint>{t("imgIn.baseHint")}</Hint>
            <Pick
              label={t("imgIn.basePick")}
              data-add="base"
              onFile={async (f) => {
                const b64 = await fileToBase64(f);
                s.setBase(b64, f.name);
                await fitSizeToBase(b64);
              }}
            />
          </>
        )}
      </Section>

      {cache && <VibeCache onClose={() => setCache(false)} />}

      {mask && (
        <MaskEditor
          image={s.baseImage}
          mask={s.baseMask}
          strength={s.baseStrength}
          onCancel={() => setMask(false)}
          onApply={(m, strength) => {
            s.patchBase({ baseMask: m, baseStrength: strength });
            setMask(false);
          }}
        />
      )}
    </div>
  );
}

const box: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: "var(--r-2)",
  padding: "var(--sp-2) var(--sp-3)",
  fontSize: "var(--text-xs)",
};

const Hint = ({ children }: { children: React.ReactNode }) => (
  <span style={{ fontSize: "var(--text-2xs)", color: "var(--ink-faint)" }}>{children}</span>
);

/** 켬/끔이 있는 절. `on` 을 안 주면 늘 열려 있는 절이다 (베이스 이미지) */
function Section({
  label,
  on,
  onToggle,
  children,
  ...rest
}: {
  label: string;
  on?: boolean;
  onToggle?: (v: boolean) => void;
  children: React.ReactNode;
} & Record<string, unknown>) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }} {...rest}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
        <span style={{ fontSize: "var(--text-xs)", fontWeight: "var(--w-semi)", color: "var(--ink-soft)" }}>
          {label}
        </span>
        {onToggle && (
          <label style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: "var(--sp-2)" }}>
            <input
              type="checkbox"
              checked={!!on}
              data-sec-on={label}
              onChange={(e) => onToggle(e.target.checked)}
            />
          </label>
        )}
      </div>
      {(on === undefined || on) && children}
    </div>
  );
}

/** 그림 한 장 + 그 그림의 값들 */
function Card({
  src,
  name,
  badge,
  onRemove,
  children,
  ...rest
}: {
  src: string;
  name: string;
  badge?: string;
  onRemove: () => void;
  children: React.ReactNode;
} & Record<string, unknown>) {
  return (
    <div
      style={{
        border: "1px solid var(--line)",
        borderRadius: "var(--r-2)",
        padding: "var(--sp-2)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--sp-2)",
        background: "var(--surface)",
      }}
      {...rest}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
        <img
          src={src}
          alt=""
          style={{ width: 38, height: 38, objectFit: "cover", borderRadius: "var(--r-1)", flexShrink: 0 }}
        />
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: "var(--text-2xs)",
            color: "var(--ink-soft)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {name}
        </span>
        {badge && (
          <span style={{ fontSize: "var(--text-3xs, 10px)", color: "var(--ok, var(--accent))" }}>{badge}</span>
        )}
        <button onClick={onRemove} title="×" style={{ color: "var(--ink-faint)", display: "grid" }}>
          {Icon.close}
        </button>
      </div>
      {children}
    </div>
  );
}

function Slide({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", fontSize: "var(--text-2xs)" }}>
      <span style={{ width: 54, color: "var(--ink-faint)" }}>{label}</span>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ flex: 1 }}
      />
      <span style={{ width: 30, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </label>
  );
}

/** 그림 고르기 — 누르면 파일 선택, **끌어다 놓아도** 받는다 */
function Pick({
  label,
  disabled,
  onFile,
  ...rest
}: {
  label: string;
  disabled?: boolean;
  onFile: (f: File) => void | Promise<void>;
} & Record<string, unknown>) {
  const t = useI18n((s) => s.t);
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <>
      <button
        disabled={disabled}
        onClick={() => ref.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files[0];
          if (f && f.type.startsWith("image/")) onFile(f);
        }}
        style={{
          ...box,
          width: "100%",
          borderStyle: over ? "solid" : "dashed",
          borderColor: over ? "var(--accent)" : "var(--line)",
          color: "var(--ink-soft)",
          opacity: disabled ? 0.5 : 1,
        }}
        {...rest}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-2)" }}>
          {Icon.plus}
          {over ? t("imgIn.drop") : label}
        </span>
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </>
  );
}
