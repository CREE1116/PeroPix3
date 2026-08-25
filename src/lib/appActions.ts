/** **조수가 앱에 시킬 수 있는 일** — 여기가 정의되는 유일한 자리 (2026-08-24).
 *
 *  ★★한 액션의 이름·설명·**인자 형식**·위험도·실행이 **한 덩이**로 붙어 있다. 예전에는
 *    스키마가 백엔드(`agent.py` 의 `_table`)에, 구현이 앱(`queue.ts` 의 `runAction`)에
 *    나뉘어 있어 조용히 어긋났다 — `generate` 스키마의 `set` 을 앱이 안 읽어서 **오류 없이
 *    엉뚱한 세트에 생성되고 Anlas 가 나갔다** (적대 검토 2026-08-24).
 *
 *  ★목록은 빌드할 때 뽑아 백엔드에 넣는다 (`scripts/gen-actions.mjs`) — 앱이 접속할 때
 *    올려 보내면 소켓 타이밍에 걸려 **도구가 0개**로 보인다 (`backend/agent.py` 머리).
 *
 *  ★★**위험도(`confirm`)를 반드시 적는다.** 자동 승인이 이 값을 본다 (`lib/approve`):
 *      none — 물을 것이 없다 (읽기·값 편집)
 *      ask  — 되돌릴 수 있다 (휴지통 24시간)
 *      hard — **되돌릴 수 없다** — 카드·씬 삭제와 **Anlas 가 나가는 생성**
 *    ★생성은 고정이 아니다: 돈이 나가느냐로 그때 정한다 (사용자 결정 2026-08-24).
 */

import { defineAction, err, nearBy, type ActionResult } from "./actions.ts";
import { useWs, type DelTarget } from "../store/workspace";
import { useCensor } from "../store/censor";
import { useQueue } from "../store/queue";
import { useUi } from "../store/ui";
import { useGen } from "../store/gen";
import { costNow, countNow } from "./costNow.ts";
import { t } from "../i18n";

/* ── 삭제 ──────────────────────────────────────────────────────
   ★한 벌은 스토어에 있다 (`removeAt`) — 여기서는 **찾아 주고 말로 옮길** 뿐이다.
   사람이 버튼을 눌렀을 때와 **같은 함수**를 부른다 (선결 조건 3-1). */

/** 이름이나 id 로 세트를 찾는다. ★못 찾으면 **비슷한 것 셋**을 얹어 준다 (2-4) —
 *  그것만 있으면 조수가 대개 한 번에 고친다. */
function findSet(key: string) {
  const spec = useWs.getState().spec;
  const sets = (spec?.sets ?? []).filter((x) => x.kind === "set");
  const hit = sets.find((x) => x.id === key || x.name === key);
  return { hit, names: sets.map((x) => x.name) };
}

const BLOCK_WHY: Record<string, string> = {
  last_set: "그 탭의 마지막 세트라 닫을 수 없습니다 (탭에 세트가 없어집니다).",
  last_tab: "마지막 탭이라 지울 수 없습니다.",
  not_found: "그런 것이 없습니다.",
};

/** 삭제 액션 넷을 같은 모양으로 만든다 — 대상을 고르는 법만 다르다 */
async function doRemove(target: DelTarget): Promise<ActionResult> {
  const r = await useWs.getState().removeAt(target);
  if (!r.ok)
    return err(r.blocked === "not_found" ? "not_found" : "blocked", BLOCK_WHY[r.blocked], {
      retry: "never",
    });
  const p = r.plan;
  const files = p.files.length ? ` (그림 ${p.files.length}장도 휴지통으로)` : "";
  return { ok: true, did: `${p.name} 을(를) 지움${files}`, at: { kind: "prompt" } };
}

/** 승인 카드에 띄울 문구 — **무엇이 사라지는지 미리 세어** 보여 준다 */
function previewRemove(target: DelTarget): string {
  const p = useWs.getState().planRemove(target);
  if (p.blocked) return BLOCK_WHY[p.blocked];
  const bits = [`「${p.name}」`];
  if (p.inner) bits.push(`안에 든 ${p.inner}개`);
  if (p.files.length) bits.push(`그림 ${p.files.length}장 (휴지통으로)`);
  return bits.join(" · ") + " 가 사라집니다. 되돌리기로는 못 돌아옵니다.";
}

