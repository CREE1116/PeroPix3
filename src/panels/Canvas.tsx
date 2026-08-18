import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { useGen } from "../store/gen";
import { useWs, takesOf, allScenes } from "../store/workspace";
import { SceneLane } from "./SceneLane";
import { useSceneFocus } from "../store/sceneFocus";
import { useUi } from "../store/ui";
import { CanvasTabs } from "./CanvasTabs";
import { useDropZone, useDragSource, dragSourceStyle } from "../cards/dragStore";
import { cardIcon, zoneIcon } from "../cards/CardArt";
import type { PoseCard } from "../store/cards";
import { imgUrl, thumbUrlOf } from "../lib/imgUrl";
import { Icon } from "../components/Icon";
import { toast } from "../store/toast";
import { ImageActions } from "./ImageActions";
import { MaskEditor } from "../components/MaskEditor";
import { useImageInput } from "../store/imageInput";
import { EnhanceDialog } from "./EnhanceDialog";
import { useGallery, type ImageMeta } from "../store/gallery";
import { useQueue } from "../store/queue";
import { api } from "../lib/backend";

/** 캔버스 — 탭 줄 + 본문(싱글 / 세트 그리드 / 셀 라이트박스) + 생성 바.
 *  ★우하단 카드 핸드는 걷었다 (2026-08-16) — 덱이 오른쪽 기둥에 상시로 있다. */
