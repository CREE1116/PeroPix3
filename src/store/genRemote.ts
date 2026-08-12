import { api } from "../lib/backend";
import { compileBlocks } from "../lib/blocks";
import { allScenes, promptOf, type CanvasTab, type Spec } from "./workspace";
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
  tabName?: string,
): Promise<{ ok: true; queued: number; tab: string } | { error: string }> {
  let spec: Spec | null = null;
  try {
    const r = await api<{ spec: Spec | null }>(`/api/workspaces/${encodeURIComponent(workspace)}`);
    spec = r.spec;
  } catch (e) {
    return { error: `워크스페이스를 못 읽었습니다: ${String((e as Error).message ?? e)}` };
  }
  if (!spec) return { error: `'${workspace}' 워크스페이스가 없습니다.` };

  const tabs: CanvasTab[] = spec.tabs ?? [];
  const tab = tabName
    ? tabs.find((t) => t.name === tabName)
    : (tabs.find((t) => t.id === spec!.activeTab) ?? tabs[0]);
  if (!tab) return { error: tabName ? `'${tabName}' 탭이 없습니다.` : "탭이 없습니다." };

  const p = promptOf(spec, tab);
  const prompt = compileBlocks(p.base ?? []);
  const uc = compileBlocks(p.baseUc ?? []);
  if (!prompt.trim()) return { error: `'${tab.name}' 탭의 프롬프트가 비어 있습니다.` };

  const params = { ...useGen.getState().params, ...(spec.params ?? {}) };
  const n = Math.max(1, Math.min(50, count));

  if (tab.kind === "set") {
    // ★씬마다 **그 카드의** 접두를 붙여 한 바퀴씩 돈다 (gen.generateAll 과 같은 규칙)
    const live = allScenes(tab).filter((x) => !x.cell.locked && !x.card.locked);
    if (!live.length) return { error: `'${tab.name}' 탭에 잠기지 않은 씬이 없습니다.` };
    for (let round = 0; round < n; round++) {
      for (const [i, { card, cell: c }] of live.entries()) {
        const cellPrompt = [(card.prefix || "").trim(), prompt, compileBlocks(c.blocks ?? [])]
          .filter(Boolean)
          .join(", ");
        await useQueue.getState().enqueue(
          {
            ...params,
            seed: params.seed_mode === "fixed" ? params.seed : -1,
            prompt: cellPrompt,
            negative_prompt: uc,
            workspace,
            tab: tab.name,
            tab_id: tab.id,
            cell: c.name,
            cell_id: c.id,
            cell_no: i + 1,
            // 캐릭터 이름은 저장 경로 한 칸이 된다 (<ws>/output/멀티/<캐릭터>/<탭>/)
            char: (spec.chars ?? []).find((c) => c.id === (tab.charId ?? spec.activeChar))?.name ?? null,
          },
          undefined,
          1,
        );
      }
    }
    return { ok: true, queued: live.length * n, tab: tab.name };
  }

  await useQueue.getState().enqueue(
    {
      ...params,
      seed: params.seed_mode === "fixed" ? params.seed : -1,
      prompt,
      negative_prompt: uc,
      workspace,
      tab: tab.name,
      tab_id: tab.id,
    },
    undefined,
    n,
  );
  return { ok: true, queued: n, tab: tab.name };
}
