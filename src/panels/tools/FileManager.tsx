import { useEffect, useState } from "react";
import { useI18n } from "../../i18n";
import { useFiles, type FileNode } from "../../store/files";
import { useGen } from "../../store/gen";
import { fileMgrThumb } from "../../lib/imgUrl";
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
 */
export function FileManager({ onConvert }: { onConvert: () => void }) {
  const t = useI18n((s) => s.t);
  const base = useGen((s) => s.base);
  const { tree, rootCount, folder, items, picked, open, total, hasMore, loadTree, go, more, toggleOpen, pick, pickAll, clearPick } =
    useFiles();
  const onScroll = onNearBottom(() => void more());
  const [over, setOver] = useState<string | null>(null);

  useEffect(() => {
    void loadTree().then(() => useFiles.getState().go(useFiles.getState().folder));
  }, [loadTree]);

  const move = async (dest: string) => {
    const files = [...picked];
    if (!files.length) return;
    await useFiles.getState().move(files, dest);
    toast(t("files.moved", { n: files.length }));
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

  const Row = ({ node, depth }: { node: FileNode; depth: number }) => {
    const on = folder === node.path;
    const opened = open.has(node.path);
    return (
      <>
        <div
          data-folder={node.path}
          onClick={() => void go(node.path)}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(node.path);
          }}
          onDragLeave={() => setOver((p) => (p === node.path ? null : p))}
          onDrop={(e) => {
            e.preventDefault();
            setOver(null);
            void move(node.path);
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
        </div>
        {opened && node.children.map((c) => <Row key={c.path} node={c} depth={depth + 1} />)}
      </>
    );
  };

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", gap: "var(--sp-4)" }}>
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
              void move("");
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
              <button data-fm-delete onClick={() => void remove()} style={{ ...box, color: "var(--danger)" }}>
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
          }}
        >
          {items.map((it) => {
            const on = picked.has(it.file);
            return (
              <div
                key={it.file}
                data-fm-item={it.file}
                draggable
                onDragStart={(e) => {
                  if (!on) pick(it.file, true);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onClick={(e) => pick(it.file, e.ctrlKey || e.metaKey || e.shiftKey)}
                title={it.name}
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
          {hasMore && (
            <span
              data-fm-more
              style={{ gridColumn: "1/-1", padding: "var(--sp-3)", textAlign: "center",
                       fontSize: "var(--text-2xs)", color: "var(--ink-faint)" }}
            >
              {t("gallery.more", { n: total - items.length })}
            </span>
          )}
          {!items.length && (
            <span style={{ gridColumn: "1/-1", margin: "auto", fontSize: "var(--text-2xs)", color: "var(--ink-faint)" }}>
              {t("files.empty")}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

async function newFolder(parent: string, t: (k: string, p?: Record<string, string | number>) => string) {
  const name = window.prompt(t("files.newFolderPrompt"), "새 폴더");
  if (!name) return;
  try {
    await useFiles.getState().mkdir(parent, name);
  } catch (e) {
    toast(String(e), "warn");
  }
}

const box: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: "var(--r-2)",
  padding: "3px var(--sp-3)",
  fontSize: "var(--text-2xs)",
  color: "var(--ink-soft)",
};
