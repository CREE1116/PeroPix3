import { api } from "../lib/backend";
import { compileBlocks } from "../lib/blocks";
import { resolveWildcards } from "../lib/wildcards";
import { wildcardPools } from "./wildcards";
import { allScenes, promptOf, type SceneSet, type Spec } from "./workspace";
import { useQueue } from "./queue";
import { useGen } from "./gen";

/** **다른 워크스페이스**로 생성을 넣는다 (사용자 지시 2026-08-08: "워크스페이스2에 큐 10개").
 *
 *  ★화면을 그리로 옮기지 않는다 — 보고 있던 것을 뺏지 않는 게 요청의 요지였다.
 *    그래서 그쪽 spec 을 **읽어서** 프롬프트를 컴파일하고 큐에만 넣는다.
 *  ★컴파일러는 하나다(`compileBlocks`). 여기서 두 번째 구현을 만들지 말 것 —
 *    두 벌이 되면 화면에서 본 프롬프트와 큐에 들어간 것이 조용히 달라진다.
 *  ★생성 옵션(해상도·스텝 등)은 **그 워크스페이스의 spec 에 저장된 것**을 쓰고, 없으면
 *    지금 화면의 값을 쓴다. 이미지 입력(Vibe 등)은 화면 상태라 안 딸려 간다.
 */
export async function queueToWorkspace(
  workspace: string,
  count: number,
  setName?: string,
): Promise<{ ok: true; queued: number; set: string } | { error: string }> {
  let spec: Spec | null = null;
  try {
    const r = await api<{ spec: Spec | null }>(`/api/workspaces/${encodeURIComponent(workspace)}`);
    spec = r.spec;
  } catch (e) {
    return { error: `워크스페이스를 못 읽었습니다: ${String((e as Error).message ?? e)}` };
  }
  if (!spec) return { error: `'${workspace}' 워크스페이스가 없습니다.` };

  const tabs: SceneSet[] = spec.sets ?? [];
  /* ★찾는 곳이 `spec.sets` 이므로 이름도 **세트 이름**이다 (인자 이름이 `tabName` 이라
     탭 이름으로 오해하기 쉬웠다 — 적대 검토 2026-08-24). */
  const tab = setName
    ? tabs.find((t) => t.name === setName)
    : (tabs.find((t) => t.id === spec!.activeTab) ?? tabs[0]);
  if (!tab) return { error: setName ? `'${setName}' 세트가 없습니다.` : "세트가 없습니다." };

  const p = promptOf(spec, tab);
  /* ★★스타일 카드를 껐으면 베이스도 UC 도 안 나간다 — 화면에 없는 것이 실려 나가면 안 된다
     (`store/prompt.ts` 의 `compiled()` 와 **같은 규칙**이어야 한다). */
  const on = p.styleOn !== false;
  const prompt = on ? compileBlocks(p.base ?? []) : "";
  const uc = on ? compileBlocks(p.baseUc ?? []) : "";
  const params = { ...useGen.getState().params, ...(spec.params ?? {}) };
  /* ★★★**캐릭터 프롬프트를 싣는다** (적대 검토 2026-08-24에 발견).
     여기는 베이스와 씬만 컴파일하고 `characters` 를 payload 에 안 실었다. 그래서 조수에게
     *"저쪽 워크스페이스에 20장"* 을 시키면 **인물이 통째로 빠진 그림**이 나왔다 —
     오류도 안 나고 Anlas 는 그대로 든다. 로컬 경로(`store/gen.ts`)는 처음부터 싣고 있었다.
     ★좌표 쓰기는 **전원에게 같은 값**이다 (`gen.ts` 의 `withCoords` 주석). */
  const chars = (p.chars ?? [])
    .filter((c) => c.on)
    .map((c) => ({
      id: c.id,
      prompt: compileBlocks(c.prompt ?? []),
      uc: compileBlocks(c.uc ?? []),
      center: c.center,
      use_coord: !!params.use_coords,
    }));
  if (!prompt.trim()) return { error: `'${tab.name}' 탭의 프롬프트가 비어 있습니다.` };

  const n = Math.max(1, Math.min(50, count));

  /* ★★갈래가 **하나**다 — 2026-08-24 에 옛 싱글 탭 분기를 걷었다 (사용자 확인:
       *"현재 개발단계이고 그런 워크스페이스는 없음"*). 그 분기는 씬 없이 큐에 넣어서
       파일 이름에 씬 번호가 안 붙었다. */
  if (tab.kind !== "set") return { error: `'${tab.name}' 은 씬 세트가 아닙니다.` };
  // ★씬마다 한 바퀴씩 돈다 (gen.generateAll 과 같은 규칙).
  //   ★카드 공통 접두는 걷혔다 (2026-08-21) — 두 경로가 **같은 문자열**을 만들어야 한다
  const live = allScenes(tab).filter((x) => !x.cell.locked && !x.card.locked);
  if (!live.length) return { error: `'${tab.name}' 탭에 잠기지 않은 씬이 없습니다.` };
  for (let round = 0; round < n; round++) {
    for (const [i, { cell: c }] of live.entries()) {
      const cellPrompt = [prompt, compileBlocks(c.blocks ?? [])].filter(Boolean).join(", ");
      // ★와일드카드는 여기서도 **장마다** 뽑는다 (`lib/wildcards` 머리 주석).
      //   풀은 워크스페이스를 안 가리는 공용 문서라 남의 워크스페이스에도 그대로 먹는다.
      await useQueue.getState().enqueue(
        {
          ...params,
          seed: params.seed_mode === "fixed" ? params.seed : -1,
          prompt: resolveWildcards(cellPrompt, wildcardPools()),
          negative_prompt: resolveWildcards(uc, wildcardPools()),
          workspace,
          characters: chars,
          set: tab.name,
          set_id: tab.id,
          cell: c.name,
          cell_id: c.id,
          cell_no: i + 1,
          // 탭 이름은 저장 경로 한 칸이 된다 (`<ws>/output/멀티/<탭>/<세트>/`)
          tab: (spec.tabs ?? []).find((c) => c.id === (tab.tabId ?? spec.activeTab))?.name ?? null,
        },
        undefined,
        1,
      );
    }
  }
  return { ok: true, queued: live.length * n, set: tab.name };
}
