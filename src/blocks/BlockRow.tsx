import { useI18n } from "../i18n";
import { useEffect, useRef, useState } from "react";
import { caretAfterTag, COLORS, EXTRA_COLOR, parseSegs, serializeBlock, type Block } from "../lib/blocks";
import { Chip, colorHex } from "./Chip";
import { useTagSuggest } from "./TagSuggest";
import { Icon } from "../components/Icon";

/** 블록 한 줄.
 *
 *  ★조작 문법:
 *   - 그립(⠿) 드래그    = 블록 순서 변경
 *   - 머리 클릭         = 접기/펼치기
 *   - 제목 더블클릭     = 이름 변경
 *   - 색점 클릭         = 색 순환
 *   - 본문(칩 영역) 클릭 = **블록 전체가 텍스트로** 바뀐다
 *   - **칩 드래그       = 태그 자리 옮기기** (다른 블록으로도)
 *   - 칩 휠             = 가중치 / **휠 클릭 = 가중치 초기화** / 우클릭 = 삭제
 *   - 편집 중 Enter        = 고친 것을 저장하고 편집을 끝낸다
 *   - 편집 중 Shift+Enter  = 저장하고 **다음 블록을 만들어 이어서 입력**
 *   - 편집 중 Esc       = 편집만 끝낸다
 *
 *  ★가중치는 태그에만 있다. 블록 가중치는 걷어냈다 (2026-08-01). */
