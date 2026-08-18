import { useI18n, t as tGlobal } from "./i18n";
import { useEffect, useState } from "react";
import { api } from "./lib/backend";
import { Shell } from "./app/Shell";
import { TitleBar } from "./app/TitleBar";
import { WindowFrame } from "./app/WindowFrame";
import { Icon } from "./components/Icon";
import { useTheme } from "./store/theme";
import { useUi, applyFont } from "./store/ui";
import { useGen } from "./store/gen";
import { useQueue } from "./store/queue";
import { scheduleSave, useWs } from "./store/workspace";
import { setPromptSaver } from "./store/prompt";
import { WorkspaceGate } from "./app/WorkspaceGate";
import { WorkspaceTabs } from "./app/WorkspaceTabs";
import { LeftPanel } from "./panels/LeftPanel";
import { GenerateFooter } from "./panels/GenerateFooter";
import { Settings, type TabId as SettingsTab } from "./app/Settings";
import { Toasts } from "./app/Toasts";
import { AskDialog } from "./app/AskDialog";
import { AiChat } from "./panels/AiChat";
import { OptionsPanel } from "./panels/OptionsPanel";
import { Canvas } from "./panels/Canvas";
import { CanvasTabs } from "./panels/CanvasTabs";
import { Gallery } from "./panels/Gallery";
import { Censor } from "./panels/Censor";
import { Tools } from "./panels/Tools";
import { GalleryFolders } from "./panels/GalleryFolders";
import { GalleryMeta } from "./panels/GalleryMeta";
import { Deck } from "./cards/Deck";
import { DragLayer } from "./cards/DragLayer";
import { SaveDialog, type SaveAsk } from "./cards/SaveDialog";
import { useSub } from "./store/sub";
import { useImageInput } from "./store/imageInput";
import { BlockDrawer } from "./blocks/BlockDrawer";
import { ThumbDialog } from "./cards/ThumbDialog";
import { saveCardWithThumb } from "./cards/saveCard";
import { pinImage, setCover } from "./cards/thumbUpload";
import { usePrompt, defaultView } from "./store/prompt";
import { useCards, type CardKind } from "./store/cards";
import type { DragImage } from "./cards/dragStore";

/** 위치 잡는 창이 겨눌 수 있는 두 목적지 — 섹션 배너 또는 **덱 커버**.
 *  ★덱 안의 개별 카드는 여기서 못 바꾼다 (사용자 정정): 카드는 꺼내서(섹션에 적용)
 *    고친 뒤 역드래그로 덮어쓰는 것이 유일한 수정 경로다. */
type ThumbTarget =
  | { type: "section"; section: string; img: DragImage }
  | { type: "cover"; kind: CardKind; img: DragImage };

type Health = { ok: boolean; version: string; hasToken: boolean };

