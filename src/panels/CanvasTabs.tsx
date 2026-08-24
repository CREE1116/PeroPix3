import { Fragment } from "react";
import { useI18n } from "../i18n";
import { useReorder } from "../lib/useReorder";
import { DragGhost } from "../cards/DragGhost";
import { DropLine } from "../components/DropLine";
import { EditableName } from "../components/EditableName";
import { api } from "../lib/backend";
import { toast } from "../store/toast";
import { useState } from "react";
import { allCells, takesOf, useWs, type SceneSet } from "../store/workspace";
import { ask } from "../store/ask";
import { useGen } from "../store/gen";
import { Icon } from "../components/Icon";

/** 캔버스 탭 — **두 층이고, 두 층의 생김새가 다르다** (페로픽스파이 규칙 이식 2026-08-04).
 *
 *      ┌────────┐┌────────┐
 *      │아이리스 ×││유나  ×│  +     ← 위층: **캐릭터** 폴더 탭 (위 모서리만 둥글고 아래는 열려 있다)
 *      ─────────────────────────     그 밑줄 위에 탭이 얹힌다 (`top: 1px` + 아래 테두리 없음)
 *      [새 세트 ×] [포즈 2 ×]  +     ← 아래층: **씬 세트** 작은 칩 (한 칸 안쪽)
 *
 *  ★두 줄을 같은 칩으로 그리면 층이 안 보인다 (사용자 지적 2026-08-04 — 그냥 칩을 떼다 붙였다).
 *    위층은 **어디에 있나**, 아래층은 **무엇을 열어 뒀나**라 성격이 다르고, 생김새도 달라야 한다.
 *  ★서브 탭마다 스타일·캐릭터를 따로 든다 — v2 의 "캐릭터 리스트 프리셋"이 이것으로 대체된다.
 *  ★탭 이름이 곧 저장 폴더명이다 (schema.md).
 *  ★싱글/멀티 층은 없다 — 구분 자체가 폐기됐다 (사용자 결정 2026-08-11). 탭은 **언제나
 *    씬 탭**이고, 옛 싱글 탭을 옮겨 주던 길도 2026-08-24 에 걷었다.
 *
 *  ★★**화면 이름**(사용자 결정 2026-08-18): 위층 = 「탭」, 아래층 = 「세트」.
 *    코드 식별자도 같은 이름이다 (`spec.tabs`·`spec.sets` — `shared/terms.json`).
 *    아래 그림의 「캐릭터」도 이제 화면에서는 「탭」이다. 아래층 문구(`tabs.*`)에
 *    「탭」을 되살리지 말 것. 두 줄이 같은 이름이 되면 구별이 안 된다. */
