/** **승인 받기** — 조수가 무언가 하기 전에 대화 안에서 사용자에게 묻는다 (2026-08-24).
 *
 *  ★★모달 확인 창(`store/ask`)이 아니다. 클로드 코드가 파일 삭제 전에 승인을 받는 것과
 *    같은 모양으로, **대화 안에** 카드를 띄우고 도구는 답이 올 때까지 기다린다
 *    (사용자 결정). 얻는 것 셋:
 *      · 왕복이 한 번이다 (토큰안은 거절→되묻기→재호출로 세 번이었다)
 *      · **조수가 잊을 수 있는 것이 없다** — 앱이 막는다
 *      · **대화에 남는다** — 모달은 누르고 나면 무엇을 승인했는지 흔적이 없다
 *
 *  ★기제는 `ask_user` 의 것을 그대로 쓴다 (`store/llm` 의 `Ask`) — 새로 만들지 않았다.
 */

import { useLlm } from "../store/llm";
import { useUi } from "../store/ui";
import { notifyByTitle } from "./titleNotify";
import type { Risk } from "./actions";

/** 이 위험도에 대해 **지금 설정에서** 물어야 하나.
 *
 *  ★칸이 둘이다 (사용자 결정 2026-08-24):
 *      [ ] 조수의 작업을 자동 승인       → `agentAuto`
 *      [✓] 단, 되돌릴 수 없는 것은 묻기  → `agentAskHard`
 *  ★`hard` 는 되돌릴 수 없는 것이다 — 카드·씬 삭제와 **Anlas 가 나가는 생성**. */
export function needsAsk(risk: Risk): boolean {
  if (risk === "none") return false;
  const { agentAuto, agentAskHard } = useUi.getState();
  if (!agentAuto) return true;             // 자동 승인이 꺼져 있으면 전부 묻는다
  return risk === "hard" && agentAskHard;  // 켜져 있어도 되돌릴 수 없는 것은 남긴다
}

/** 승인 카드를 띄우고 **답을 기다린다.** 승인하면 `true`.
 *
 *  ★★시간 제한을 두지 않는다 — 사람이 답하는 것이다. 대신 도구 쪽에서 넉넉히 기다린다
 *    (`backend/agent.py` 의 `do(timeout=…)`; `ask_user` 와 같은 취급).
 *  ★이미 다른 승인이 떠 있으면 **거절**로 돌려준다: 카드는 한 번에 하나이고, 앞의 것을
 *    덮으면 앞 도구가 영영 안 끝난다. */
export function askApprove(
  o: { title: string; body?: string; hard?: boolean },
): Promise<boolean | "busy"> {
  /* ★★**이미 떠 있으면 「거절」이 아니라 「대기 중」이다** (QA 실측 2026-08-25).
     카드는 한 번에 하나이고 앞의 것을 덮으면 앞 도구가 영영 안 끝난다. 그런데 이것을
     `false`(거절)로 돌려주면 조수가 **사용자가 거절했다**고 말한다 — 사용자는 아무것도
     본 적이 없는데. 갈래를 나눠 부르는 쪽이 다른 오류를 내게 한다. */
  if (useLlm.getState().confirm) return Promise.resolve("busy");
  /* ★★**패널을 연다** (QA 실측 2026-08-25). AI 패널은 **기본이 접힌 레일**이고, 접혀 있으면
     `AiChat` 이 아예 안 그려져(`app/Shell.tsx`) 승인 카드가 **화면에 나타날 수 없다.**
     그러면 도구가 600초를 기다리다 시간 초과로 끝나고, 사용자는 무엇을 물었는지도 모른다.
     실제로 QA 에서 그렇게 걸렸다 — 「보여 주고 누르게 한다」는 설계가 통째로 죽는 자리다.
     ★창 제목 알림만으로는 부족하다: 창을 보고 있어도 카드가 없으면 누를 것이 없다. */
  useUi.getState().openAi();
  // ★창을 안 보고 있을 때는 제목으로도 알린다
  notifyByTitle(o.title);
  return new Promise((resolve) => {
    useLlm.setState({
      confirm: {
        title: o.title,
        body: o.body,
        hard: o.hard,
        answer: (okay: boolean) => {
          useLlm.setState({ confirm: null });
          resolve(okay);
        },
      },
    });
  });
}