defineAction({
  id: "delete_set",
  desc: "★**세트를 닫는다** — 그 안의 씬과 **그림도 함께 휴지통으로** 간다. "
    + "그 탭의 마지막 세트는 못 닫는다 (탭이 빈다).",
  args: { set: { type: "string", desc: "세트 이름 또는 id", required: true } },
  confirm: "hard",
  preview: (a) => {
    const { hit } = findSet(String(a.set ?? ""));
    return hit ? previewRemove({ kind: "set", id: hit.id }) : "그런 세트가 없습니다.";
  },
  run: async (a) => {
    const { hit, names } = findSet(String(a.set ?? ""));
    if (!hit)
      return err("not_found", `그런 세트가 없습니다: ${a.set}`, {
        what: "set", given: String(a.set ?? ""), candidates: nearBy(String(a.set ?? ""), names),
      });
    return doRemove({ kind: "set", id: hit.id });
  },
});

defineAction({
  id: "delete_scene",
  desc: "★**씬 칸을 지운다** — 그 씬의 **그림도 함께 휴지통으로** 간다. "
    + "`set` 을 비우면 지금 보고 있는 세트에서 찾는다.",
  args: {
    scene: { type: "string", desc: "씬 이름 또는 id", required: true },
    set: { type: "string", desc: "어느 세트에서 — 비우면 지금 보고 있는 세트" },
  },
  confirm: "hard",
  preview: (a) => {
    const f = pickScene(a);
    return "error" in f ? f.error.message : previewRemove(f.target);
  },
  run: async (a) => {
    const f = pickScene(a);
    return "error" in f ? f : doRemove(f.target);
  },
});

/** 씬을 고른다 — 세트를 안 주면 지금 보고 있는 것에서 */
function pickScene(a: Record<string, any>): { target: DelTarget } | ReturnType<typeof err> {
  const ws = useWs.getState();
  const want = String(a.set ?? "").trim();
  const set = want ? findSet(want).hit : ws.activeSet();
  if (!set || set.kind !== "set")
    return err("not_found", want ? `그런 세트가 없습니다: ${want}` : "열려 있는 세트가 없습니다.", {
      what: "set", given: want, candidates: nearBy(want, findSet("").names),
    });
  const key = String(a.scene ?? "").trim();
  const cells = set.cards.flatMap((k) => k.cells);
  const cell = cells.find((c) => c.id === key || c.name === key);
  if (!cell)
    return err("not_found", `그런 씬이 없습니다: ${key}`, {
      what: "scene", given: key, candidates: nearBy(key, cells.map((c) => c.name)),
    });
  return { target: { kind: "scene", setId: set.id, cellId: cell.id } };
}

/* ── 큐 ─────────────────────────────────────────────────────── */

defineAction({
  id: "cancel_queue",
  desc: "★**생성 큐를 비운다** — 아직 시작 안 한 것이 취소된다. 이미 나간 장은 못 되돌린다 "
    + "(Anlas 가 이미 나갔다). 사용자가 «그만»·«취소» 라고 하면 쓴다.",
  confirm: "ask",
  preview: () => {
    const q = useQueue.getState();
    const left = Math.max(0, q.progress.total - q.progress.completed);
    return left ? `대기 중인 ${left}장을 취소합니다.` : "취소할 것이 없습니다.";
  },
  run: async () => {
    const q = useQueue.getState();
    const left = Math.max(0, q.progress.total - q.progress.completed);
    if (!left) return { ok: true, did: "큐가 이미 비어 있음" };
    await q.cancelAll();
    return { ok: true, did: `큐 취소 (대기 ${left}장)`, at: { kind: "queue" } };
  },
});

/* ── 검열 ────────────────────────────────────────────────────── */