export function CanvasTabs({ part = "all" }: { part?: "all" | "top" | "sets" }) {
  const { spec, setActiveTab, closeSet, renameSet, addSet,
    switchTab, addTab, renameTab, removeTab, moveTab, moveSet, records, isDeleted, deleteFiles } = useWs();
  const tr = useI18n((s) => s.t);
  const [editing, setEditing] = useState<string | null>(null);
  const [editingChar, setEditingChar] = useState<string | null>(null);
  /* ★★**두 줄 다 끌어서 차례를 바꾼다** (사용자 지시 2026-08-24). 탭 전체가 손잡이라
     `tapSafe` 로 잡는다 — 문턱(4px)을 넘기 전에는 아무 일도 안 하므로 **눌러서 전환**과
     **두 번 눌러 이름 고치기**가 그대로 살아 있다.
     ★★세트 탭에 걸려 있던 「끌면 덱에 카드로 저장」은 **걷었다** (사용자 지시 2026-08-24:
       *"세트탭을 저장하는건 잘못된 동작임. 저장은 '세트 카드'만 되어야함. 덱에 저장되는것
       오로지 카드뿐"*). 덱으로 가는 길은 씬 줄의 **세트 카드 머리**에 그대로 있다
       (`SceneLane` 의 `onDragSave`). 그래서 여기서 몸짓이 겹칠 일도 없다.
     ★훅은 **`spec` 검사보다 앞**이다 — 조건부 훅은 규칙 위반이라 워크스페이스를 못 읽은
       순간 화면이 통째로 죽는다 (`StyleSection` 이 같은 함정을 밟았다). */
  const setOrd = useReorder(0, moveSet, { axis: "x", tapSafe: true });
  const tabOrd = useReorder(0, moveTab, { axis: "x", tapSafe: true });
  if (!spec) return null;

  const inGroup = spec.sets.filter(
    (t): t is Extract<SceneSet, { kind: "set" }> => t.kind === "set" && t.tabId === spec.activeTab,
  );
  const tabs = spec.tabs ?? [];

  // ★씬 세트 줄은 **캔버스 바로 위**에 붙는다 (사용자 제안 2026-08-05) — 두 줄을 앱 맨 위에
  //   전부 쌓으면 머리가 두꺼워지고, 이 층은 **캔버스의 내용**을 가르는 것이라 그 자리가 맞다
  //   (페로픽스파이도 캔버스 쪽에 둔다). 캐릭터 줄은 위에 남는다 —
  //   캐릭터는 **좌 패널의 프롬프트까지** 소유하므로 세 기둥 위가 맞다.
  const setRow = (
      <div
        style={{
          // ★씬 세트는 **한 칸 안쪽의 작은 칩**이다 — 위의 캐릭터 폴더 탭과 층이 갈린다
          //   (페로픽스파이 `.canvas-tab-bar` 와 같은 취지: 들여쓰기 + 작은 알약).
          display: "flex",
          alignItems: "center",
          gap: 4,
          flexWrap: "wrap",
          padding: "var(--sp-2) var(--sp-5) var(--sp-2) var(--sp-8)",
          borderBottom: "1px solid var(--line)",
        }}
      >
      {inGroup.map((t, i) => {
        const on = t.id === spec.activeTab;
        const hp = setOrd.handleProps(i);
        return (
          <Fragment key={t.id}>
          <DropLine on={setOrd.dragIdx != null && setOrd.overIdx === i} vert />
          <div
            ref={setOrd.register(i)}
            {...hp}
            onClick={() => setActiveTab(t.id)}
            onDoubleClick={() => setEditing(t.id)}
            data-scene-set={t.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--sp-2)",
              padding: "3px var(--sp-4)",
              borderRadius: "var(--r-2)",
              border: `1px solid ${on ? "var(--accent)" : "var(--line)"}`,
              maxWidth: 220,
              background: on ? "color-mix(in srgb, var(--accent) 14%, var(--surface))" : "var(--panel)",
              color: on ? "var(--ink)" : "var(--ink-dim)",
              fontSize: "var(--text-xs)",
              fontWeight: on ? "var(--w-semi)" : 400,
              // ★끌고 있는 것은 흐리게 — 잔상이 커서를 따라가므로 원본은 자리만 지킨다
              opacity: setOrd.dragIdx === i ? 0.35 : 1,
              ...hp.style,
              cursor: hp.style.cursor ?? "pointer",
            }}
          >
            {/* ★이름 고치기는 **앱에 하나**다 (`EditableName` → `useRename`).
                ★탭은 좁아서 연필 단추를 안 단다 — 더블클릭 규칙은 그대로다 */}
            <EditableName
              mark="tab"
              btn={false}
              name={t.name}
              onRename={(v) => renameSet(t.id, v)}
              ctrl={{ editing: editing === t.id, setEditing: (v) => setEditing(v ? t.id : null) }}
              style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              inputStyle={{
                width: 90,
                fontSize: "var(--text-xs)",
                background: "var(--surface2)",
                border: "1px solid var(--accent)",
                borderRadius: "var(--r-1)",
                padding: "0 4px",
              }}
            />
            {/* ★씬 수만 적는다. 예전엔 `결과가 있는 씬/전체` 를 `6/3` 처럼 적었는데
                무슨 뜻인지 알 수 없었고(사용자 지적 2026-08-04), 옛 레코드를 잘못 물어
                분자가 분모보다 큰 값까지 나왔다. 진행 상황은 생성 푸터의 큐 줄이 말한다. */}
            <span
              data-tip={tr("slots.count", { n: allCells(t).length })}
              style={{ fontSize: "0.68rem", opacity: 0.7, fontVariantNumeric: "tabular-nums" }}
            >
              {allCells(t).length}
            </span>
            {/* ★**마지막 하나는 못 닫는다** — 닫으면 이 캐릭터에 탭이 없어진다 (`closeSet` 주석) */}
            {inGroup.length > 1 && (
              <button
                /* ★★그림이 든 탭은 **묻고 닫으며, 그림도 함께 지운다**
                     (사용자 지시 2026-08-19 묻기 · 2026-08-22 함께 지우기).
                   ★★옛 원칙(`backend/workspace.py` 머리: *"생성물 = 원본. 앱이 자동으로
                     지우지 않는다"*)을 사용자가 뒤집었다 — *"앱에서 다시는 확인할 수 없는
                     형태로 사라지면 원 파일도 지운다"*. 파일만 남고 앱에서 볼 길이 없으면
                     **관리가 안 되기** 때문이다.
                   ★**휴지통을 지난다** (`deleteFiles`). 24시간 유예가 있어 되살릴 수 있고,
                     이 앱에서 지우는 창구는 전부 그리로 가기로 되어 있다 (`backend/trash.py`).
                   ★**묶는 키는 `set_id`** 다. 폴더는 **탭 이름**으로 짓기 때문에
                     (`workspace.out_dir`), 폴더를 지우면 같은 이름의 다른 탭 그림까지 지운다. */
                onClick={(e) => {
                  e.stopPropagation();
                  const mine = takesOf(records, t, undefined)
                    .filter((r) => !isDeleted(r.file))
                    .map((r) => r.file);
                  if (!mine.length) return closeSet(t.id);
                  void (async () => {
                    if (
                      await ask({
                        title: tr("set.closeConfirm", { name: t.name, n: mine.length }),
                        body: tr("set.closeConfirmBody"),
                        ok: tr("common.delete"),
                        cancel: tr("common.cancel"),
                      })
                    ) {
                      // ★그림을 먼저 보낸다 — 탭이 사라진 뒤에는 어느 그림이 그 탭 것이었는지
                      //   화면이 더는 묶어 주지 못한다
                      await deleteFiles(mine);
                      closeSet(t.id);
                    }
                  })();
                }}
                data-tip={tr("set.closeSet")}
                data-scene-set-close
                style={{ color: "var(--ink-faint)", padding: 0, display: "grid" }}
              >
                {Icon.close12}
              </button>
            )}
          </div>
          </Fragment>
        );
      })}
      <DropLine on={setOrd.dragIdx != null && setOrd.overIdx === inGroup.length} vert />

      <button
        // ★씬 하나로 시작한다 (사용자 지시 2026-08-04) — 필요한 만큼은 `씬 추가`로 는다.
        //   셋으로 시작하면 안 쓸 씬을 먼저 지워야 했다
        /* ★씬 없이 만든다 — 씬 줄에서 `+` 로 시작한다 (새 워크스페이스와 같다) */
        onClick={() => addSet(tr("set.newSet"), [])}
        data-tip={tr("set.newSetTab")}
        data-scene-set-add="set"
        style={{
          border: "1px solid var(--line)",
          borderRadius: "var(--r-2)",
          background: "var(--panel)",
          color: "var(--ink-dim)",
          lineHeight: 1,
          padding: "5px 9px",
          marginBottom: 3,
          display: "grid",
          placeItems: "center",
        }}
      >
        {Icon.plus}
      </button>

        <span style={{ flex: 1 }} />
        <SaveHint />
        <TabGhost ord={setOrd} names={inGroup.map((x) => x.name)} />
      </div>
  );

  // ★어느 자리에 그리는지가 층을 가른다: 씬 세트 줄은 캔버스 위, 캐릭터 줄은 세 기둥 위.
  //   둘 다 안 그리면 **탭이 통째로 사라진다** (실측 2026-08-05).
  if (part === "sets") return setRow;

  return (
    <div>
      {/* ★위층(싱글 | 멀티)은 없앴다 — 구분 자체가 사라졌다 (사용자 결정 2026-08-11) */}
      {/* ── **캐릭터** — 폴더 탭. 프롬프트의 주인이다 ── */}
        <div
          data-tab-bar
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 4,
            flexWrap: "wrap",
            padding: "var(--sp-3) var(--sp-5) 0",
            borderBottom: "1px solid var(--line)",
          }}
        >
          {tabs.map((c, i) => {
            const on = c.id === spec.activeTab;
            const hp = tabOrd.handleProps(i);
            return (
              <Fragment key={c.id}>
              <DropLine on={tabOrd.dragIdx != null && tabOrd.overIdx === i} vert />
              <div
                ref={tabOrd.register(i)}
                {...hp}
                data-tab={c.id}
                onClick={() => switchTab(c.id)}
                onDoubleClick={() => setEditingChar(c.id)}
                data-tip={tr("tab.rename")}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--sp-2)",
                  padding: "5px var(--sp-5)",
                  borderRadius: "7px 7px 0 0",
                  /* ★낱개 표기로만 적는다 — `border` 줄임 표기와 `borderBottom` 을 섞으면
                     탭을 바꿀 때 아래 선이 되살아날 수 있다 (React 경고, 2026-08-19) */
                  borderWidth: "1px 1px 0",
                  borderStyle: "solid",
                  borderColor: on ? "var(--accent)" : "var(--line)",
                  position: "relative",
                  top: 1,
                  maxWidth: 200,
                  background: on ? "color-mix(in srgb, var(--accent) 14%, var(--surface))" : "var(--panel)",
                  color: on ? "var(--ink)" : "var(--ink-dim)",
                  fontSize: "var(--text-xs)",
                  fontWeight: on ? "var(--w-semi)" : 400,
                  // ★끌고 있는 것은 흐리게 (세트 줄과 같은 규칙)
                  opacity: tabOrd.dragIdx === i ? 0.35 : 1,
                  ...hp.style,
                  cursor: hp.style.cursor ?? "pointer",
                }}
              >
                <EditableName
                  mark="char"
                  btn={false}
                  name={c.name}
                  onRename={(v) => renameTab(c.id, v)}
                  ctrl={{ editing: editingChar === c.id, setEditing: (v) => setEditingChar(v ? c.id : null) }}
                  style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  inputStyle={{
                    width: 96,
                    fontSize: "var(--text-xs)",
                    background: "var(--panel)",
                    border: "1px solid var(--accent)",
                    borderRadius: "var(--r-1)",
                    padding: "0 4px",
                  }}
                />
                {(spec.tabs?.length ?? 0) > 1 && (
                  <button
                    data-tab-close={c.id}
                    /* ★★**생성물이 화면에서 사라지는 삭제는 전부 묻는다** (사용자 지시 2026-08-19:
                       "무슨 탭이든 상관없어. 생성된게 지워지는 상황이면 다 확인 팝업 띄워").
                       탭 하나에 세트가 여럿 달리므로 여기서 사라지는 범위가 세트 닫기보다 넓다 —
                       그런데 예전에는 이쪽만 아무것도 안 묻고 지웠다 (조작 테스트에서 잡았다).
                     ★★**그림도 함께 휴지통으로 보낸다** (사용자 지적 2026-08-22: *"탭을 지워도
                       이미지가 그대로 output에 남아있음. 휴지통으로 안감."*). 세트 닫기는 먼저
                       그리로 갔는데 **범위가 더 넓은 이쪽만 빠져 있었다** — 그래서 파일만 남고
                       앱에서 볼 길이 없는, 관리가 안 되는 그림이 쌓였다. */
                    onClick={(e) => {
                      e.stopPropagation();
                      const sets = spec.sets.filter((x) => x.kind === "set" && x.tabId === c.id);
                      // ★한 탭에 달린 **세트 전부**의 그림을 모은다 — 묶는 키는 세트 닫기와 같은
                      //   `set_id` 다 (폴더는 세트 이름으로 짓기 때문에 폴더로 지우면 같은 이름의
                      //   다른 세트 그림까지 지운다, 위 ★주)
                      const mine = sets.flatMap((t) =>
                        takesOf(records, t, undefined)
                          .filter((r) => !isDeleted(r.file))
                          .map((r) => r.file),
                      );
                      if (!mine.length) return removeTab(c.id);
                      void (async () => {
                        if (
                          await ask({
                            title: tr("tab.removeConfirm", {
                              name: c.name,
                              t: sets.length,
                              n: mine.length,
                            }),
                            body: tr("set.closeConfirmBody"),
                            ok: tr("common.delete"),
                            cancel: tr("common.cancel"),
                          })
                        ) {
                          // ★그림을 **먼저** 보낸다 — 탭이 사라진 뒤에는 어느 그림이 그 탭 것이었는지
                          //   화면이 더는 묶어 주지 못한다 (세트 닫기와 같은 순서)
                          await deleteFiles(mine);
                          removeTab(c.id);
                        }
                      })();
                    }}
                    data-tip={tr("tab.remove")}
                    style={{ color: "var(--ink-faint)", padding: 0, display: "grid" }}
                  >
                    {Icon.close12}
                  </button>
                )}
              </div>
              </Fragment>
            );
          })}
          <DropLine on={tabOrd.dragIdx != null && tabOrd.overIdx === tabs.length} vert />
          <button
            data-tab-add
            onClick={() => addTab()}
            data-tip={tr("tab.add")}
            style={{
              border: "1px solid var(--line)",
              borderRadius: "var(--r-2)",
              background: "var(--panel)",
              color: "var(--ink-dim)",
              lineHeight: 1,
              padding: "5px 9px",
              marginBottom: 3,
              display: "grid",
              placeItems: "center",
            }}
          >
            {Icon.plus}
          </button>
          <TabGhost ord={tabOrd} names={tabs.map((c) => c.name)} />
        </div>

    </div>
  );
}

