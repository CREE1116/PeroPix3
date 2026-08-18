import { useEffect, useRef } from "react";
import { useI18n } from "../i18n";
import { useCensor, type Tab } from "../store/censor";
import { useFiles, type FileNode } from "../store/files";
import { useGen } from "../store/gen";
import { fileMgrThumb } from "../lib/imgUrl";
import { useImageDrop } from "../lib/dropImages";
import { toast } from "../store/toast";
import { Icon } from "../components/Icon";
import { onNearBottom } from "../lib/nearBottom";
import { CensorStage } from "./censor/CensorStage";
import { CensorSide } from "./censor/CensorSide";
import { card, box } from "./censor/ui";

/** 자동 검열. **여러 장을 한 번에** 찾고 가린다 (v2 이식).
 *
 *  ★탭 셋이 곧 작업 순서다: 담아서 찾고(검열 전) · 손보고(검열 중) · 다시 손본다(검열 후).
 *  ★그림은 **두 길로** 들어온다: 아웃풋 폴더에서 고르거나(왼쪽 트리), 밖에서 떨구거나.
 *    떨군 것은 경로만 서버로 가고 바이트는 안 실린다 (`lib/dropImages.ts` 머리 주석).
 *  ★결과는 **새 파일**이다. 원본은 그대로 남는다. 덮어쓰기 경로를 만들지 말 것.
 */
