import { composing } from "../lib/ime";
import { useRef, useState } from "react";
import { useI18n } from "../i18n";
import { useWs } from "../store/workspace";
import { ALL, useGallery } from "../store/gallery";
import { useDrag, useDropZone } from "../cards/dragStore";
import { ask } from "../store/ask";
import { toast } from "../store/toast";
import { Icon } from "../components/Icon";

/** 갤러리의 폴더 목록 — 좌 패널.
 *
 *  ★폴더 축은 **사용자 소유**다 (feature-inventory K절). 앱이 캐릭터 이름 같은 걸로 폴더를
 *    만들지 않으므로, 여기 뜨는 이름은 전부 사용자가 붙인 탭·셀 이름이다.
 *  ★빈 폴더도 보인다 — 여기서 만든 폴더는 그림을 옮겨 넣기 전까지 비어 있다.
 *  ★폴더를 만들고 지우는 창구가 **여기 하나**다 (v2-port-audit C6). */
export function GalleryFolders() {
  const t = useI18n((s) => s.t);
  const ws = useWs((s) => s.current);
  // ★목록을 불러오는 것은 **중앙(Gallery)** 이다 — 이 패널은 접으면 언마운트되므로
  //   (Shell 이 접힌 쪽을 렌더하지 않는다) 여기서 불러오면 접었을 때 갤러리가 빈다.
  const { folders, folder, items, setFolder, newFolder, dropFolder, reveal, moveTo } = useGallery();
  /** 그림을 끌어다 놓으면 그 폴더로 옮긴다 (사용자 지시 2026-08-19) */
  const moveFiles = async (files: string[], dest: string) => {
    try {
      const n = await moveTo(ws, dest === ALL ? "" : dest, files);
      if (n) toast(t("gallery.moved", { n }));
    } catch (e) {
      toast(String(e), "warn");
    }
  };
  /** 새 폴더 — **그 자리 입력칸**이다. 브라우저 `prompt` 은 창 밖 OS 대화상자라 쓰지 않는다 */
  const [adding, setAdding] = useState<string | null>(null);
  /** ★적고 있는 글자를 **ref 로도** 든다. Esc 로 물린 직후 `blur` 가 오면 그 순간의
   *  렌더가 들고 있던 옛 값으로 폴더가 만들어진다 — ref 는 즉시 비울 수 있다. */
  const draft = useRef("");
  /** 갤러리 그림을 끌고 있나 — 그동안 이 영역이 어둠 위로 올라온다 */
  const lift = useDrag((d) => d.drag?.kind === "keep");

  const addFolder = async () => {
    const name = draft.current.trim();
    draft.current = "";
    setAdding(null);
    if (!name) return;
    try {
      await newFolder(ws, name);
    } catch (e) {
      toast(String(e), "warn");
    }
  };

  const removeFolder = async (path: string, count: number) => {
    // ★그림이 든 폴더는 서버가 거절한다. 여기서 먼저 알려 주는 편이 눌러 보고 실패하는 것보다 낫다
    if (count > 0) return toast(t("gallery.folderNotEmpty"), "warn");
    if (!(await ask({ title: t("gallery.folderDelConfirm", { name: path }), ok: t("common.delete"), cancel: t("common.cancel") })))
      return;
    try {
      await dropFolder(ws, path);
    } catch (e) {
      toast(String(e), "warn");
    }
  };

  // ★서버가 주는 첫 줄(`path: ""`)이 **전체**다 — 그걸 그대로 쓴다.
  //   따로 더하면 하위 폴더가 두 번 세어지고, 이름 없는 빈 줄이 하나 더 생긴다
  //   (실측 2026-08-05: 3장짜리 폴더 하나에 전체가 6으로 뜨고 무명 줄이 붙었다).
  const total = folders.find((f) => f.path === ALL)?.count ?? 0;
  const rest = folders.filter((f) => f.path !== ALL);

  return (
    // ★제목은 패널 머리글(Shell)이 이미 달고 있다 — 여기서 또 적으면 두 겹이 된다
    <div
      /* ★★그림을 끌 때 **이 영역을 어둠 위로 올린다** (사용자 지적 2026-08-23: 폴더 트리가
         어두워서 안 보였다). `DragLayer` 가 화면에 어둠을 까는데, 받는 자리는 그 위로
         올라와야 한다 — CLAUDE.md 「드롭 표시는 하나의 양식이다」의 첫 번째 겹이다.
         ★올리는 것은 **영역 전체**다. 줄마다 올리면 줄 사이 여백이 어두운 채로 남는다. */
      data-spot={lift ? "" : undefined}
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        ...(lift ? { position: "relative" as const, zIndex: 31, background: "var(--bg)" } : {}),
      }}
    >
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "var(--sp-2) var(--sp-2) var(--sp-3)" }}>
        {/* ★★첫 줄이 **뿌리 폴더 그 자체**다 (사용자 지시 2026-08-23).
            이름도 실제 폴더와 같은 `gallery` 이고, **떨구면 최상위로 올라온다**.
            ★따로 있던 「폴더 밖으로」 줄을 걷은 자리다 — 뿌리로 되돌리는 자리가 둘이면
              어느 것이 무엇인지 헷갈린다. 같은 일은 한 줄이 한다. */}
        <Row
          label={t("gallery.all")}
          count={total}
          on={folder === ALL}
          onClick={() => void setFolder(ws, ALL)}
          onDropFiles={(files) => void moveFiles(files, ALL)}
        />
        {rest.map((f) => (
          <Row
            key={f.path}
            label={f.path}
            count={f.count}
            on={folder === f.path}
            onClick={() => void setFolder(ws, f.path)}
            onDelete={() => void removeFolder(f.path, f.count)}
            onDropFiles={(files) => void moveFiles(files, f.path)}
          />
        ))}

        {/* ★앱 안에서 하위 폴더를 만들 길 (v2 `POST /api/gallery/folders`).
            전에는 탐색기로 나가야만 폴더를 만들 수 있었다 (v2-port-audit C6). */}
        {adding === null ? (
          <button
            data-keep-newfolder
            onClick={() => {
              draft.current = "";
              setAdding("");
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--sp-2)",
              width: "100%",
              marginTop: "var(--sp-2)",
              padding: "5px var(--sp-3)",
              borderRadius: "var(--r-2)",
              color: "var(--ink-faint)",
              fontSize: "var(--text-xs)",
              textAlign: "left",
            }}
          >
            {Icon.plus}
            {t("gallery.newFolder")}
          </button>
        ) : (
          <input
            data-keep-newfolder-input
            autoFocus
            value={adding}
            placeholder={t("gallery.newFolderHint")}
            onChange={(e) => {
              draft.current = e.target.value;
              setAdding(e.target.value);
            }}
            onBlur={() => void addFolder()}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !composing(e)) e.currentTarget.blur();
              else if (e.key === "Escape") {
                draft.current = "";
                setAdding(null);
              }
            }}
            style={{
              width: "100%",
              marginTop: "var(--sp-2)",
              padding: "5px var(--sp-3)",
              borderRadius: "var(--r-2)",
              border: "1px solid var(--accent)",
              background: "var(--panel)",
              color: "var(--ink)",
              fontSize: "var(--text-xs)",
            }}
          />
        )}
      </div>

      <div
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-2)",
          padding: "var(--sp-2) var(--sp-3)",
          borderTop: "1px solid var(--line-soft)",
          fontSize: "var(--text-2xs)",
          color: "var(--ink-faint)",
        }}
      >
        {/* ★숫자만 두면 무엇의 개수인지 알 수 없다 — 지금 보고 있는 범위를 함께 적는다 */}
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {folder === ALL ? t("gallery.all") : folder} · {t("gallery.countImages", { n: items.length })}
        </span>
        {/* 보관함은 앱 밖에서도 들여다보는 폴더다 — 지금 보고 있는 폴더를 그대로 연다 */}
        <button
          data-keep-openfolder
          data-tip={t("files.reveal")}
          onClick={() => void reveal(folder).catch((e) => toast(String(e), "warn"))}
          style={{ display: "grid", placeItems: "center", padding: 2, color: "var(--ink-dim)" }}
        >
          {Icon.folderOpen}
        </button>
      </div>
    </div>
  );
}

