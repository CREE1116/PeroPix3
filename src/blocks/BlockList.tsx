import { useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { dupSet, makeBlock, type Block } from "../lib/blocks";
import { useReorder } from "../lib/useReorder";
import { useTagDrag, type Spot } from "./useTagDrag";
import { TagDragLayer } from "./TagDragLayer";
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
 *    칩 하나하나를 블록 모양으로 만든 까닭이 이것이다 (사용자 2026-08-07).
 *
 *  ★★**블록을 고치는 자리는 앱에 이것 하나다** (사용자 지적 2026-08-20:
 *    *"네가 실제로 동일한 컴포넌트를 쓰는게 아니고 복제해서 만드니까 불일치가 계속 생김"*).
 *    씬 칸은 예전에 `SlotBlock` 이라는 **따로 만든 부품**이었는데, 칩 끌기·서랍 드롭존·
 *    드래그 표시·중복 검사를 각자 한 벌씩 들고 있어 조작이 계속 어긋났다.
 *    이제 씬 칸은 **이 목록의 `single` 모드**다 — 배선이 한 벌뿐이라 어긋날 자리가 없다.
 *
 *  `single` 이 바꾸는 것은 넷뿐이다:
 *    1. 블록이 **하나뿐**이다 — 「+ 블록」도, 블록 사이 끼우기도 없다.
 *    2. 머리(이름·색·켜고끄기·삭제)를 안 그린다 (`BlockRow bare`) — 칸 이름은 줄 머리에 있다.
 *    3. 서랍에서 받으면 **태그가 뒤에 붙는다** (블록을 더하는 게 아니라).
 *    4. `clamp` 를 주면 넘치는 만큼 자르고 `+n` 으로 알린다 (씬 줄이 접혀 있을 때). */
export function BlockList({
  blocks,
  onChange,
  libZone,
  single,
  id,
  clamp,
  bg,
  autoEdit,
  onMore,
  onOpen,
  onDone,
  onNext,
  onTab,
}: {
  blocks: Block[];
  onChange: (b: Block[]) => void;
  /** 저장소에서 끌어온 블록을 받을 자리인가 — **화면에서 유일한 id** 를 준다.
   *  ★목록이 여럿이라(베이스·UC·캐릭터마다·씬 칸마다) id 가 겹치면 엉뚱한 곳에 떨어진다 */
  libZone?: string;
  /** 블록이 **하나뿐인** 자리인가 (씬 칸). 위 머리 주석의 넷이 달라진다 */
  single?: boolean;
  /** `single` 일 때 이 자리를 가리키는 이름 — `data-slot-block` 으로 나간다 */
  id?: string;
  /** 자리가 좁아 **잘라 보여 주는** 상태인가. 넘치는 칩 수를 `+n` 으로 낸다 */
  clamp?: boolean;
  /** `+n` 뒤에 깔 바탕 — 잘린 칩 위에 뜨므로 줄 바탕과 같아야 글자가 읽힌다 */
  bg?: string;
  /** 떠오르자마자 글 상자를 연다 (`Tab` 으로 건너온 씬 칸) */
  autoEdit?: boolean;
  /** `+n` 을 눌렀다 — 치려는 게 아니라 **다 보려는** 것이다 */
  onMore?: () => void;
  /** 글 상자가 열렸다 — 잘라 보여 주던 부모가 **자리를 내준다** */
  onOpen?: () => void;
  /** Enter 로 편집을 끝냈다 (씬 줄은 도로 접는다) */
  onDone?: () => void;
  /** Shift+Enter — `single` 에서는 새 블록 대신 **다음 칸**으로 간다 */
  onNext?: () => void;
  /** Tab — 옆 칸으로 */
  onTab?: (dir: 1 | -1) => void;
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
      const got = itemToBlock(d.item);
      // ★`single` 은 블록을 더할 수 없다 — 태그를 **뒤에 붙인다**
      if (!single) return onChange([...blocks, got]);
      const b = blocks[0];
      if (b) onChange([{ ...b, tags: [...b.tags, ...got.tags] }]);
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
   *  ★`single` 에서는 만들 자리가 없다 — 반영만 하고 **옆 칸**으로 넘긴다 (`onNext`). */
  const enterAt = (i: number, b: Block) => {
    if (single) {
      replace(i, b);
      onNext?.();
      return;
    }
    const nb = makeBlock(t("block.newBlock"), [], { open: true, color: b.color });
    auto.current.add(nb.id);
    const n = blocks.slice();
    n[i] = b;
    n.splice(i + 1, 0, nb);
    onChange(n);
    setEditId(nb.id);
  };

  /** Esc — Enter 로 딸려 나온 빈 블록이면 도로 거둔다 (안 그러면 꼬리에 빈 칸이 남는다) */
  const cancelAt = (i: number) => {
    if (single) return onDone?.();
    const b = blocks[i];
    if (!auto.current.has(b.id) || b.tags.length) return;
    auto.current.delete(b.id);
    onChange(blocks.filter((_, j) => j !== i));
  };

  /** 잘려 안 보이는 칩이 몇 개인가 — ★칩은 **다 그려 두고** 넘치는 것만 잘린다
   *  (`overflow: hidden`). 자리를 실제로 차지해 봐야 셀 수 있으므로 지우지 않고 재기만
   *  한다. 그래서 잘린 칩도 **끌 수 있고 서랍 드롭도 받는다** — 진짜 블록 그대로다. */
  const box = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(0);
  const tagKey = blocks.map((b) => b.tags.map((x) => `${x.t}${x.w ?? ""}`).join("|")).join("//");
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !clamp) return setOver(0);
    const measure = () => {
      const h = el.clientHeight;
      const kids = [...el.querySelectorAll<HTMLElement>("[data-chip]")];
      // ★1px 은 봐준다 — 소수점 높이에서 마지막 줄이 통째로 잘린 것처럼 세어진다
      setOver(kids.filter((k) => k.offsetTop + k.offsetHeight > h + 1).length);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // ★태그를 **글로 굳혀** 의존한다 — 배열은 다시 그릴 때마다 새것이라, 그대로 걸면
    //   측정을 붙였다 뗐다 한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clamp, tagKey]);

  return (
    <div
      ref={(el) => {
        box.current = el;
        (zone.ref as React.MutableRefObject<HTMLDivElement | null>).current = el;
      }}
      data-block-list={libZone}
      data-slot-block={single ? id : undefined}
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
        /* ★자리가 좁으면 **자른다** — 줄 높이는 오른쪽 썸네일이 정하는 것이라 늘릴 수 없다.
           `+n` 이 그 위에 뜨고, 누르면 부모가 자리를 내준다 */
        ...(clamp ? { position: "relative", flex: 1, minWidth: 0, minHeight: 0, overflow: "hidden" } : null),
      }}
    >
      {blocks.map((b, i) => (
        <div key={b.id}>
          {!single && (
            <DropLine active={dragIdx != null && overIdx === i && i !== dragIdx && i !== dragIdx + 1} />
          )}
          <div
            ref={(el) => {
              register(i)(el);
              tag.regRow(i)(el);
            }}
          >
            <BlockRow
              block={b}
              bare={single}
              dup={dup}
              dragging={dragIdx === i}
              autoEdit={editId === b.id || (!!single && !!autoEdit)}
              onChange={(nb) => replace(i, nb)}
              onRemove={() => onChange(blocks.filter((_, j) => j !== i))}
              onEnter={(nb) => enterAt(i, nb)}
              onCancel={() => cancelAt(i)}
              onDone={onDone}
              onOpen={onOpen}
              onTab={onTab}
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

      {!single && (
        <>
          <DropLine active={dragIdx != null && overIdx === blocks.length && dragIdx !== blocks.length - 1} />
          <div style={{ display: "flex", gap: "var(--sp-2)", marginLeft: 16, marginTop: 6 }}>
            <button
              data-block-add
              onClick={() => onChange([...blocks, makeBlock(t("block.newBlock"), [], { open: true })])}
              style={addBtn}
            >
              {t("block.add")}
            </button>
          </div>
        </>
      )}

      {clamp && over > 0 && (
        <button
          data-slot-more={id}
          onClick={(e) => {
            e.stopPropagation();
            onMore?.();
          }}
          style={{
            position: "absolute",
            right: 0,
            bottom: 0,
            padding: "1px 6px 1px 12px",
            borderRadius: "var(--r-1)",
            /* 잘린 칩 위에 뜨므로 왼쪽을 흐리게 빼서 글자가 겹쳐 읽히지 않게 한다 */
            background: `linear-gradient(90deg, transparent, ${bg ?? "var(--surface)"} 45%)`,
            color: "var(--ink-faint)",
            fontSize: "var(--text-2xs)",
            fontFamily: "var(--font-mono)",
          }}
        >
          +{over}
        </button>
      )}

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

      <TagDragLayer tag={tag} />
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
