import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { Icon } from "../components/Icon";
import {
  MAX_VIBES,
  fileToBase64,
  processReference,
  pushVibe,
  useImageInput,
  type BaseMode,
} from "../store/imageInput";
import { canFocus } from "../lib/focused";
import { fitSizeToBase, useGen } from "../store/gen";
import { flashStyle, useFlash } from "../store/ui";
import { toast } from "../store/toast";
import { NAI_VIBE_EXT, isNaiVibeFile, parseNaiVibeFile } from "../lib/naiVibeFile";
import { useTauriDrop } from "../lib/dropImages";
import { api } from "../lib/backend";
import { VibeCache } from "./VibeCache";

/** 앱 창에 떨군 파일 하나를 서버가 읽어 준다 (`POST /api/tools/read`) */
const readDropped = (path: string) =>
  api<{ name: string; text?: string; data?: string }>("/api/tools/read", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: path.split(/[\\/]/).pop() || path, path }),
  });

/** 이미지 입력 — Vibe Transfer · Precise Reference · 베이스 이미지.
 *
 *  ★v2 의 `Vibe / Character Ref` 절과 베이스 이미지 절을 옮긴 것이다
 *    (index.html:8998-9063 · 18362-18700). 값·범위·배타 규칙은 **원문 그대로**다. */