export function Canvas() {
  const { current, select, base, preview } = useGen();
  const { records, current: ws, spec, activeTab, isStarred, isDeleted, toggleStar, toggleDeleted,
    undoSelection, deleteFiles } = useWs();
  /** ★여러 장을 한 번에 — Ctrl 은 하나씩, Shift 는 **범위** (페로픽스파이 `onThumbClick`) */
  const [sel, setSel] = useState<Set<string>>(() => new Set());
  const anchorRef = useRef<string | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const tr = useI18n((s) => s.t);
  const startDrag = useDragSource();
  const [enhance, setEnhance] = useState<string | null>(null);
  /** ★별표는 **거르는 장치**다 (사용자 지시 2026-08-05) — 내보내기 같은 것을 달지 않는다 */
  const [starOnly, setStarOnly] = useState(false);
  /** 큰 그림의 실제 해상도 — 페로픽스파이 `res-tag` 자리 (없으면 설정값으로 적는다) */
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  /** ★아직 안 나온 장 — 눌렀다는 신호이자 "어디에 생길지"다 (멀티의 queued 카드와 같은 것) */
  const pending = useQueue((q) => q.pending);
  /** ★마스크를 칠하는 동안 **이 자리가 편집기로 바뀐다** (사용자 결정 2026-08-13).
   *  모달로 띄우면 칠하는 동안 프롬프트도 결과도 못 본다. 생성 버튼은 그동안 「인페인트」다. */
  const editing = useImageInput((s) => s.editing);
  const tab = activeTab();
  if (!tab) return null;

  const isSet = tab.kind === "set";
  // 큰 화면은 원본, 아래 히스토리 줄은 썸네일 (lib/imgUrl 참조)
  const url = (f: string) => imgUrl(base, ws, f);
  const thumb = (f: string) => thumbUrlOf(base, ws, f);

  const all = takesOf(records, tab, null).filter((r) => !isDeleted(r.file));
  const takes = starOnly ? all.filter((r) => isStarred(r.file)) : all;
  const cur = takes.find((t) => t.file === current) ?? takes[takes.length - 1];
  // ★줄은 **최신이 왼쪽**이다 (사용자 지시 2026-08-05). 방금 나온 것을 찾아 눈이 끝까지
  //   갈 이유가 없다. 대기 칸은 그보다 더 왼쪽 — 곧 그 자리에 그림이 앉는다.
  const shown = [...takes].reverse();
  const waiting = tab.kind === "single" ? pending.filter((x) => x.tabId === tab.id) : [];
  /** 복제를 받을 수 있는 **다른 싱글 탭** (같은 워크스페이스 안) */
  const singleTabs = (spec?.tabs ?? []).filter((x) => x.kind === "single" && x.id !== tab.id);
  /** 큰 그림에서 휠 = 앞뒤 장 (페로픽스파이 `onPreviewWheel`).
   *
   *  ★**줄에 보이는 순서(`shown`)를 따른다** — 저장 순서(`takes`)로 세면 줄과 반대로 움직인다
   *    (사용자 지적 2026-08-05: 줄은 최신이 왼쪽인데 휠은 오래된 쪽부터 셌다).
   *    아래로 굴리면 줄에서 **오른쪽**(더 오래된 것)으로 간다. */
  const step = (d: 1 | -1) => {
    if (shown.length < 2) return;
    const i = shown.findIndex((t) => t.file === cur?.file);
    const next = shown[Math.min(shown.length - 1, Math.max(0, (i < 0 ? 0 : i) + d))];
    if (next) select(next.file);
  };

  /** 지금 보는 장을 목록에서 뺀다.
   *
   *  ★**파일은 지우지 않는다** — 목록에서 빼고 `Ctrl+Z` 로 되돌린다 (멀티 무대와 같은 규칙).
   *    페로픽스파이의 Delete 도 히스토리에서만 빼고 디스크의 파일은 남긴다.
   *  ★지우기 **전에** 선택을 옮긴다 (그쪽 `removeMany` 주석): 오른쪽(더 오래된 쪽)이
   *    먼저고, 없으면 왼쪽. 그래야 빈 화면이 깜빡이지 않는다. */
  const hideMany = (files: string[]) => {
    if (!files.length) return;
    const gone = new Set(files);
    // ★지우기 **전에** 선택을 옮긴다: 오른쪽(더 오래된 쪽) 먼저, 없으면 왼쪽
    if (cur && gone.has(cur.file)) {
      const i = shown.findIndex((t) => t.file === cur.file);
      const right = shown.slice(i + 1).find((t) => !gone.has(t.file));
      const left = [...shown.slice(0, i)].reverse().find((t) => !gone.has(t.file));
      select((right ?? left)?.file ?? null);
    }
    setSel(new Set());
    // ★지우면 **파일이 실제로 없어진다** — 휴지통으로 옮기고 Ctrl+Z 로 되돌린다
    //   (사용자 결정 2026-08-05 · backend/trash.py). 앱을 켤 때 24시간 지난 것이 비워진다.
    void deleteFiles(files);
  };

  /** 고른 것이 있으면 그것들을, 없으면 지금 보는 장을 (페로픽스파이 `deleteSelected`) */
  const hideCurrent = () => hideMany(sel.size ? [...sel] : cur ? [cur.file] : []);

  /** 썸네일 클릭 — Shift 범위 · Ctrl 토글 · 그냥 클릭은 보기 전환 */
  const onThumb = (e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }, file: string) => {
    if (e.shiftKey) {
      const anchor = anchorRef.current ?? cur?.file ?? null;
      const a = shown.findIndex((t) => t.file === anchor);
      const b = shown.findIndex((t) => t.file === file);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        setSel(new Set(shown.slice(lo, hi + 1).map((t) => t.file)));
        select(file);
        return;
      }
    }
    if (e.ctrlKey || e.metaKey) {
      const next = new Set(sel);
      // 빈 상태에서 다른 장을 Ctrl+클릭하면 **보던 것까지** 함께 고른다 (그쪽과 같은 배려)
      if (!next.size && cur && cur.file !== file) next.add(cur.file);
      next.has(file) ? next.delete(file) : next.add(file);
      setSel(next);
      select(file);
    } else {
      setSel(new Set());
      select(file);
    }
    anchorRef.current = file;
  };

  // ★키보드 — ←/→ 전환, Del 숨김, Ctrl+Z 되돌리기 (페로픽스파이 WorkbenchTab 의 키 처리).
  //   ★입력란에 커서가 있으면 **아무것도 하지 않는다** — 프롬프트를 고치다 Del 을 눌렀는데
  //     그림이 사라지면 안 된다.
  useEffect(() => {
    if (isSet) return;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (document.querySelector("[data-enhance], [data-prompt-view], [data-settings], [data-mask-editor]")) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
      else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); hideCurrent(); }
      else if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z")) { e.preventDefault(); undoSelection(); }
      else if (e.key === "Escape" && sel.size) { e.preventDefault(); setSel(new Set()); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // 보고 있는 장을 줄 안으로 (이미 보이면 안 움직인다)
  useEffect(() => {
    setDims(null); // ★선택이 바뀌면 해상도를 비운다 — 안 그러면 옛 값이 잠깐 남는다
    stripRef.current
      ?.querySelector<HTMLElement>(`[data-take="${CSS.escape(cur?.file ?? "")}"]`)
      ?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [cur?.file]);

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        position: "relative",
      }}
    >
      {/* ★포즈세트 줄 — 이 층이 가르는 것이 바로 아래 결과라 여기 붙는다 (사용자 제안 2026-08-05) */}
      <CanvasTabs part="sets" />
      <SetZone />

      {editing ? (
        // ★마스크 칠하기는 **씬 탭이든 옛 싱글 탭이든** 이 자리를 차지한다. 아래 갈래보다
        //   먼저 판정해야 한다. 지금 워크스페이스의 탭은 전부 씬 탭이다 (2026-08-11)
        <MaskEditor />
      ) : isSet ? (
        // ★씬 칸 (2026-08-11) — 그릇 + 얹은 카드 + 씬 줄. 옛 목차형 무대(`SlotResults`)를
        //   대신한다. 위는 **고른 한 장**의 프리뷰다 (「줄마다 한 장」은 안 쓰기로 했다).
        <SceneStage />
      ) : (
        <>
          <div
            style={{
              flex: 1,
              minHeight: 0,
              margin: "var(--sp-3) var(--sp-4)",
              // ★페로픽스파이 `.result-main` 과 같은 모양 — panel 바탕 + border 1px + radius 8.
              //   테두리가 있어야 그림 영역이 '올라온 면'으로 읽힌다.
              borderRadius: "var(--r-3)",
              border: "1px solid var(--line)",
              background: "var(--panel)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              position: "relative",
              overflow: "hidden",
            }}
            /* ★휠로 앞뒤 장 — 크게 보면서 견주는 리듬이 여기서 나온다 (페로픽스파이) */
            onWheel={(e) => {
              if (e.deltaY === 0) return;
              // ★그림을 넘기기 시작하면 = 그림을 다루려는 것 → 입력란 포커스를 푼다.
              //   그래야 이어지는 Del 이 프롬프트가 아니라 이 그림에 먹는다 (페로픽스파이 주석 그대로)
              const el = document.activeElement as HTMLElement | null;
              if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) el.blur();
              step(e.deltaY > 0 ? 1 : -1);
            }}
          >
            {cur ? (
              // ★큰 이미지도 배너로 끌 수 있다. 커서를 따라오는 고스트는 DragLayer 가
              //   작게 그리므로 화면이 가려지지 않는다 (목업 실측 요구).
              <img
                data-single-img={cur.file}
                src={url(cur.file)}
                alt=""
                draggable={false}
                onLoad={(e) => setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                onPointerDown={(e) =>
                  startDrag(e, {
                    dir: "image",
                    kind: "image",
                    img: { ws, file: cur.file, url: thumb(cur.file) },
                  })
                }
                style={{
                  maxWidth: "100%",
                  maxHeight: "100%",
                  objectFit: "contain",
                  cursor: "grab",
                  ...dragSourceStyle,
                }}
              />
            ) : preview ? (
              // ★자동 저장을 껐을 때 — **파일도 기록도 없는 그림**이라 여기 말고 뜰 자리가 없다
              //   (v2 `auto_save` 이식 2026-08-16). 씬 칸·갤러리에는 안 뜬다.
              <div style={{ position: "relative", maxWidth: "100%", maxHeight: "100%" }}>
                <img
                  data-preview-img
                  src={preview}
                  alt=""
                  draggable={false}
                  style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
                />
                <span
                  style={{
                    position: "absolute",
                    left: 8,
                    top: 8,
                    padding: "2px var(--sp-3)",
                    borderRadius: "var(--r-2)",
                    background: "rgba(0,0,0,0.6)",
                    color: "#fff",
                    fontSize: "var(--text-2xs)",
                  }}
                >
                  {tr("canvas.previewOnly")}
                </span>
              </div>
            ) : waiting.length ? (
              // ★기다리는 자리도 **자리를 차지한다** — 빈 화면이면 눌렀는지 알 수 없다
              <div data-single-placeholder style={{ textAlign: "center", color: "var(--ink-faint)" }}>
                <div style={{ fontSize: "var(--text-lg)", marginBottom: "var(--sp-2)" }}>
                  {tr("canvas.generating")}
                </div>
                <div style={{ fontSize: "var(--text-xs)" }}>{tr("queue.waiting", { n: waiting.length })}</div>
              </div>
            ) : (
              <div style={{ textAlign: "center", color: "var(--ink-faint)" }}>
                <div style={{ fontSize: "var(--text-lg)", marginBottom: "var(--sp-2)" }}>
                  {tr("canvas.noneYet")}
                </div>
                <div style={{ fontSize: "var(--text-xs)", display: "inline-flex", alignItems: "center", gap: "var(--sp-2)" }}>
                  {Icon.spark}
                  {tr("canvas.pressGenerate")}
                </div>
              </div>
            )}
            {/* ★별표 버튼은 **썸네일 우상단**으로 옮겼다 (사용자 지시 2026-08-05).
                큰 그림 위에 두면 지금 보는 한 장만 켤 수 있어, 견주며 고르는 흐름과 어긋난다.
                시드 배지도 뺐다 — 아래 줄의 누를 수 있는 시드와 겹친다. */}
          </div>

          {/* ★그림 **바로 아래** 한 줄 — 라이트박스·갤러리와 같은 줄이다 (ImageActions 머리 주석) */}
          {cur && (
            <div style={{ flexShrink: 0, padding: "0 var(--sp-4) var(--sp-3)" }}>
              <ImageActions
                url={url(cur.file)}
                name={cur.file.split("/").pop() ?? cur.file}
                seed={cur.seed}
                loadMeta={async () =>
                  (
                    await api<{ meta: ImageMeta | null }>(
                      `/api/gallery/${encodeURIComponent(ws)}/meta?file=${encodeURIComponent(cur.file)}`,
                    )
                  ).meta
                }
                dims={dims}
                revealPath={`${ws}/${cur.file}`}
                onEnhance={() => setEnhance(cur.file)}
                upscale={{ ws, file: cur.file }}
                onKeep={async () => {
                  try {
                    await useGallery.getState().keep(ws, cur.file);
                    toast(tr("gallery.kept"));
                  } catch (e) {
                    toast(String(e), "warn");
                  }
                }}
                /* ★별표만 보기는 **여기** 온다 (사용자 지시 2026-08-05) — 히스토리 줄에는
                   썸네일만 남기고, 별표 개수는 이 버튼 안에 괄호로 적는다. */
                extra={
                  <>
                  <CopySelect tabs={singleTabs} files={[cur.file]} onDone={() => {}} />
                  <button
                    data-single-delete
                    onClick={hideCurrent}
                    title={tr("canvas.hideHint")}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 3,
                      border: "1px solid var(--line)",
                      borderRadius: "var(--r-2)",
                      background: "var(--panel)",
                      padding: "3px var(--sp-3)",
                      fontSize: "var(--text-2xs)",
                      color: "var(--danger, var(--err))",
                    }}
                  >
                    {Icon.trash}
                    {tr("common.delete")}
                  </button>
                  <button
                    data-star-filter
                    onClick={() => setStarOnly((v) => !v)}
                    title={tr("canvas.starOnly")}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 3,
                      border: `1px solid ${starOnly ? "var(--warn)" : "var(--line)"}`,
                      borderRadius: "var(--r-2)",
                      background: "var(--panel)",
                      padding: "3px var(--sp-3)",
                      fontSize: "var(--text-2xs)",
                      color: starOnly ? "var(--warn)" : "var(--ink-soft)",
                    }}
                  >
                    {starOnly ? Icon.star12On : Icon.star12}
                    {tr("canvas.starOnly")} ({all.filter((x) => isStarred(x.file)).length})
                  </button>
                  </>
                }
              />
            </div>
          )}

          {enhance && <EnhanceDialog files={[enhance]} onClose={() => setEnhance(null)} />}

          {/* ★고른 것이 있을 때만 뜨는 줄 (페로픽스파이 `.multi-bar`) */}
          {sel.size > 0 && (
            <div
              data-multi-bar
              style={{
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                gap: "var(--sp-2)",
                margin: "0 var(--sp-4) var(--sp-2)",
                padding: "3px var(--sp-3)",
                borderRadius: "var(--r-2)",
                background: "var(--panel)",
                border: "1px solid var(--warn)",
                fontSize: "var(--text-2xs)",
                color: "var(--warn)",
              }}
            >
              <span>{tr("gallery.selected", { n: sel.size })}</span>
              <span style={{ flex: 1 }} />
              <CopySelect tabs={singleTabs} files={[...sel]} onDone={() => setSel(new Set())} />
              <button data-multi-delete onClick={hideCurrent} style={miniBtn}>
                {tr("common.delete")}
              </button>
              <button data-multi-clear onClick={() => setSel(new Set())} style={miniBtn}>
                {tr("gallery.clear")}
              </button>
            </div>
          )}

          {(takes.length > 0 || waiting.length > 0 || starOnly) && (
            <div
              ref={stripRef}
              /* ★썸네일 줄에서 휠 = **가로 스크롤** (페로픽스파이 `.history-strip`).
                 세로로 굴려도 줄이 옆으로 가야 손이 안 바뀐다. */
              onWheel={(e) => {
                if (e.deltaY !== 0) e.currentTarget.scrollLeft += e.deltaY;
              }}
              style={{
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                gap: "var(--sp-2)",
                padding: "0 var(--sp-4) var(--sp-3)",
                overflowX: "auto",
              }}
            >
              {/* ★대기 칸 — 맨 왼쪽. 첫 칸이 **지금 만드는 중**이다 (큐 순서 그대로) */}
              {waiting.map((w, i) => (
                <div
                  key={w.id}
                  data-pending-cell
                  style={{
                    flexShrink: 0,
                    width: 64,
                    height: 64,
                    borderRadius: "var(--r-2)",
                    border: `2px dashed ${i === 0 ? "var(--accent)" : "var(--line)"}`,
                    background: "var(--surface2)",
                    display: "grid",
                    placeItems: "center",
                    fontSize: "var(--text-2xs)",
                    color: i === 0 ? "var(--accent)" : "var(--ink-faint)",
                  }}
                >
                  {i === 0 ? Icon.spark : "…"}
                </div>
              ))}
              {shown.map((t) => (
                <button
                  key={t.file}
                  // 생성물을 왼쪽 배너로 끌면 카드 그림이 된다.
                  // ★클릭(선택)은 onClick 이 아니라 onTap — pointerdown 의 preventDefault 가
                  //   호환 click 이벤트를 삼키기 때문이다
                  onPointerDown={(e) =>
                    startDrag(
                      e,
                      { dir: "image", kind: "image", img: { ws, file: t.file, url: thumb(t.file) } },
                      undefined,
                      () => onThumb(e, t.file),
                    )
                  }
                  data-take={t.file}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    toggleDeleted(t.file);
                  }}
                  title={tr("canvas.takeDragHint", { seed: t.seed })}
                  style={{
                    position: "relative",
                    flexShrink: 0,
                    // ★정사각 크롭 (사용자 지시 2026-08-05) — 세로·가로 그림이 섞여도 줄이 고르다
                    width: 64,
                    height: 64,
                    borderRadius: "var(--r-2)",
                    border: `2px solid ${
                      sel.has(t.file) ? "var(--warn)" : t.file === cur?.file ? "var(--accent)" : "transparent"
                    }`,
                    overflow: "hidden",
                    background: "var(--surface2)",
                    ...dragSourceStyle,
                  }}
                >
                  {/* ★썸네일을 쓴다 — 여긴 56×76 이고 장수가 계속 는다.
                      lazy·async 는 수십 장이 한꺼번에 뜰 때 첫 그림이 늦지 않게 한다. */}
                  <img
                    src={thumb(t.file)}
                    alt=""
                    draggable={false}
                    loading="lazy"
                    decoding="async"
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      display: "block",
                      opacity: sel.has(t.file) ? 0.6 : 1,
                    }}
                  />
                  {/* ★여기서 **켜고 끈다** (페로픽스파이 `.thumb-star`). 켜진 것은 늘 보이고,
                      꺼진 것은 그 칸에 커서를 올렸을 때만 보인다 — 줄이 별표로 뒤덮이지 않게. */}
                  <span
                    data-thumb-star={t.file}
                    title={tr("canvas.star")}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      toggleStar(t.file);
                    }}
                    style={{
                      position: "absolute",
                      right: 1,
                      top: 0,
                      padding: "1px 2px",
                      borderRadius: 3,
                      background: "rgba(10,14,20,0.55)",
                      color: isStarred(t.file) ? "var(--warn)" : "rgba(255,255,255,0.8)",
                      display: "grid",
                      opacity: isStarred(t.file) ? 1 : 0,
                      transition: "opacity 120ms",
                    }}
                    className="thumb-star"
                  >
                    {isStarred(t.file) ? Icon.star12On : Icon.star12}
                  </span>
                </button>
              ))}
              {starOnly && !takes.length && (
                <span style={{ fontSize: "var(--text-2xs)", color: "var(--ink-faint)" }}>
                  {tr("canvas.noStarred")}
                </span>
              )}
              {/* ★줄에는 **썸네일만** 둔다 (사용자 지시 2026-08-05). 장수는 탭 이름 뒤 괄호로,
                  별표 수는 아래 줄의 「별표만 보기」 버튼 안으로 갔다. */}
            </div>
          )}
        </>
      )}

      {/* ★생성 바는 **좌측 프롬프트 패널 아래**로 옮겼다 (사용자 지시 2026-08-04).
          시드·장 수·Anlas 와 한자리에 있어야 누르기 전에 판단이 선다 — `GenerateFooter`.
          ★여기 있던 「별표만 내보내기」는 **폐기**했다 (사용자 지시 2026-08-05) — 별표의 쓸모는
          거르기 하나이고, 파일을 옮기는 일은 보조 도구 › 파일 관리가 한다. */}

    </div>
  );
}

