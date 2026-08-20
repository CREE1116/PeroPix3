import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { caretAfterTag, parseSegs, serializeBlock, type Block } from "../lib/blocks";
import { Chip } from "./Chip";
import { useTagSuggest } from "./TagSuggest";

/** 칩 끌기 손잡이 — 목록이 들고 있는 것을 이 블록 몫만 받는다 (`useTagDrag`) */
export type TagDrag = {
  handle: (chipIndex: number, label: string) => React.HTMLAttributes<HTMLSpanElement>;
  draggingIndex: number | null;
  justDragged: () => boolean;
};

/** 블록의 **본문** — 칩 줄과, 그것을 눌렀을 때 열리는 글 상자.
 *
 *  ★★**머리가 없다.** 그래서 머리를 그리는 곳(`BlockRow`)과 머리가 없는 곳(씬 칸,
 *    `SlotBlock`)이 **같은 부품**을 쓴다 — 칩 클릭으로 열리는 자리, 커서를 놓는 규칙,
 *    자동완성, Enter·Esc 가 두 벌로 갈리지 않는다 (사용자 지시 2026-08-20: 씬 칸도 블록으로).
 *
 *  ★조작 (앱 전체에서 같다):
 *   - 칩 클릭        = 그 태그의 **쉼표 뒤**에 커서를 놓고 글 상자를 연다
 *   - 빈 자리 클릭   = 맨 뒤에 이어 적는다
 *   - 칩 휠          = 가중치 · 휠 클릭 = 초기화 · 우클릭 = 삭제
 *   - 칩 드래그      = 자리 옮기기 (`tagDrag` 를 준 곳에서만)
 *   - Enter          = 저장하고 끝낸다 (`onDone` 이 있으면 그것까지)
 *   - Shift+Enter    = 저장하고 **다음 것으로** (`onEnter`)
 *   - Tab            = 저장하고 **옆으로** (`onTab` 을 준 곳에서만 — 씬 칸)
 *   - Esc            = 고치던 것을 버리고 끝낸다
 */
