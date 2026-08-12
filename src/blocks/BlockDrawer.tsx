import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import { Icon } from "../components/Icon";
import { Chip, colorHex } from "./Chip";
import type { Block } from "../lib/blocks";
import { grouped, useBlockLib, type LibItem } from "../store/blockLib";
import { useDragSource, useDropZone, dragSourceStyle } from "../cards/dragStore";
import { toast } from "../store/toast";

/** 블록 저장소 서랍 — 좌측 프롬프트 패널 **옆**에 열린다 (목업 `peropix-block-editor`).
 *
 *  ★**넣는 것도 꺼내는 것도 끌기 하나**다 (사용자 지시 2026-08-13).
 *    프롬프트의 블록 머리를 잡아 서랍에 놓으면 들어가고, 서랍의 항목을 잡아 프롬프트에
 *    놓으면 사본이 나온다. **분류 머리에 놓으면 그 분류로** 들어간다 — 창을 띄워 묻지
 *    않으므로 한 동작에 끝난다.
 *  ★서랍은 패널을 **덮지 않고 밀지도 않는다** — 옆에 붙어 열린다. 덮으면 놓을 자리가
 *    가려져서 끌어다 놓을 수가 없다. */
export function BlockDrawer() {
  const t = useI18n((s) => s.t);
  const { items, open, query, loaded, setOpen, setQuery, load, remove, drop } = useBlockLib();
  const [closed, setClosed] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open && !loaded) void load();
  }, [open, loaded, load]);

  // 서랍 전체가 받는 자리 — 분류 머리를 못 맞혔을 때의 폴백(미분류)
  const body = useDropZone({
    id: "blocklib-body",
    kind: "blocklib",
    dir: "save",
    onDrop: (d) => void putIn(d.block, ""),
  });

  const putIn = async (b: Block | undefined, cat: string) => {
    if (!b) return;
    try {
      const it = await drop(b, cat);
      toast(t("lib.added", { name: it.label, cat: it.cat || t("lib.uncategorized") }));
    } catch (e) {
      toast(String(e), "warn");
    }
  };

  if (!open) return null;
  const groups = grouped(items, query);

  return (
    <div
      data-block-drawer
      ref={body.ref}
      style={{
        width: 216,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        background: "var(--bg)",
        borderRight: "1px solid var(--line)",
        // 블록을 끌고 오는 중에는 서랍 전체가 받는 자리임을 알린다
        ...(body.active
          ? { outline: `1px ${body.over ? "solid" : "dashed"} var(--accent)`, outlineOffset: -1 }
          : null),
      }}
    >
      <div
        style={{
          height: 32,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-2)",
          padding: "0 var(--sp-2) 0 var(--sp-3)",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <b style={{ fontSize: "var(--text-xs)", color: "var(--ink-soft)", whiteSpace: "nowrap" }}>
          {t("lib.title")}
        </b>
        <span style={{ flex: 1 }} />
        <button
          data-block-drawer-close
          onClick={() => setOpen(false)}
          title={t("lib.close")}
          style={{ color: "var(--ink-faint)", display: "grid" }}
        >
          {Icon.close12}
        </button>
      </div>

      <div style={{ padding: "var(--sp-2)", flexShrink: 0 }}>
        <input
          data-block-search
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("lib.search")}
          style={{
            width: "100%",
            background: "var(--surface2)",
            border: "1px solid var(--line)",
            borderRadius: "var(--r-1)",
            padding: "3px var(--sp-2)",
            fontSize: "var(--text-2xs)",
          }}
        />
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 var(--sp-2) var(--sp-3)" }}>
        {!groups.length && (
          <div style={{ padding: "var(--sp-3) 2px", fontSize: "var(--text-2xs)", color: "var(--ink-faint)", lineHeight: 1.6 }}>
            {items.length ? t("lib.noHit") : t("lib.empty")}
          </div>
        )}
        {groups.map(([cat, list]) => (
          <Category
            key={cat || "-"}
            cat={cat}
            list={list}
            // ★검색 중에는 접힘을 무시하고 전부 펼친다 — 안 그러면 찾은 것이 안 보인다
            folded={closed.has(cat) && !query.trim()}
            onFold={() =>
              setClosed((s) => {
                const n = new Set(s);
                n.has(cat) ? n.delete(cat) : n.add(cat);
                return n;
              })
            }
            onDropBlock={(b) => void putIn(b, cat)}
            onRemove={(id) => void remove(id)}
          />
        ))}
      </div>

      <div
        style={{
          flexShrink: 0,
          padding: "var(--sp-2) var(--sp-3)",
          borderTop: "1px solid var(--line)",
          fontSize: "var(--text-2xs)",
          color: "var(--ink-faint)",
          lineHeight: 1.5,
        }}
      >
        {t("lib.dragHint")}
      </div>
    </div>
  );
}