export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [dead, setDead] = useState(false);
  const mode = useUi((s) => s.mode);
  // ★여기서 구독해야 언어를 바꿨을 때 패널 머리글이 따라 바뀐다 (tGlobal 은 구독이 아니다)
  const tr = useI18n((s) => s.t);
  const initGen = useGen((s) => s.init);
  const connectQueue = useQueue((s) => s.connect);
  const initWs = useWs((s) => s.init);
  const wsCurrent = useWs((s) => s.current);
  const wsLoading = useWs((s) => s.loading);
  const loadCards = useCards((s) => s.load);
  const [deck, setDeck] = useState<CardKind | null>(null);
  const [ask, setAsk] = useState<SaveAsk | null>(null);
  const [thumbAsk, setThumbAsk] = useState<ThumbTarget | null>(null);
  // ★어느 탭으로 열지까지 담는다 — 연 자리가 곧 볼 탭이다 (AI 채팅 → LLM)
  const [settings, setSettings] = useState<SettingsTab | null>(null);
  // ★탭 줄의 「+」 — 게이트를 그 자리에서 띄운다 (워크스페이스를 닫지 않고 하나 더 연다)
  const [gate, setGate] = useState(false);
  /** ★인페인트 중에는 왼쪽 패널이 **씬 프롬프트가 아니라 그 인페인트의 사본**을 편집한다
   *  (`store/imageInput` 의 startEdit). 머리글이 안 바뀌면 씬 프롬프트를 고치는 줄 안다. */
  const inpainting = useImageInput((s) => s.editing);

  // ★저장된 글꼴 선택을 부팅 때 한 번 꽂는다. `--font-sans` 는 CSS 기본값이 Pretendard 라,
  //   이걸 안 하면 다른 글꼴을 골라 뒀어도 새로 켤 때 Pretendard 로 돌아간다.
  useEffect(() => {
    applyFont(useUi.getState().font);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      await initGen();
      // 사이드카가 뜨는 데 잠깐 걸리므로 재시도한다.
      for (let i = 0; i < 25; i++) {
        try {
          const h = await api<Health>("/api/health");
          if (!alive) return;
          setHealth(h);
          if (h.hasToken) {
            try {
              await useSub.getState().load();
            } catch {}
          }
          // 프롬프트 편집이 워크스페이스 저장을 예약하도록 연결 (순환 참조 회피)
          // ★**워크스페이스 스토어의 타이머를 쓴다.** 여기서 setTimeout 을 따로 만들면
          //   디바운스가 두 개가 되고, 탭을 바꿀 때 흘려보내는 쪽이 그 하나를 못 본다 —
          //   편집 직후 전환하면 그 편집이 조용히 사라졌다 (실측 2026-08-08).
          setPromptSaver(() => {
            scheduleSave();
            return () => {};
          });
          await initWs();
          // ★큐는 앱 전체가 공유한다 — 워크스페이스를 고르기 전에 붙어 둔다
          void connectQueue();
          // 카드는 워크스페이스와 무관한 공용 저장소라 여기서 한 번만 읽는다
          await loadCards();
          return;
        } catch {
          await new Promise((r) => setTimeout(r, 400));
        }
      }
      if (alive) setDead(true);
    })();
    return () => {
      alive = false;
    };
  }, [initGen, initWs, loadCards, connectQueue]);

  // ★열린 워크스페이스가 없을 때 — **첫 화면이 아니라 빈 셸 + 닫을 수 없는 모달**이다
  //   (사용자 지시 2026-08-08). 켜면 마지막에 보던 워크스페이스가 저절로 열리므로
  //   (`useWs.init`) 여기 오는 것은 셋뿐이다: 진짜 첫 실행 · 마지막 탭을 닫음 ·
  //   보던 워크스페이스를 지움. 창 단추를 쓸 수 있어야 하므로 타이틀바는 남긴다.
  // ★확인 창·토스트도 **여기에** 매단다 — 일찍 반환하므로 아래 것들이 안 붙는다.
  //   실측으로 밟았다 (2026-08-05: 워크스페이스 삭제를 눌러도 아무 일도 안 일어났다).
  if (!wsCurrent)
    return (
      <WindowFrame>
        <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--bg-deep)" }}>
          <TitleBar right={<Status health={health} dead={dead} />} />
          <div style={{ flex: 1, display: "grid", placeItems: "center" }}>
            {wsLoading && <Booting ready={!!health} dead={dead} />}
          </div>
        </div>
        {/* 아직 목록을 읽는 중이면 모달을 안 띄운다 — 부팅 때 한 번 깜빡인다 */}
        {!wsLoading && <WorkspaceGate />}
        <AskDialog />
        <Toasts />
      </WindowFrame>
    );

  return (
    <WindowFrame>
      <Shell
        titleRight={
          <>
            <Status health={health} dead={dead} />
            {/* ★언어·글꼴·테마는 **설정 안**으로 모았다 — 자주 안 쓰는 것이 타이틀바를 채우고 있었다 */}
            <ThemeButton />
            <button
              data-settings-open
              onClick={() => setSettings("general")}
              title={tr("settings.title")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "0 var(--sp-3)",
                color: "var(--ink-soft)",
                alignSelf: "stretch",
              }}
            >
              {Icon.settings}
            </button>
          </>
        }
        /* ★Anlas 는 여기 없다 — 생성 푸터 하나로 모았다 (사용자 지시 2026-08-04) */
        navRight={<QueueStatus />}
        /* ★AI 는 **모드와 무관하게** 늘 있다 — 갤러리에서 정리를 시키고 검열 중에
           프롬프트를 손볼 수 있어야 한다. 기본은 접힌 레일이라 자리를 안 먹는다 */
        ai={<AiChat onOpenSettings={() => setSettings("llm")} />}
        /* ★모드마다 양옆이 바뀐다 — 갤러리에서 프롬프트 편집기를 띄워 두면
           "지금 편집하는 것이 무엇인지"가 흐려진다 (갤러리는 과거를 보는 화면이다).
           머리글도 함께 바뀌어야 한다 — 안 그러면 "프롬프트" 아래 폴더가 뜬다. */
        leftLabel={
          mode === "gallery"
            ? tr("gallery.folders")
            : inpainting
              ? tr("focus.promptLabel")
              : tr("panel.prompt")
        }
        rightLabel={mode === "gallery" ? tr("gallery.meta") : tr("panel.options")}
        /* ★프롬프트·생성 옵션은 **생성 모드에만** (사용자 지적 2026-08-05).
           이미 만든 것을 다루는 화면에 뜨면 "여기서 고치면 뭐가 되나"가 흐려진다.
           갤러리는 기둥을 쓴다(폴더·그림 정보). 검열·보조 도구는 **레일도 안 남긴다** —
           열 것이 없는 레일은 막다른 길이다. */
        hideLeft={mode !== "generate" && mode !== "gallery"}
        hideRight={mode !== "generate" && mode !== "gallery"}
        left={
          mode === "gallery" ? (
            <GalleryFolders />
          ) : (
            <LeftPanel onThumb={(section, img) => setThumbAsk({ type: "section", section, img })} />
          )
        }
        /* ★블록 저장소는 **프롬프트를 볼 때만** 뜻이 있다 — 갤러리에는 놓을 목록이 없다 */
        leftDrawer={mode === "generate" ? <BlockDrawer /> : undefined}
        /* 위 두 줄(싱글·멀티 · 캐릭터)만 세 기둥 위에. 포즈세트는 캔버스 위로 내려갔다 */
        /* ★워크스페이스 탭이 **위**, 싱글/멀티가 아래다. 검열·보조도구는 워크스페이스를
           안 쓰는 도구라 탭 줄을 감춘다 (사용자 지시 2026-08-08) */
        tabs={
          mode === "generate" || mode === "gallery" ? (
            <>
              <WorkspaceTabs onAdd={() => setGate(true)} />
              {mode === "generate" && <CanvasTabs part="top" />}
            </>
          ) : undefined
        }
        /* 최종 프롬프트 바로 아래, 패널 맨 밑에 **고정**. 접어도 버튼은 레일에 남는다 */
        leftFooter={mode === "generate" ? <GenerateFooter /> : undefined}
        leftFooterCompact={mode === "generate" ? <GenerateFooter compact /> : undefined}
        right={mode === "gallery" ? <GalleryMeta /> : <OptionsPanel />}
        center={
          mode === "generate" ? (
            <Canvas
              onOpenDeck={setDeck}
              onAskSave={setAsk}
              onImageToDeck={(kind, img) => setThumbAsk({ type: "cover", kind, img })}
            />
          ) : mode === "gallery" ? (
            <Gallery />
          ) : mode === "censor" ? (
            <Censor />
          ) : mode === "utility" ? (
            <Tools />
          ) : (
            <Placeholder mode={mode} />
          )
        }
      />
      {gate && <WorkspaceGate onClose={() => setGate(false)} />}
      <Deck kind={deck} onClose={() => setDeck(null)} />
      <SaveDialog
        ask={ask}
        onCancel={() => setAsk(null)}
        onOverwrite={() => {
          if (ask) void saveCardWithThumb(ask.kind, ask.card, ask.thumb);
          setAsk(null);
        }}
        onAddNew={() => {
          if (ask) void saveCardWithThumb(ask.kind, { ...ask.card, id: undefined }, ask.thumb);
          setAsk(null);
        }}
      />
      {/* ★key 로 목적지·그림마다 창을 새로 만든다 — 안에서 잡아 둔 위치가
          부모 재렌더에 초기화되지 않게 하는 유일한 안전한 방법이다 */}
      <ThumbDialog
        key={thumbAsk ? `${thumbAsk.type}:${"section" in thumbAsk ? thumbAsk.section : thumbAsk.kind}:${thumbAsk.img.file}` : "none"}
        ask={
          thumbAsk
            ? thumbAsk.type === "section"
              ? {
                  url: thumbAsk.img.url,
                  banner: defaultView(),
                  boxes: [{ key: "face", label: tGlobal("thumb.inCard"), w: 138, h: 118, view: defaultView() }],
                }
              : {
                  url: thumbAsk.img.url,
                  // 덱 커버는 핸드 카드(58×80)와 같은 비율 — 배너 미리보기는 필요 없다
                  boxes: [{ key: "cover", label: tGlobal("thumb.onCover"), w: 58, h: 80, view: defaultView() }],
                }
            : null
        }
        onCancel={() => setThumbAsk(null)}
        onDone={(r) => {
          const t = thumbAsk;
          setThumbAsk(null);
          if (!t) return;
          void (async () => {
            // ★어디에 걸든 먼저 **고정 썸네일 하나**로 굳힌다 — 배너·카드 앞면·덱 커버가
            //   전부 이 tid 를 가리킨다. 목적지마다 따로 굽지 않는다 (사용자 결정 2026-08-02).
            const tid = await pinImage(t.img.ws, t.img.file);
            if (!tid) return; // 실패는 thumbUpload 가 콘솔에 남긴다
            if (t.type === "section") {
              usePrompt.getState().setThumb(t.section, {
                tid,
                banner: r.banner ?? defaultView(),
                face: r.boxes.face ?? defaultView(),
              });
            } else {
              await setCover(t.kind, tid, r.boxes.cover ?? defaultView());
            }
          })();
        }}
      />
      {settings && (
        <Settings tab={settings} onClose={() => setSettings(null)} hasToken={!!health?.hasToken} />
      )}
      <AskDialog />
      <Toasts />
      <DragLayer />
    </WindowFrame>
  );
}