defineAction({
  id: "censor_add",
  desc: "자동검열 화면에 **그림을 넣는다**. 경로는 `list_files` 가 준 것을 그대로 쓴다.",
  args: {
    files: { type: "array", items: { type: "string" }, desc: "워크스페이스 기준 상대경로", required: true },
  },
  confirm: "none",
  run: async (a) => {
    const files = (a.files ?? []).map((x: unknown) => String(x)).filter(Boolean);
    if (!files.length) return err("not_found", "넣을 그림을 주세요.");
    const ws = useWs.getState().current;
    if (!ws) return err("no_workspace", "열려 있는 워크스페이스가 없습니다.", { retry: "never" });
    /* ★★**경로 기준이 둘이라 여기서 옮긴다** (선결 조건 3-7, 2026-08-24).
       조수의 파일 도구는 **워크스페이스 폴더** 기준인데(`agent._ws_root`), 검열이 받는
       `rel` 은 **아웃풋 루트** 기준이다(`server._censor_open` 의 `files.under(WS_ROOT, rel)`).
       `list_files` 결과를 그대로 넣으면 「그림을 찾지 못했습니다」가 난다.
       ★기준을 아웃풋 루트로 통일하고, 어긋나는 쪽(조수)이 **경계에서** 워크스페이스 이름을
         앞에 붙인다 — 검열 화면·드롭이 쓰는 값을 건드리지 않는 쪽이 안전하다. */
    const rels = files.map((f: string) => `${ws}/${f.replace(/^\/+/, "")}`);
    await useCensor.getState().addImages(
      rels.map((rel: string) => ({ name: rel.split("/").pop() ?? rel, rel })),
    );
    return { ok: true, did: `검열에 ${files.length}장 넣음`, at: { kind: "censor" } };
  },
});

defineAction({
  id: "censor_clear",
  desc: "자동검열 목록을 **비운다** (원본 파일은 그대로다).",
  confirm: "ask",
  preview: () => `목록의 ${useCensor.getState().images.length}장을 뺍니다 (원본은 그대로).`,
  run: async () => {
    const n = useCensor.getState().images.length;
    useCensor.getState().clearImages();
    return { ok: true, did: `검열 목록 비움 (${n}장)`, at: { kind: "censor" } };
  },
});

defineAction({
  id: "censor_run",
  desc: "★자동검열을 **돌린다** (목록에 든 그림 전부를 훑어 가릴 곳을 찾는다). "
    + "결과 저장은 사용자가 화면에서 따로 누른다.",
  confirm: "ask",
  preview: () => `${useCensor.getState().images.length}장을 훑습니다.`,
  run: async () => {
    const c = useCensor.getState();
    if (!c.images.length) return err("not_found", "검열 목록이 비어 있습니다. 먼저 그림을 넣어 주세요.");
    await c.scanAll();
    return { ok: true, did: `검열 ${c.images.length}장 훑음`, at: { kind: "censor" } };
  },
});

/* ── 화면 설정 ────────────────────────────────────────────────
   ★★`슬롯당 장수` 가 여기 있어야 하는 까닭: 한 바퀴가 만드는 장 수를 이 값이 정하는데
     (`queued = 씬수 × count × perSlot`), 조수가 읽지도 바꾸지도 못해 *"10종 만들어줘"* 에서
     **장수를 보장할 수 없었다** (시뮬레이션 구멍 B). */

defineAction({
  id: "set_per_slot",
  desc: "★**슬롯당 몇 장**을 뽑을지 정한다. 한 바퀴가 만드는 장 수 = 잠기지 않은 씬 × 이 값. "
    + "«씬마다 3장씩» 같은 요청이 이것이다.",
  args: { n: { type: "number", desc: "1 이상", required: true } },
  confirm: "none",
  run: async (a) => {
    const n = Math.max(1, Math.round(Number(a.n) || 0));
    if (!n) return err("unknown_field", "1 이상의 수를 주세요.", { given: String(a.n) });
    useUi.getState().setPerSlot(n);
    return { ok: true, did: `슬롯당 ${n}장으로 바꿈`, at: { kind: "queue" } };
  },
});

/* ── 생성 옵션 ────────────────────────────────────────────────
   ★값 하나하나에 액션을 만들지 않는다 — **범용 창구 하나**다 (목표 ①: 예외를 열거하면
     반드시 빠뜨린다). 대신 **허용 목록**으로 아무 이름이나 들어오는 것을 막는다. */

