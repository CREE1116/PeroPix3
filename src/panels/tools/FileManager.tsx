import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import { useFiles, type FileNode } from "../../store/files";
import { useGen } from "../../store/gen";
import { useUi } from "../../store/ui";
import { fileMgrImg, fileMgrThumb } from "../../lib/imgUrl";
import { ask } from "../../store/ask";
import { toast } from "../../store/toast";
import { Icon } from "../../components/Icon";
import { useConvertQueue } from "./ConvertTool";
import { onNearBottom } from "../../lib/nearBottom";

/** 파일 관리 — **아웃풋 폴더를 그대로** 연다 (v2 `보조 도구 › 파일 관리`).
 *
 *  ★갤러리처럼 그림을 쭉 늘어놓지 않는다. 왼쪽은 **폴더 트리**, 오른쪽은 **그 폴더 안**이다 —
 *    탐색기와 같은 그림이라야 "내 파일이 어디 있는지"가 보인다 (사용자 지적 2026-08-05).
 *  ★워크스페이스를 넘는다. 트리의 첫 층이 워크스페이스라, 작업 사이로 파일을 옮길 수 있다.
 *  ★옮기기는 **트리에 떨궈서** 한다. 겹치는 이름은 덮지 않고 번호가 붙는다.
 *  ★고르는 법도 탐색기와 같다 (v2 `fmHandleFileClick`): 맨 클릭은 하나, **Ctrl 은 토글**,
 *    **Shift 는 앵커부터 범위**, 그림 위를 끌면 훑은 만큼. 판정은 `store/files.ts` 가 한다.
 *  ★격자에 **하위 폴더를 섞지 않는다** (CLAUDE.md 「의도된 차이」). 계층은 왼쪽 트리가 맡는다.
 */
