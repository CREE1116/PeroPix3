import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  currentWord,
  formatCount,
  loadTags,
  searchTags,
  tagsLoaded,
  underscoresToSpaces,
  type TagEntry,
} from "../lib/tagData";

/** 자동완성이 붙을 수 있는 입력칸 — 여러 줄(블록·슬롯)과 한 줄(공통 접두) 둘 다 */
type Field = HTMLTextAreaElement | HTMLInputElement;

/** 태그 자동완성 — 페로픽스파이 `TagAutocompleteTextarea` 에서 이식.
 *
 *  거기서는 textarea 를 감싼 컴포넌트였지만, 여기서는 **훅**이다. 블록의 textarea 는
 *  Enter·Esc 에 이미 제 뜻(다음 블록 만들기 / 편집 끝내기)이 있어서, 자동완성이
 *  **먼저 먹을지**를 그 자리에서 판단해야 하기 때문이다 (`onKeyDown` 이 true 를 돌려주면
 *  자동완성이 가져간 것).
 *
 *  ★가중치 조작(Alt+휠·드래그)은 안 가져왔다 — 여기서는 **칩 휠**이 그 일을 한다. */
export function useTagSuggest(
  value: string,
  setValue: (v: string) => void,
  ref: React.RefObject<Field | null>,
) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<TagEntry[]>([]);
  const [sel, setSel] = useState(0);
  const [pos, setPos] = useState({ left: 0, top: 0, width: 300 });
  const list = useRef<HTMLDivElement>(null);
  const last = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 넣은 뒤 커서를 되돌릴 자리 — controlled 라 우리가 직접 놓아야 한다 */
  const caret = useRef<number | null>(null);

  // 사전은 한 번만 읽는다. 블록이 그려질 때 시작하므로 첫 입력 전에 준비된다
  useEffect(() => {
    loadTags();
  }, []);

  const close = () => setOpen(false);

  const run = () => {
    const ta = ref.current;
    if (!ta || !tagsLoaded()) return;
    // ★input 의 selectionStart 는 null 일 수 있다 (여러 줄 칸에는 늘 숫자가 온다)
    const at = ta.selectionStart ?? ta.value.length;
    // 공백 두 번이면 낱말이 끝난 것으로 본다
    if (at >= 2 && ta.value.substring(at - 2, at) === "  ") return close();
    const { word } = currentWord(ta.value, at);
    const q = word.replace(/ /g, "_"); // 단부루는 언더바 형식
    if (q.length < 2) return close();
    const found = searchTags(q);
    if (!found.length) return close();
    setItems(found);
    setSel(0);
    setPos(dropdownPos(ta));
    setOpen(true);
  };

  const onChange = (e: React.ChangeEvent<Field>) => {
    const v = e.target.value;
    const deleting = v.length < last.current.length;
    last.current = v;
    setValue(v);
    if (deleting) return close();
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(run, 50);
  };

  /** 고른 것을 커서 자리에 넣는다. 뒤에 `, ` 를 붙여 다음 태그로 이어지게 한다 */
  const insert = (tag: TagEntry) => {
    const ta = ref.current;
    if (!ta) return;
    const { start, end, fullStart } = currentWord(value, ta.selectionStart ?? value.length);
    const lead = value.substring(fullStart, start);
    let tail = ", ";
    if (end < value.length && value[end] === ",")
      tail = end + 1 < value.length && value[end + 1] !== " " ? " " : "";
    const text = lead + underscoresToSpaces(tag.value) + tail;
    const next = value.substring(0, fullStart) + text + value.substring(end);
    caret.current = fullStart + text.length;
    last.current = next;
    setValue(next);
    close();
  };

  useLayoutEffect(() => {
    if (caret.current != null && ref.current) {
      const p = caret.current;
      caret.current = null;
      ref.current.focus();
      ref.current.setSelectionRange(p, p);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    if (!open) return;
    (list.current?.children[sel] as HTMLElement | undefined)?.scrollIntoView({ block: "nearest" });
  }, [sel, open]);

  /** true = 자동완성이 가져갔다 (블록의 Enter·Esc 로 넘기지 말 것) */
  const onKeyDown = (e: React.KeyboardEvent<Field>): boolean => {
    if (!open || !items.length) return false;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, items.length - 1));
      return true;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
      return true;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      if (items[sel]) insert(items[sel]);
      return true;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return true;
    }
    return false;
  };

  const node =
    open && items.length ? (
      createPortal(
        <div
          ref={list}
          data-tag-suggest
          style={{
            position: "fixed",
            left: pos.left,
            top: pos.top,
            width: pos.width,
            maxHeight: 300,
            overflowY: "auto",
            zIndex: 950,
            background: "var(--panel)",
            border: "1px solid var(--line-strong)",
            borderRadius: "var(--r-2)",
            boxShadow: "var(--shadow-3)",
            padding: 3,
          }}
        >
          {items.map((tag, i) => (
            <div
              key={tag.value + i}
              data-tag-item={tag.value}
              onMouseDown={(e) => {
                e.preventDefault(); // 포커스를 뺏지 않는다 — blur 이 편집을 끝내 버린다
                insert(tag);
              }}
              onMouseMove={() => setSel(i)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--sp-2)",
                padding: "3px 7px",
                borderRadius: "var(--r-1)",
                cursor: "pointer",
                background: i === sel ? "var(--accent-bg)" : undefined,
              }}
            >
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: "var(--text-2xs)",
                  color: "var(--ink)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {tag.label}
              </span>
              <span
                style={{
                  flexShrink: 0,
                  fontSize: "0.62rem",
                  letterSpacing: "0.04em",
                  color: TYPE_COLOR[tag.type] ?? "var(--ink-faint)",
                }}
              >
                {tag.type}
              </span>
              <span
                style={{
                  flexShrink: 0,
                  width: 42,
                  textAlign: "right",
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.62rem",
                  color: "var(--ink-faint)",
                }}
              >
                {formatCount(tag.count)}
              </span>
            </div>
          ))}
        </div>,
        document.body,
      )
    ) : null;

  return { onChange, onKeyDown, close, node, open };
}

