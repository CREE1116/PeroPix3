import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

/** 툴팁 — **우리가 그린다** (사용자 지시 2026-08-19).
 *
 *  ★브라우저 기본 `title` 은 뜨는 데 1초쯤 걸리고, 위치도 모양도 우리 것이 아니다.
 *    화면 아무 요소에나 `data-tip="…"` 를 달면 이 층이 받아 띄운다.
 *  ★**한 곳에서 위임으로 듣는다** — 요소마다 상태를 두면 목록이 길어질수록 리스너가 는다.
 *  ★한 번 뜬 뒤 잠깐은 **곧바로** 뜬다 (`WARM`). 줄지어 있는 단추를 훑을 때마다
 *    매번 기다리면 느리게 느껴진다 — 실제 툴팁 구현들이 쓰는 방식이다.
 *
 *  설명 문구를 화면에 **상시 노출하지 않는다**는 규칙과 한 짝이다 (`CLAUDE.md`) —
 *  값이 무엇을 하는지는 라벨 옆 `?`(`Help`)에 넣고, 단추의 이름은 여기로 뜬다. */

/** ★★처음 뜰 때까지 (ms). **넉넉히 기다린다** — 커서를 옮길 때마다 여기저기서 툴팁이
 *  튀어나오면 그것 자체가 방해다 (사용자 지적 2026-08-19). 지나가다 스치는 것에는 안 뜬다.
 *  ★단추 이름은 대개 **몰라서 보는 것이 아니라** 확인하려고 보는 것이라, 급할 이유가 없다. */
const DELAY = 650;
/** `?` 는 **설명을 보려고 일부러 대는 것**이라 곧바로 뜬다 (`Help` — 사용자 지시: 반응성) */
const DELAY_HELP = 120;

type Shown = { text: string; x: number; y: number; below: boolean };

export function TipLayer() {
  const [tip, setTip] = useState<Shown | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);
  const target = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const stop = () => {
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = null;
    };
    const hide = () => {
      stop();
      target.current = null;
      setTip(null);
    };
    const show = (el: HTMLElement) => {
      const text = el.getAttribute("data-tip");
      if (!text) return;
      // ★★**이미 보이는 글은 다시 안 띄운다** (사용자 지적 2026-08-19). 이름을 그대로
      //   툴팁으로도 단 자리가 많다 (탭·카드·파일 이름) — 그건 커서를 댈 때마다 같은 글자가
      //   한 번 더 뜨는 것뿐이다. **잘려 있을 때만** 뜬다 (그때는 알 길이 그것뿐이다).
      const shown = (el.textContent ?? "").trim();
      if (shown && shown === text.trim() && el.scrollWidth <= el.clientWidth + 1) return;
      const r = el.getBoundingClientRect();
      // 위가 좁으면 아래로 내린다. 아래로 내릴 때도 화면 밖으로는 안 나간다
      const below = r.top < 72;
      setTip({
        text,
        x: r.left + r.width / 2,
        y: below ? r.bottom + 8 : r.top - 8,
        below,
      });
    };
    const enter = (e: Event) => {
      const el = (e.target as HTMLElement | null)?.closest?.("[data-tip]") as HTMLElement | null;
      if (!el || el === target.current) return;
      stop();
      target.current = el;
      // ★★**한 번 뜬 뒤 잠깐은 곧바로**… 를 뺐다 (사용자 지적 2026-08-19). 줄지어 있는
      //   단추 위를 지나가는 것만으로 툴팁이 따라다녔다. 언제나 같은 만큼 기다린다.
      timer.current = window.setTimeout(() => show(el), el.hasAttribute("data-help") ? DELAY_HELP : DELAY);
    };
    const leave = (e: PointerEvent) => {
      const to = e.relatedTarget as Node | null;
      if (target.current && to && target.current.contains(to)) return;
      hide();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    document.addEventListener("pointerover", enter);
    document.addEventListener("pointerout", leave);
    document.addEventListener("focusin", enter);
    document.addEventListener("focusout", hide);
    // 누르는 순간 사라진다 — 누른 뒤에도 떠 있으면 결과를 가린다
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("keydown", key);
    // 스크롤·휠은 자리를 어긋나게 하므로 그냥 닫는다
    window.addEventListener("scroll", hide, true);
    window.addEventListener("wheel", hide, { passive: true });
    window.addEventListener("blur", hide);
    return () => {
      stop();
      document.removeEventListener("pointerover", enter);
      document.removeEventListener("pointerout", leave);
      document.removeEventListener("focusin", enter);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("wheel", hide);
      window.removeEventListener("blur", hide);
    };
  }, []);

  // 폭을 재고 나서 가로를 화면 안으로 밀어 넣는다 (재기 전에는 안 보인다)
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !tip) return;
    const half = el.offsetWidth / 2;
    el.style.left = `${Math.max(8 + half, Math.min(window.innerWidth - 8 - half, tip.x))}px`;
    el.style.opacity = "1";
  }, [tip]);

  if (!tip) return null;
  return (
    <div
      ref={box}
      data-tip-box
      role="tooltip"
      style={{
        position: "fixed",
        left: tip.x,
        top: tip.y,
        transform: `translate(-50%, ${tip.below ? "0" : "-100%"})`,
        zIndex: 9000,
        pointerEvents: "none",
        opacity: 0,
        transition: "opacity 90ms ease",
        maxWidth: 320,
        padding: "var(--sp-2) var(--sp-3)",
        borderRadius: "var(--r-2)",
        background: "var(--tip-bg)",
        color: "var(--tip-ink)",
        border: "1px solid var(--tip-line)",
        boxShadow: "0 6px 20px rgba(0,0,0,0.22)",
        fontSize: "var(--text-2xs)",
        lineHeight: 1.5,
        whiteSpace: "pre-line",
        textAlign: "left",
      }}
    >
      {tip.text}
    </div>
  );
}

/** 라벨 옆의 `?` — **눌러야 나오는 설명**이 사는 유일한 자리.
 *
 *  ★설명을 화면에 펼쳐 두지 않는다 (사용자 지시 2026-08-19): 아는 사람에게는 잡음이고,
 *    같은 자리를 매번 읽게 만든다. 값이 무엇을 하는지는 여기 넣는다. */
export function Help({ tip }: { tip: string }) {
  return (
    <span
      data-help
      data-tip={tip}
      tabIndex={0}
      /* ★`<label>` 안에 들어가는 자리가 있다 (체크박스 옆) — 막지 않으면 `?` 를 누른 것이
         **그 설정을 켜고 끈다.** 라벨의 기본 동작이라 preventDefault 로만 멈춘다. */
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      style={{
        display: "inline-grid",
        placeItems: "center",
        flexShrink: 0,
        color: "var(--ink-ghost)",
        cursor: "help",
      }}
    >
      {Icon.help}
    </span>
  );
}