function Row({
  label,
  count,
  on,
  onClick,
  onDelete,
  onDropFiles,
}: {
  label: string;
  count: number;
  on: boolean;
  onClick: () => void;
  /** 없으면 지우는 단추가 안 뜬다 (전체 줄) */
  onDelete?: () => void;
  /** ★그림을 끌어다 놓으면 **이 폴더로 옮긴다** (사용자 지시 2026-08-19).
   *  없으면 받지 않는다 (「전체」는 폴더가 아니라 보기라 받을 자리가 없다 — 뿌리로 옮기는
   *  것은 「전체」가 아니라 뿌리 폴더 줄이 받아야 뜻이 분명하다). */
  onDropFiles?: (files: string[]) => void;
}) {
  const t = useI18n((s) => s.t);
  /** ★앱의 포인터 끌기를 받는다 — HTML5 드롭은 Tauri 가 가로채 안 온다 (`cards/dragStore`) */
  const zone = useDropZone({
    id: `keep-folder-${label}`,
    kind: "keep",
    prio: 10,
    onDrop: (d) => d.files?.length && onDropFiles?.(d.files),
  });
  // 폴더는 `work/유나/포즈1` 처럼 계층이라, 마지막 조각을 굵게 두고 앞은 흐리게 둔다
  const parts = label.split("/");
  const leaf = parts.pop()!;
  return (
    <div
      // ★지우는 단추는 **커서를 올렸을 때만** 보인다 (globals.css `*:hover > .thumb-star` 와 같은 요령).
      //   늘 보이면 폴더 목록이 단추 줄로 읽힌다.
      className="keep-folder-row"
      data-keep-folder-row={label}
      ref={zone.ref}
      style={{
        display: "flex",
        alignItems: "center",
        borderRadius: "var(--r-2)",
        outline: zone.over ? "1px solid var(--accent)" : undefined,
        background: zone.over ? "var(--accent-bg)" : undefined,
      }}
    >
    <button
      onClick={onClick}
      data-tip={label}
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: "var(--sp-2)",
        width: "100%",
        padding: "5px var(--sp-3)",
        borderRadius: "var(--r-2)",
        background: on ? "var(--surface2)" : "transparent",
        color: on ? "var(--ink)" : "var(--ink-dim)",
        fontSize: "var(--text-xs)",
        textAlign: "left",
      }}
    >
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {parts.length > 0 && (
          <span style={{ color: "var(--ink-faint)" }}>{parts.join("/")}/</span>
        )}
        <span style={{ fontWeight: on ? "var(--w-semi)" : "var(--w-normal)" }}>{leaf}</span>
      </span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", color: "var(--ink-faint)" }}>
        {count}
      </span>
    </button>
    {onDelete && (
      <button
        data-keep-folder-del={label}
        className="keep-folder-del"
        onClick={onDelete}
        data-tip={t("gallery.folderDelete")}
        style={{ display: "grid", placeItems: "center", padding: "2px 4px", color: "var(--ink-faint)" }}
      >
        {Icon.trash}
      </button>
    )}
    </div>
  );
}