export function BlockBody({
  block,
  readOnly,
  onChange,
  dup,
  tagDrag,
  autoEdit,
  mark,
  onEnter,
  onCancel,
  onDone,
  onTab,
  onOpen,
}: {
  block: Block;
  /** 보여 주기만 하는 자리 (블록 저장소) — 칩도 글 상자도 안 먹는다 */
  readOnly?: boolean;
  onChange: (b: Block) => void;
  /** 켜진 블록들에서 겹치는 태그 (계기판 — 고치지 않고 표시만) */
  dup?: Set<string>;
  tagDrag?: TagDrag;
  /** 뜨자마자 글 상자를 연다 — 갓 만든 블록 · `Tab` 으로 건너온 씬 칸 ·
   *  접힌 씬 칸의 칩을 누른 경우 */
  autoEdit?: boolean;
  /** 조작 테스트가 잡는 손잡이 — `data-block-text` 값 */
  mark?: string;
  /** Shift+Enter — 고친 내용과 함께. **한 번에** 넘겨야 목록이 두 번 갈리지 않는다 */
  onEnter?: (b: Block) => void;
  /** Esc — 고치던 것을 버리고 나간다 */
  onCancel?: () => void;
  /** Enter 로 끝냈을 때 뒤따르는 일 (씬 칸은 줄을 접는다) */
  onDone?: () => void;
  /** Tab — 옆 씬의 같은 칸으로 (v2 index.html:11821-11832) */
  onTab?: (dir: 1 | -1) => void;
  /** 글 상자가 열렸다 — 잘라 보여 주던 부모가 **자리를 내준다** */
  onOpen?: () => void;
}) {
  const t = useI18n((s) => s.t);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const ta = useRef<HTMLTextAreaElement>(null);
  const ac = useTagSuggest(text, setText, ta);
  /** 편집을 열 때 커서를 놓을 자리. `null` 이면 맨 뒤 */
  const caretAt = useRef<number | null>(null);
  /** Enter·Esc 로 넘어갈 때 뒤따르는 blur 이 한 번 더 반영하지 않게 */
  const skipBlur = useRef(false);

  /** ★★글 상자는 **적은 글이 다 보이게** 커진다 (사용자 지시 2026-08-20).
   *
   *  예전에는 줄 수를 **글자 수로 어림**했다(`rows = 글자수 / 46`). 46 은 어디서도 맞지 않는
   *  숫자였다 — 씬 줄 머리는 사용자가 폭을 끌고(`laneHeadW`), 카드 편집기는 460px 이고,
   *  프롬프트 패널은 또 다르다. 게다가 8줄에서 잘려 **긴 프롬프트는 스크롤해야** 보였다.
   *  이제 **실제로 그려 본 높이**(`scrollHeight`)를 그대로 쓴다.
   *  ★폭이 바뀌면 줄바꿈이 달라지므로 다시 잰다 — 재는 것은 **품(parent)의 폭**이다.
   *    글 상자 자신을 지켜보면 우리가 높이를 고칠 때마다 다시 불려 맴돈다. */
  const fit = () => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };
  useLayoutEffect(fit, [text, editing]);
  useEffect(() => {
    const el = ta.current?.parentElement;
    if (!editing || !el) return;
    let w = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === w) return;
      w = el.clientWidth;
      fit();
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  /** ★★**사라질 때도 반영한다.** React 의 `onBlur` 은 **언마운트에는 오지 않는다**
   *  (CLAUDE.md 의 잊기 쉬운 것). 씬 칸은 글 상자 밖을 누르면 줄이 접혀 상자가 통째로
   *  사라지므로, blur 만 믿으면 **치던 글이 사라진다.** 마지막 값을 여기 들고 있다가
   *  정리할 때 흘려보낸다 — Esc 로 버리고 나간 경우만 뺀다. */
  const live = useRef({ editing: false, text: "", block, onChange, dropped: false });
  live.current.editing = editing;
  live.current.text = text;
  live.current.block = block;
  live.current.onChange = onChange;
  useEffect(
    () => () => {
      const l = live.current;
      if (l.editing && !l.dropped) l.onChange({ ...l.block, tags: parseSegs(l.text) });
    },
    [],
  );

  useEffect(() => {
    if (!editing) return;
    const el = ta.current;
    if (!el) return;
    el.focus();
    // ★★**전체 선택을 하지 않는다** (사용자 지시 2026-08-18). 열자마자 다 잡혀 있으면
    //   뭐든 한 글자 치는 순간 블록이 통째로 지워진다.
    const at = caretAt.current ?? el.value.length;
    el.setSelectionRange(at, at);
    caretAt.current = null;
  }, [editing]);

  /** @param at 커서를 놓을 글자 자리 (안 주면 맨 뒤)
   *  @param txt 열면서 넣을 글 (안 주면 블록을 그대로 편다) */
  const openText = (at?: number | null, txt?: string) => {
    if (readOnly) return;
    /* ★★**표식들을 열 때 지운다** (사용자 지적 2026-08-19: *"esc로 취소 → 다시 입력하고
       엔터를 누르면 아무 반응 없음"*). `Esc`·`Shift+Enter` 는 표식을 세운 뒤 곧바로
       textarea 를 언마운트하는데, 언마운트에는 React 의 `onBlur` 이 오지 않아 표식이
       **다음 편집까지 살아남았다.** */
    skipBlur.current = false;
    live.current.dropped = false;
    caretAt.current = at ?? null;
    setText(txt ?? serializeBlock(block));
    setEditing(true);
    onOpen?.();
  };

  /** `i` 번째 태그 **뒤에서** 이어 적는다 (`i < 0` 이면 맨 뒤 — 빈 자리를 눌렀을 때) */
  const openAt = (i: number) => {
    if (i < 0) {
      if (!block.tags.length) return openText();
      const last = caretAfterTag(block, block.tags.length - 1);
      return openText(last.at, last.text);
    }
    const { at, text: txt } = caretAfterTag(block, i);
    openText(at, txt);
  };

  // 열어 달라고 하고 뜬 자리 (갓 만들어진 블록 · `Tab` 으로 건너온 씬 칸 · 접힌 줄의 칩)
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

  /** 고친 것을 반영하고 편집을 닫는다 — blur 이 한 번 더 하지 않게 표식을 세운다 */
  const commitNow = (): Block => {
    skipBlur.current = true;
    setEditing(false);
    const b = { ...block, tags: parseSegs(text) };
    onChange(b);
    return b;
  };

  /** ★★칩 줄과 글 상자는 **같은 상자**다 (사용자 지적 2026-08-20:
   *  *"블록 텍스트 편집 영역이 실제 보이는 것보다 좁음"*).
   *  글 상자에만 안팎 여백과 테두리가 있었던 탓에, 칩으로 보이던 것보다 **글 쓰는 폭이
   *  14px 좁았다** — 같은 글이 편집으로 들어가는 순간 줄이 하나 더 늘어났다.
   *  테두리는 **투명으로라도 자리를 잡아 둔다** — 있고 없고가 곧 폭 차이다. */
  const box: React.CSSProperties = {
    width: "100%",
    minWidth: 0,
    padding: "3px 6px",
    borderWidth: 1,
    borderStyle: "solid",
    borderRadius: "var(--r-1)",
  };

  return (
    <>
      {editing ? (
        <>
          <textarea
            ref={ta}
            data-block-text={mark ?? ""}
            value={text}
            onChange={ac.onChange}
            onBlur={commitText}
            onKeyDown={(e) => {
              // ★자동완성이 떠 있으면 Enter·Esc·방향키는 **그쪽 것**이다
              if (ac.onKeyDown(e)) return;
              if (e.key === "Tab" && onTab) {
                e.preventDefault();
                commitNow();
                onTab(e.shiftKey ? -1 : 1);
                return;
              }
              /* ★★`Enter` = **저장하고 끝낸다**, `Shift+Enter` = 저장하고 **다음 것**
                 (사용자 지시 2026-08-19). 예전에는 맨 Enter 가 새 블록을 만들어서,
                 한 블록만 고치려던 사람이 빈 블록을 계속 만들게 됐다. */
              if (e.key === "Enter") {
                e.preventDefault();
                // ★고친 내용과 "다음 것"을 **한 번에** 넘긴다 — 따로 부르면 뒤 호출이
                //   앞 호출의 결과를 못 보고 덮어쓴다 (둘 다 같은 목록을 들고 있다)
                if (e.shiftKey && onEnter) {
                  skipBlur.current = true;
                  setEditing(false);
                  onEnter({ ...block, tags: parseSegs(text) });
                } else if (onDone) {
                  commitNow();
                  onDone();
                } else (e.target as HTMLTextAreaElement).blur();
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                skipBlur.current = true;
                live.current.dropped = true;
                setEditing(false);
                onCancel?.();
              }
            }}
            rows={1}
            style={{
              ...box,
              background: "var(--code-bg)",
              borderColor: "var(--accent)",
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-2xs)",
              lineHeight: 1.5,
              /* ★손잡이를 두지 않는다 — 높이는 **글이 정한다**. 손으로 줄여 놔도
                 다음 글자에 도로 늘어나므로, 있으면 고장으로 읽힌다 */
              resize: "none",
              overflow: "hidden",
            }}
          />
          {/* 목록은 **편집 중에만** — textarea 가 사라져도 떠 있으면 화면에 남는다 */}
          {ac.node}
        </>
      ) : (
        <div
          data-chips
          onClick={(e) => {
            // 칩을 끌고 난 직후의 클릭은 편집을 열지 않는다
            if (tagDrag?.justDragged()) return;
            // ★누른 칩이 있으면 커서를 **그 태그의 쉼표 뒤**에 놓는다 (사용자 지시 2026-08-19).
            //   칩과 글 상자는 배치가 달라 클릭 좌표를 글자 자리로 옮기는 것은 어긋나므로,
            //   "몇 번째 태그를 눌렀나"로 잡는다 — 그 편이 어긋날 일이 없다.
            const box = e.currentTarget;
            const hit = (e.target as HTMLElement).closest("[data-chip]");
            // ★빈 자리를 눌러도 **이어 적는 자리**로 연다 (사용자 지시 2026-08-19)
            openAt(hit ? [...box.querySelectorAll("[data-chip]")].indexOf(hit) : -1);
          }}
          style={{
            ...box,
            // ★테두리는 **투명으로 자리만** 잡는다 — 글 상자와 폭이 어긋나지 않게
            borderColor: "transparent",
            display: "flex",
            flexWrap: "wrap",
            gap: 4,
            minHeight: "calc(1.5em + 8px)",
            cursor: readOnly ? "inherit" : "text",
          }}
        >
          {block.tags.length === 0 && (
            <span style={{ fontSize: "var(--text-2xs)", color: "var(--ink-faint)" }}>
              {/* ★★빈 자리 문구는 **부품이 정한다** — 부르는 쪽이 넘기면 화면마다 달라진다
                  (사용자 지적 2026-08-20: 씬 칸만 다른 문구였다). 갈리는 기준은 스위치 하나:
                  고칠 수 있으면 「클릭해서 입력」, 보기 전용이면 「비어 있음」이다. */}
              {t(readOnly ? "block.emptySummary" : "block.clickToInput")}
            </span>
          )}
          {block.tags.map((tag, i) => (
            <Chip
              key={i}
              tag={tag}
              readOnly={readOnly}
              dup={!!dup?.has(tag.t.trim().toLowerCase())}
              dragProps={tagDrag?.handle(i, tag.t)}
              dragging={tagDrag?.draggingIndex === i}
              onWeight={(w) => {
                const tags = block.tags.slice();
                tags[i] = { ...tag, w };
                onChange({ ...block, tags });
              }}
              onRemove={() => onChange({ ...block, tags: block.tags.filter((_, j) => j !== i) })}
            />
          ))}
        </div>
      )}
    </>
  );
}
