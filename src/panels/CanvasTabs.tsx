import { useI18n } from "../i18n";
import { cardBlocks } from "../lib/blocks";
import { useState } from "react";
import { allCells, useWs, type CanvasTab } from "../store/workspace";
import { useGen } from "../store/gen";
import { useDragSource } from "../cards/dragStore";
import { colorOf } from "../store/cards";
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
 *    씬 탭**이고, 옛 싱글 탭은 열 때 옮겨진다 (`migrate` → `convertSingleTab`). */
export function CanvasTabs({ part = "all" }: { part?: "all" | "top" | "sets" }) {
  const { spec, setActiveTab, closeTab, renameTab, addSetTab,
    switchChar, addChar, renameChar, removeChar } = useWs();
  const tr = useI18n((s) => s.t);
  const [editing, setEditing] = useState<string | null>(null);
  const [editingChar, setEditingChar] = useState<string | null>(null);
  const startDrag = useDragSource();
  if (!spec) return null;

  const inGroup = spec.tabs.filter(
    (t): t is Extract<CanvasTab, { kind: "set" }> => t.kind === "set" && t.charId === spec.activeChar,
  );

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
      {inGroup.map((t) => {
        const on = t.id === spec.activeTab;
        return (
          <div
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            onDoubleClick={() => setEditing(t.id)}
            // 역드래그 저장: 씬 세트 탭을 우하단 핸드로 끌면 씬 세트 카드가 된다
            onPointerDown={(e) => {
              if (editing) return;
              // ★닫기 단추 위에서는 끌지 않는다 — `startDrag` 가 pointerdown 을 preventDefault 해서
              //   따라올 click 을 삼키고, 그래서 **세트 탭이 지워지지 않았다** (사용자 지적 2026-08-04)
              if ((e.target as HTMLElement).closest("[data-tab-close]")) return;
              startDrag(e, {
                dir: "save",
                kind: "posesets",
                card: {
                  id: "",
                  name: t.name,
                  color: colorOf(t.name),
                  // ★「추가」 블록은 카드에 안 담긴다 (이 탭 것이다)
                  cells: allCells(t).map((c) => ({ name: c.name, blocks: cardBlocks(c.blocks) })),
                },
              });
            }}
            data-tab={t.id}
            title={tr("tabs.dragToSave")}
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
              cursor: "pointer",
            }}
          >
            {editing === t.id ? (
              <input
                autoFocus
                defaultValue={t.name}
                onClick={(e) => e.stopPropagation()}
                onBlur={(e) => {
                  renameTab(t.id, e.target.value.trim());
                  setEditing(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") setEditing(null);
                }}
                style={{
                  width: 90,
                  fontSize: "var(--text-xs)",
                  background: "var(--surface2)",
                  border: "1px solid var(--accent)",
                  borderRadius: "var(--r-1)",
                  padding: "0 4px",
                }}
              />
            ) : (
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {t.name}
              </span>
            )}
            {/* ★씬 수만 적는다. 예전엔 `결과가 있는 씬/전체` 를 `6/3` 처럼 적었는데
                무슨 뜻인지 알 수 없었고(사용자 지적 2026-08-04), 옛 레코드를 잘못 물어
                분자가 분모보다 큰 값까지 나왔다. 진행 상황은 생성 푸터의 큐 줄이 말한다. */}
            <span
              title={tr("slots.count", { n: allCells(t).length })}
              style={{ fontSize: "0.68rem", opacity: 0.7, fontVariantNumeric: "tabular-nums" }}
            >
              {allCells(t).length}
            </span>
            {/* ★**마지막 하나는 못 닫는다** — 닫으면 이 캐릭터에 탭이 없어진다 (`closeTab` 주석) */}
            {inGroup.length > 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(t.id);
                }}
                title={tr("tabs.closeTab")}
                data-tab-close
                style={{ color: "var(--ink-faint)", padding: 0, display: "grid" }}
              >
                {Icon.close12}
              </button>
            )}
          </div>
        );
      })}

      <button
        // ★씬 하나로 시작한다 (사용자 지시 2026-08-04) — 필요한 만큼은 `씬 추가`로 는다.
        //   셋으로 시작하면 안 쓸 씬을 먼저 지워야 했다
        onClick={() => addSetTab(tr("tabs.newSet"), [tr("tabs.posePrefix", { n: 1 })])}
        title={tr("tabs.newSetTab")}
        data-tab-add="set"
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
          data-char-bar
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 4,
            flexWrap: "wrap",
            padding: "var(--sp-3) var(--sp-5) 0",
            borderBottom: "1px solid var(--line)",
          }}
        >
          {(spec.chars ?? []).map((c) => {
            const on = c.id === spec.activeChar;
            return (
              <div
                key={c.id}
                data-char={c.id}
                onClick={() => switchChar(c.id)}
                onDoubleClick={() => setEditingChar(c.id)}
                title={tr("chars.rename")}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--sp-2)",
                  padding: "5px var(--sp-5)",
                  borderRadius: "7px 7px 0 0",
                  border: `1px solid ${on ? "var(--accent)" : "var(--line)"}`,
                  borderBottom: "none",
                  position: "relative",
                  top: 1,
                  maxWidth: 200,
                  background: on ? "color-mix(in srgb, var(--accent) 14%, var(--surface))" : "var(--panel)",
                  color: on ? "var(--ink)" : "var(--ink-dim)",
                  fontSize: "var(--text-xs)",
                  fontWeight: on ? "var(--w-semi)" : 400,
                  cursor: "pointer",
                }}
              >
                {editingChar === c.id ? (
                  <input
                    autoFocus
                    defaultValue={c.name}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => {
                      renameChar(c.id, e.target.value);
                      setEditingChar(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      if (e.key === "Escape") setEditingChar(null);
                    }}
                    style={{
                      width: 96,
                      fontSize: "var(--text-xs)",
                      background: "var(--panel)",
                      border: "1px solid var(--accent)",
                      borderRadius: "var(--r-1)",
                      padding: "0 4px",
                    }}
                  />
                ) : (
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {c.name}
                  </span>
                )}
                {(spec.chars?.length ?? 0) > 1 && (
                  <button
                    data-char-close={c.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeChar(c.id);
                    }}
                    title={tr("chars.remove")}
                    style={{ color: "var(--ink-faint)", padding: 0, display: "grid" }}
                  >
                    {Icon.close12}
                  </button>
                )}
              </div>
            );
          })}
          <button
            data-char-add
            onClick={() => addChar()}
            title={tr("chars.add")}
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
        </div>

    </div>
  );
}

/** 어디에 저장되는지 늘 보이게 — 폴더는 사람이 보기 위한 것이다 */
function SaveHint() {
  const { current, spec } = useWs();
  const cell = useGen((s) => s.cell);
  const tr = useI18n((s) => s.t);
  const tab = spec?.tabs.find((x) => x.id === spec.activeTab);
  if (!tab) return null;
  return (
    <span
      style={{
        fontSize: "var(--text-2xs)",
        color: "var(--ink-ghost)",
        fontFamily: "var(--font-mono)",
        paddingBottom: 6,
      }}
      title={tr("canvas.saveLocation")}
    >
      {/* ★실제 저장 자리를 그대로 보인다 — 옛 `work/` 를 보여 주고 있어 틀렸었다.
          ★폴더 이름 `멀티/` 는 **디스크에 이미 있는 구조**다 (싱글/멀티 구분은 폐기됐지만
            폴더를 바꾸면 이미 만든 그림이 갈라진다 — `backend/workspace.py` 의 `out_dir`) */}
      workspaces/{current}/output/멀티/{tab.name}
      {cell ? `/${cell}` : ""}
    </span>
  );
}