function Placeholder({ mode }: { mode: string }) {
  const t = useI18n((s) => s.t);
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--sp-2)",
        color: "var(--ink-faint)",
      }}
    >
      <div style={{ fontSize: "var(--text-lg)" }}>{t(`mode.${mode}`)}</div>
      <div style={{ fontSize: "var(--text-xs)" }}>{t("mode.comingSoon")}</div>
    </div>
  );
}

/** 큐 진행률 — 돌고 있을 때만 뜬다. 취소·비우기가 여기 붙는다. */
function QueueStatus() {
  const t = useI18n((s) => s.t);
  const { progress, cancel, clear } = useQueue();
  const running = progress.total > progress.completed;
  if (!running) return null;
  return (
    <span
      data-queue-status
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--sp-2)",
        padding: "0 var(--sp-4)",
        fontSize: "var(--text-2xs)",
        color: "var(--ink-dim)",
      }}
    >
      <b style={{ fontFamily: "var(--font-mono)", color: "var(--ink-soft)" }}>
        {progress.completed}/{progress.total}
      </b>
      {progress.queue_length > 0 && (
        <span title={t("queue.waiting", { n: progress.queue_length })}>+{progress.queue_length}</span>
      )}
      <button onClick={() => void cancel()} style={navBtn} title={t("queue.cancelHint")}>
        {t("queue.cancel")}
      </button>
      {progress.queue_length > 0 && (
        <button onClick={() => void clear()} style={navBtn} title={t("queue.clearHint")}>
          {t("queue.clear")}
        </button>
      )}
    </span>
  );
}