/** 씬 무대 — 위는 **고른 한 장**, 아래는 씬 칸. 사이를 손잡이로 끈다.
 *
 *  ★씬 칸은 **빈 자리를 남기지 않는다** — 내용이 짧으면 그만큼으로 줄어든다. 다만 카드가
 *    하나도 없을 때는 안 줄인다: 그릇이 있다는 것과 「씬 카드 추가하기」가 설 자리가 필요하다. */
function SceneStage() {
  const { laneHeight, setLaneHeight } = useUi();
  const grip = useRef<HTMLDivElement>(null);
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <ScenePreview />
      <SceneActions />
      <div
        ref={grip}
        data-lane-grip
        onPointerDown={(e) => {
          grip.current?.setPointerCapture(e.pointerId);
          const y0 = e.clientY;
          const h0 = laneHeight;
          const move = (ev: PointerEvent) => setLaneHeight(h0 + (y0 - ev.clientY));
          const up = () => {
            grip.current?.removeEventListener("pointermove", move);
            grip.current?.removeEventListener("pointerup", up);
            useUi.getState().commitLayout();
          };
          grip.current?.addEventListener("pointermove", move);
          grip.current?.addEventListener("pointerup", up);
        }}
        style={{
          flexShrink: 0,
          height: 11,
          margin: "var(--sp-3) var(--sp-4) 0",
          cursor: "row-resize",
          display: "grid",
          placeItems: "center",
          position: "relative",
        }}
      >
        <span
          style={{
            width: 44,
            height: 5,
            borderRadius: 3,
            background: "var(--line-strong)",
            opacity: 0.85,
          }}
        />
      </div>
      <div style={{ flexShrink: 0, height: laneHeight, display: "flex", minHeight: 0, minWidth: 0 }}>
        <SceneLane />
      </div>
    </div>
  );
}

