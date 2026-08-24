/** 끼울 자리 표시 — **앱에 하나**다 (CLAUDE.md: 복제하면 불일치가 계속 생긴다).
 *
 *  ★★**높이(또는 폭) 0 위에 띄운다.** 칸 사이에 실제로 끼워 넣으면 레이아웃이 밀려
 *    방금 잰 좌표가 어긋난다 — 그러면 끌고 있는 동안 놓일 자리가 스스로 흔들린다
 *    (칩 드래그가 막대를 화면 좌표에 띄우는 것과 같은 이유).
 *  ★`vert` 는 **막대가 세로**라는 뜻이다 = 칸이 **가로로 늘어선 줄**에 쓴다
 *    (워크스페이스 줄·탭 줄·세트 줄, 그리고 세로 모드의 씬 줄).
 *
 *  ★블록 목록(`BlockList`)에는 **다른 것**이 있다 — 그쪽은 일부러 자리를 벌려 아래 블록을
 *    밀어 낸다 (세로로 쌓인 목록이라 밀려도 좌표가 안 어긋나고, 벌어지는 편이 잘 보인다).
 *    성격이 다르므로 하나로 합치지 말 것. */
export function DropLine({ on, vert = false }: { on: boolean; vert?: boolean }) {
  return (
    <div
      style={{
        position: "relative",
        zIndex: 5,
        // ★자리를 안 차지해야 방금 잰 좌표가 안 어긋난다 — 그 축으로 0 이다
        ...(vert ? { width: 0, minHeight: "100%" } : { height: 0, minWidth: "100%" }),
      }}
    >
      {on && (
        <div
          data-drop-line
          style={{
            position: "absolute",
            borderRadius: 1,
            background: "var(--accent)",
            ...(vert ? { top: 0, bottom: 0, left: -1, width: 2 } : { left: 0, right: 0, top: -1, height: 2 }),
          }}
        />
      )}
    </div>
  );
}
