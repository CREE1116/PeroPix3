import { useState } from "react";
import { useI18n, LOCALES } from "../i18n";
import { api } from "../lib/backend";
import { useTheme } from "../store/theme";
import { playDoneSound } from "../lib/notifySound";
import { useUi, FONTS, type SettingsTabId } from "../store/ui";
import { useSub } from "../store/sub";
import { useHealth } from "../store/health";
import { ask } from "../store/ask";
import { openExternal } from "../lib/openExternal";
import { toast } from "../store/toast";
import { Icon } from "../components/Icon";
import { Help } from "../components/Tip";
import { AiSettings } from "./AiSettings";

/** 설정 — **앱 안에서 손대는 것들**을 한자리에 (10단계).
 *
 *  ★NAI 토큰이 여기 없으면 앱만으로는 아무것도 못 만든다 — 지금까지는 `data/config.json` 을
 *    직접 고쳐야 했다. 백엔드 `/api/token` 은 이미 있었고, **창구가 없었다.**
 *  ★토큰은 **되읽지 않는다.** 서버는 있는지(`hasToken`)만 알려 주고 값은 안 내보낸다 —
 *    화면에 띄우면 스크린샷·화면 공유로 새어 나간다.
 *  ★글꼴·언어·테마도 여기로 모은다. 타이틀바에 흩어 두면 자주 안 쓰는 것이 늘 자리를 차지한다.
 *  ★**좌측 탭으로 가른다** (사용자 지시 2026-08-08). 한 화면에 다 쌓으면 항목이 늘수록
 *    나빠진다 — 특히 AI 조수는 공급자·모델·키가 붙어 자기 화면이 필요하다.
 */