/** 그림 **바로 아래** 한 줄 — 저장·강화·삭제·갤러리 보관.
 *
 *  ★싱글 화면이 없어지면서 갈 곳이 사라진 것들이라 여기로 옮겼다 (CLAUDE.md 의
 *    「시안에 없다고 지우면 안 되는 것이 있었다」 — 화면을 갈아 끼울 때마다 밟는 자리다). */
function SceneActions() {
  const tr = useI18n((s) => s.t);
  const { base } = useGen();
  const { current: ws, records, deleteFiles } = useWs();
  const file = useSceneFocus((s) => s.file);
  const [enhance, setEnhance] = useState<string | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => setDims(null), [file]);
  if (!file) return null;
  const rec = records.find((r) => r.file === file);
  return (
    <div style={{ flexShrink: 0, padding: "var(--sp-3) var(--sp-4) 0" }}>
      <ImageActions
        url={imgUrl(base, ws, file)}
        name={file.split("/").pop() ?? file}
        seed={rec?.seed ?? 0}
        loadMeta={async () =>
          (
            await api<{ meta: ImageMeta | null }>(
              `/api/gallery/${encodeURIComponent(ws)}/meta?file=${encodeURIComponent(file)}`,
            )
          ).meta
        }
        dims={dims}
        revealPath={`${ws}/${file}`}
        onEnhance={() => setEnhance(file)}
        upscale={{ ws, file }}
        onKeep={async () => {
          try {
            await useGallery.getState().keep(ws, file);
            toast(tr("gallery.kept"));
          } catch (e) {
            toast(String(e), "warn");
          }
        }}
        extra={
          <button
            data-scene-delete
            onClick={() => {
              void deleteFiles([file]);
              useSceneFocus.getState().focus(useSceneFocus.getState().cell, null);
            }}
            title={tr("canvas.hideHint")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              border: "1px solid var(--line)",
              borderRadius: "var(--r-2)",
              background: "var(--panel)",
              padding: "3px var(--sp-3)",
              fontSize: "var(--text-2xs)",
              color: "var(--danger, var(--err))",
            }}
          >
            {Icon.trash}
            {tr("common.delete")}
          </button>
        }
      />
      {enhance && <EnhanceDialog files={[enhance]} onClose={() => setEnhance(null)} />}
    </div>
  );
}