export function FileManager({ onConvert }: { onConvert: () => void }) {
  const t = useI18n((s) => s.t);
  const base = useGen((s) => s.base);
  const { tree, rootCount, folder, items, picked, open, total, hasMore, loadTree, go, more, toggleOpen, pick,
    pickRange, pickAll, clearPick } = useFiles();
  const view = useUi((s) => s.fmView);
  const setView = useUi((s) => s.setFmView);
  const pipOn = useUi((s) => s.fmPip);
  const setPip = useUi((s) => s.setFmPip);
  const onScroll = onNearBottom(() => void more());
  const [over, setOver] = useState<string | null>(null);
  /** 폴더 행의 ⋮ 메뉴 — 열려 있는 폴더 경로 하나 */
  const [menu, setMenu] = useState<string | null>(null);
  /** 커서를 따라다니는 큰 그림 (v2 `fmPipPreview`) */
  const [pip, setPip2] = useState<{ src: string; x: number; y: number } | null>(null);
  /** 훑어 고르기 — 시작 칸과 "정말 움직였나". null 이면 안 끌고 있다 */
  const drag = useRef<{ start: number; moved: boolean } | null>(null);
  /** ★훑고 나서 따라오는 click 은 한 번 삼킨다 — 안 삼키면 뗀 자리 한 장만 남는다
   *  (캔버스 마키와 같은 함정. CLAUDE.md 「감싼 뒤 따라오는 click」). */
  const swallow = useRef(false);

  useEffect(() => {
    void loadTree().then(() => useFiles.getState().go(useFiles.getState().folder));
  }, [loadTree]);

  // ★끄면 떠 있던 것도 함께 내린다 — 남아 있으면 화면 위에 그림이 박힌다
  useEffect(() => {
    if (!pipOn) setPip2(null);
  }, [pipOn]);

  const move = async (dest: string) => {
    const files = [...picked];
    if (!files.length) return;
    await useFiles.getState().move(files, dest);
    toast(t("files.moved", { n: files.length }));
  };

  /** 폴더를 폴더 안으로 — ★막는 것은 **기계적으로 확실한 것**뿐이다:
   *  자기 자신 · 자기 하위(순환) · 이미 그 아래(제자리). 나머지는 서버가 판단한다. */
  const moveFolder = async (src: string, dest: string) => {
    if (!src || src === dest) return;
    if (dest === src || dest.startsWith(src + "/")) return toast(t("files.moveIntoSelf"), "warn");
    const parent = src.includes("/") ? src.slice(0, src.lastIndexOf("/")) : "";
    if (parent === dest) return;
    try {
      await useFiles.getState().move([src], dest);
      toast(t("files.moved", { n: 1 }));
      if (folder === src || folder.startsWith(src + "/")) await go(dest);
    } catch (e) {
      toast(String(e), "warn");
    }
  };

  const remove = async () => {
    if (
      !(await ask({
        title: t("files.deleteConfirm", { n: picked.size }),
        body: t("common.cannotUndo"),
        ok: t("common.delete"),
        cancel: t("common.cancel"),
        danger: true,
      }))
    )
      return;
    await useFiles.getState().remove([...picked]);
  };

  const removeFolder = async (path: string) => {
    setMenu(null);
    if (
      !(await ask({
        title: t("files.deleteFolderConfirm", { s: path.split("/").pop() || path }),
        body: t("files.deleteFolderBody"),
        ok: t("common.delete"),
        cancel: t("common.cancel"),
        danger: true,
      }))
    )
      return;
    try {
      await useFiles.getState().remove([path]);
      if (folder === path || folder.startsWith(path + "/")) await go("");
    } catch (e) {
      toast(String(e), "warn");
    }
  };

  const rename = async () => {
    const file = [...picked][0];
    if (!file) return;
    const cur = file.split("/").pop() || "";
    const next = window.prompt(t("files.renamePrompt"), cur);
    if (!next || next === cur) return;
    try {
      await useFiles.getState().rename(file, next);
    } catch (e) {
      toast(String(e), "warn");
    }
  };

  const sendToConvert = () => {
    const rows = items.filter((i) => picked.has(i.file));
    if (!rows.length) return;
    useConvertQueue.getState().add(rows.map((r) => ({ name: r.name, rel: r.file })));
    clearPick();
    onConvert();
  };

  /** 칸 하나에 붙는 손잡이 — 격자와 목록이 **같은 것**을 쓴다 (조작이 갈리면 안 된다).
   *
   *  ★훑어 고르기(v2 `fmStartDragSelect`)는 **이미 고른 칸 위에서는 시작하지 않는다** —
   *    거기서는 바깥으로 끌어 옮기는 것이 뜻이다. Shift 를 눌렀을 때도 비켜 간다. */
  const cellProps = (i: number, file: string) => ({
    "data-fm-item": file,
    // ★**고른 칸만 끌 수 있다** (v2 와 같은 갈래). 고르지 않은 칸에서 끄는 것은 「훑어 고르기」라,
    //   둘 다 열어 두면 브라우저가 언제나 네이티브 드래그를 가져가 훑기가 아예 안 된다.
    //   v2 는 pointerdown 에서 preventDefault 로 막았는데, 그러면 click 이 통째로 사라진다
    //   (CLAUDE.md ★절) — `draggable` 을 갈라 주는 쪽이 같은 결과를 부작용 없이 낸다.
    draggable: picked.has(file),
    onDragStart: (e: React.DragEvent) => {
      setPip2(null);
      drag.current = null;
      e.dataTransfer.effectAllowed = "move";
    },
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0 || e.shiftKey || picked.has(file)) return;
      drag.current = { start: i, moved: false };
    },
    onPointerEnter: (e: React.PointerEvent) => {
      const d = drag.current;
      if (d) {
        if (i !== d.start) d.moved = true;
        pickRange(d.start, i);
      } else if (pipOn) setPip2({ src: fileMgrImg(base, file), x: e.clientX, y: e.clientY });
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (pipOn && !drag.current) setPip2((p) => (p ? { ...p, x: e.clientX, y: e.clientY } : p));
    },
    onPointerLeave: () => setPip2(null),
    onClick: (e: React.MouseEvent) => {
      if (swallow.current) return void (swallow.current = false);
      pick(i, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey });
    },
    title: file.split("/").pop(),
  });

  const Row = ({ node, depth }: { node: FileNode; depth: number }) => {
    const on = folder === node.path;
    const opened = open.has(node.path);
    return (
      <>
        <div
          data-folder={node.path}
          draggable
          onDragStart={(e) => {
            e.stopPropagation();
            e.dataTransfer.setData("application/x-fm-folder", node.path);
            e.dataTransfer.effectAllowed = "move";
          }}
          onClick={() => void go(node.path)}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(node.path);
          }}
          onDragLeave={() => setOver((p) => (p === node.path ? null : p))}
          onDrop={(e) => {
            e.preventDefault();
            setOver(null);
            const src = e.dataTransfer.getData("application/x-fm-folder");
            void (src ? moveFolder(src, node.path) : move(node.path));
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: `2px var(--sp-2) 2px ${8 + depth * 12}px`,
            borderRadius: "var(--r-1)",
            fontSize: "var(--text-2xs)",
            cursor: "pointer",
            color: on ? "var(--ink)" : "var(--ink-soft)",
            background: over === node.path ? "var(--accent-bg)" : on ? "var(--raise)" : undefined,
            outline: over === node.path ? "1px solid var(--accent)" : undefined,
          }}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleOpen(node.path);
            }}
            style={{
              width: 14,
              display: "grid",
              placeItems: "center",
              color: "var(--ink-faint)",
              visibility: node.children.length ? "visible" : "hidden",
            }}
          >
            {opened ? Icon.chevronDown : Icon.chevronRight}
          </button>
          <span style={{ display: "grid", color: on ? "var(--accent)" : "var(--ink-faint)" }}>
            {opened && node.children.length ? Icon.folderOpen : Icon.folder}
          </span>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {node.name}
          </span>
          {!!node.count && (
            <span style={{ color: "var(--ink-faint)", fontVariantNumeric: "tabular-nums" }}>{node.count}</span>
          )}
          {/* ⋮ — 폴더에 할 수 있는 일. 지금은 삭제 하나뿐이라 눌러야 뜬다 (v2 도 같다) */}
          <button
            data-folder-menu={node.path}
            onClick={(e) => {
              e.stopPropagation();
              setMenu(node.path);
            }}
            title={t("files.folderMenu")}
            style={{ display: "grid", placeItems: "center", color: "var(--ink-faint)" }}
          >
            {Icon.dots}
          </button>
        </div>
        {menu === node.path && (
          <div
            style={{
              margin: `0 var(--sp-2) 2px ${8 + depth * 12}px`,
              border: "1px solid var(--line)",
              borderRadius: "var(--r-2)",
              background: "var(--panel)",
              padding: 2,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <button
              data-folder-delete={node.path}
              onClick={(e) => {
                e.stopPropagation();
                void removeFolder(node.path);
              }}
              style={{
                textAlign: "left",
                padding: "3px var(--sp-2)",
                borderRadius: "var(--r-1)",
                fontSize: "var(--text-2xs)",
                color: "var(--err)",
              }}
            >
              {t("common.delete")}
            </button>
          </div>
        )}
        {opened && node.children.map((c) => <Row key={c.path} node={c} depth={depth + 1} />)}
      </>
    );
  };

  return (
    <div
      style={{ flex: 1, minHeight: 0, display: "flex", gap: "var(--sp-4)" }}
      // ★끌기는 어디서 떼든 끝나야 한다 — 칸 밖에서 떼면 시작 칸에 갇힌다
      onPointerUp={() => {
        if (drag.current?.moved) swallow.current = true;
        drag.current = null;
      }}
      onPointerLeave={() => (drag.current = null)}
      // ⋮ 메뉴는 **바깥을 누르면 닫힌다** (pointerdown 이 click 보다 먼저라 여는 것은 안 막는다)
      onPointerDown={() => setMenu(null)}
    >
      {/* 왼쪽 — 폴더 트리 */}
      <div
        style={{
          width: 230,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          gap: "var(--sp-2)",
          background: "var(--panel)",
          border: "1px solid var(--line)",
          borderRadius: "var(--r-3)",
          padding: "var(--sp-2)",
        }}
      >
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          <div
            data-folder=""
            onClick={() => void go("")}
            onDragOver={(e) => {
              e.preventDefault();
              setOver("");
            }}
            onDragLeave={() => setOver((p) => (p === "" ? null : p))}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const src = e.dataTransfer.getData("application/x-fm-folder");
              void (src ? moveFolder(src, "") : move(""));
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "2px var(--sp-2)",
              borderRadius: "var(--r-1)",
              fontSize: "var(--text-2xs)",
              cursor: "pointer",
              color: folder === "" ? "var(--ink)" : "var(--ink-soft)",
              background: over === "" ? "var(--accent-bg)" : folder === "" ? "var(--raise)" : undefined,
            }}
          >
            <span style={{ width: 14 }} />
            <span style={{ display: "grid", color: "var(--ink-faint)" }}>{Icon.folderOpen}</span>
            <span style={{ flex: 1 }}>{t("files.root")}</span>
            {!!rootCount && <span style={{ color: "var(--ink-faint)" }}>{rootCount}</span>}
          </div>
          {tree.map((n) => (
            <Row key={n.path} node={n} depth={0} />
          ))}
        </div>
        <button data-mkdir onClick={() => void newFolder(folder, t)} style={{ ...box, width: "100%" }}>
          {t("files.newFolder")}
        </button>
      </div>

      {/* 오른쪽 — 그 폴더 안 */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", flexWrap: "wrap" }}>
          {/* 보기 — 격자 / 목록. 둘은 **같은 목록**을 다르게 그릴 뿐이다 */}
          <span style={{ display: "flex", gap: 2 }}>
            <button
              data-fm-view="grid"
              onClick={() => setView("grid")}
              title={t("files.viewGrid")}
              style={{ ...iconBtn, ...(view === "grid" ? onSt : {}) }}
            >
              {Icon.grid}
            </button>
            <button
              data-fm-view="list"
              onClick={() => setView("list")}
              title={t("files.viewList")}
              style={{ ...iconBtn, ...(view === "list" ? onSt : {}) }}
            >
              {Icon.list}
            </button>
            <button
              data-fm-pip
              onClick={() => setPip(!pipOn)}
              title={t("files.pip")}
              style={{ ...iconBtn, ...(pipOn ? onSt : {}) }}
            >
              {Icon.pip}
            </button>
          </span>
          <span style={{ fontSize: "var(--text-xs)", color: "var(--ink-soft)", fontWeight: "var(--w-semi)" }}>
            {folder || t("files.root")}
          </span>
          <span style={{ fontSize: "var(--text-2xs)", color: "var(--ink-faint)" }}>
            {t("files.count", { n: total || items.length })}
          </span>
          <span style={{ flex: 1 }} />
          {!!picked.size && (
            <>
              <span style={{ fontSize: "var(--text-2xs)", color: "var(--ink-faint)" }}>
                {t("slots.picked", { n: picked.size })}
              </span>
              <button data-fm-convert onClick={sendToConvert} style={box}>
                {t("files.toConvert")}
              </button>
              {picked.size === 1 && (
                <button data-fm-rename onClick={() => void rename()} style={box}>
                  {t("files.rename")}
                </button>
              )}
              <button data-fm-delete onClick={() => void remove()} style={{ ...box, color: "var(--err)" }}>
                {t("common.delete")}
              </button>
            </>
          )}
          <button data-fm-all onClick={pickAll} style={box}>
            {picked.size === items.length && items.length ? t("tools.none") : t("tools.all")}
          </button>
          <button data-fm-reveal onClick={() => void useFiles.getState().reveal(folder)} style={box}>
            {t("files.reveal")}
          </button>
        </div>

        {view === "grid" ? (
          <div
            data-fm-grid
            onScroll={onScroll}
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              background: "var(--bg)",
              border: "1px solid var(--line)",
              borderRadius: "var(--r-3)",
              padding: "var(--sp-3)",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
              gridAutoRows: "min-content",
              gap: "var(--sp-3)",
              alignContent: "start",
              // ★훑어 고르는 동안 글자 선택이 시작되면 pointercancel 이 나서 한 칸에서 끝난다
              userSelect: "none",
            }}
          >
            {items.map((it, i) => {
              const on = picked.has(it.file);
              return (
                <div
                  key={it.file}
                  {...cellProps(i, it.file)}
                  style={{ display: "flex", flexDirection: "column", gap: 4, cursor: "pointer" }}
                >
                  <div
                    style={{
                      aspectRatio: "1 / 1",
                      borderRadius: "var(--r-2)",
                      overflow: "hidden",
                      border: `2px solid ${on ? "var(--accent)" : "transparent"}`,
                      background: "var(--panel)",
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    <img
                      src={fileMgrThumb(base, it.file)}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      draggable={false}
                      style={{ width: "100%", height: "100%", objectFit: "contain", opacity: on ? 1 : 0.85 }}
                    />
                  </div>
                  <span
                    style={{
                      fontSize: "var(--text-2xs)",
                      color: on ? "var(--ink)" : "var(--ink-faint)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {it.name}
                  </span>
                </div>
              );
            })}
            {hasMore && <More t={t} n={total - items.length} span />}
            {!items.length && (
              <span style={{ gridColumn: "1/-1", margin: "auto", fontSize: "var(--text-2xs)", color: "var(--ink-faint)" }}>
                {t("files.empty")}
              </span>
            )}
          </div>
        ) : (
          <div
            data-fm-list
            onScroll={onScroll}
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              background: "var(--bg)",
              border: "1px solid var(--line)",
              borderRadius: "var(--r-3)",
              userSelect: "none",
            }}
          >
            <div style={{ ...listRow, position: "sticky", top: 0, background: "var(--panel)", color: "var(--ink-dim)",
                          borderBottom: "1px solid var(--line)", zIndex: 1 }}>
              <span />
              <span>{t("files.colName")}</span>
              <span style={{ textAlign: "right" }}>{t("files.colSize")}</span>
              <span style={{ textAlign: "right" }}>{t("files.colDate")}</span>
            </div>
            {items.map((it, i) => {
              const on = picked.has(it.file);
              return (
                <div
                  key={it.file}
                  {...cellProps(i, it.file)}
                  style={{
                    ...listRow,
                    cursor: "pointer",
                    color: on ? "var(--ink)" : "var(--ink-soft)",
                    background: on ? "var(--accent-bg)" : undefined,
                    borderLeft: `2px solid ${on ? "var(--accent)" : "transparent"}`,
                  }}
                >
                  <img
                    src={fileMgrThumb(base, it.file)}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    draggable={false}
                    style={{ width: 22, height: 22, objectFit: "cover", borderRadius: "var(--r-1)" }}
                  />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</span>
                  <span style={{ textAlign: "right", color: "var(--ink-faint)", fontVariantNumeric: "tabular-nums" }}>
                    {fmtSize(it.bytes)}
                  </span>
                  <span style={{ textAlign: "right", color: "var(--ink-faint)", fontVariantNumeric: "tabular-nums" }}>
                    {fmtDate(it.mtime)}
                  </span>
                </div>
              );
            })}
            {hasMore && <More t={t} n={total - items.length} />}
            {!items.length && (
              <div style={{ padding: "var(--sp-6)", textAlign: "center", fontSize: "var(--text-2xs)", color: "var(--ink-faint)" }}>
                {t("files.empty")}
              </div>
            )}
          </div>
        )}
      </div>

      {/* PIP — 커서를 따라다니되 **화면 밖으로는 안 나간다** (v2 `fmUpdatePipPosition`) */}
      {pip && (
        <img
          data-fm-pip-view
          src={pip.src}
          alt=""
          style={{
            position: "fixed",
            left: Math.max(8, Math.min(pip.x + 16, window.innerWidth - PIP - 8)),
            top: Math.max(8, Math.min(pip.y + 16, window.innerHeight - PIP - 8)),
            width: PIP,
            height: PIP,
            objectFit: "contain",
            background: "var(--bg-deep)",
            border: "1px solid var(--line-strong)",
            borderRadius: "var(--r-3)",
            boxShadow: "var(--shadow-3)",
            pointerEvents: "none",
            zIndex: 80,
          }}
        />
      )}
    </div>
  );
}