export function ImageInputPanel() {
  const t = useI18n((s) => s.t);
  const s = useImageInput();
  const model = useGen((g) => g.params.model);
  const [cache, setCache] = useState(false);

  /** ★서버에 구워 둔 인코딩이 있으면 「구워 둠」이 뜨고 비용에서도 빠진다.
   *
   *  ★여기 두는 것이 맞다 — 이 절과 모델 고르기가 **같은 패널**에 있어서, 패널이 접혀 있는
   *    동안에는 물어볼 것이 바뀔 수도 없다 (패널은 접히면 언마운트된다).
   *  ★딸림값은 **바뀌면 다시 물어야 하는 것**만 적는다. `s.vibes` 자체를 넣으면 답을 받아
   *    `encoded` 를 채우는 순간 배열이 새로 만들어져 무한히 돌게 된다. */
  const vibeKey = s.vibes.map((v) => `${v.image.length}:${v.info_extracted}`).join("|");
  useEffect(() => {
    void useImageInput.getState().syncVibeCache();
  }, [vibeKey, model]);

  /** 밖에서 가져온 바이브 파일 한 장 */
  const importVibeText = (text: string, name: string) => {
    try {
      const v = parseNaiVibeFile(text, name);
      if (!pushVibe(v)) return toast(t("imgIn.vibeFull", { n: MAX_VIBES }), "warn");
      toast(v.encoded ? t("imgIn.vibeFileCached") : t("imgIn.vibeFileAdded"));
    } catch {
      toast(t("imgIn.vibeFileBad"), "warn");
    }
  };
  const importVibeFile = async (f: File) => importVibeText(await f.text(), f.name);
  /** ★앱 창에 떨군 것은 **경로**로 온다 — 서버가 읽어 준다 (`lib/dropImages.ts` 머리 주석).
   *  그림이면 그대로 바이브로, `.naiv4vibe` 면 안의 인코딩까지 들여온다. */
  const addDroppedPath = async (path: string) => {
    try {
      const r = await readDropped(path);
      if (r.text !== undefined) return importVibeText(r.text, r.name);
      if (r.data) s.addVibe(r.data, r.name);
    } catch {
      toast(t("imgIn.vibeFileBad"), "warn");
    }
  };
  /** 참조·베이스도 같은 길로 받는다. 그림만 오므로 `data` 하나면 된다 */
  const addRefPath = async (path: string) => {
    const r = await readDropped(path).catch(() => null);
    if (!r?.data) return toast(t("imgIn.dropBad"), "warn");
    s.addRef({
      image: await processReference(r.data),
      preview: r.data,
      name: r.name,
      mode: "character&style",
      strength: 1,
      fidelity: 1,
    });
  };
  const addBasePath = async (path: string) => {
    const r = await readDropped(path).catch(() => null);
    if (!r?.data) return toast(t("imgIn.dropBad"), "warn");
    s.setBase(r.data, r.name);
    await fitSizeToBase(r.data);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}>
      <Section
        label={t("imgIn.vibe")}
        on={s.vibeOn}
        onToggle={s.setVibeOn}
        data-sec="vibe"
      >
        <Hint>{t("imgIn.vibeHint")}</Hint>
        {/* ★공홈에도 같은 토글이 있다 (기본 켜짐). 켜져 있고 강도 합이 1을 넘으면 나눠서 보낸다 */}
        <Check
          label={t("imgIn.normalize")}
          title={t("imgIn.normalizeHint")}
          checked={s.normalizeVibe}
          onChange={s.setNormalizeVibe}
          data-vibe-normalize={s.normalizeVibe ? "on" : "off"}
        />
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
          {/* ★NAI 가 내보낸 `.naiv4vibe` 도 받는다 — 안에 구워 둔 인코딩이 들어 있어
              그대로 쓰면 Anlas 가 안 나간다 (v2 index.html:22758-22830) */}
          <Pick
            label={t("imgIn.vibeAdd")}
            disabled={s.vibes.length >= MAX_VIBES}
            accept={`image/*,${NAI_VIBE_EXT}`}
            takes={(f) => f.type.startsWith("image/") || isNaiVibeFile(f.name)}
            dropExt={/\.(png|jpe?g|webp|naiv4vibe)$/i}
            data-add="vibe"
            onFile={async (f) => {
              if (isNaiVibeFile(f.name)) return importVibeFile(f);
              s.addVibe(await fileToBase64(f), f.name);
            }}
            onPath={addDroppedPath}
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
          onPath={addRefPath}
        />
      </Section>

      <Section label={t("imgIn.base")} data-sec="base" flashKey="base">
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
            {/* ★강도는 **모드마다 다른 값**이다 (v2 `currentBaseStrength`, index.html:23348).
                기본값도 다르고(0.7 / 1) 나가는 필드도 다르다 — 하나로 합치면 모드를 오갈 때
                값이 서로 샌다. 인페인트 쪽은 1 이 「마스크 영역 완전 재생성」이라 1 까지 간다. */}
            {s.baseMode === "inpaint" ? (
              <Slide
                label={t("imgIn.strength")}
                value={s.baseInpaintStrength}
                min={0.01}
                max={1}
                step={0.01}
                onChange={(x) => s.patchBase({ baseInpaintStrength: x })}
                data-base-strength="inpaint"
              />
            ) : (
              <Slide
                label={t("imgIn.strength")}
                value={s.baseStrength}
                min={0.01}
                max={0.99}
                step={0.01}
                onChange={(x) => s.patchBase({ baseStrength: x })}
                data-base-strength="img2img"
              />
            )}
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
              <>
                <Hint>{t("imgIn.inpaintStrengthHint")}</Hint>
                {/* ★칠하기는 **가운데 화면**에서 한다 (모달이 아니다). 그동안 왼쪽 아래
                    생성 버튼이 「인페인트」가 된다 */}
                <button
                  data-mask-open
                  onClick={() => s.startEdit()}
                  style={{
                    ...box,
                    width: "100%",
                    background: s.editing ? "var(--accent)" : "var(--panel)",
                    color: s.editing ? "var(--accent-on)" : "var(--ink-soft)",
                  }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-2)" }}>
                    {Icon.brush}
                    {t("imgIn.mask")}
                  </span>
                </button>
                <FocusedToggle />
              </>
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
              onPath={addBasePath}
            />
          </>
        )}
      </Section>

      {cache && <VibeCache onClose={() => setCache(false)} />}
    </div>
  );
}

/** Focused Inpainting 스위치. 무엇을 하는 기능인지는 `lib/focused.ts` 머리 주석에 있다.
 *
 *  ★**끌 수 있게 둔다.** 큰 그림에서는 켜진 채로 시작하지만, 사각형보다 넓게 고치고 싶으면
 *    끄고 해상도를 올리는 길이 있어야 한다 (사용자 지시 2026-08-13).
 *  ★워크스페이스 파일에만 뜬다. 서버가 그 파일을 열어 잘라야 한다. 밖에서 떨군 그림은
 *    경로가 없어 못 쓴다. */