export function Settings({
  onClose,
  tab: initialTab = "general",
}: {
  onClose: () => void;
  /** 어느 탭으로 열 것인가 — ★**연 자리에 맞춘다.** AI 채팅의 엔진 칩에서 오면 LLM 탭이다
   *  (사용자 지시 2026-08-12). 거기서 일반 탭이 열리면 한 번 더 눌러야 한다 */
  tab?: TabId;
}) {
  const t = useI18n((s) => s.t);
  const locale = useI18n((s) => s.locale);
  const setLocale = useI18n((s) => s.setLocale);
  const theme = useTheme((s) => s.theme);
  const setTheme = useTheme((s) => s.set);
  const font = useUi((s) => s.font);
  const setFont = useUi((s) => s.setFont);
  const notify = useUi((s) => s.notifyDone);
  const sound = useUi((s) => s.notifySound);
  const setSound = useUi((s) => s.setNotifySound);
  const vol = useUi((s) => s.notifyVolume);
  const setVol = useUi((s) => s.setNotifyVolume);
  const setNotify = useUi((s) => s.setNotifyDone);
  const suggest = useUi((s) => s.tagSuggest);
  const setSuggest = useUi((s) => s.setTagSuggest);
  // ★토큰 유무·앱 버전·요청 창구는 **백엔드가 정본**이다 (`store/health.ts`)
  const has = useHealth((s) => !!s.health?.hasToken);
  const version = useHealth((s) => s.health?.version ?? "");
  const support = useHealth((s) => s.health?.support ?? "");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  /** 저장이 되짚어야 할 것을 알려 왔을 때 — ★토스트로 흘리지 않는다. "왜 안 되지"의 답이라
   *  **칸 옆에 남아 있어야** 한다 (v2 `naiTokenSettingsError`) */
  const [note, setNote] = useState("");
  const [tab, setTab] = useState<TabId>(initialTab);

  /** 저장과 삭제가 **같은 창구**를 쓴다 — 빈 값이 곧 삭제다 (`backend/secretstore.py:36-41`).
   *
   *  ★검사는 서버가 한다 (공백·비ASCII·`pst-` 접두 + NAI 401 확인). 화면에서 한 번 더 재면
   *    두 곳이 어긋나고, 401 확인은 어차피 화면에서 못 한다. 지금까지는 오타 난 토큰이
   *    조용히 저장돼 생성할 때가 되어서야 실패했다 (감사 C5). */
  const putToken = async (value: string) => {
    if (busy) return;
    setBusy(true);
    setNote("");
    try {
      const r = await api<{ hasToken: boolean; warning?: string }>("/api/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: value }),
      });
      useHealth.getState().setHasToken(r.hasToken);
      setToken("");
      if (r.warning) setNote(r.warning);
      toast(t(value ? "settings.tokenSaved" : "settings.tokenRemoved"));
      // ★토큰이 생겼으니 **곧바로 잔액을 묻는다** (v2 `index.html:15736, 15828`).
      //   부팅 때 한 번만 읽던 값이라, 여기서 안 부르면 앱을 다시 켜기 전까지 Anlas 가 빈다
      if (r.hasToken) void useSub.getState().load();
      else useSub.getState().set(null);
    } catch (e) {
      setNote(String(e).replace(/^Error:\s*/, ""));
    } finally {
      setBusy(false);
    }
  };

  const removeToken = async () => {
    if (
      !(await ask({
        title: t("settings.tokenDelete"),
        body: t("settings.tokenDeleteBody"),
        ok: t("common.delete"),
        cancel: t("common.cancel"),
        danger: true,
      }))
    )
      return;
    await putToken("");
  };

  return (
    <div
      data-settings
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 90,
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
          width: "min(880px, 94vw)",
          height: "min(620px, 88vh)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "var(--sp-4) var(--sp-5)",
            borderBottom: "1px solid var(--line-soft)",
          }}
        >
          <b style={{ fontSize: "var(--text-md)" }}>{t("settings.title")}</b>
          <span style={{ flex: 1 }} />
          <button data-settings-close onClick={onClose} style={{ color: "var(--ink-faint)", display: "grid" }}>
            {Icon.close}
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
          {/* ★왼쪽은 **어디에 있는지**만 말한다 — 항목이 늘어도 여기는 안 는다 */}
          <nav
            style={{
              width: 168,
              flexShrink: 0,
              borderRight: "1px solid var(--line-soft)",
              padding: "var(--sp-3)",
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            {TABS.map(([id, key]) => (
              <button
                key={id}
                data-settings-tab={id}
                data-on={tab === id ? "" : undefined}
                onClick={() => setTab(id)}
                style={{
                  textAlign: "left",
                  padding: "6px var(--sp-3)",
                  borderRadius: "var(--r-2)",
                  fontSize: "var(--text-2xs)",
                  background: tab === id ? "var(--accent-bg)" : "transparent",
                  color: tab === id ? "var(--ink)" : "var(--ink-soft)",
                  border: `1px solid ${tab === id ? "var(--accent)" : "transparent"}`,
                }}
              >
                {t(key)}
              </button>
            ))}
          </nav>

          <div
            data-settings-pane={tab}
            style={{
              flex: 1,
              minWidth: 0,
              overflowY: "auto",
              padding: "var(--sp-5)",
              display: "flex",
              flexDirection: "column",
              gap: "var(--sp-5)",
            }}
          >
            {tab === "general" && (
              <>
                <Group label={t("settings.token")} help={t("settings.tokenHint")}>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
                    <input
                      data-token
                      type="password"
                      value={token}
                      placeholder={has ? t("settings.tokenSet") : t("settings.tokenEmpty")}
                      onChange={(e) => setToken(e.target.value)}
                      // ★빈 칸에서 Enter 로 지워지지 않게 — 삭제는 삭제 단추뿐이다
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && token.trim()) void putToken(token.trim());
                      }}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        background: "var(--panel)",
                        border: "1px solid var(--line)",
                        borderRadius: "var(--r-2)",
                        padding: "4px var(--sp-3)",
                        fontSize: "var(--text-2xs)",
                        fontFamily: "var(--font-mono)",
                      }}
                    />
                    <button
                      data-token-save
                      onClick={() => void putToken(token.trim())}
                      disabled={busy || !token.trim()}
                      style={btn}
                    >
                      {t(busy ? "settings.tokenChecking" : "settings.save")}
                    </button>
                    {/* ★지우는 창구 — 백엔드는 빈 값이면 지우도록 이미 돼 있었고 여기만 없었다 */}
                    {has && (
                      <button
                        data-token-delete
                        onClick={() => void removeToken()}
                        disabled={busy}
                        style={{ ...btn, color: "var(--err)" }}
                      >
                        {t("common.delete")}
                      </button>
                    )}
                  </div>
                  {note && (
                    <span data-token-note style={{ fontSize: "var(--text-2xs)", color: "var(--warn)", lineHeight: 1.6 }}>
                      {note}
                    </span>
                  )}
                  {/* ★NAI 계정이 걸린 경고라 눈에 띄어야 한다 (v2 index.html:10558) */}
                  <span style={{ fontSize: "var(--text-2xs)", color: "var(--warn)", lineHeight: 1.6 }}>
                    {t("settings.bulkWarn")}
                  </span>
                </Group>

                <Group label={t("settings.editing")} help={t("settings.tagSuggestHint")}>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "var(--sp-2)",
                      fontSize: "var(--text-2xs)",
                      color: "var(--ink-soft)",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      data-tag-suggest-toggle
                      checked={suggest}
                      onChange={(e) => setSuggest(e.target.checked)}
                    />
                    {t("settings.tagSuggest")}
                  </label>
                </Group>

                <Group label={t("settings.queue")} help={t("settings.notifyHint")}>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "var(--sp-2)",
                      fontSize: "var(--text-2xs)",
                      color: "var(--ink-soft)",
                    }}
                  >
                    <input
                      type="checkbox"
                      data-notify-done
                      checked={notify}
                      onChange={(e) => setNotify(e.target.checked)}
                    />
                    {t("settings.notifyDone")}
                  </label>
                  {/* ★소리로도 알린다 (v2 `notifySoundOnComplete` 이식 2026-08-16).
                      ★생성 옵션이 아니라 **앱 설정**이라 여기 있다 (사용자 지시). */}
                  <label
                    style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", cursor: "pointer" }}
                  >
                    <input
                      type="checkbox"
                      data-notify-sound
                      checked={sound}
                      onChange={(e) => setSound(e.target.checked)}
                    />
                    {t("settings.notifySound")}
                  </label>
                  {sound && (
                    <label
                      style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}
                    >
                      <span style={{ fontSize: "var(--text-2xs)", color: "var(--ink-faint)" }}>
                        {t("settings.notifyVolume")}
                      </span>
                      <input
                        type="range"
                        data-notify-volume
                        min={1}
                        max={100}
                        value={vol}
                        onChange={(e) => setVol(Number(e.target.value))}
                        style={{ flex: 1 }}
                      />
                      <span
                        style={{
                          width: 30,
                          textAlign: "right",
                          fontSize: "var(--text-2xs)",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {vol}
                      </span>
                      <button
                        data-notify-test
                        onClick={() => void playDoneSound()}
                        data-tip={t("settings.notifyTest")}
                        style={{ color: "var(--ink-faint)", display: "grid" }}
                      >
                        {Icon.spark}
                      </button>
                    </label>
                  )}
                </Group>

                {/* ★앱 정보 — 버전은 백엔드가 준다(`/api/health`). 화면에 박아 두면 어긋난다.
                    ★업데이트 확인은 여기 없다: 배포처가 안 정해져 있다 (감사 E절 「보류」). */}
                <Group label={t("settings.about")}>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", flexWrap: "wrap" }}>
                    <span
                      data-about-version
                      style={{
                        fontSize: "var(--text-2xs)",
                        color: "var(--ink-dim)",
                        fontFamily: "var(--font-mono)",
                      }}
                    >
                      {version || t("settings.loading")}
                    </span>
                    {support && (
                      <button
                        data-support-link
                        onClick={() => openExternal(support)}
                        data-tip={support}
                        style={{ ...btn, display: "inline-flex", alignItems: "center", gap: "var(--sp-2)" }}
                      >
                        {Icon.external}
                        {t("settings.support")}
                      </button>
                    )}
                  </div>
                </Group>
              </>
            )}

            {tab === "look" && (
              <Group label={t("settings.look")}>
                <Line label={t("settings.language")}>
                  {LOCALES.map((l) => (
                    <Chip key={l.id} on={locale === l.id} onClick={() => setLocale(l.id)} mark={`locale-${l.id}`}>
                      {l.label}
                    </Chip>
                  ))}
                </Line>
                <Line label={t("settings.theme")}>
                  {THEMES.map(([k, key]) => (
                    <Chip key={k} on={theme === k} onClick={() => setTheme(k)} mark={`theme-${k}`}>
                      {t(key)}
                    </Chip>
                  ))}
                </Line>
                <Line label={t("settings.font")}>
                  {FONTS.map((f) => (
                    <Chip key={f.id} on={font === f.id} onClick={() => setFont(f.id)} mark={`font-${f.id}`}>
                      {f.label}
                    </Chip>
                  ))}
                </Line>
              </Group>
            )}

            {tab === "llm" && <AiSettings />}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 좌측 탭 — ★이름을 문자열로 이어 만들지 않는다 (아래 THEMES 와 같은 이유).
 *  ★값 자체는 `store/ui.ts` 가 든다 (여는 자리가 셋이라 스토어에 있어야 한다) */