/** 차례를 바꾸는 동안 커서를 따라가는 잔상 — 두 줄이 **같은 것**을 쓴다.
 *  ★껍데기는 앱에 하나다 (`DragGhost`): 자리·층·`pointer-events` 를 그쪽이 든다. */
function TabGhost({ ord, names }: { ord: ReturnType<typeof useReorder>; names: string[] }) {
  if (!ord.ghost || ord.dragIdx == null) return null;
  return (
    <DragGhost x={ord.ghost.x} y={ord.ghost.y} anchor="exact" style={{ width: ord.ghost.w }}>
      <div
        style={{
          height: ord.ghost.h,
          display: "grid",
          placeItems: "center",
          padding: "0 var(--sp-4)",
          border: "1px solid var(--accent)",
          borderRadius: "var(--r-2)",
          background: "color-mix(in srgb, var(--accent) 14%, var(--surface))",
          color: "var(--ink)",
          fontSize: "var(--text-xs)",
          fontWeight: "var(--w-semi)",
          whiteSpace: "nowrap",
          overflow: "hidden",
        }}
      >
        {names[ord.dragIdx]}
      </div>
    </DragGhost>
  );
}

/** 어디에 저장되는지 늘 보이게 — 폴더는 사람이 보기 위한 것이다 */
function SaveHint() {
  const { current, spec } = useWs();
  const cell = useGen((s) => s.cell);
  const tr = useI18n((s) => s.t);
  /* ★★찾는 것은 **세트**이므로 열쇠도 `activeSet` 이다. 2026-08-24 개명 때 옛 이름
     (`activeTab` 이 세트를 가리키던 시절)이 남아 아무것도 못 찾았고, 그래서 이 줄이
     **화면에서 통째로 사라졌다** (사용자 지적: *"상단에 뜨던 저장경로 표시가 사라졌어"*). */
  const set = spec?.sets.find((x) => x.id === spec.activeSet);
  if (!set) return null;
  /** 화면에 적힌 그 자리 — 탐색기로 열 때도 **같은 문자열**을 쓴다 (둘이 갈리면 안 된다).
   *
   *  ★★규칙 정본은 `backend/workspace.out_dir` 다: `output/멀티/<탭>/<세트>/`.
   *    여기 적혀 있던 것은 **틀렸다** (사용자 지적 2026-08-19: 열면 400):
   *      · 위층(탭=`chars`) 폴더가 빠져 있었다
   *      · 씬 폴더를 붙이고 있었는데 **씬은 폴더가 아니다** (파일 이름 앞의 번호다) */
  const tabName = (spec?.tabs ?? []).find((c) => c.id === spec?.activeTab)?.name;
  const rel = `output/멀티/${tabName ? `${tabName}/` : ""}${set.name}`;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        /* ★★자리가 모자라면 **줄이 밀리는 대신 말줄임**이다 (사용자 지시 2026-08-19) —
           서브탭이 늘면 이 줄이 탭을 밀어냈다. 폴더 이름은 뒤쪽이 중요하지만, 여기서는
           **어느 탭·세트인지**가 뒤에 오므로 앞을 자르지 않고 끝을 자른다 (툴팁에 전체가 있다). */
        minWidth: 0,
        flexShrink: 1,
        overflow: "hidden",
        whiteSpace: "nowrap",
        fontSize: "var(--text-2xs)",
        color: "var(--ink-ghost)",
        fontFamily: "var(--font-mono)",
        paddingBottom: 6,
      }}
      data-tip={`workspaces/${current}/${rel}`}
    >
      {/* ★실제 저장 자리를 그대로 보인다 — 옛 `work/` 를 보여 주고 있어 틀렸었다.
          ★폴더 이름 `멀티/` 는 **디스크에 이미 있는 구조**다 (싱글/멀티 구분은 폐기됐지만
            폴더를 바꾸면 이미 만든 그림이 갈라진다 — `backend/workspace.py` 의 `out_dir`) */}
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        workspaces/{current}/{rel}
      </span>
      {/* ★씬 이름은 **파일 이름 앞**에 붙는다 (`file_lead`) — 폴더가 아니다 */}
      {cell ? <span style={{ color: "var(--ink-faint)" }}>/{cell}_*.png</span> : ""}
      {/* ★그 자리를 **여는 단추** (사용자 지시 2026-08-19) — 경로만 적혀 있으면
          탐색기에서 손으로 찾아 들어가야 했다 */}
      <button
        data-open-out
        data-tip={tr("files.reveal")}
        onClick={() =>
          void api("/api/files/reveal", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: `${current}/${rel}` }),
          }).catch((e) => toast(String(e), "warn"))
        }
        style={{ display: "grid", color: "var(--ink-faint)", padding: 1 }}
      >
        {Icon.folderOpen}
      </button>
    </span>
  );
}