/** PIP 한 변 — 커서를 가리지 않으면서 무엇인지 알아볼 만한 크기 */
const PIP = 320;

const More = ({ t, n, span }: { t: (k: string, p?: Record<string, number>) => string; n: number; span?: boolean }) => (
  <span
    data-fm-more
    style={{
      display: "block",
      gridColumn: span ? "1/-1" : undefined,
      padding: "var(--sp-3)",
      textAlign: "center",
      fontSize: "var(--text-2xs)",
      color: "var(--ink-faint)",
    }}
  >
    {t("gallery.more", { n })}
  </span>
);

async function newFolder(parent: string, t: (k: string, p?: Record<string, string | number>) => string) {
  const name = window.prompt(t("files.newFolderPrompt"), t("files.newFolder"));
  if (!name) return;
  try {
    await useFiles.getState().mkdir(parent, name);
  } catch (e) {
    toast(String(e), "warn");
  }
}

const fmtSize = (n: number) =>
  !n ? "-" : n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;

const fmtDate = (sec: number) => {
  if (!sec) return "-";
  const d = new Date(sec * 1000);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const listRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "22px 1fr 88px 132px",
  alignItems: "center",
  gap: "var(--sp-3)",
  padding: "3px var(--sp-3)",
  fontSize: "var(--text-2xs)",
};

const box: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: "var(--r-2)",
  padding: "3px var(--sp-3)",
  fontSize: "var(--text-2xs)",
  color: "var(--ink-soft)",
};

const iconBtn: React.CSSProperties = {
  ...box,
  display: "grid",
  placeItems: "center",
  padding: "3px var(--sp-2)",
};

const onSt: React.CSSProperties = { borderColor: "var(--accent)", background: "var(--accent-bg)", color: "var(--ink)" };
