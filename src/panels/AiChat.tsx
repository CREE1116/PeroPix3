import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { useLlm, type Ask, type Line } from "../store/llm";
import { useWs } from "../store/workspace";
import { useUi, MODES } from "../store/ui";
import { useCli, CLI_EFFORTS } from "../store/cli";
import { Icon } from "../components/Icon";

/** AI 채팅 — **반복 작업을 말로 시키는 자리** (ui-guide 7절 「LLM 개입면」).
 *
 *  ★**수동 UI 가 정본이고 LLM 은 같은 것을 고칠 뿐이다** (renewal/README 5항).
 *    그래서 도구는 화면이 쓰는 스토어를 그대로 쓴다 — 고치면 화면이 곧바로 따라 바뀐다.
 *  ★**지금 보고 있는 것**을 머리에 한 줄로 건다. "무엇을 알고 있는지" 를 사용자가 눈으로
 *    확인할 수 있어야 시킬 말을 정할 수 있다 (Studio 의 `crumb` 과 같은 장치).
 *  ★스트리밍이 아니라 **도구 줄**로 진행을 보인다 — 무엇을 만졌는지가 글자보다 중요하다. */
export function AiChat({ onOpenSettings }: { onOpenSettings: () => void }) {
  const t = useI18n((s) => s.t);
  // `id` = 지금 열려 있는 대화 (목록에서 어느 줄이 지금 것인지 표시)
  const { cfg, lines, sending, error, ask, list, id: cur, cliSessionGone,
          loadConfig, restore, send, stop, newChat, open, remove } = useLlm();
  const [showList, setShowList] = useState(false);
  const { engine, exe, scanning, detect } = useCli();
  const ws = useWs((s) => s.current);
  const tab = useWs((s) => s.activeTab());
  const mode = useUi((s) => s.mode);
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  // ★내용에 맞춰 높이를 다시 잰다. `auto` 로 되돌리지 않으면 **줄어들지 않는다**
  //   (scrollHeight 가 지금 높이에 갇힌다).
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    // ★`box-sizing: border-box` 라 높이에 **테두리까지** 포함해야 한다. 그냥 scrollHeight 를
    //   넣으면 내용이 테두리 두께만큼 넘쳐서 스크롤바가 생긴다 (실측 2026-08-08).
    el.style.height = el.scrollHeight + (el.offsetHeight - el.clientHeight) + "px";
  }, [text]);

  useEffect(() => {
    void loadConfig();
    // ★껐다 켜도 하던 이야기가 이어진다 (사용자 요청 2026-08-07)
    void restore();
    // 탐지는 공짜다 — 열 때마다 다시 봐서 "그새 깔았다"를 놓치지 않는다
    void detect();
  }, [loadConfig, restore, detect]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [lines.length, sending]);

  // ★도는 중에도 말을 걸 수 있다 (사용자 지시 2026-08-15) — 줄은 바로 뜨고, 지금 턴이
  //   끝나는 대로 이어서 처리된다. 그래서 `sending` 으로 막지 않는다.
  const submit = () => {
    const v = text.trim();
    if (!v) return;
    setText("");
    void send(v);
  };

  const modeLabel = MODES.find((m) => m.id === mode)?.label ?? mode;
  // ★엔진마다 "준비됨"의 뜻이 다르다: API 는 키, CLI 는 몰 수 있는 실행 파일
  const ready = engine === "cli" ? !!exe : !!cfg?.hasKey;
  const noCli = engine === "cli" && !exe && !scanning;

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {/* 지금 보고 있는 것 */}
      <div
        data-ai-context
        title={t("ai.contextHint")}
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-2)",
          padding: "4px var(--sp-4)",
          borderBottom: "1px solid var(--line)",
          fontSize: "var(--text-2xs)",
          color: "var(--ink-faint)",
          whiteSpace: "nowrap",
          overflow: "hidden",
        }}
      >
        <span style={{ color: "var(--ink-dim)" }}>{ws || "—"}</span>
        <span>·</span>
        <span>{modeLabel}</span>
        {tab && (
          <>
            <span>·</span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{tab.name}</span>
          </>
        )}
        <span style={{ flex: 1 }} />
        {/* ★지금 무엇으로 도는가 — 누르면 설정이 열린다 */}
        <button
          data-ai-engine={engine}
          onClick={onOpenSettings}
          title={t("ai.engineHint")}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "0 4px",
            color: ready ? "var(--ink-dim)" : "var(--warn)",
            fontSize: "0.62rem",
            letterSpacing: "0.04em",
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: ready ? "var(--ok)" : "var(--warn)",
            }}
          />
          {engine === "cli" ? "CLI" : "API"}
        </button>
        <button
          data-ai-list
          onClick={() => setShowList((v) => !v)}
          title={t("ai.history")}
          style={{ color: showList ? "var(--accent)" : "var(--ink-faint)", display: "grid" }}
        >
          {Icon.folder}
        </button>
        {lines.length > 0 && (
          <button
            data-ai-new
            onClick={newChat}
            disabled={sending}
            title={sending ? t("ai.busyLock") : t("ai.reset")}
            style={{ color: sending ? "var(--ink-ghost)" : "var(--ink-faint)", display: "grid" }}
          >
            {Icon.plus}
          </button>
        )}
      </div>

      {/* 지난 대화 — ★고르면 그 자리에서 열린다 (재실행 뒤에도 남아 있다) */}
      {showList && (
        <div
          data-ai-history
          style={{
            flexShrink: 0,
            maxHeight: 220,
            overflowY: "auto",
            borderBottom: "1px solid var(--line)",
            background: "var(--panel)",
          }}
        >
          {list.length === 0 && (
            <div style={{ padding: "var(--sp-3) var(--sp-4)", fontSize: "var(--text-2xs)", color: "var(--ink-ghost)" }}>
              {t("ai.noHistory")}
            </div>
          )}
          {sending && (
            <div
              data-ai-locked
              style={{
                padding: "var(--sp-2) var(--sp-4)",
                fontSize: "0.62rem",
                color: "var(--ink-faint)",
                borderBottom: "1px solid var(--line-soft)",
              }}
            >
              {t("ai.busyLock")}
            </div>
          )}
          {list.map((c) => (
            <div
              key={c.id}
              data-ai-chat={c.id}
              data-locked={sending ? "" : undefined}
              title={sending ? t("ai.busyLock") : undefined}
              onClick={() => {
                if (sending) return; // ★돌던 응답이 그 대화에 붙는다
                void open(c.id);
                setShowList(false);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--sp-2)",
                padding: "4px var(--sp-4)",
                cursor: "pointer",
                fontSize: "var(--text-2xs)",
                color: c.id === cur ? "var(--ink)" : "var(--ink-soft)",
                background: c.id === cur ? "var(--accent-bg)" : undefined,
              }}
            >
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {c.title || t("ai.untitled")}
              </span>
              {/* ★대화는 전역이지만 **어디서 시작했는지**는 보인다 (사용자 결정 2026-08-08) */}
              {c.workspace && c.workspace !== ws && (
                <span
                  data-ai-chat-ws={c.workspace}
                  style={{
                    flexShrink: 0,
                    maxWidth: 90,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    color: "var(--ink-ghost)",
                  }}
                >
                  {c.workspace}
                </span>
              )}
              <span style={{ flexShrink: 0, color: "var(--ink-ghost)", fontFamily: "var(--font-mono)" }}>
                {c.updatedAt.slice(5, 10)}
              </span>
              <button
                data-ai-chat-del={c.id}
                onClick={(e) => {
                  e.stopPropagation();
                  void remove(c.id);
                }}
                title={t("common.delete")}
                style={{ flexShrink: 0, color: "var(--ink-faint)", display: "grid" }}
              >
                {Icon.close12}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 대화 */}
      <div
        data-ai-lines
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "var(--sp-4)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--sp-3)",
        }}
      >
        {/* CLI 인데 몰 수 있는 것이 없다 — 설치 안내 (스튜디오의 연결 가이드와 같은 자리) */}
        {noCli && (
          <div style={guide}>
            {t("ai.noCli")}
            <code style={{ fontFamily: "var(--font-mono)", color: "var(--ink-soft)" }}>
              npm i -g @anthropic-ai/claude-code
            </code>
            <span style={{ display: "flex", gap: "var(--sp-2)" }}>
              <button data-ai-rescan onClick={() => void detect()} style={guideBtn}>
                {t("settings.rescan")}
              </button>
              <button data-ai-settings onClick={onOpenSettings} style={guideBtn}>
                {t("ai.openSettings")}
              </button>
            </span>
          </div>
        )}
        {engine === "api" && !cfg?.hasKey && (
          <div style={guide}>
            {t("ai.noKey")}
            <button
              data-ai-settings
              onClick={onOpenSettings}
              style={{
                border: "1px solid var(--line)",
                borderRadius: "var(--r-2)",
                background: "var(--panel)",
                color: "var(--ink-soft)",
                padding: "3px var(--sp-4)",
                fontSize: "var(--text-2xs)",
              }}
            >
              {t("ai.openSettings")}
            </button>
          </div>
        )}
        {lines.length === 0 && ready && (
          <div style={{ fontSize: "var(--text-2xs)", color: "var(--ink-ghost)", lineHeight: 1.7 }}>
            {t("ai.empty")}
          </div>
        )}
        {lines.map((l, i) => (
          <Row key={i} line={l} />
        ))}
        {ask && <AskCard ask={ask} />}
        {sending && (
          <div style={{ fontSize: "var(--text-2xs)", color: "var(--ink-faint)" }}>{t("ai.working")}</div>
        )}
        {/* ★없어진 세션은 **열자마자** 알린다 (사용자 지시 2026-08-12) — 말을 걸어 실패를
            겪고 나서 알게 되지 않도록. claude 는 기본 30일이 지난 기록을 지운다. */}
        {cliSessionGone && !error && (
          <div style={{ display: "grid", gap: "var(--sp-2)", justifyItems: "start" }}>
            <Row line={{ kind: "error", text: t("ai.cliSessionGone") }} />
            {/* ★이어서 말을 걸 수 없는 대화다 — 갈 곳을 여기서 준다 (사용자 지시 2026-08-12) */}
            <button
              data-ai-gone-new
              onClick={newChat}
              disabled={sending}
              style={{
                fontSize: "var(--text-2xs)",
                color: "var(--ink)",
                border: "1px solid var(--line)",
                borderRadius: "var(--r-2)",
                padding: "var(--sp-1) var(--sp-3)",
              }}
            >
              {t("ai.cliSessionGoneNew")}
            </button>
          </div>
        )}
        {/* ★오류는 대화에 안 담는다 — 다음 턴에 공급자로 되돌아가면 또 걸린다 */}
        {error && <Row line={{ kind: "error", text: error }} />}
        <div ref={end} />
      </div>

      {/* 입력 */}
      <div
        style={{
          flexShrink: 0,
          borderTop: "1px solid var(--line)",
          padding: "var(--sp-3)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--sp-2)",
        }}
      >
        {/* ★줄바꿈하면 **스크롤이 아니라 칸이 늘어난다** (사용자 지시 2026-08-08) —
            쓴 것이 한눈에 다 보여야 고치기 쉽다. 45vh 를 넘어가야 그때 스크롤이 생긴다
            (안 그러면 긴 글을 붙여 넣었을 때 대화가 통째로 가려진다). */}
        <textarea
          ref={box}
          data-ai-input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder={t("ai.placeholder")}
          style={{
            width: "100%",
            resize: "none",
            overflowY: "auto",
            maxHeight: "45vh",
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: "var(--r-2)",
            padding: "var(--sp-2) var(--sp-3)",
            fontSize: "var(--text-2xs)",
            lineHeight: 1.5,
          }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
          <ModelChip onOpenSettings={onOpenSettings} />
          <span style={{ flex: 1 }} />
          {/* ★단추는 **하나**다 (사용자 지시 2026-08-15, CLI 들이 하는 방식).
              평소엔 보내기 · 도는 중엔 정지 · 도는 중에 **뭔가 치면 다시 보내기**.
              둘을 나란히 두면 도는 동안 어느 쪽을 누를지가 매번 판단거리가 된다. */}
          {sending && !text.trim() ? (
            <button data-ai-stop onClick={stop} style={sendBtn}>
              {t("ai.stop")}
            </button>
          ) : (
            <button
              data-ai-send
              onClick={submit}
              disabled={!text.trim()}
              // 도는 중에 보내면 곧바로 안 가고 이 턴이 끝난 뒤에 간다 — 그것을 미리 알린다
              title={sending ? t("ai.queue") : undefined}
              style={sendBtn}
            >
              {t("ai.send")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** 지금 무엇으로 도는가 — **보내기 바로 옆에서 보고 바꾼다** (사용자 지시 2026-08-08).
 *
 *  ★값을 여기 따로 담지 않는다. 설정 화면과 **같은 스토어·같은 저장 경로**를 쓰므로
 *    두 화면이 어긋날 수 없다 (CLAUDE.md: 하나의 정보에는 하나의 창구).
 *  ★엔진에 따라 보는 곳이 다르다 — CLI 는 `useCli`(로컬 설정), API 는 `useLlm`(백엔드 설정). */
function ModelChip({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const t = useI18n((s) => s.t);
  const [open, setOpen] = useState(false);
  const cfg = useLlm((s) => s.cfg);
  const models = useLlm((s) => s.models);
  const loadModels = useLlm((s) => s.loadModels);
  const saveLlm = useLlm((s) => s.saveConfig);
  const { engine, model: cliModel, effort: cliEffort, setModel: setCliModel, setEffort: setCliEffort } = useCli();
  // ★고른 CLI 가 받는 모델만 보여 준다 (`items` 가 실어 온다)
  const cliModels = useCli((c) => c.models());
  const cli = engine === "cli";

  // ★"기본값"이라고만 적으면 그게 뭔지 알 수 없다 (사용자 지적 2026-08-08) —
  //   클로드 코드의 설정에서 읽어 온 실제 값을 괄호로 붙인다. 모르면 안 붙인다.
  const name = cli ? cliModel : cfg?.model || "—";
  const eff = cli ? cliEffort : cfg?.effort;
  const picked = models.find((m) => m.id === cfg?.model);
  const efforts = cli ? CLI_EFFORTS : (picked?.efforts ?? []);

  useEffect(() => {
    if (open && !cli && !models.length) void loadModels();
  }, [open, cli, models.length, loadModels]);

  const short = name.includes("/") ? name.slice(name.indexOf("/") + 1) : name;
  return (
    <div style={{ position: "relative", minWidth: 0 }}>
      <button
        data-ai-model
        onClick={() => setOpen((v) => !v)}
        title={`${cli ? "CLI" : cfg?.provider ?? ""} · ${name}${eff ? " · " + eff : ""}`}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          maxWidth: 190,
          padding: "3px var(--sp-2)",
          borderRadius: "var(--r-2)",
          border: `1px solid ${open ? "var(--accent)" : "var(--line)"}`,
          background: open ? "var(--accent-bg)" : "transparent",
          color: "var(--ink-dim)",
          fontSize: "0.62rem",
          whiteSpace: "nowrap",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{short}</span>
        {eff && <span style={{ color: "var(--ink-faint)", flexShrink: 0 }}>· {eff}</span>}
      </button>

      {open && (
        <>
          {/* 바깥을 누르면 닫힌다 */}
          <div onPointerDown={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 60 }} />
          <div
            data-ai-model-pop
            style={{
              position: "absolute",
              bottom: "calc(100% + 6px)",
              left: 0,
              zIndex: 61,
              width: 248,
              display: "grid",
              gap: "var(--sp-2)",
              padding: "var(--sp-3)",
              background: "var(--panel)",
              border: "1px solid var(--line)",
              borderRadius: "var(--r-3)",
              boxShadow: "var(--shadow-3)",
            }}
          >
            <Field label={t("settings.llmModel")}>
              {cli ? (
                <select
                  data-ai-model-pick
                  value={cliModel}
                  onChange={(e) => setCliModel(e.target.value)}
                  style={popField}
                >
                  {/* ★목록은 고른 CLI 것이다. 기억해 둔 값이 목록에 없어도 자리를 남긴다 */}
                  {(cliModels.includes(cliModel) || !cliModel
                    ? cliModels
                    : [cliModel, ...cliModels]
                  ).map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              ) : (
                <select
                  data-ai-model-pick
                  value={cfg?.model ?? ""}
                  disabled={!models.length}
                  onChange={(e) => void saveLlm({ model: e.target.value })}
                  style={popField}
                >
                  {cfg?.model && !models.some((m) => m.id === cfg.model) && (
                    <option value={cfg.model}>{cfg.model}</option>
                  )}
                  {!cfg?.model && <option value="">{t("settings.modelNeedKey")}</option>}
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>{m.id}</option>
                  ))}
                </select>
              )}
            </Field>
            {/* ★단계는 그 모델이 받는 것만 — 목록이 없으면 칸 자체를 안 낸다 */}
            {efforts.length > 0 && (
              <Field label={t("settings.reasoning")}>
                <select
                  data-ai-effort-pick
                  value={eff ?? ""}
                  onChange={(e) => (cli ? setCliEffort(e.target.value) : void saveLlm({ effort: e.target.value }))}
                  style={popField}
                >
                  {!cli && <option value="">{t("settings.effortDefault")}</option>}
                  {efforts.map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </Field>
            )}
            <button
              data-ai-model-more
              onClick={() => {
                setOpen(false);
                onOpenSettings?.();
              }}
              style={{ justifySelf: "start", fontSize: "0.62rem", color: "var(--accent)", textDecoration: "underline" }}
            >
              {t("settings.title")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const popField: React.CSSProperties = {
  width: "100%",
  background: "var(--surface)",
  border: "1px solid var(--line)",
  borderRadius: "var(--r-2)",
  padding: "3px var(--sp-2)",
  fontSize: "0.62rem",
};

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label style={{ display: "grid", gap: 3 }}>
    <span style={{ fontSize: "0.58rem", color: "var(--ink-faint)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
      {label}
    </span>
    {children}
  </label>
);

/** AI 의 물음 — **답할 때까지 도구가 기다린다** (`ask_user`).
 *
 *  ★취향이 갈리는 자리에서 임의로 고르지 말라는 뜻이라, 답하기 전에는 다음 줄이 안 온다.
 *  ★**다중 선택**은 눌러서 담았다가 「확인」으로 한 번에 보낸다 (사용자 지시 2026-08-08) —
 *    하나짜리는 누르는 즉시 간다. 두 경우의 조작이 달라야 무엇을 고르는지 헷갈리지 않는다. */
function AskCard({ ask }: { ask: Ask }) {
  const t = useI18n((s) => s.t);
  const [picked, setPicked] = useState<string[]>([]);
  const multi = !!ask.multi;

  return (
    <div
      data-ai-ask
      data-ai-multi={multi ? "" : undefined}
      style={{
        border: "1px solid var(--accent)",
        borderRadius: "var(--r-2)",
        background: "var(--accent-bg)",
        padding: "var(--sp-3)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--sp-2)",
      }}
    >
      {ask.header && (
        <span style={{ fontSize: "0.62rem", letterSpacing: "0.06em", color: "var(--accent)" }}>
          {ask.header}
        </span>
      )}
      <span style={{ fontSize: "var(--text-2xs)", color: "var(--ink)", lineHeight: 1.6 }}>
        {ask.question}
      </span>

      {ask.options.map((o, i) => {
        const on = picked.includes(o.label);
        return (
          <button
            key={i}
            data-ai-choice={o.label}
            data-on={on ? "" : undefined}
            onClick={() =>
              multi
                ? setPicked((p) => (on ? p.filter((x) => x !== o.label) : [...p, o.label]))
                : ask.answer([o.label])
            }
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "var(--sp-2)",
              textAlign: "left",
              border: `1px solid ${on ? "var(--accent)" : "var(--line)"}`,
              borderRadius: "var(--r-2)",
              background: on ? "var(--accent-bg)" : "var(--panel)",
              padding: "4px var(--sp-3)",
            }}
          >
            {/* 여럿 고르는 물음에서만 네모 표시 — 한 개짜리와 조작이 다르다는 것을 알린다 */}
            {multi && (
              <span
                style={{
                  flexShrink: 0,
                  marginTop: 3,
                  width: 11,
                  height: 11,
                  borderRadius: 3,
                  border: `1px solid ${on ? "var(--accent)" : "var(--line-strong)"}`,
                  background: on ? "var(--accent)" : "transparent",
                  display: "grid",
                  placeItems: "center",
                  color: "var(--accent-on)",
                }}
              >
                {on && Icon.check}
              </span>
            )}
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "block", fontSize: "var(--text-2xs)", color: "var(--ink)" }}>
                {o.label}
              </span>
              {o.description && (
                <span style={{ display: "block", fontSize: "0.62rem", color: "var(--ink-faint)" }}>
                  {o.description}
                </span>
              )}
            </span>
          </button>
        );
      })}

      {multi && (
        <button
          data-ai-confirm
          disabled={!picked.length}
          onClick={() => ask.answer(picked)}
          style={{
            alignSelf: "flex-end",
            border: "1px solid var(--accent)",
            borderRadius: "var(--r-2)",
            background: picked.length ? "var(--accent)" : "var(--panel)",
            color: picked.length ? "var(--accent-on)" : "var(--ink-faint)",
            padding: "3px var(--sp-5)",
            fontSize: "var(--text-2xs)",
          }}
        >
          {picked.length ? t("ai.pickN", { n: picked.length }) : t("ai.pickNone")}
        </button>
      )}
    </div>
  );
}

function Row({ line }: { line: Line }) {
  const t = useI18n((s) => s.t);
  if (line.kind === "user")
    return (
      <div
        style={{
          alignSelf: "flex-end",
          maxWidth: "92%",
          background: "var(--accent-bg)",
          border: "1px solid var(--accent-line)",
          borderRadius: "var(--r-2)",
          padding: "var(--sp-2) var(--sp-3)",
          fontSize: "var(--text-2xs)",
          lineHeight: 1.6,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {line.text}
      </div>
    );

  if (line.kind === "ai")
    return (
      <div
        style={{
          fontSize: "var(--text-2xs)",
          color: "var(--ink)",
          lineHeight: 1.65,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {line.text}
      </div>
    );

  if (line.kind === "error")
    return (
      <div
        style={{
          fontSize: "var(--text-2xs)",
          color: "var(--err)",
          background: "color-mix(in srgb, var(--err) 10%, transparent)",
          border: "1px solid color-mix(in srgb, var(--err) 35%, var(--line))",
          borderRadius: "var(--r-2)",
          padding: "var(--sp-2) var(--sp-3)",
          wordBreak: "break-word",
          // ★줄바꿈을 살린다 — CLI 가 죽은 까닭(stderr)이 여러 줄로 붙는다 (`llm.ts` 의 exit)
          whiteSpace: "pre-wrap",
        }}
      >
        {line.text}
      </div>
    );

  // 도구 — ★무엇을 만졌는지가 이 패널의 핵심 정보다
  return (
    <div
      data-ai-tool={line.name}
      title={line.note || undefined}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-2)",
        fontSize: "var(--text-2xs)",
        fontFamily: "var(--font-mono)",
        color: line.ok ? "var(--ink-dim)" : "var(--warn)",
      }}
    >
      <span style={{ display: "grid", color: line.ok ? "var(--ok)" : "var(--warn)" }}>
        {line.ok ? Icon.check : Icon.close12}
      </span>
      <span style={{ flexShrink: 0 }}>{line.name}</span>
      {line.note && (
        <span
          data-ai-tool-did={line.ok ? "" : undefined}
          style={{
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            // 성공한 것의 설명은 한 단 흐리게 — 실패 문구와 눈으로 갈린다
            color: line.ok ? "var(--ink-faint)" : "inherit",
          }}
        >
          — {line.note}
        </span>
      )}
      {!line.ok && !line.note && <span>— {t("ai.failed")}</span>}
    </div>
  );
}

const guide: React.CSSProperties = {
  border: "1px dashed var(--line)",
  borderRadius: "var(--r-2)",
  padding: "var(--sp-4)",
  fontSize: "var(--text-2xs)",
  color: "var(--ink-dim)",
  display: "flex",
  flexDirection: "column",
  gap: "var(--sp-2)",
  alignItems: "flex-start",
  lineHeight: 1.6,
};

const guideBtn: React.CSSProperties = {
  border: "1px solid var(--line)",
  borderRadius: "var(--r-2)",
  background: "var(--panel)",
  color: "var(--ink-soft)",
  padding: "3px var(--sp-4)",
  fontSize: "var(--text-2xs)",
};

const sendBtn: React.CSSProperties = {
  border: "1px solid var(--line)",
  borderRadius: "var(--r-2)",
  background: "var(--panel)",
  color: "var(--ink-soft)",
  padding: "3px var(--sp-5)",
  fontSize: "var(--text-2xs)",
};