/** 고른 한 장 — 씬 칸에서 고른 결과를 크게. 아무것도 안 골랐으면 안내만 */
function ScenePreview() {
  const tr = useI18n((s) => s.t);
  const { base } = useGen();
  const ws = useWs((s) => s.current);
  const { records, activeTab, isDeleted } = useWs();
  const cell = useSceneFocus((s) => s.cell);
  const file = useSceneFocus((s) => s.file);

  /** ★휠로 앞뒤 장 (사용자 지시 2026-08-14, 싱글 큰 그림과 같은 조작).
   *
   *  ★**씬 줄에 보이는 순서를 따른다.** 줄은 최신이 왼쪽이므로, 아래로 굴리면
   *    오른쪽(더 오래된 것)으로 간다. 저장 순서로 세면 줄과 반대로 움직인다
   *    (싱글 쪽에서 한 번 밟은 함정이다). */
  const tab = activeTab();
  const scene = tab?.kind === "set" ? allScenes(tab).find((x) => x.cell.id === cell) : null;
  const shown = scene
    ? [...takesOf(records, tab!, scene.cell)].filter((r) => !isDeleted(r.file)).reverse()
    : [];
  const step = (d: 1 | -1) => {
    if (shown.length < 2) return;
    const i = shown.findIndex((r) => r.file === file);
    const next = shown[Math.min(shown.length - 1, Math.max(0, (i < 0 ? 0 : i) + d))];
    if (next && next.file !== file) useSceneFocus.getState().focus(cell, next.file);
  };

  return (
    <div
      data-scene-preview
      onWheel={(e) => {
        if (e.deltaY === 0) return;
        step(e.deltaY > 0 ? 1 : -1);
      }}
      style={{
        flex: 1,
        minHeight: 0,
        margin: "var(--sp-3) var(--sp-4) 0",
        borderRadius: "var(--r-3)",
        border: "1px solid var(--line)",
        background: "var(--panel)",
        display: "flex",
        alignItems: "stretch",
        padding: "var(--sp-4)",
        overflow: "hidden",
      }}
    >
      {file ? (
        <img
          data-scene-img={file}
          data-scene-pos={`${shown.findIndex((r) => r.file === file) + 1}/${shown.length}`}
          src={imgUrl(base, ws, file)}
          alt=""
          draggable={false}
          style={{ width: "100%", height: "100%", objectFit: "contain", borderRadius: "var(--r-1)" }}
        />
      ) : (
        <div
          style={{
            flex: 1,
            display: "grid",
            placeItems: "center",
            color: "var(--ink-faint)",
            fontSize: "var(--text-md)",
          }}
        >
          {tr("scenes.pickOne")}
        </div>
      )}
    </div>
  );
}

