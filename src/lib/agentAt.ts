/** 조수가 **어디를 고쳤나**, 그리고 그 자리로 가기.
 *
 *  ★★사용자 지시 2026-08-24: *"실제로 앱의 데이터를 수정한 경우에 반드시 채팅 로그에
 *    구분되는 양식으로 명시되고, 그걸 누르면 수정된 위치를 열어 주면 좋겠다."*
 *
 *  ★고치는 도구는 `did`(무엇을)와 함께 `at`(어디를)을 돌려준다 (`backend/agent.py` 의
 *    `_mark`). 읽기 도구는 안 돌려준다 — 그것이 「고침 줄」과 「읽기 줄」을 가르는 기준이다.
 *  ★**저장 장치를 따로 안 만든다.** `at` 은 도구 결과 JSON 안에 있고 대화가 그대로
 *    저장되므로, 나중에 열어도 눌린다. 옛 대화에는 `at` 이 없어 안 눌릴 뿐이다.
 *  ★가서 **강조까지** 한다 (`useUi.reveal`). 열어 놓고 「어디가 바뀌었지」를 다시 찾게 하면
 *    절반만 한 것이다.
 */
import { useUi } from "../store/ui";
import { useWs } from "../store/workspace";

export type AgentAt =
  | { kind: "card"; cardKind: string; id: string; log?: string }
  | {
      kind: "prompt";
      workspace?: string;
      tab?: string;
      set?: string;
      area?: string;
      /** 씬 칸을 고친 것이면 그 씬 id — 씬은 왼쪽 패널이 아니라 **캔버스**에 산다 */
      scene?: string;
      label?: string;
      log?: string;
    }
  | { kind: "file"; workspace?: string; path?: string; log?: string }
  | { kind: "guide"; log?: string }
  | { kind: "queue"; workspace?: string; set?: string; log?: string };

/** 그 자리를 여는 문구 (툴팁) — **무엇이 열리는지** 미리 말해 준다 */
export function atLabel(at: AgentAt, t: (k: string) => string): string {
  switch (at.kind) {
    case "card": return t("ai.atCard");
    case "prompt": return t("ai.atPrompt");
    case "file": return t("ai.atFile");
    case "guide": return t("ai.atGuide");
    case "queue": return t("ai.atQueue");
  }
}

/** 그 자리로 간다. ★못 가면 **조용히 넘기지 않는다** — 왜 못 갔는지 말한다 */
export async function openAt(at: AgentAt): Promise<void> {
  const ui = useUi.getState();
  const ws = useWs.getState();

  if (at.kind === "guide") {
    ui.openSettings("llm");
    return;
  }
  if (at.kind === "card") {
    ui.setMode("generate");
    // 덱은 종류별 탭이라 그 종류를 먼저 편다 (`cards/DeckPanel` 의 `view.tab.deck`)
    ui.setView("tab", "deck", at.cardKind as never);
    ui.reveal("right", `card:${at.id}`, true);
    return;
  }
  if (at.kind === "file") {
    ui.setMode("utility");
    if (at.path) ui.reveal("left", `file:${at.path}`, true);
    return;
  }

  // prompt·queue — 워크스페이스·탭·세트를 차례로 맞춘다
  if (at.workspace && at.workspace !== ws.current) {
    await ws.open(at.workspace);
  }
  ui.setMode("generate");
  const spec = useWs.getState().spec;
  if (at.kind === "prompt" && at.tab && spec?.tabs?.some((c) => c.id === at.tab)) {
    useWs.getState().switchTab(at.tab);
  }
  const setId = at.kind === "prompt" ? at.set : at.set;
  if (setId && useWs.getState().spec?.sets.some((x) => x.id === setId)) {
    useWs.getState().setActiveTab(setId);
  }
  if (at.kind === "prompt") {
    /* ★씬 칸은 **골라서** 데려간다 — 캔버스에 사는 것이라 왼쪽 패널의 `reveal` 이 못 닿는다.
       고르면 그 칸이 화면에 들어오고 테두리가 선다 (생성이 끝난 칸을 고르는 길과 같다). */
    if (at.scene) {
      const { useSceneFocus } = await import("../store/sceneFocus");
      useSceneFocus.getState().focus(at.scene, null);
      return;
    }
    // ★블록 이름까지 알면 그 자리를 펴고 강조한다 (`lib/keepScroll` 과 같은 표식)
    ui.reveal("left", at.label ? `block:${at.label}` : "params", true);
  }
}
