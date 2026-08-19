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
import { Settings } from "./app/Settings";
import { useHealth, type Health } from "./store/health";
import { Toasts } from "./app/Toasts";
import { TipLayer } from "./components/Tip";
import { AskDialog } from "./app/AskDialog";
import { AiChat } from "./panels/AiChat";
import { Canvas } from "./panels/Canvas";
import { CanvasTabs } from "./panels/CanvasTabs";
import { Gallery } from "./panels/Gallery";
import { Censor } from "./panels/Censor";
import { Tools } from "./panels/Tools";
import { GalleryFolders } from "./panels/GalleryFolders";
import { GalleryMeta } from "./panels/GalleryMeta";
import { DeckPanel } from "./cards/DeckPanel";
import { DragLayer } from "./cards/DragLayer";
import { SaveDialog, type SaveAsk } from "./cards/SaveDialog";
import { useSub } from "./store/sub";
import { BlockDrawer } from "./blocks/BlockDrawer";
import { WildcardModal } from "./panels/WildcardModal";
import { useWildcards } from "./store/wildcards";
import { ThumbDialog } from "./cards/ThumbDialog";
import { saveCardWithThumb } from "./cards/saveCard";
import { pinImage, setCardThumb } from "./cards/thumbUpload";
import { usePrompt, defaultView } from "./store/prompt";
import { useCards, type AnyCard, type CardKind } from "./store/cards";
import type { DragImage } from "./cards/dragStore";

/** 위치 잡는 창이 겨눌 수 있는 목적지 — 섹션 배너 또는 **덱 카드 한 장**.
 *
 *  ★~~덱 안의 개별 카드는 여기서 못 바꾼다~~ (2026-08-19 사용자 결정으로 뒤집힘).
 *    예전에는 덱이 접힌 손패라 카드 한 장을 겨눌 자리가 없어서, 꺼내 고친 뒤 역드래그로
 *    덮어쓰는 것이 유일한 길이었다. 지금은 **덱이 오른쪽에 펼쳐져 있어** 카드가 그대로
 *    노출되므로 거기 바로 떨군다 (사용자 원문: *"이제 다 펼쳐져 있어서 바로 드롭해도 될듯.
 *    대신 해당 카드가 받을 수 있게 노출된 상태일 때만"*).
 *  ★종류당 하나였던 **덱 커버**는 그리던 손패와 함께 통째로 걷었다 (2026-08-19). */
type ThumbTarget =
  | { type: "section"; section: string; img: DragImage }
  | { type: "card"; kind: CardKind; card: AnyCard; img: DragImage };