const navBtn: React.CSSProperties = {
  padding: "1px var(--sp-2)",
  borderRadius: "var(--r-1)",
  border: "1px solid var(--line)",
  color: "var(--ink-dim)",
  fontSize: "var(--text-2xs)",
};



function ThemeButton() {
  const theme = useTheme((s) => s.theme);
  const toggle = useTheme((s) => s.toggle);
  const t = useI18n((s) => s.t);
  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  return (
    <button
      onClick={toggle}
      title={dark ? t("window.themeToLight") : t("window.themeToDark")}
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "0 var(--sp-3)",
        color: "var(--ink-soft)",
        alignSelf: "stretch",
      }}
    >
      {dark ? Icon.sun : Icon.moon}
    </button>
  );
}

/** 켜는 동안 — **빈 화면을 보이지 않는다** (사용자 지시 2026-08-08).
 *
 *  실측(2026-08-08): 사이드카(파이썬)가 응답하기까지 **1.7초**. 개발 중에는 Vite 가 모듈
 *  107개를 하나씩 주느라 2.6초가 더 붙지만, **1.7초는 정식 빌드에서도 그대로 남는다** —
 *  그래서 표시가 필요하다.
 *  ★기다리는 것이 무엇인지 말한다. "로딩 중"만 뜨면 멈춘 것과 구분이 안 된다. */
