import { useRef, useState } from "react";
import { useI18n } from "../i18n";
import { dupSet, makeBlock, type Block } from "../lib/blocks";
import { useReorder } from "../lib/useReorder";
import { useTagDrag, type Spot } from "./useTagDrag";
import { BlockRow } from "./BlockRow";
import { itemToBlock, useBlockLib } from "../store/blockLib";
import { useDragSource, useDropZone } from "../cards/dragStore";
import { DragGhost } from "../cards/DragGhost";

/** 블록 시퀀스 — **블록의 위치가 곧 프롬프트의 위치**다.
 *
 *  순서 변경은 그립(⠿) 드래그. 드래그 중에는
 *   - 원본이 흐려지고(고스트),
 *   - 놓일 자리에 굵은 액센트 선이 자리를 벌리며 나타난다.
 *  포인터 이벤트 기반이라 WebView2 의 파일 드롭 핸들러와 충돌하지 않는다 (useReorder.ts).
 *
 *  ★**태그 칩도 같은 방식으로 끈다** (useTagDrag) — 블록 안에서도, 블록 사이로도.
 *    칩 하나하나를 블록 모양으로 만든 까닭이 이것이다 (사용자 2026-08-07). */
export function BlockList({
  blocks,
  onChange,
  allowExtra,
  libZone,
}: {
  blocks: Block[];
  onChange: (b: Block[]) => void;
  /** ★「추가」 블록을 만들 수 있는 자리인가 — 카드로 저장되는 곳(포즈)에서만 뜻이 있다 */
  allowExtra?: boolean;
  /** 저장소에서 끌어온 블록을 받을 자리인가 — **화면에서 유일한 id** 를 준다.
   *  ★목록이 여럿이라(베이스·UC·캐릭터마다·씬 칸마다) id 가 겹치면 엉뚱한 곳에 떨어진다 */
  libZone?: string;
}) {
  const t = useI18n((s) => s.t);
  const startDrag = useDragSource();
  const libOpen = useBlockLib((s) => s.open);
  // ★존은 **언제나 등록한다** — 조건부 훅은 규칙 위반이고, 끄는 중이 아니면 판정도 안 돈다
  const zone = useDropZone({
    id: `blocklib-${libZone ?? "none"}`,
    kind: "blocklib",
    onDrop: (d) => {
      if (!libZone || !d.item) return;
      onChange([...blocks, itemToBlock(d.item)]);
    },
  });
  const dup = dupSet(blocks);
  /** 갓 만들어진 블록 — 뜨자마자 편집 상태가 된다 */
  const [editId, setEditId] = useState<string | null>(null);
  /** Enter 로 딸려 만들어진 블록들. 비운 채 Esc 로 나가면 도로 거둔다 */
  const auto = useRef(new Set<string>());

  const move = (from: number, to: number) => {
    const n = blocks.slice();
    const [moved] = n.splice(from, 1);
    n.splice(to > from ? to - 1 : to, 0, moved);
    onChange(n);
  };

  const moveTag = (from: Spot, to: Spot) => {
    const n = blocks.map((b) => ({ ...b, tags: b.tags.slice() }));
    const [tag] = n[from.block].tags.splice(from.index, 1);
    if (!tag) return;
    // -1 은 "그 블록의 끝" (접힌 블록에 떨어뜨린 경우)
    let at = to.index < 0 ? n[to.block].tags.length : to.index;
    if (to.block === from.block && at > from.index) at--;
    if (to.block === from.block && at === from.index) return; // 제자리
    n[to.block].tags.splice(at, 0, tag);
    onChange(n);
  };

  const { register, handleProps, dragIdx, overIdx, ghost } = useReorder(blocks.length, move);
  const tag = useTagDrag(moveTag);
  const replace = (i: number, b: Block) => onChange(blocks.map((x, j) => (j === i ? b : x)));

  /** Enter — 이 블록을 반영하면서 **바로 뒤에** 새 블록을 만들고 거기로 넘어간다.
   *  ★「추가」에서 Enter 하면 **다음 것도 「추가」**다 (사용자 지시 2026-08-07) —
   *    이 탭 것을 이어 적는 흐름이 한 번에 끊기면 안 된다. */
  const enterAt = (i: number, b: Block) => {
    const nb = b.extra
      ? makeBlock(t("slots.extra"), [], { open: true, color: b.color, extra: true })
      : makeBlock(t("block.newBlock"), [], { open: true, color: b.color });
    auto.current.add(nb.id);
    const n = blocks.slice();
    n[i] = b;
    n.splice(i + 1, 0, nb);
    onChange(n);
    setEditId(nb.id);
  };

  /** Esc — Enter 로 딸려 나온 빈 블록이면 도로 거둔다 (안 그러면 꼬리에 빈 칸이 남는다) */
  const cancelAt = (i: number) => {
    const b = blocks[i];
    if (!auto.current.has(b.id) || b.tags.length) return;
    auto.current.delete(b.id);
    onChange(blocks.filter((_, j) => j !== i));
  };

  return (
    <div
      ref={zone.ref}
      data-block-list={libZone}
      style={{
        display: "flex",
        flexDirection: "column",
        // 저장소에서 끄는 중에만 자리를 알린다 — 1단계 점선, 2단계(지금 떼면 여기) 실선
        ...(libZone && zone.active
          ? {
              borderRadius: "var(--r-3)",
              outline: `1px ${zone.over ? "solid" : "dashed"} var(--accent)`,
              outlineOffset: 3,
              background: zone.over ? "var(--accent-bg)" : "transparent",
            }
          : null),
      }}
    >
      {blocks.map((b, i) => (
        <div key={b.id}>
          <DropLine active={dragIdx != null && overIdx === i && i !== dragIdx && i !== dragIdx + 1} />
          <div
            ref={(el) => {
              register(i)(el);
              tag.regRow(i)(el);
            }}
          >
            <BlockRow
              block={b}
              dup={dup}
              dragging={dragIdx === i}
              autoEdit={editId === b.id}
              onChange={(nb) => replace(i, nb)}
              onRemove={() => onChange(blocks.filter((_, j) => j !== i))}
              onEnter={(nb) => enterAt(i, nb)}
              onCancel={() => cancelAt(i)}
              // ★서랍이 닫혀 있으면 끌 곳이 없다 — 그때는 머리 클릭이 접기 그대로다
              onSave={
                libOpen
                  ? (e) =>
                      startDrag(e, { dir: "save", kind: "blocklib", block: b }, undefined, () =>
                        replace(i, { ...b, open: !b.open }),
                      )
                  : undefined
              }
              gripProps={handleProps(i)}
              tagDrag={{
                handle: (ci, label) => tag.handle(i, ci, label),
                draggingIndex: tag.from?.block === i ? tag.from.index : null,
                justDragged: tag.justDragged,
              }}
            />
          </div>
        </div>
      ))}

      <DropLine active={dragIdx != null && overIdx === blocks.length && dragIdx !== blocks.length - 1} />

      <div style={{ display: "flex", gap: "var(--sp-2)", marginLeft: 16, marginTop: 6 }}>
        <button
          data-block-add
          onClick={() => onChange([...blocks, makeBlock(t("block.newBlock"), [], { open: true })])}
          style={addBtn}
        >
          {t("block.add")}
        </button>
        {/* ★여러 개여도 된다 — 「추가」에서 Enter 로 이어 만들 수 있어야 하므로(사용자 지시
            2026-08-07) "하나뿐" 규칙과 어긋난다. 카드 저장은 **전부** 뺀다(cardBlocks) */}
        {allowExtra && (
          <button
            data-block-add-extra
            data-tip={t("block.extraHint")}
            onClick={() =>
              onChange([
                ...blocks,
                makeBlock(t("slots.extra"), [], { open: true, extra: true, color: "amber" }),
              ])
            }
            style={{ ...addBtn, color: "var(--warn)", borderColor: "var(--warn)" }}
          >
            {t("block.addExtra")}
          </button>
        )}
      </div>

      {/* 커서를 따라오는 고스트 — 포인터 방식은 브라우저가 잔상을 만들어 주지 않는다 */}
      {ghost && dragIdx != null && blocks[dragIdx] && (
        <DragGhost
          x={ghost.x}
          y={ghost.y}
          anchor="exact"
          style={{ width: ghost.w, borderRadius: "var(--r-3)" }}
        >
          <BlockRow
            block={{ ...blocks[dragIdx], open: false }}
            dup={dup}
            onChange={() => {}}
            onRemove={() => {}}
          />
        </DragGhost>
      )}

      {/* ── 칩 끌기의 표시들 — ★레이아웃을 밀지 않도록 전부 화면 좌표에 띄운다 ── */}
      {tag.from && tag.bar && (
        <div
          style={{
            position: "fixed",
            left: tag.bar.x,
            top: tag.bar.y,
            width: 3,
            height: tag.bar.h,
            borderRadius: 2,
            background: "var(--accent)",
            boxShadow: "0 0 0 2px var(--accent-bg)",
            zIndex: 901,
            pointerEvents: "none",
          }}
        />
      )}
      {tag.from && tag.box && (
        <div
          style={{
            position: "fixed",
            left: tag.box.x,
            top: tag.box.y,
            width: tag.box.w,
            height: tag.box.h,
            borderRadius: "var(--r-3)",
            border: "2px solid var(--accent)",
            zIndex: 901,
            pointerEvents: "none",
          }}
        />
      )}
      {tag.from && tag.ghost && (
        <div
          style={{
            position: "fixed",
            left: tag.ghost.x,
            top: tag.ghost.y,
            zIndex: 902,
            pointerEvents: "none",
            padding: "1px 7px",
            borderRadius: "var(--r-1)",
            background: "var(--chip-bg)",
            border: "1px solid var(--accent)",
            color: "var(--ink)",
            fontSize: "var(--text-2xs)",
            boxShadow: "var(--shadow-3)",
            whiteSpace: "nowrap",
          }}
        >
          {tag.label}
        </div>
      )}
    </div>
  );
}

const addBtn: React.CSSProperties = {
  fontSize: "var(--text-2xs)",
  color: "var(--ink-dim)",
  border: "1px dashed var(--line)",
  borderRadius: "var(--r-1)",
  padding: "2px 10px",
};

/** 놓일 자리 표시 — 자리를 벌려 아래 블록이 밀리므로 어디로 가는지 눈에 보인다. */
function DropLine({ active }: { active: boolean }) {
  return (
    <div
      style={{
        height: active ? 18 : 4,
        transition: "height 0.08s",
        display: "flex",
        alignItems: "center",
      }}
    >
      {active && (
        <div
          style={{
            width: "100%",
            height: 3,
            borderRadius: 2,
            background: "var(--accent)",
            boxShadow: "0 0 0 3px var(--accent-bg)",
          }}
        />
      )}
    </div>
  );
}
