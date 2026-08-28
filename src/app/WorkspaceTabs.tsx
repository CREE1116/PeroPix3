import { Fragment } from "react";
import { useWs } from "../store/workspace";
import { useI18n } from "../i18n";
import { Icon } from "../components/Icon";
import { useReorder } from "../lib/useReorder";
import { DragGhost } from "../cards/DragGhost";
import { DropLine } from "../components/DropLine";
import { justDropped, useTabDrop } from "../lib/tabDrop";

/** 열어 둔 워크스페이스 — **캐릭터 줄 위**에 선다 (사용자 지시 2026-08-08).
 *
 *  ★탭이 담는 것은 **이름뿐**이다. 내용(spec·records)은 활성 것 하나만 메모리에 있고,
 *    누를 때 그 워크스페이스를 읽는다 (실측 255KB/18ms — 체감이 없다).
 *  ★생성·갤러리에서만 보인다. 자동검열·보조 도구는 워크스페이스를 **안 쓰는** 도구라
 *    (그림을 받아 처리할 뿐) 탭이 떠 있으면 "지금 어느 걸 검열하지"라는 없는 질문이 생긴다.
 *
 *  ★**모양은 ComfyUI 의 워크플로 탭**이다 (사용자 지시 2026-08-08). 책갈피(위쪽만 둥근
 *    모서리 + 아래 테두리를 지워 무대와 잇는 것)가 아니라 **네모**이고, 가르는 것은
 *    세로 1px 선뿐이다 — 아래 캐릭터 줄이 폴더 탭이라 모양이 겹치지 않는다.
 *  ★활성은 **올라온 면**(`--panel`)으로 가른다. `--bg-deep` 과 `--bg` 는 값이 같아서
 *    (토큰 주석: "표면은 두 겹뿐") 무대 색으로는 구분이 안 된다.
 *
 *  ★★**끌어서 차례를 바꾼다** (사용자 지시 2026-08-24). 탭 전체가 손잡이라 `tapSafe` 로
 *    잡는다 — 문턱(4px)을 넘기 전에는 아무 일도 안 하므로 **눌러서 전환**이 그대로 살아 있다.
 *  ★차례는 **이 컴퓨터의 것**이다 (localStorage) — 워크스페이스 파일에 남기면 다른 사람의
 *    창에서도 내가 늘어놓은 차례가 되어 버린다. */
export function WorkspaceTabs({ onAdd }: { onAdd: () => void }) {
  const t = useI18n((s) => s.t);
  const { openWs, current, open, closeWs, moveWs } = useWs();
  const ord = useReorder(openWs.length, moveWs, { axis: "x", tapSafe: true });
  /** 탭을 끌어 올려 둔 워크스페이스 — 받을 자리라고 빛난다 (`lib/tabDrop`) */
  const dropOver = useTabDrop((s) => s.over);
  if (!openWs.length) return null;

  return (
    <div
      data-ws-tabs
      style={{
        display: "flex",
        alignItems: "stretch",
        background: "var(--bg-deep)",
        borderBottom: "1px solid var(--line)",
        overflowX: "auto",
      }}
    >
      {openWs.map((name, i) => {
        const on = name === current;
        const hp = ord.handleProps(i);
        return (
          <Fragment key={name}>
          <DropLine on={ord.dragIdx != null && ord.overIdx === i} vert />
          <div
            ref={ord.register(i)}
            {...hp}
            data-ws-tab={name}
            data-on={on ? "" : undefined}
            // ★탭을 놓은 직후의 클릭은 전환이 아니다 (`justDropped` 의 ★주)
            onClick={() => !on && !justDropped() && void open(name)}
            data-tip={name}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--sp-2)",
              flexShrink: 0, // ★수십 개여도 찌그러지지 않는다 — 넘치면 줄이 스크롤된다
              maxWidth: 220,
              padding: "6px var(--sp-4)",
              borderRight: "1px solid var(--line)",
              background: on ? "var(--panel)" : "transparent",
              color: on ? "var(--ink)" : "var(--ink-dim)",
              fontSize: "var(--text-2xs)",
              fontWeight: on ? "var(--w-semi)" : undefined,
              whiteSpace: "nowrap",
              // ★끌고 있는 것은 흐리게 — 잔상이 커서를 따라가므로 원본은 자리만 지킨다
              opacity: ord.dragIdx === i ? 0.35 : 1,
              // ★`handleProps` 가 준 것(touchAction·userSelect·끄는 중 커서)을 여기서 잇는다 —
              //   펴 넣은 `style` 을 아래 `style` 이 통째로 덮기 때문이다
              ...hp.style,
              // ★평소 커서는 이 탭의 것이다 (`tapSafe` 라 `handleProps` 는 안 정한다)
              cursor: hp.style.cursor ?? (on ? "default" : "pointer"),
              // ★탭을 끌어 올려 둔 자리 — 지금 워크스페이스는 받을 수 없으니 안 빛난다
              ...(dropOver === name && !on
                ? { outline: "2px solid var(--accent)", outlineOffset: -2, background: "var(--accent-bg)" }
                : null),
            }}
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
            <button
              data-ws-tab-close={name}
              onClick={(e) => {
                e.stopPropagation();
                void closeWs(name);
              }}
              data-tip={t("gate.closeTab")}
              style={{
                // ★`display: grid` 만 주면 아이콘이 위로 붙는다 (목록의 휴지통과 같은 자리)
                display: "grid",
                placeItems: "center",
                flexShrink: 0,
                color: "var(--ink-ghost)",
              }}
            >
              {Icon.close12}
            </button>
          </div>
          </Fragment>
        );
      })}
      <DropLine on={ord.dragIdx != null && ord.overIdx === openWs.length} vert />
      <button
        data-ws-tab-add
        onClick={onAdd}
        data-tip={t("gate.openAnother")}
        style={{
          display: "grid",
          placeItems: "center",
          flexShrink: 0,
          padding: "0 var(--sp-4)",
          color: "var(--ink-faint)",
        }}
      >
        {Icon.plus}
      </button>
      {/* 커서를 따라가는 잔상 — 껍데기는 앱에 하나다 (`DragGhost`) */}
      {ord.ghost && ord.dragIdx != null && (
        <DragGhost x={ord.ghost.x} y={ord.ghost.y} anchor="exact" style={{ width: ord.ghost.w }}>
          <div
            style={{
              width: "100%",
              height: ord.ghost.h,
              display: "grid",
              placeItems: "center",
              padding: "0 var(--sp-4)",
              border: "1px solid var(--accent)",
              borderRadius: "var(--r-1)",
              background: "var(--panel)",
              color: "var(--ink)",
              fontSize: "var(--text-2xs)",
              whiteSpace: "nowrap",
              overflow: "hidden",
            }}
          >
            {openWs[ord.dragIdx]}
          </div>
        </DragGhost>
      )}
    </div>
  );
}