/** 분류 한 덩어리 — **머리가 곧 드롭 자리**다 (여기 놓으면 이 분류로 들어간다) */
function Category({
  cat,
  list,
  folded,
  onFold,
  onDropBlock,
  onRemove,
}: {
  cat: string;
  list: LibItem[];
  folded: boolean;
  onFold: () => void;
  onDropBlock: (b: Block | undefined) => void;
  onRemove: (id: string) => void;
}) {
  const t = useI18n((s) => s.t);
  // ★서랍 전체(폴백)보다 **우선순위가 높다** — 겹치면 분류가 이긴다
  const zone = useDropZone({
    id: `blocklib-cat-${cat}`,
    kind: "blocklib",
    dir: "save",
    prio: 1,
    onDrop: (d) => onDropBlock(d.block),
  });

  return (
    <div>
      <div
        ref={zone.ref}
        data-lib-cat={cat}
        onClick={onFold}
        title={t("lib.dropHere")}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "6px 4px 3px",
          borderRadius: "var(--r-1)",
          fontSize: "var(--text-2xs)",
          fontWeight: "var(--w-semi)",
          color: "var(--ink-dim)",
          cursor: "pointer",
          userSelect: "none",
          ...(zone.over ? { background: "var(--accent-bg)", color: "var(--ink)" } : null),
        }}
      >
        <span style={{ color: "var(--ink-faint)" }}>{folded ? "▸" : "▾"}</span>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
          {cat || t("lib.uncategorized")}
        </span>
        <span style={{ color: "var(--ink-faint)", fontWeight: 400 }}>{list.length}</span>
      </div>
      {!folded && list.map((it) => <Row key={it.id} it={it} onRemove={() => onRemove(it.id)} />)}
    </div>
  );
}

/** 저장소 항목 한 줄 — **끌어서** 블록 목록에 놓는다. 누르면 **내용이 펼쳐진다.** */
function Row({ it, onRemove }: { it: LibItem; onRemove: () => void }) {
  const t = useI18n((s) => s.t);
  const start = useDragSource();
  const justAdded = useBlockLib((s) => s.justAdded);
  const save = useBlockLib((s) => s.save);
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);

  // 방금 넣은 것은 펼친 채로 뜬다 (무엇이 어디로 들어갔는지 눈으로 확인)
  useEffect(() => {
    if (justAdded === it.id) setOpen(true);
  }, [justAdded, it.id]);

  return (
    <div
      data-lib-item={it.id}
      // ★끌기와 펼치기가 **같은 자리**다 — 4px 문턱을 넘으면 끌기, 아니면 펼치기
      //   (`useDragSource` 의 onTap). 카드 배너와 같은 규칙이다.
      // ★손잡이는 **항목 전체**다. 머리줄에만 걸었더니 펼친 뒤 태그 쪽을 잡으면 안 끌렸다
      //   (실측 2026-08-13) — 펼쳐 놓고 끄는 것이 오히려 자연스러운 순서다.
      onPointerDown={(e) =>
        start(e, { dir: "apply", kind: "blocklib", item: it }, undefined, () => setOpen((v) => !v))
      }
      title={t("lib.itemHint")}
      style={{
        marginBottom: 2,
        borderRadius: "var(--r-1)",
        borderLeft: `3px solid ${it.color ? colorHex(it.color) : "var(--line)"}`,
        background: "var(--surface)",
        cursor: "grab",
        ...dragSourceStyle,
        ...(justAdded === it.id ? { outline: "1px solid var(--accent)" } : null),
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "3px 4px 3px 6px",
          fontSize: "var(--text-2xs)",
        }}
      >
        <span style={{ color: "var(--ink-faint)" }}>{open ? "▾" : "▸"}</span>
        {renaming ? (
          <input
            data-lib-rename
            autoFocus
            defaultValue={it.label}
            onPointerDown={(e) => e.stopPropagation()}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== it.label) void save({ ...it, label: v });
              setRenaming(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setRenaming(false);
            }}
            style={{
              flex: 1,
              minWidth: 0,
              background: "var(--surface2)",
              border: "1px solid var(--accent)",
              borderRadius: "var(--r-1)",
              padding: "0 3px",
              fontSize: "var(--text-2xs)",
            }}
          />
        ) : (
          <span
            onDoubleClick={(e) => {
              e.stopPropagation();
              setRenaming(true);
            }}
            style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {it.label}
          </span>
        )}
        <span style={{ color: "var(--ink-faint)" }}>{it.tags.length}</span>
        <button
          data-lib-del={it.id}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onRemove}
          title={t("lib.remove")}
          style={{ color: "var(--ink-faint)", display: "grid" }}
        >
          {Icon.close12}
        </button>
      </div>

      {/* ★펼치면 **든 것이 그대로 보인다** (사용자 지시 2026-08-13) — 이름만으로는
          무엇이 든 항목인지 알 수 없어 꺼내 봐야만 확인이 됐다.
          칩은 **읽기 전용**이다: 고치는 자리는 프롬프트 쪽 하나뿐이다 */}
      {open && (
        <div style={{ padding: "0 6px 6px 8px", display: "flex", flexWrap: "wrap", gap: 3 }}>
          {it.tags.map((tag, i) => (
            <Chip key={i} tag={tag} onWeight={() => {}} onRemove={() => {}} readOnly />
          ))}
          {!it.tags.length && (
            <span style={{ fontSize: "var(--text-2xs)", color: "var(--ink-faint)" }}>
              {t("block.emptySummary")}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** 저장소 열기 단추 — 패널 머리에 붙는다 */
export function BlockLibButton() {
  const t = useI18n((s) => s.t);
  const open = useBlockLib((s) => s.open);
  const setOpen = useBlockLib((s) => s.setOpen);
  return (
    <button
      data-block-lib-toggle
      data-on={open ? "" : undefined}
      onClick={() => setOpen(!open)}
      title={t("lib.title")}
      style={{ color: open ? "var(--accent)" : "var(--ink-faint)", display: "grid", padding: "0 4px" }}
    >
      {Icon.bookmark}
    </button>
  );
}