/** 조수가 정해도 되는 생성 옵션 — 여기 없는 이름은 거절한다.
 *  ★막는 것: 저장 포맷·품질처럼 **파일이 달라지는 값**과, 화면이 따로 관리하는 것. */
const GEN_FIELDS: Record<string, "number" | "string" | "boolean"> = {
  width: "number", height: "number", steps: "number", cfg: "number",
  seed: "number", cfg_rescale: "number",
  model: "string", sampler: "string", scheduler: "string",
  quality_preset: "string", uc_preset: "string",
  variety_plus: "boolean", transparent_bg: "boolean", furry_mode: "boolean",
};

defineAction({
  id: "set_gen_option",
  desc: "★**생성 옵션을 고친다** — 모델·크기·스텝·CFG·시드·샘플러 등. "
    + "«시드 고정해서 다시»·«스텝 28로» 같은 요청이 이것이다. "
    + "지금 값은 `get_workspace` 의 `gen` 에 있다. 한 번에 여러 개를 줘도 된다.",
  args: {
    options: { type: "object", desc: "고칠 값들 — 예: {\"steps\": 28, \"seed\": 12345}", required: true },
  },
  confirm: "none",
  run: async (a) => {
    const o = (a.options ?? {}) as Record<string, unknown>;
    const bad = Object.keys(o).filter((k) => !GEN_FIELDS[k]);
    if (bad.length)
      return err("unknown_field", `고칠 수 없는 값입니다: ${bad.join(", ")}`, {
        candidates: nearBy(bad[0], Object.keys(GEN_FIELDS)), retry: "safe",
      });
    const g = useGen.getState();
    const done: string[] = [];
    for (const [k, v] of Object.entries(o)) {
      const want = GEN_FIELDS[k];
      const val = want === "number" ? Number(v) : want === "boolean" ? !!v : String(v);
      if (want === "number" && !Number.isFinite(val as number))
        return err("unknown_field", `${k} 는 숫자여야 합니다.`, { given: String(v) });
      g.set(k as never, val as never);
      done.push(`${k}=${val}`);
    }
    if (!done.length) return err("unknown_field", "고칠 값을 주세요.");
    return { ok: true, did: `생성 옵션 고침 — ${done.join(", ")}`, at: { kind: "queue" } };
  },
});

/* ── 생성 ─────────────────────────────────────────────────────
   ★★위험도가 **고정이 아니다** — Anlas 가 나가느냐로 그때 정한다 (사용자 결정 2026-08-24).
     Opus 무료 범위 안이면 자동 승인으로 통과시킨다. 판정은 `lib/anlas.ts` 의 계산을
     그대로 쓴다 (`costNow`) — 새 규칙을 만들면 두 벌이 되어 반드시 갈린다. */

defineAction({
  id: "generate",
  desc: "★**생성을 큐에 넣는다.** 그 세트의 잠기지 않은 씬 전부를 `count` 바퀴 돈다 "
    + "(씬이 하나면 count 장). 비우면 지금 보고 있는 세트. "
    + "★**기다릴 필요가 없다** — 큐는 넣는 순간의 프롬프트를 담으므로, 이어서 프롬프트를 "
    + "고치고 또 넣어도 앞 배치는 그대로다. Anlas 가 들 수 있다.",
  args: {
    count: { type: "number", desc: "몇 바퀴. 기본 1" },
    workspace: { type: "string", desc: "어디에 넣을지 — 비우면 지금 보고 있는 곳" },
    set: { type: "string", desc: "어느 세트에 — 비우면 활성 세트" },
  },
  // ★★돈이 나가면 되돌릴 수 없다 — 그때만 `hard`
  confirm: (a) => (costNow(Math.max(1, Number(a.count) || 1)).total > 0 ? "hard" : "ask"),
  preview: (a) => {
    const rounds = Math.max(1, Number(a.count) || 1);
    const c = costNow(rounds);
    const n = countNow(rounds);
    return c.total > 0
      ? `${n}장을 만듭니다. **Anlas ${c.total}** 가 나갑니다 (되돌릴 수 없습니다).`
      : `${n}장을 만듭니다 (Opus 무료 범위 — Anlas 는 안 나갑니다).`;
  },
  // ★실행은 기존 경로를 그대로 부른다 (`queue.ts` 의 `runAction`) — 프롬프트 조립·시드
  //   규칙이 전부 거기 있어서 여기 옮기면 두 벌이 된다.
  run: async (a) => {
    const { runLegacyAction } = await import("../store/queue");
    const out = await runLegacyAction("generate", a);
    if (out && typeof out === "object" && "error" in out)
      return err("blocked", String((out as { error: unknown }).error), { retry: "never" });
    return { ...(out as object), ok: true, did: String((out as { did?: string }).did ?? t("ai.queued")) } as ActionResult;
  },
});