function FocusedToggle() {
  const t = useI18n((s) => s.t);
  const s = useImageInput();
  if (!s.baseFrom || !s.baseSize) return null;
  const big = canFocus(s.baseSize.w, s.baseSize.h);
  const on = s.focused && big;
  return (
    <div
      data-focused={on ? "on" : "off"}
      onClick={() => big && s.setFocused(!s.focused)}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "var(--sp-3)",
        padding: "var(--sp-2)",
        borderRadius: "var(--r-2)",
        border: `1px solid ${on ? "var(--accent)" : "var(--line)"}`,
        background: on ? "var(--accent-bg, var(--panel))" : "var(--panel)",
        opacity: big ? 1 : 0.5,
        cursor: big ? "pointer" : "default",
      }}
    >
      <span
        style={{
          flexShrink: 0,
          width: 30,
          height: 17,
          marginTop: 1,
          borderRadius: 9,
          background: on ? "var(--accent)" : "var(--line-strong, var(--line))",
          position: "relative",
          transition: "background 120ms",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 2,
            left: on ? 15 : 2,
            width: 13,
            height: 13,
            borderRadius: "50%",
            background: "var(--surface)",
            transition: "left 120ms",
          }}
        />
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", fontSize: "var(--text-xs)" }}>
          Focused Inpainting
          <span
            data-focused-help
            title={t("focus.help")}
            onClick={(e) => e.stopPropagation()}
            style={{
              display: "inline-grid",
              placeItems: "center",
              width: 14,
              height: 14,
              borderRadius: "50%",
              border: "1px solid var(--ink-faint)",
              color: "var(--ink-faint)",
              fontSize: 9,
              cursor: "help",
            }}
          >
            ?
          </span>
        </span>
        <span
          style={{
            display: "block",
            marginTop: 2,
            fontSize: "var(--text-2xs)",
            color: "var(--ink-faint)",
            lineHeight: 1.5,
          }}
        >
          {!big ? t("focus.notNeeded") : on ? t("focus.onDesc") : t("focus.offDesc")}
        </span>
      </span>
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
  flashKey,
  children,
  ...rest
}: {
  label: string;
  on?: boolean;
  onToggle?: (v: boolean) => void;
  /** 방금 이 자리가 바뀌었으면 강조한다 (`useUi.reveal`) */
  flashKey?: string;
  children: React.ReactNode;
} & Record<string, unknown>) {
  const flash = useFlash(flashKey ?? "");
  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)", ...flashStyle(!!flashKey && flash) }}
      {...rest}
    >
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

/** 켬/끔 한 줄. ★네모는 입력요소 그대로 쓴다 (글자 아이콘을 만들지 않는다) */
function Check({
  label,
  title,
  checked,
  onChange,
  ...rest
}: {
  label: string;
  title?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
} & Record<string, unknown>) {
  return (
    <label
      title={title}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-2)",
        fontSize: "var(--text-2xs)",
        color: "var(--ink-dim)",
        cursor: "pointer",
      }}
      {...rest}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ flexShrink: 0 }}
      />
      {label}
    </label>
  );
}

function Slide({
  label,
  value,
  min,
  max,
  step,
  onChange,
  ...rest
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
} & Record<string, unknown>) {
  return (
    <label
      {...rest}
      style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", fontSize: "var(--text-2xs)" }}
    >
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
  accept = "image/*",
  takes = (f: File) => f.type.startsWith("image/"),
  dropExt = /\.(png|jpe?g|webp)$/i,
  onFile,
  onPath,
  ...rest
}: {
  label: string;
  disabled?: boolean;
  /** 파일 고르기 대화상자가 보여 줄 종류 */
  accept?: string;
  /** 떨군 것을 받을지 (대화상자는 `accept` 가 이미 거른다) */
  takes?: (f: File) => boolean;
  /** ★앱 창에 떨군 것은 **경로**로 오므로 확장자로 거른다 (`File` 이 없다) */
  dropExt?: RegExp;
  onFile: (f: File) => void | Promise<void>;
  /** 앱(Tauri) 창에 떨군 파일. 없으면 앱에서는 떨구기를 안 받는다 */
  onPath?: (path: string) => void | Promise<void>;
} & Record<string, unknown>) {
  const t = useI18n((s) => s.t);
  const ref = useRef<HTMLInputElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const [over, setOver] = useState(false);
  // ★Tauri 는 HTML5 drop 을 가로채므로 아래 `onDrop` 은 앱에서 **안 불린다.**
  //   앱에서 떨구려면 이쪽이 있어야 한다 (`lib/dropImages.ts` 머리 주석).
  useTauriDrop(btn, dropExt, (paths) => void onPath?.(paths[0]), (v) => setOver(v && !!onPath));
  return (
    <>
      <button
        ref={btn}
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
          if (f && takes(f)) onFile(f);
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
        accept={accept}
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