export function Censor() {
  const t = useI18n((s) => s.t);
  const base = useGen((s) => s.base);
  const c = useCensor();
  const { tree, folder, items, open: opened, hasMore, loadTree, go, more, toggleOpen } = useFiles();
  const onScroll = onNearBottom(() => void more());
  const stripRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  const list = c.tab === "after" ? c.after : c.images;
  const at = c.tab === "after" ? c.afterIdx : c.idx;
  const picked = new Set(c.images.map((x) => x.rel).filter(Boolean) as string[]);

  // ★떨군 그림은 **검열 전 탭에서만** 받는다 (v2 `canAcceptDrop`).
  //   결과를 보는 탭에 떨군 것이 조용히 다른 목록으로 들어가면 어디로 갔는지 알 수 없다
  const { zone, over, pick } = useImageDrop((dropped) => {
    if (useCensor.getState().tab !== "before") return;
    void c.addImages(dropped);
  });

  useEffect(() => {
    void c.loadModels();
    void loadTree().then(() => useFiles.getState().go(useFiles.getState().folder));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 고른 장이 띠 밖으로 나가지 않게 (v2 `scrollIntoView`)
  useEffect(() => {
    stripRef.current?.querySelector<HTMLElement>('[data-censor-thumb-active="1"]')?.scrollIntoView({
      block: "nearest",
      inline: "center",
      behavior: "smooth",
    });
  }, [at, c.tab]);

  /** 무대의 휠 = 장 넘기기.
   *
   *  ★**네이티브 리스너로 붙인다.** React 의 `onWheel` 은 뿌리에 passive 로 달려서
   *    `preventDefault()` 가 안 먹고, 그러면 넘기면서 화면까지 함께 밀린다
   *    (`SceneLane` 의 Ctrl+휠과 같은 함정). */
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const s = useCensor.getState();
      const n = (s.tab === "after" ? s.after : s.images).length;
      if (n < 2) return;
      e.preventDefault();
      s.step(e.deltaY > 0 ? 1 : -1);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [c.tab]);

  /** 단축키. ★입력칸에 커서가 있으면 먹지 않는다 (숫자칸에 1 을 못 치면 곤란하다) */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      const s = useCensor.getState();
      if (s.tab !== "before" && (e.key === "1" || e.key === "2" || e.key === "3")) {
        e.preventDefault();
        return s.set({ tool: e.key === "1" ? "select" : e.key === "2" ? "add" : "delete", sel: -1 });
      }
      if (e.key === "Delete" && s.tab !== "before" && s.sel >= 0) {
        e.preventDefault();
        return s.removeBox(s.sel);
      }
      if (e.key === "ArrowLeft") return s.step(-1);
      if (e.key === "ArrowRight") return s.step(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const Row = ({ node, depth }: { node: FileNode; depth: number }) => (
    <>
      <div
        data-folder={node.path}
        onClick={() => void go(node.path)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: `2px var(--sp-2) 2px ${8 + depth * 12}px`,
          borderRadius: "var(--r-1)",
          fontSize: "var(--text-2xs)",
          cursor: "pointer",
          color: folder === node.path ? "var(--ink)" : "var(--ink-soft)",
          background: folder === node.path ? "var(--accent-bg)" : undefined,
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
          {opened.has(node.path) ? Icon.chevronDown : Icon.chevronRight}
        </button>
        <span style={{ display: "grid", color: "var(--ink-faint)" }}>{Icon.folder}</span>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {node.name}
        </span>
        {!!node.count && <span style={{ color: "var(--ink-faint)" }}>{node.count}</span>}
      </div>
      {opened.has(node.path) && node.children.map((x) => <Row key={x.path} node={x} depth={depth + 1} />)}
    </>
  );

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: "var(--sp-3)", padding: "var(--sp-4)" }}>
      {/* ── 머리: 어디까지 왔나 · 어디에 저장하나 ── */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
        {TABS.map(([id, key]) => {
          const active = c.tab === id;
          const dim = id === "processing" && !c.staged;
          return (
            <button
              key={id}
              data-censor-tab={id}
              onClick={() => c.setTab(id)}
              disabled={dim}
              style={{
                padding: "var(--sp-2) var(--sp-4)",
                borderRadius: "var(--r-2)",
                fontSize: "var(--text-xs)",
                fontWeight: "var(--w-semi)",
                border: `1px solid ${active ? "var(--accent)" : "transparent"}`,
                background: active ? "var(--accent-bg)" : "transparent",
                color: active ? "var(--ink)" : dim ? "var(--ink-ghost)" : "var(--ink-dim)",
              }}
            >
              {t(key)}
            </button>
          );
        })}

        <span style={{ flex: 1 }} />

        {/* 저장 폴더. 결과가 갈 자리 (v2 의 `censored` 폴더 드롭다운) */}
        <span style={{ fontSize: "var(--text-2xs)", color: "var(--ink-faint)" }}>{t("censor.dest")}</span>
        <select
          data-censor-dest
          value={c.dest}
          onChange={(e) => c.tune({ dest: e.target.value })}
          style={{ ...box, maxWidth: 220 }}
        >
          <option value="">{t("censor.destBeside")}</option>
          {/* ★들여쓰기가 아니라 **온 경로**를 적는다. option 은 앞 공백을 접어 버려
              층이 안 보이고, 저장할 자리는 끝 이름만으로는 못 가린다 */}
          {flatten(tree).map((path) => (
            <option key={path} value={path}>
              {path}
            </option>
          ))}
        </select>
        <button
          data-censor-mkdir
          title={t("censor.newFolder")}
          onClick={() => void newFolder(c.dest, t)}
          style={{ ...box, display: "grid", placeItems: "center", padding: "3px var(--sp-2)" }}
        >
          {Icon.folderPlus}
        </button>
        <button
          data-censor-open-folder
          title={t("censor.openFolder")}
          onClick={() => void useFiles.getState().reveal(c.dest)}
          style={{ ...box, display: "grid", placeItems: "center", padding: "3px var(--sp-2)" }}
        >
          {Icon.folderOpen}
        </button>
      </div>

      {/* ── 썸네일 띠: 지금 다루는 목록 ── */}
      <div
        ref={stripRef}
        data-censor-strip
        onWheelCapture={(e) => {
          // ★띠에서는 휠이 **가로 스크롤**이다 (무대의 장 넘기기와 갈라 둔다)
          if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
          e.stopPropagation();
          e.currentTarget.scrollLeft += e.deltaY;
        }}
        style={{
          ...card,
          flexShrink: 0,
          height: 68,
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-2)",
          padding: "var(--sp-2)",
          overflowX: "auto",
          overflowY: "hidden",
        }}
      >
        {list.map((im, i) => (
          <div key={im.id} style={{ position: "relative", flexShrink: 0 }}>
            <button
              data-censor-thumb={i}
              data-censor-thumb-active={at === i ? "1" : "0"}
              onClick={() => c.select(i)}
              title={im.name}
              style={{
                width: 50,
                height: 50,
                borderRadius: "var(--r-2)",
                overflow: "hidden",
                padding: 0,
                background: "var(--bg)",
                border: `2px solid ${at === i ? "var(--accent)" : "transparent"}`,
              }}
            >
              <img
                src={im.thumb ?? (im.rel ? fileMgrThumb(base, im.rel) : undefined)}
                alt=""
                loading="lazy"
                decoding="async"
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            </button>
            {c.tab === "before" && (
              <button
                data-censor-thumb-del={i}
                title={t("censor.removeOne")}
                onClick={() => c.removeImage(i)}
                style={{
                  position: "absolute",
                  top: -2,
                  right: -2,
                  width: 16,
                  height: 16,
                  display: "grid",
                  placeItems: "center",
                  borderRadius: "50%",
                  background: "var(--panel)",
                  border: "1px solid var(--line)",
                  color: "var(--ink-dim)",
                }}
              >
                {Icon.close12}
              </button>
            )}
          </div>
        ))}
        {c.tab === "before" && (
          <button
            data-censor-add
            onClick={() => void pick()}
            title={t("censor.add")}
            style={{
              flexShrink: 0,
              width: 50,
              height: 50,
              display: "grid",
              placeItems: "center",
              borderRadius: "var(--r-2)",
              border: "1px dashed var(--line-strong)",
              color: "var(--ink-faint)",
              background: "transparent",
            }}
          >
            {Icon.plus}
          </button>
        )}
        {!list.length && c.tab !== "before" && (
          <span style={{ margin: "auto", fontSize: "var(--text-2xs)", color: "var(--ink-faint)" }}>
            {t("censor.emptyList")}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {!!list.length && (
          <span style={{ flexShrink: 0, paddingRight: "var(--sp-2)", fontSize: "var(--text-2xs)", color: "var(--ink-faint)", fontVariantNumeric: "tabular-nums" }}>
            {at + 1} / {list.length}
          </span>
        )}
        {c.tab === "before" && !!list.length && (
          <button data-censor-clear onClick={() => c.clearImages()} style={{ ...box, flexShrink: 0 }}>
            {t("censor.clear")}
          </button>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex", gap: "var(--sp-4)" }}>
        {/* ── 왼쪽: 아웃풋 폴더에서 담기 (검열 전 탭에만) ── */}
        {c.tab === "before" && (
          <div style={{ width: 210, flexShrink: 0, display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
            <div style={{ ...card, flex: "0 0 38%", overflowY: "auto", padding: "var(--sp-2)" }}>
              {tree.map((n) => (
                <Row key={n.path} node={n} depth={0} />
              ))}
            </div>
            <div
              data-censor-picker
              onScroll={onScroll}
              style={{
                ...card,
                flex: 1,
                minHeight: 0,
                overflowY: "auto",
                padding: "var(--sp-2)",
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(56px, 1fr))",
                gridAutoRows: "min-content",
                gap: "var(--sp-2)",
                alignContent: "start",
              }}
            >
              {items.map((it) => {
                const inList = picked.has(it.file);
                return (
                  <button
                    key={it.file}
                    data-censor-pick={it.file}
                    onClick={() => c.toggleRel(it.file, it.name)}
                    title={it.name}
                    style={{
                      position: "relative",
                      aspectRatio: "1 / 1",
                      borderRadius: "var(--r-2)",
                      overflow: "hidden",
                      border: `2px solid ${inList ? "var(--accent)" : "transparent"}`,
                      padding: 0,
                      background: "var(--bg)",
                    }}
                  >
                    <img
                      src={fileMgrThumb(base, it.file)}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      style={{ width: "100%", height: "100%", objectFit: "contain", opacity: inList ? 1 : 0.85 }}
                    />
                    {inList && (
                      <span
                        style={{
                          position: "absolute",
                          right: 2,
                          top: 2,
                          display: "grid",
                          placeItems: "center",
                          width: 15,
                          height: 15,
                          borderRadius: "50%",
                          background: "var(--accent)",
                          color: "var(--accent-on)",
                        }}
                      >
                        {Icon.check}
                      </span>
                    )}
                  </button>
                );
              })}
              {hasMore && (
                <span style={{ gridColumn: "1/-1", textAlign: "center", fontSize: "var(--text-2xs)", color: "var(--ink-faint)" }}>
                  …
                </span>
              )}
              {!items.length && (
                <span style={{ gridColumn: "1/-1", margin: "auto", fontSize: "var(--text-2xs)", color: "var(--ink-faint)" }}>
                  {t("files.empty")}
                </span>
              )}
            </div>
          </div>
        )}

        {/* ── 가운데: 무대 ── */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
          <div
            {...zone}
            ref={(el) => {
              stageRef.current = el;
              // ★드롭존의 ref 와 **같은 요소**를 가리켜야 한다. 떨군 자리를 좌표로 가려내므로
              (zone.ref as React.MutableRefObject<HTMLDivElement | null>).current = el;
            }}
            data-censor-stage
            style={{
              ...card,
              flex: 1,
              minHeight: 0,
              display: "grid",
              placeItems: "center",
              overflow: "hidden",
              position: "relative",
              borderColor: over && c.tab === "before" ? "var(--accent)" : "var(--line)",
              background: over && c.tab === "before" ? "var(--accent-bg)" : "var(--bg)",
            }}
          >
            {list.length ? <CensorStage /> : null}

            {!list.length && (
              <button
                data-censor-dropzone
                onClick={() => c.tab === "before" && void pick()}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "var(--sp-2)",
                  padding: "var(--sp-8)",
                  background: "transparent",
                  border: "none",
                  color: "var(--ink-faint)",
                }}
              >
                <span style={{ display: "grid", color: "var(--ink-ghost)" }}>{Icon.folderOpen}</span>
                <span style={{ fontSize: "var(--text-xs)", color: "var(--ink-dim)" }}>
                  {t(c.tab === "before" ? "censor.dropHere" : "censor.emptyList")}
                </span>
                {c.tab === "before" && <span style={{ fontSize: "var(--text-2xs)" }}>{t("censor.dropHint")}</span>}
              </button>
            )}

            {list.length > 1 && (
              <>
                <Arrow side="left" disabled={at <= 0} onClick={() => c.step(-1)} />
                <Arrow side="right" disabled={at >= list.length - 1} onClick={() => c.step(1)} />
              </>
            )}

            {c.scanning && (
              <span
                data-censor-scanning
                style={{
                  position: "absolute",
                  top: "var(--sp-3)",
                  left: "50%",
                  transform: "translateX(-50%)",
                  padding: "3px var(--sp-4)",
                  borderRadius: "var(--r-4)",
                  background: "var(--panel)",
                  border: "1px solid var(--line)",
                  fontSize: "var(--text-2xs)",
                  color: "var(--ink-soft)",
                }}
              >
                {t("censor.scanningOne")}
              </span>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", minHeight: 18 }}>
            <span style={{ fontSize: "var(--text-2xs)", color: "var(--ink-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {c.cur()?.name ?? t("censor.pickImage")}
            </span>
            <span style={{ flex: 1 }} />
            {!!c.curBoxes().length && (
              <span style={{ fontSize: "var(--text-2xs)", color: "var(--ink-faint)" }}>
                {t("censor.found", { n: c.curBoxes().filter((b) => !b.off).length })}
              </span>
            )}
            <span style={{ fontSize: "var(--text-2xs)", color: "var(--ink-faint)" }}>
              {t(c.tab === "before" ? "censor.hintBefore" : "censor.hintEdit")}
            </span>
          </div>
        </div>

        {/* ── 오른쪽: 무엇을 찾고 어떻게 가릴까 ── */}
        <CensorSide />
      </div>
    </div>
  );
}

const TABS: [Tab, "censor.tabBefore" | "censor.tabDuring" | "censor.tabAfter"][] = [
  ["before", "censor.tabBefore"],
  ["processing", "censor.tabDuring"],
  ["after", "censor.tabAfter"],
];

function Arrow({ side, disabled, onClick }: { side: "left" | "right"; disabled: boolean; onClick: () => void }) {
  return (
    <button
      data-censor-nav={side}
      onClick={onClick}
      disabled={disabled}
      style={{
        position: "absolute",
        [side]: "var(--sp-2)",
        top: "50%",
        transform: "translateY(-50%)",
        width: 30,
        height: 44,
        display: "grid",
        placeItems: "center",
        borderRadius: "var(--r-2)",
        border: "1px solid var(--line)",
        background: "var(--panel)",
        color: "var(--ink-soft)",
        opacity: disabled ? 0.25 : 0.85,
      }}
    >
      {side === "left" ? Icon.chevL : Icon.chevR}
    </button>
  );
}

/** 폴더 트리를 한 줄짜리 목록으로 (드롭다운에 들여쓰기로 그린다) */
function flatten(tree: FileNode[]): string[] {
  return tree.flatMap((n) => [n.path, ...flatten(n.children)]);
}

async function newFolder(parent: string, t: (k: string, p?: Record<string, string | number>) => string) {
  const name = window.prompt(t("files.newFolderPrompt"), "censored");
  if (!name) return;
  try {
    await useFiles.getState().mkdir(parent, name);
    const path = parent ? `${parent}/${name}` : name;
    useCensor.getState().tune({ dest: path });
    toast(t("censor.folderMade", { n: name }));
  } catch (e) {
    toast(String(e), "warn");
  }
}