/* ── 씬 자리 옮기기 ────────────────────────────────────────────
   ★★*"미소 씬이랑 슬픔 씬 위치를 바꿔줘"* 가 이것이다 (사용자 시나리오 2026-08-24).
     자리를 옮기면 **파일 이름의 씬 번호도 따라간다** (`renumberSet`) — 사람이 끌어다
     놓았을 때와 **같은 길**이라 조수가 시켜도 자동으로 맞는다. */

defineAction({
  id: "move_scene",
  desc: "★**씬 자리를 옮긴다.** «미소를 맨 앞으로»·«미소와 슬픔 자리를 바꿔줘» 가 이것이다. "
    + "자리가 바뀌면 **그림 파일 이름의 씬 번호도 따라간다.** "
    + "`before` 를 주면 그 씬 앞으로, 비우면 맨 뒤로 간다.",
  args: {
    scene: { type: "string", desc: "옮길 씬 이름 또는 id", required: true },
    before: { type: "string", desc: "이 씬 **앞**에 놓는다 — 비우면 맨 뒤" },
    set: { type: "string", desc: "어느 세트에서 — 비우면 지금 보고 있는 세트" },
  },
  confirm: "none",
  run: async (a) => {
    const ws = useWs.getState();
    const want = String(a.set ?? "").trim();
    const set = want ? findSet(want).hit : ws.activeSet();
    if (!set || set.kind !== "set")
      return err("not_found", want ? `그런 세트가 없습니다: ${want}` : "열려 있는 세트가 없습니다.", {
        what: "set", given: want, candidates: nearBy(want, findSet("").names),
      });

    /* ★씬은 **카드 안에** 있다. 옮길 자리는 「받는 카드 + 그 카드 안의 틈 번호」로 준다
       (`moveScene` 의 규약) — 그래서 `before` 가 어느 카드의 몇 번째인지 먼저 찾는다. */
    const key = String(a.scene ?? "").trim();
    const named = set.cards.flatMap((k) => k.cells.map((c) => ({ card: k, cell: c })));
    const mine = named.find((x) => x.cell.id === key || x.cell.name === key);
    if (!mine)
      return err("not_found", `그런 씬이 없습니다: ${key}`, {
        what: "scene", given: key, candidates: nearBy(key, named.map((x) => x.cell.name)),
      });

    const beforeKey = String(a.before ?? "").trim();
    let toCard = mine.card.id;
    let toIndex = -1; // 맨 뒤
    if (beforeKey) {
      const target = named.find((x) => x.cell.id === beforeKey || x.cell.name === beforeKey);
      if (!target)
        return err("not_found", `그런 씬이 없습니다: ${beforeKey}`, {
          what: "scene", given: beforeKey, candidates: nearBy(beforeKey, named.map((x) => x.cell.name)),
        });
      if (target.cell.id === mine.cell.id) return { ok: true, did: "이미 그 자리입니다" };
      toCard = target.card.id;
      toIndex = target.card.cells.findIndex((c) => c.id === target.cell.id);
    }

    ws.moveScene(set.id, mine.cell.id, toCard, toIndex);
    const where = beforeKey ? `「${beforeKey}」 앞으로` : "맨 뒤로";
    return {
      ok: true,
      did: `씬 「${mine.cell.name}」 을 ${where} 옮김 (파일 번호도 함께 갱신)`,
      at: { kind: "prompt" },
    };
  },
});