export function App() {
  // ★백엔드 상태는 **스토어 하나**가 든다 — 보는 자리가 넷이다 (타이틀바 점 · 설정의 앱
  //   정보 · 부팅 화면 · 생성 푸터의 토큰 검사). 여기 지역 상태로 두면 못 내려간다.
  const health = useHealth((s) => s.health);
  const dead = useHealth((s) => s.dead);
  const mode = useUi((s) => s.mode);
  // ★여기서 구독해야 언어를 바꿨을 때 패널 머리글이 따라 바뀐다 (tGlobal 은 구독이 아니다)
  const tr = useI18n((s) => s.t);
  const initGen = useGen((s) => s.init);
  const connectQueue = useQueue((s) => s.connect);
  const initWs = useWs((s) => s.init);
  const wsCurrent = useWs((s) => s.current);
  const wsLoading = useWs((s) => s.loading);
  const loadCards = useCards((s) => s.load);
  const [ask, setAsk] = useState<SaveAsk | null>(null);
  const [thumbAsk, setThumbAsk] = useState<ThumbTarget | null>(null);
  // ★어느 탭으로 열지까지 담는다 — 연 자리가 곧 볼 탭이다 (AI 채팅 → LLM).
  //   ★상태는 `useUi` 에 있다: 여는 자리가 셋이라(톱니·엔진 칩·토큰 없이 생성) 프롭으로
  //   내리면 생성 푸터까지 세 겹을 지나야 한다.
  const settings = useUi((s) => s.settingsTab);
  const openSettings = useUi((s) => s.openSettings);
  const closeSettings = useUi((s) => s.closeSettings);
  // ★탭 줄의 「+」 — 게이트를 그 자리에서 띄운다 (워크스페이스를 닫지 않고 하나 더 연다)
  const [gate, setGate] = useState(false);

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
          useHealth.getState().set(h);
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
          // ★와일드카드 풀도 여기서 한 번 읽는다 (카드와 같은 공용 문서).
          //   ★**생성보다 먼저 준비돼야 한다.** 비어 있으면 `#이름` 이 그대로 프롬프트에
          //   나간다. 좌 패널에 매달면 패널을 접었을 때 안 읽힌다 (CLAUDE.md 「잊기 쉬운 것」).
          void useWildcards.getState().load().catch(() => {});
          return;
        } catch {
          await new Promise((r) => setTimeout(r, 400));
        }
      }
      if (alive) useHealth.getState().setDead(true);
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
          <TitleBar right={<Status />} />
          <div style={{ flex: 1, display: "grid", placeItems: "center" }}>
            {wsLoading && <Booting ready={!!health} dead={dead} />}
          </div>
        </div>
        {/* 아직 목록을 읽는 중이면 모달을 안 띄운다 — 부팅 때 한 번 깜빡인다 */}
        {!wsLoading && <WorkspaceGate />}
        <AskDialog />
        <Toasts />
        <TipLayer />
      </WindowFrame>
    );

  return (
    <WindowFrame>
      <Shell
        titleRight={
          <>
            <Status />
            {/* ★언어·글꼴·테마는 **설정 안**으로 모았다 — 자주 안 쓰는 것이 타이틀바를 채우고 있었다 */}
            <ThemeButton />
            <button
              data-settings-open
              onClick={() => openSettings("general")}
              data-tip={tr("settings.title")}
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
        ai={<AiChat onOpenSettings={() => openSettings("llm")} />}
        /* ★모드마다 양옆이 바뀐다 — 갤러리에서 프롬프트 편집기를 띄워 두면
           "지금 편집하는 것이 무엇인지"가 흐려진다 (갤러리는 과거를 보는 화면이다).
           머리글도 함께 바뀌어야 한다 — 안 그러면 "프롬프트" 아래 폴더가 뜬다. */
        leftLabel={
          /* ★인페인트라고 머리글이 바뀌지 않는다 — 칠하는 동안에도 **그 씬의 프롬프트**를
             고치는 것이 맞다 (사용자 지시 2026-08-19). 예전에는 여기서 사본을 편집했다. */
          mode === "gallery" ? tr("gallery.folders") : tr("panel.prompt")
        }
        rightLabel={mode === "gallery" ? tr("gallery.meta") : tr("panel.deck")}
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
        /* 캐릭터 줄만 세 기둥 위에. 씬 세트 줄은 캔버스 위로 내려갔다 */
        /* ★워크스페이스 탭이 **위**, 캐릭터가 아래다. 검열·보조도구는 워크스페이스를
           안 쓰는 도구라 탭 줄을 감춘다 (사용자 지시 2026-08-08).
           ★★**갤러리도 감춘다** (사용자 지시 2026-08-19) — 보관함은 워크스페이스와 무관한
             공용 자리라, 탭이 떠 있으면 그 워크스페이스의 것을 보는 줄 안다. */
        tabs={
          mode === "generate" ? (
            <>
              <WorkspaceTabs onAdd={() => setGate(true)} />
              <CanvasTabs part="top" />
            </>
          ) : undefined
        }
        /* 최종 프롬프트 바로 아래, 패널 맨 밑에 **고정**. 접어도 버튼은 레일에 남는다 */
        leftFooter={mode === "generate" ? <GenerateFooter /> : undefined}
        leftFooterCompact={mode === "generate" ? <GenerateFooter compact /> : undefined}
        right={
          mode === "gallery" ? (
            <GalleryMeta />
          ) : (
            <DeckPanel
              onAsk={setAsk}
              onImageDrop={(kind, card, img) => setThumbAsk({ type: "card", kind, card, img })}
            />
          )
        }
        center={
          mode === "generate" ? (
            <Canvas />
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
      <SaveDialog
        ask={ask}
        onCancel={() => setAsk(null)}
        onOverwrite={() => {
          // ★덮어쓰기는 **그 카드의 id 로** 간다 — 이름으로 찾은 그 장을 고치는 것이다
          //   (신원이 이름이 된 뒤로, 끌어온 카드의 id 는 다른 폴더 것일 수 있다)
          if (ask) void saveCardWithThumb(ask.kind, { ...ask.card, id: ask.existing.id }, ask.thumb);
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
        key={thumbAsk ? `${thumbAsk.type}:${"section" in thumbAsk ? thumbAsk.section : thumbAsk.card.id}:${thumbAsk.img.file}` : "none"}
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
                  // ★카드는 **배너로도 앞면으로도** 뜬다 (같은 tid, 보는 방식만 다르다) —
                  //   섹션과 같은 창을 쓴다. 덱 칸은 3:4 라 앞면 상자를 그 비율로 잡는다
                  banner: defaultView(),
                  boxes: [{ key: "face", label: tGlobal("thumb.inCard"), w: 110, h: 146, view: defaultView() }],
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
              // ★떨군 **그 카드**의 그림이 된다. 목록의 그 한 장만 갈아 끼운다
              const view = { banner: r.banner ?? defaultView(), face: r.boxes.face ?? defaultView() };
              const next = await setCardThumb(t.kind, t.card.id, tid, view);
              if (next) {
                const cur = useCards.getState()[t.kind];
                useCards.setState({
                  [t.kind]: cur.map((c) => (c.id === next.id ? { ...c, ...next } : c)),
                } as never);
              }
            }
          })();
        }}
      />
      {settings && (
        <Settings tab={settings} onClose={closeSettings} />
      )}
      {/* ★모달이라 어느 모드에서나 한 자리에 매단다. 확인 창(`AskDialog`)보다 **위에**
          두지 않는다. 닫을 때 저장 여부를 묻는 창이 이 위에 떠야 한다 */}
      <WildcardModal />
      <AskDialog />
      <Toasts />
      {/* 툴팁 층 — 화면 아무 데나 `data-tip` 을 달면 여기서 뜬다 (`components/Tip`) */}
      <TipLayer />
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

/** 큐 진행률 — 돌고 있을 때만 뜬다. 취소가 여기 붙는다. */
function QueueStatus() {
  const t = useI18n((s) => s.t);
  const { progress, cancelAll } = useQueue();
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
        <span data-tip={t("queue.waiting", { n: progress.queue_length })}>+{progress.queue_length}</span>
      )}
      {/* ★취소는 **버튼 하나**다 (사용자 결정 2026-08-18) — 생성 푸터와 같은 창구다 */}
      <button onClick={() => void cancelAll()} style={navBtn} data-tip={t("queue.cancelHint")}>
        {t("queue.cancel")}
      </button>
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
      data-tip={dark ? t("window.themeToLight") : t("window.themeToDark")}
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

function Status() {
  const t = useI18n((s) => s.t);
  const health = useHealth((s) => s.health);
  const dead = useHealth((s) => s.dead);
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

