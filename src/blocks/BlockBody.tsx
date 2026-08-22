import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { caretAfterTag, parseSegs, serializeBlock, type Block } from "../lib/blocks";
import { Chip } from "./Chip";
import { pushUndo } from "../lib/undo";
import { t as tr } from "../i18n";
import { useTagSuggest } from "./TagSuggest";

/** ★★**태그 안의 빈칸은 안 깨지는 빈칸(NBSP)으로** 둔다 — 글 상자도 칩처럼 **쉼표에서만**
 *  접히게 하려는 것이다 (사용자 지시 2026-08-22).
 *
 *  칩은 통째로 접혀 태그가 두 줄에 걸칠 일이 없는데, 글 상자는 빈칸이면 어디서든 접혀
 *  `looking at viewer` 가 둘로 쪼개졌다. CSS 로는 못 막는다 — `word-break: keep-all`·
 *  `overflow-wrap`·`text-wrap` 을 다 대 봤지만 여섯 판 모두 쪼개졌다 (실측).
 *  ★폭이 같다: 보통 빈칸 3.64px · NBSP 3.64px, `word-spacing: 11px` 에서도 둘 다 14.64px.
 *    그래서 맞춰 둔 흐름이 흐트러지지 않는다.
 *  ★**길이가 안 바뀌는 치환**이라 커서 자리가 안 밀린다 (한 글자를 한 글자로).
 *  ★한 태그가 줄보다 길면 그때는 그래도 쪼개진다 (글 상자의 기본 동작) — 칩은 그 경우
 *    말줄임으로 자른다. 줄보다 긴 태그는 드물어 그대로 둔다. */
const NBSP = "\u00a0";
/** 안 깨지는 붙임표 — ★폭이 보통 붙임표와 **똑같다** (실측 4.52px 대 4.52px) */
const NBHY = "\u2011";
/** 고칠 때의 글 — 접힐 자리를 **쉼표 뒤 하나만** 남긴다.
 *
 *  ★빈칸(U+0020)과 붙임표(U+002D) 둘 다 접힐 자리다. `close-up` 이 `close-` / `up` 으로
 *    끊기던 것이 붙임표 쪽이다 (사용자 지적 2026-08-22).
 *  ★한 글자를 한 글자로 바꾸므로 **길이가 안 변한다** — 커서 자리가 안 밀린다. */
const toEdit = (t: string) =>
  t.replace(/[ -]/g, (m, i: number) => (m === "-" ? NBHY : t[i - 1] === "," ? " " : NBSP));