export function BlockRow({
  block,
  dup,
  onChange,
  onRemove,
  onEnter,
  onCancel,
  onSave,
  autoEdit,
  gripProps,
  tagDrag,
  dragging,
}: {
  block: Block;
  dup: Set<string>;
  onChange: (b: Block) => void;
  onRemove: () => void;
  /** 저장소로 **끌어 넣기** — 머리를 잡고 서랍에 놓는다 (사용자 지시 2026-08-13).
   *  ★단추가 아니다: 넣는 것도 꺼내는 것도 같은 동작이라야 규칙이 하나로 남는다. */
  onSave?: (e: React.PointerEvent) => void;
  /** Enter — 고친 내용과 함께. **한 번에** 넘겨야 목록이 두 번 갈리지 않는다 */
  onEnter?: (b: Block) => void;
  /** Esc — 고치던 것을 버리고 나간다 */
  onCancel?: () => void;
  /** 방금 만들어진 블록 — 뜨자마자 편집 상태로 */
  autoEdit?: boolean;
  gripProps?: React.HTMLAttributes<HTMLSpanElement>;
  /** 칩 끌기 (`useTagDrag`) — 목록이 들고 있는 것을 이 블록 몫만 받는다 */
  tagDrag?: {
    handle: (chipIndex: number, label: string) => React.HTMLAttributes<HTMLSpanElement>;
    draggingIndex: number | null;
    justDragged: () => boolean;
  };
  dragging?: boolean;
}) {
  const t = useI18n((s) => s.t);
  const [editing, setEditing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [text, setText] = useState("");
  const ta = useRef<HTMLTextAreaElement>(null);
  /** Enter 로 넘어갈 때 뒤따르는 blur 이 한 번 더 반영하지 않게 */
  const skipBlur = useRef(false);
  const ac = useTagSuggest(text, setText, ta);

  /** 편집을 열 때 커서를 놓을 자리. `null` 이면 맨 뒤 */
  const caretAt = useRef<number | null>(null);

  useEffect(() => {
    if (!editing) return;
    const el = ta.current;
    if (!el) return;
    el.focus();
    // ★★**전체 선택을 하지 않는다** (사용자 지시 2026-08-18). 예전에는 `select()` 라
    //   열자마자 다 잡혀서, 뭐든 한 글자 치면 **블록이 통째로 지워졌다.**
    //   누른 칩이 있으면 그 태그의 쉼표 뒤에, 없으면 맨 뒤에 커서만 놓는다.
    const at = caretAt.current ?? el.value.length;
    el.setSelectionRange(at, at);
    caretAt.current = null;
  }, [editing]);

  /** @param at 커서를 놓을 글자 자리 (안 주면 맨 뒤)
   *  @param txt 열면서 넣을 글 (안 주면 블록을 그대로 편다) */
  const openText = (at?: number, txt?: string) => {
    caretAt.current = at ?? null;
    setText(txt ?? serializeBlock(block));
    setEditing(true);
  };

  // 갓 만들어진 블록은 뜨자마자 입력 상태 — Enter 로 이어 적을 수 있어야 한다
  useEffect(() => {
    if (autoEdit) openText();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoEdit]);

  const commitText = () => {
    if (skipBlur.current) {
      skipBlur.current = false;
      return;
    }
    onChange({ ...block, tags: parseSegs(text) });
    setEditing(false);
  };

  const summary = block.tags.map((x) => x.t).join(", ") || t("block.emptySummary");

  return (
    <div
      data-block={block.id}
      data-extra={block.extra ? "" : undefined}
      style={{
        border: "1px solid var(--line)",
        borderLeftWidth: block.extra ? 4 : 3,
        borderLeftColor: block.extra ? EXTRA_COLOR : colorHex(block.color),
        borderRadius: "var(--r-3)",
        background: "var(--surface)",
        opacity: dragging ? 0.35 : block.on ? 1 : 0.45,
        // ★「추가」는 **한눈에 다르게** 보여야 한다 — 점선 테두리 + 옅게 물들인 바탕.
        //   카드에 안 담기는 블록이라는 것을 겉모습이 알린다 (사용자 지시 2026-08-07)
        ...(block.extra
          ? {
              borderStyle: "dashed",
              borderColor: `color-mix(in srgb, ${EXTRA_COLOR} 55%, var(--line))`,
              borderLeftStyle: "solid",
              background: `color-mix(in srgb, ${EXTRA_COLOR} 7%, var(--surface))`,
            }
          : null),
      }}
    >
      {/* 머리 */}
      <div
        data-block-head
        // ★머리는 **두 가지**를 한다: 그냥 누르면 접기/펼치기, 끌면 저장소로 넣기.
        //   문턱(4px)을 넘어야 끌기가 되고, 안 넘기면 `onTap` 이 접기를 한다 —
        //   카드 배너의 역드래그 저장과 같은 규칙이다 (`useDragSource`).
        // ★★머리 위의 **누르는 것들**(색·이름·토글·삭제)은 끌기에서 비켜 간다.
        //   안 비키면 `pointerdown` 의 기본 동작 막기가 **호환 click 을 삼켜** 그 단추들이
        //   통째로 죽는다 — 저장소를 열었을 때만 죽어서 원인이 안 보였다 (실측 2026-08-16).
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button, [data-head-action]")) return;
          onSave?.(e);
        }}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("button, [data-head-action]")) return;
          // 끌기 제스처가 잡았으면 클릭은 오지 않는다 (pointerdown 에서 기본 동작을 막는다)
          if (!onSave) onChange({ ...block, open: !block.open });
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-2)",
          padding: "4px 7px 4px 3px",
          minHeight: 28,
          cursor: "pointer",
        }}
      >
        <span
          {...gripProps}
          onClick={(e) => e.stopPropagation()}
          style={{
            color: "var(--ink-faint)",
            fontSize: 11,
            lineHeight: 1,
            padding: "0 4px",
            userSelect: "none",
            display: "grid",
            ...(gripProps?.style ?? {}),
          }}
        >
          {Icon.grip}
        </span>

        {/* ★「추가」는 **색을 못 고른다** — 네모난 고정 표식이라 동그란 색점과 구별된다 */}
        {block.extra ? (
          <span
            data-tip={t("block.extraHint")}
            style={{
              width: 10,
              height: 10,
              flexShrink: 0,
              borderRadius: 2,
              background: EXTRA_COLOR,
            }}
          />
        ) : (
          <span
            data-head-action
            data-block-color
            onClick={(e) => {
              e.stopPropagation();
              const i = COLORS.indexOf(block.color);
              onChange({ ...block, color: COLORS[(i + 1) % COLORS.length] });
            }}
            data-tip={t("block.color")}
            style={{
              width: 10,
              height: 10,
              flexShrink: 0,
              borderRadius: "50%",
              border: "1px solid var(--line)",
              background: block.color ? colorHex(block.color) : "transparent",
            }}
          />
        )}

        {block.extra ? (
          // ★이름 고정 — 더블클릭해도 안 바뀐다. 대문자 라벨로 "칸의 종류"임을 알린다
          <b
            data-tip={t("block.extraHint")}
            style={{
              fontSize: "var(--text-2xs)",
              fontWeight: "var(--w-bold)",
              color: EXTRA_COLOR,
              letterSpacing: "0.06em",
              whiteSpace: "nowrap",
              userSelect: "none",
            }}
          >
            {t("slots.extra")}
          </b>
        ) : renaming ? (
          <input
            autoFocus
            defaultValue={block.label}
            onBlur={(e) => {
              onChange({ ...block, label: e.target.value.trim() || block.label });
              setRenaming(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setRenaming(false);
            }}
            onClick={(e) => e.stopPropagation()}
            style={{
              fontSize: "var(--text-xs)",
              fontWeight: "var(--w-bold)",
              background: "var(--surface2)",
              border: "1px solid var(--accent)",
              borderRadius: "var(--r-1)",
              padding: "0 4px",
              width: 110,
            }}
          />
        ) : (
          <b
            onDoubleClick={(e) => {
              e.stopPropagation();
              setRenaming(true);
            }}
            style={{ fontSize: "var(--text-xs)", whiteSpace: "nowrap", userSelect: "none" }}
          >
            {block.label}
          </b>
        )}

        {/* 접힌 동안만 요약 — 펼치면 정보 중복이라 숨긴다 */}
        {!block.open ? (
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: "var(--text-2xs)",
              color: "var(--ink-dim)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {summary}
          </span>
        ) : (
          <span style={{ flex: 1 }} />
        )}

        {/* ★태그 개수를 적지 않는다 (사용자 지시 2026-08-13) — 접혀 있으면 요약이 이미
            보이고 펼치면 칩이 다 보인다. 한 줄에 정보가 너무 많았다 */}
        {/* ★★차례는 앱 전체에서 하나다: **이름변경 · 온오프 · 삭제** (사용자 지시 2026-08-19).
            ★「추가」 블록은 이름을 못 바꾼다 (칸의 종류라 이름이 고정이다) */}
        {!block.extra && (
          <button
            data-block-rename={block.id}
            onClick={(e) => {
              e.stopPropagation();
              setRenaming(true);
            }}
            data-tip={t("cards.rename")}
            style={{ color: "var(--ink-faint)", padding: "0 2px", display: "grid" }}
          >
            {Icon.pencil}
          </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onChange({ ...block, on: !block.on });
          }}
          data-tip={block.on ? t("block.toggleOff") : t("block.toggleOn")}
          style={{ color: "var(--ink-faint)", padding: "0 2px", display: "grid" }}
        >
          {block.on ? Icon.dotOn : Icon.dotOff}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          data-tip={t("block.remove")}
          style={{ color: "var(--ink-faint)", padding: "0 2px", display: "grid" }}
        >
          {Icon.close12}
        </button>
      </div>

      {/* 본문 */}
      {block.open && (
        <div style={{ padding: "0 8px 7px" }}>
          {editing ? (
            <textarea
              ref={ta}
              value={text}
              onChange={ac.onChange}
              onBlur={commitText}
              onKeyDown={(e) => {
                // ★자동완성이 떠 있으면 Enter·Esc·방향키는 **그쪽 것**이다
                if (ac.onKeyDown(e)) return;
                // ★★`Enter` = **저장하고 끝낸다**, `Shift+Enter` = 저장하고 **다음 블록**
                //   (사용자 지시 2026-08-19). 예전에는 맨 Enter 가 새 블록을 만들어서,
                //   한 블록만 고치려던 사람이 빈 블록을 계속 만들게 됐다.
                if (e.key === "Enter") {
                  e.preventDefault();
                  // ★고친 내용과 "새 블록"을 **한 번에** 넘긴다 — 따로 부르면 뒤 호출이
                  //   앞 호출의 결과를 못 보고 덮어쓴다 (둘 다 같은 목록을 들고 있다)
                  if (e.shiftKey && onEnter) {
                    skipBlur.current = true;
                    setEditing(false);
                    onEnter({ ...block, tags: parseSegs(text) });
                  } else (e.target as HTMLTextAreaElement).blur();
                }
                if (e.key === "Escape") {
                  skipBlur.current = true;
                  setEditing(false);
                  onCancel?.();
                }
              }}
              rows={Math.min(8, Math.max(2, Math.ceil(text.length / 46)))}
              style={{
                width: "100%",
                background: "var(--code-bg)",
                border: "1px solid var(--accent)",
                borderRadius: "var(--r-1)",
                padding: "var(--sp-2)",
                fontFamily: "var(--font-mono)",
                fontSize: "var(--text-2xs)",
                lineHeight: 1.5,
                resize: "vertical",
              }}
            />
          ) : null}
          {/* ★목록은 편집 중에만 — textarea 가 사라져도 떠 있으면 화면에 남는다 */}
          {editing && ac.node}
          {!editing && (
            <div
              data-chips
              onClick={(e) => {
                // 칩을 끌고 난 직후의 클릭은 편집을 열지 않는다
                if (tagDrag?.justDragged()) return;
                // ★누른 칩이 있으면 커서를 **그 태그의 쉼표 뒤**에 놓는다 (사용자 지시 2026-08-19).
                //   칩과 글 상자는 배치가 달라 클릭 좌표를 글자 자리로 옮기는 것은 어긋나므로,
                //   "몇 번째 태그를 눌렀나"로 잡는다 — 그 편이 어긋날 일이 없다.
                //   ★태그 **끝**에 놓으면 치는 글자가 그 태그에 달라붙는다. 칩을 누르는 것은
                //     거기서부터 이어 적으려는 것이라, 자리는 다음 태그가 시작하는 곳이다.
                const box = e.currentTarget;
                const hit = (e.target as HTMLElement).closest("[data-chip]");
                const i = hit ? [...box.querySelectorAll("[data-chip]")].indexOf(hit) : -1;
                // ★빈 자리를 눌러도 **이어 적는 자리**로 연다 (사용자 지시 2026-08-19) —
                //   마지막 칩을 누른 것과 같은 뜻이라, 쉼표까지 같이 만들어 준다
                if (i < 0) {
                  if (!block.tags.length) return openText();
                  const last = caretAfterTag(block, block.tags.length - 1);
                  return openText(last.at, last.text);
                }
                const { at, text } = caretAfterTag(block, i);
                openText(at, text);
              }}
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 4,
                minHeight: "1.5em",
                cursor: "text",
                minWidth: 0,
              }}
            >
              {block.tags.length === 0 && (
                <span style={{ fontSize: "var(--text-2xs)", color: "var(--ink-faint)" }}>
                  {t("block.clickToInput")}
                </span>
              )}
              {block.tags.map((tag, i) => (
                <Chip
                  key={i}
                  tag={tag}
                  dup={dup.has(tag.t.trim().toLowerCase())}
                  dragProps={tagDrag?.handle(i, tag.t)}
                  dragging={tagDrag?.draggingIndex === i}
                  onWeight={(w) => {
                    const tags = block.tags.slice();
                    tags[i] = { ...tag, w };
                    onChange({ ...block, tags });
                  }}
                  onRemove={() =>
                    onChange({ ...block, tags: block.tags.filter((_, j) => j !== i) })
                  }
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