/** 포즈세트 카드의 드롭 존 — **탭 줄 + 캔버스 상단**.
 *  ★상단만 받는 이유: 시작 지점(덱은 화면 가운데)과 겹치면 드래그를 시작하는 순간 이미
 *    강조돼 "지금 떼면 여기" 신호가 죽는다. */
function SetZone() {
  const tr = useI18n((s) => s.t);
  const addSetTab = useWs((s) => s.addSetTab);
  const { ref, over, active } = useDropZone({
    id: "canvas-setzone",
    kind: "posesets",
    onDrop: (d) => {
      const c = d.card as PoseCard;
      addSetTab(c.name, c.cells);
    },
  });
  if (!active) return null;
  return (
    <div
      ref={ref}
      data-zone="set"
      title={tr("cards.zoneSet")}
      style={{
        position: "absolute",
        top: 6,
        left: 10,
        right: 10,
        height: "32%",
        zIndex: 32,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 9,
        color: "#fff",
        fontSize: "0.8rem",
        fontWeight: "var(--w-bold)",
        boxSizing: "border-box",
        border: `3px ${over ? "solid" : "dashed"} #fff`,
        borderRadius: 12,
        background: over ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.08)",
      }}
    >
      <span style={{ display: "flex" }}>{cardIcon("posesets", 20)}</span>
      {zoneIcon.add(20)}
    </div>
  );
}