/** 밖으로 나가는 글 — **반드시 되돌린다** (저장·NAI 로 이 글자들이 새면 안 된다) */
const toStore = (t: string) => t.replace(/\u00a0/g, " ").replace(/\u2011/g, "-");

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
  /* ★★자동완성에는 **평범한 글**을 준다 (`toStore`). 안 그러면 사전을 `close‑up`(U+2011)로
       뒤져 하이픈 든 태그가 하나도 안 걸린다. 길이가 안 변하는 치환이라 **커서 자리가 그대로**여서
       그 안의 자리 계산이 전부 그대로 맞는다.
     ★치는 동안에도 유지한다 — 새로 친 빈칸·붙임표도 곧바로 안 깨지는 짝으로 바뀐다. */
  /** ★★치기 직전의 커서 자리 — 값이 갈아 끼워진 뒤 여기로 돌려놓는다 (아래 ★★주) */
  const caretKeep = useRef<{ s: number; e: number } | null>(null);
  const ac = useTagSuggest(
    toStore(text),
    (v, caretPlaced) => {
      /* ★★**커서 자리를 적어 둔다** (사용자 지적 2026-08-22: *"단어 중간에 띄어쓰기를 하면
           갑자기 편집 커서가 맨 뒤로 이동함"*).
         `toEdit` 이 빈칸을 NBSP 로, 붙임표를 U+2011 로 바꾸면 글이 **브라우저가 방금 만든
         것과 달라져서**, 리액트가 `value` 를 다시 써 넣는다. 글 상자의 `value` 에 대입하면
         커서는 **맨 뒤로** 간다 (실측: 가운데 3 자리에서 쳤는데 15 로 튐).
         보통 글자는 치환이 없어 값이 같고, 그래서 멀쩡했다 — 빈칸·붙임표에서만 났다. */
      /* ★★자동완성이 **자리를 잡았으면 건드리지 않는다** (사용자 지적 2026-08-22:
           *"태그 완성했을 때 커서가 완성된 태그 뒤의 쉼표 뒤로 가야하는데, 그냥 그자리에
           멈춰있음"*). 그때는 넣은 태그의 쉼표 뒤가 맞는 자리이고, 여기서 되돌리면
           **치기 전 자리로 도로 끌려온다.** 훅이 먼저 등록돼 저쪽이 먼저 돌기 때문에,
           우리가 나중에 덮어쓰는 모양이었다. */
      const el = ta.current;
      caretKeep.current = !caretPlaced && el ? { s: el.selectionStart, e: el.selectionEnd } : null;
      setText(toEdit(v));
    },
    ta,
  );
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

  /** ★★값이 갈아 끼워진 **바로 뒤에** 커서를 제자리로 (위 `caretKeep` 의 ★★주).
   *  ★치환은 한 글자를 한 글자로 바꿔 **길이가 안 변하므로** 자리 숫자가 그대로 맞는다.
   *  ★`useLayoutEffect` 여야 한다 — 그려지기 전에 되돌려야 커서가 튀는 것이 안 보인다.
   *  ★적어 둔 것이 있을 때만 손댄다. 편집을 **열 때** 커서를 놓는 자리(`caretAt`)와 겹치면
   *    안 되기 때문이다 — 그쪽은 여기에 아무것도 안 적는다. */
  useLayoutEffect(() => {
    const el = ta.current;
    const keep = caretKeep.current;
    caretKeep.current = null;
    if (!el || !keep) return;
    if (el.selectionStart !== keep.s || el.selectionEnd !== keep.e)
      el.setSelectionRange(keep.s, keep.e);
  }, [text]);
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
      if (l.editing && !l.dropped) {
        const out = toStore(l.text);
        l.onChange({ ...l.block, tags: parseSegs(out), src: out });
      }
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
    setText(toEdit(txt ?? serializeBlock(block)));
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

  /** ★★고친 글도 **되돌리기 로그에 남긴다** (사용자 지적 2026-08-22:
   *  *"텍스트 편집을 했을 때, 엔터 눌러서 확정하면 취소가 안됨"*).
   *  글 상자 **안**에서는 브라우저 기본 되돌리기가 살아 있지만, 확정하고 나면 그것이 사라진다 —
   *  확정이야말로 "마지막에 수정한 것"이므로 로그가 받아야 한다.
   *  ★안 바뀌었으면 담지 않는다. 그냥 눌렀다 나온 것까지 쌓이면 `Ctrl+Z` 가 헛돈다. */
  const logTextEdit = (before: Block, after: Block) => {
    if (before.src === after.src) return;
    pushUndo(tr("common.undoText"), () => onChange(before));
  };

  const commitText = () => {
    if (skipBlur.current) {
      skipBlur.current = false;
      return;
    }
    /* ★★친 글이 **그대로 새 원문**이 된다 (`lib/blocks` 의 `Block.src`).
       칩으로 쪼개 다시 조립하면 줄바꿈·간격이 바뀌어 나가는데, 글 상자는 사용자가
       글자를 직접 다루는 자리라 그 글자가 그대로 NAI 로 가야 한다. */
    const out = toStore(text);
    const after = { ...block, tags: parseSegs(out), src: out };
    logTextEdit(block, after);
    onChange(after);
    setEditing(false);
  };

  /** 고친 것을 반영하고 편집을 닫는다 — blur 이 한 번 더 하지 않게 표식을 세운다 */
  const commitNow = (): Block => {
    skipBlur.current = true;
    setEditing(false);
    const out = toStore(text);
    const b = { ...block, tags: parseSegs(out), src: out };
    logTextEdit(block, b);
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
                  const out = toStore(text);
                  const b = { ...block, tags: parseSegs(out), src: out };
                  logTextEdit(block, b);   // ★이 길도 **확정**이다 — 로그가 빠지면 안 된다
                  onEnter(b);
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
              /* ★★줄 간격을 늘리면 **첫 줄이 반쪽 여백만큼 내려간다.** 그만큼 위 안여백을
                   덜어 첫 줄을 칩 줄과 같은 높이에 세운다 (아래 안여백으로 옮겨 붙인다).
                   ★상자 규격(`box`) 자체는 안 건드린다 — 폭은 두 모습이 같아야 한다. */
              /* ★★위 안여백을 **칩 줄과 같은 3px** 으로 되돌렸다 (사용자 지적 2026-08-22:
                   *"첫줄이 너무 위에 딱붙어있음" · *"커서가 안보여"*).
                   0 으로 두면 첫 줄의 줄 상자가 테두리에 닿아 **커서 윗부분이 잘려** 보인다.
                 ★그 대신 글자 자리가 칩보다 3px 내려간다 — 줄마다 같은 양이라 쌓이지 않고,
                   붙어 보이는 것보다 낫다고 봤다. */
              paddingTop: 3,
              paddingBottom: 3,
              /* ★★좌우도 **칩의 안여백만큼** 더 준다 (실측: 칩의 첫 글자는 줄 왼쪽에서 15px,
                   글은 7px 이었다 — 칩 테두리 1 + 안여백 7 만큼 안으로 들어가 있다).
                   오른쪽도 같이 줘야 **접히는 자리**가 맞는다: 칩의 마지막 글자도 줄 오른쪽에서
                   8px 앞에서 끝나기 때문이다. */
              paddingLeft: 14,
              paddingRight: 14,
              background: "var(--code-bg)",
              borderColor: "var(--accent)",
              // ★★글꼴도 **칩과 같은 것**으로 (사용자 지시 2026-08-21: 칩 쪽이 더 잘 읽힌다).
              //   한때 고정폭이었다 — `::` 와 숫자를 세로로 맞춰 보려던 것인데, 프롬프트는
              //   숫자표가 아니라 **읽는 글**이라 본문 글꼴이 낫다.
              //   ★가중치 숫자만은 칩에서처럼 고정폭이다 (`Chip` 의 `<b>`).
              fontFamily: '"WideSep", var(--font-sans)',
              /* ★★★**칩 줄과 같은 자리에 흐르도록 맞춘 값 셋** (사용자 지시 2026-08-22).
               *
               *  칩을 누르면 줄이 통째로 글 상자로 바뀌는데 두 모습의 흐름이 달라
               *  **같은 태그가 다른 줄에** 있었다 — 그것이 「누를 때 튄다」의 정체다.
               *  헤드리스로 태그마다 줄 번호를 맞대어 세면서 조였다 (표본 4벌 · 태그 41개).
               *
               *  ① **구분자 빈칸만 넓힌다** (`WideSep`, `styles/fonts.css`). 칩은 태그마다
               *     20px 을 더 쓰는데(안여백 7+7 · 테두리 1+1 · 사이 4) 글에서 그 자리는
               *     `, ` 한 조각뿐이라 글이 한 줄에 더 담겼다.
               *     ★`word-spacing` 으로 하면 **태그 안의 빈칸까지** 넓어져 여러 낱말 태그가
               *       그만큼 길어진다 — 그래서 태그 안은 NBSP 로 두고(위 `toEdit`) U+0020 에만
               *       거는 면을 쓴다. 낱말 수와 무관하게 태그마다 **일정하게** 더해진다.
               *     ★쉼표 글자를 넓히는 길도 해 봤다가 걷었다 — 글자 자체가 커져 슬래시처럼 보였다.
               *  ② **줄 간격 2.065** — 칩 줄의 걸음이 26.85px(칩 높이 + 사이 4)이다.
               *     맞추기 전에는 줄마다 7.35px 씩 어긋나 쌓였다.
               *  ③ **안여백** — 아래 ★★주.
               *
               *  실측(줄이 다른 태그 / 태그 41개): 아무것도 안 했을 때 **16개** → 지금 **0개**. */
              fontSize: "var(--text-prompt)",
              lineHeight: 2.065,
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
              /* ★★가중치도 되돌릴 수 있어야 한다 (사용자 지시 2026-08-22).
                 ★칩이 **한 차례 조절에 한 번만** 불러 준다 — 휠 눈금마다 담으면 원래대로
                   돌아가려고 Ctrl+Z 를 수십 번 눌러야 한다.
                 ★되돌리는 방법은 칩 지우기와 같다: 「이 블록을 지금 모습으로」 하나면 된다. */
              onWeightStart={() => {
                const before = block;
                pushUndo(tr("common.undoWeight"), () => onChange(before));
              }}
              onRemove={() => {
                // ★★확인 없이 사라지는 자리라 **되돌릴 길**을 함께 담는다 (`Ctrl+Z`).
                //   되돌리는 방법은 「이 블록을 지금 모습으로 되돌린다」 하나면 된다.
                const before = block;
                pushUndo(tr("common.undoTag"), () => onChange(before));
                onChange({ ...block, tags: block.tags.filter((_, j) => j !== i) });
              }}
            />
          ))}
        </div>
      )}
    </>
  );
}