const TYPE_COLOR: Record<string, string> = {
  artist: "var(--warn)",
  character: "var(--char-c)",
  copyright: "var(--accent)",
  meta: "var(--ink-dim)",
};

/** 커서의 화면 위치 아래에 목록을 놓는다. 워드랩까지 맞추려면 같은 스타일의 거울이 필요하다 */
function dropdownPos(ta: Field) {
  const cs = window.getComputedStyle(ta);
  const mirror = document.createElement("div");
  const s = mirror.style;
  s.position = "absolute";
  s.visibility = "hidden";
  s.whiteSpace = cs.whiteSpace;
  s.wordWrap = cs.wordWrap;
  s.overflowWrap = cs.overflowWrap;
  s.width = ta.clientWidth + "px";
  s.font = cs.font;
  s.lineHeight = cs.lineHeight;
  s.letterSpacing = cs.letterSpacing;
  s.padding = cs.padding;
  s.border = "0";
  s.boxSizing = cs.boxSizing;
  mirror.textContent = ta.value.substring(0, ta.selectionStart ?? ta.value.length);
  const mark = document.createElement("span");
  mark.textContent = "​";
  mirror.appendChild(mark);
  document.body.appendChild(mirror);
  const m = mark.getBoundingClientRect();
  const d = mirror.getBoundingClientRect();
  const x = m.left - d.left;
  const y = m.top - d.top;
  document.body.removeChild(mirror);

  const r = ta.getBoundingClientRect();
  const line = parseInt(cs.lineHeight) || parseInt(cs.fontSize) * 1.2;
  const width = Math.min(340, Math.max(230, r.width));
  let left = r.left + x - ta.scrollLeft;
  let top = r.top + y - ta.scrollTop + line + 4;
  if (left + width > window.innerWidth - 10) left = window.innerWidth - width - 10;
  if (left < 10) left = 10;
  if (top + 300 > window.innerHeight - 10) top = Math.max(10, r.top + y - ta.scrollTop - 304);
  return { left, top, width };
}
