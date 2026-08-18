import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { useGen } from "../store/gen";
import { useWs, takesOfScene, allCells, allScenes } from "../store/workspace";
import { SceneLane } from "./SceneLane";
import { useSceneFocus } from "../store/sceneFocus";
import { useUi } from "../store/ui";
import { CanvasTabs } from "./CanvasTabs";
import { useDropZone } from "../cards/dragStore";
import { cardIcon, zoneIcon } from "../cards/CardArt";
import type { PoseCard } from "../store/cards";
import { imgUrl } from "../lib/imgUrl";
import { Icon } from "../components/Icon";
import { toast } from "../store/toast";
import { ImageActions } from "./ImageActions";
import { MaskEditor } from "../components/MaskEditor";
import { useImageInput } from "../store/imageInput";
import { EnhanceDialog } from "./EnhanceDialog";
import { useGallery, type ImageMeta } from "../store/gallery";
import { api } from "../lib/backend";

/** 캔버스 — 씬 세트 줄 + 씬 무대 (마스크를 칠하는 동안에는 그 자리가 편집기다).
 *
 *  ★우하단 카드 핸드는 걷었다 (2026-08-16) — 덱이 오른쪽 기둥에 상시로 있다.
 *  ★**싱글 화면은 없다** (사용자 결정 2026-08-11). 탭은 언제나 씬 탭이고 옛 싱글 탭은
 *    열 때 옮겨진다 (`migrate` → `convertSingleTab`). 큰 그림·히스토리 줄·별표만 보기가
 *    있던 자리는 `SceneLane` + `ScenePreview` + `SceneActions` 가 이어받았다. */
export function Canvas() {
  const { activeTab } = useWs();
  /** ★마스크를 칠하는 동안 **이 자리가 편집기로 바뀐다** (사용자 결정 2026-08-13).
   *  모달로 띄우면 칠하는 동안 프롬프트도 결과도 못 본다. 생성 버튼은 그동안 「인페인트」다. */
  const editing = useImageInput((s) => s.editing);
  const tab = activeTab();
  if (!tab) return null;

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
      {/* ★씬 세트 줄 — 이 층이 가르는 것이 바로 아래 결과라 여기 붙는다 (사용자 제안 2026-08-05) */}
      <CanvasTabs part="sets" />
      <SetZone />

      {/* ★씬 칸 (2026-08-11) — 그릇 + 얹은 카드 + 씬 줄. 위는 **고른 한 장**의 프리뷰다 */}
      {editing ? <MaskEditor /> : <SceneStage />}

      {/* ★생성 바는 **좌측 프롬프트 패널 아래**로 옮겼다 (사용자 지시 2026-08-04).
          시드·장 수·Anlas 와 한자리에 있어야 누르기 전에 판단이 선다 — `GenerateFooter`. */}
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
  const [enhance, setEnhance] = useState<string[] | null>(null);
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
        onEnhance={() => setEnhance([file])}
        upscale={{ ws, file }}
        onKeep={async () => {
          try {
            const r = await useGallery.getState().keep(ws, file);
            toast(tr(r.removed ? "gallery.unkept" : "gallery.kept"));
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
      {enhance && <EnhanceDialog files={enhance} onClose={() => setEnhance(null)} />}
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
  const setTab = tab?.kind === "set" ? tab : null;
  const scene = setTab ? allScenes(setTab).find((x) => x.cell.id === cell) : null;
  // ★씬 줄과 **같은 창구**로 고른다 — 갈 씬이 없는 결과는 첫 씬이 받으므로(감사 D6),
  //   여기서 `takesOf` 를 쓰면 줄에는 보이는 그림을 휠로 못 넘긴다
  const shown =
    setTab && scene
      ? [...takesOfScene(records, setTab, allCells(setTab), scene.cell)]
          .filter((r) => !isDeleted(r.file))
          .reverse()
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
