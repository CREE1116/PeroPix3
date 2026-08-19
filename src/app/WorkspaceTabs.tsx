import { useWs } from "../store/workspace";
import { useI18n } from "../i18n";
import { Icon } from "../components/Icon";

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
 *    (토큰 주석: "표면은 두 겹뿐") 무대 색으로는 구분이 안 된다. */
export function WorkspaceTabs({ onAdd }: { onAdd: () => void }) {
  const t = useI18n((s) => s.t);
  const { openWs, current, open, closeWs } = useWs();
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
      {openWs.map((name) => {
        const on = name === current;
        return (
          <div
            key={name}
            data-ws-tab={name}
            data-on={on ? "" : undefined}
            onClick={() => !on && void open(name)}
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
              cursor: on ? "default" : "pointer",
              whiteSpace: "nowrap",
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
        );
      })}
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
    </div>
  );
}
