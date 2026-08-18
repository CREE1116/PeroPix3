import { useEffect, useState } from "react";
import { useI18n, LOCALES } from "../i18n";
import { api } from "../lib/backend";
import { useTheme } from "../store/theme";
import { playDoneSound } from "../lib/notifySound";
import { useUi, FONTS } from "../store/ui";
import { toast } from "../store/toast";
import { Icon } from "../components/Icon";
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
  hasToken,
  tab: initialTab = "general",
}: {
  onClose: () => void;
  hasToken: boolean;
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
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [has, setHas] = useState(hasToken);
  const [tab, setTab] = useState<TabId>(initialTab);

  useEffect(() => setHas(hasToken), [hasToken]);

  const saveToken = async () => {
    if (busy || !token.trim()) return;
    setBusy(true);
    try {
      const r = await api<{ hasToken: boolean }>("/api/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.trim() }),
      });
      setHas(r.hasToken);
      setToken("");
      toast(t("settings.tokenSaved"));
    } catch (e) {
      toast(String(e), "warn");
    } finally {
      setBusy(false);
    }
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
                <Group label={t("settings.token")}>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
                    <input
                      data-token
                      type="password"
                      value={token}
                      placeholder={has ? t("settings.tokenSet") : t("settings.tokenEmpty")}
                      onChange={(e) => setToken(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && void saveToken()}
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
                      onClick={() => void saveToken()}
                      disabled={busy || !token.trim()}
                      style={btn}
                    >
                      {t("settings.save")}
                    </button>
                  </div>
                  <Hint>{t("settings.tokenHint")}</Hint>
                </Group>

                <Group label={t("settings.queue")}>
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
                  <Hint>{t("settings.notifyHint")}</Hint>
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
                        title={t("settings.notifyTest")}
                        style={{ color: "var(--ink-faint)", display: "grid" }}
                      >
                        {Icon.spark}
                      </button>
                    </label>
                  )}
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

/** 좌측 탭 — ★이름을 문자열로 이어 만들지 않는다 (아래 THEMES 와 같은 이유) */
export type TabId = "general" | "look" | "llm";
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

export const Group = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
    <span style={{ fontSize: "var(--text-xs)", fontWeight: "var(--w-semi)", color: "var(--ink-soft)" }}>{label}</span>
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

const Hint = ({ children }: { children: React.ReactNode }) => (
  <span style={{ fontSize: "var(--text-2xs)", color: "var(--ink-faint)" }}>{children}</span>
);

const btn: React.CSSProperties = {
  border: "1px solid var(--line)",
  borderRadius: "var(--r-2)",
  background: "var(--panel)",
  color: "var(--ink-soft)",
  padding: "4px var(--sp-4)",
  fontSize: "var(--text-2xs)",
};