/** 「다른 워크스페이스로 복제」 — 원본은 그대로 두므로 보던 화면·선택이 안 흐트러진다
 *  (페로픽스파이 `copySelect`). ★워크스페이스가 하나뿐이면 아예 안 뜬다. */
function CopySelect({
  tabs,
  files,
  onDone,
}: {
  /** 받을 수 있는 **다른 싱글 탭**들 (지금 탭은 빼고) */
  tabs: { id: string; name: string }[];
  files: string[];
  onDone: () => void;
}) {
  const tr = useI18n((s) => s.t);
  if (!tabs.length || !files.length) return null;
  return (
    <select
      data-copy-ws
      value=""
      title={tr("canvas.copyToHint")}
      onChange={async (e) => {
        const id = e.target.value;
        e.currentTarget.value = "";
        const target = tabs.find((x) => x.id === id);
        if (!target) return;
        try {
          const n = await useWs.getState().copyTo(files, target);
          toast(tr("canvas.copied", { n, name: target.name }));
          onDone();
        } catch (err) {
          toast(String(err), "warn");
        }
      }}
      style={{
        border: "1px solid var(--line)",
        borderRadius: "var(--r-2)",
        background: "var(--panel)",
        color: "var(--ink-soft)",
        padding: "2px var(--sp-2)",
        fontSize: "var(--text-2xs)",
      }}
    >
      <option value="">{tr("canvas.copyTo")}</option>
      {tabs.map((x) => (
        <option key={x.id} value={x.id}>
          {x.name}
        </option>
      ))}
    </select>
  );
}

const miniBtn: React.CSSProperties = {
  border: "1px solid currentColor",
  borderRadius: "var(--r-1)",
  padding: "1px var(--sp-2)",
  fontSize: "var(--text-2xs)",
  color: "inherit",
};