function Booting({ ready, dead }: { ready: boolean; dead: boolean }) {
  const t = useI18n((s) => s.t);
  return (
    <div
      data-booting={dead ? "dead" : ready ? "workspace" : "backend"}
      style={{ display: "grid", justifyItems: "center", gap: "var(--sp-5)", padding: "var(--sp-8)" }}
    >
      <div
        style={{
          width: 26,
          height: 26,
          borderRadius: 6,
          display: "grid",
          placeItems: "center",
          background: dead ? "var(--err)" : "var(--accent)",
          color: "var(--accent-on)",
          fontSize: 14,
          fontWeight: "var(--w-bold)",
        }}
      >
        P
      </div>
      {/* 남은 시간을 알 수 없으므로 왕복만 한다 — 가짜 퍼센트를 그리지 않는다 */}
      <div style={{ width: 132, height: 2, borderRadius: 1, background: "var(--line)", overflow: "hidden" }}>
        {!dead && <div className="boot-bar" style={{ width: "34%", height: "100%", background: "var(--accent)" }} />}
      </div>
      <div style={{ fontSize: "var(--text-2xs)", color: "var(--ink-dim)", textAlign: "center", lineHeight: 1.6 }}>
        {dead ? t("boot.failed") : ready ? t("boot.workspace") : t("boot.backend")}
        {dead && (
          <>
            <br />
            <span style={{ color: "var(--ink-faint)", fontFamily: "var(--font-mono)" }}>logs/backend.err.log</span>
          </>
        )}
      </div>
    </div>
  );
}

function Status({ health, dead }: { health: Health | null; dead: boolean }) {
  const t = useI18n((s) => s.t);
  const color = health ? (health.hasToken ? "var(--ok)" : "var(--warn)") : dead ? "var(--err)" : "var(--ink-faint)";
  const label = health
    ? health.hasToken
      ? t("status.connected")
      : t("status.noToken")
    : dead
      ? t("status.backendFailed")
      : t("status.connecting");
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--sp-2)",
        fontSize: "var(--text-2xs)",
        color: "var(--ink-dim)",
        paddingRight: "var(--sp-2)",
      }}
    >
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: color }} />
      {label}
    </span>
  );
}