export type TabId = SettingsTabId;
const TABS = [
  ["general", "settings.tabGeneral"],
  ["look", "settings.look"],
  ["llm", "settings.llm"],
] as const satisfies readonly (readonly [TabId, string])[];

/** ★키를 **문자열로 이어 만들지 않는다** — i18n 회귀 테스트가 "실재하지 않는 그룹"으로 잡고,
 *  무엇보다 키가 조용히 빠져도 아무도 모른다 */
const THEMES = [
  ["system", "settings.themeSystem"],
  ["light", "settings.themeLight"],
  ["dark", "settings.themeDark"],
] as const;

/** ★설명은 **라벨 옆 `?`** 로만 나온다 (사용자 지시 2026-08-19) — 화면에 펼쳐 두지 않는다 */
export const Group = ({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
    <span style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", fontSize: "var(--text-xs)", fontWeight: "var(--w-semi)", color: "var(--ink-soft)" }}>
      {label}
      {help && <Help tip={help} />}
    </span>
    {children}
  </div>
);

const Line = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
    <span style={{ width: 54, flexShrink: 0, fontSize: "var(--text-2xs)", color: "var(--ink-faint)" }}>{label}</span>
    {children}
  </div>
);

const Chip = ({
  on,
  onClick,
  mark,
  children,
}: {
  on: boolean;
  onClick: () => void;
  mark: string;
  children: React.ReactNode;
}) => (
  <button
    data-set={mark}
    onClick={onClick}
    style={{
      border: `1px solid ${on ? "var(--accent)" : "var(--line)"}`,
      background: on ? "var(--accent-bg)" : "var(--panel)",
      color: on ? "var(--ink)" : "var(--ink-soft)",
      borderRadius: "var(--r-2)",
      padding: "3px var(--sp-4)",
      fontSize: "var(--text-2xs)",
    }}
  >
    {children}
  </button>
);

const btn: React.CSSProperties = {
  border: "1px solid var(--line)",
  borderRadius: "var(--r-2)",
  background: "var(--panel)",
  color: "var(--ink-soft)",
  padding: "4px var(--sp-4)",
  fontSize: "var(--text-2xs)",
};
