/** 비율 사각형 — **긴 변을 `max` 로 맞춘다.**
 *
 *  ★★쓰는 곳이 둘이라 여기 하나로 둔다: 해상도 고르기(탭·목록, `OptionsPanel`)와
 *    씬 줄의 **가로/세로 모드 단추**(`SceneLane`). 같은 뜻(가로냐 세로냐)을 두 곳에서
 *    다른 모양으로 그리면 화면이 갈린다 (사용자 지적 2026-08-20: *"동일한 컴포넌트를
 *    쓰는게 아니고 복제해서 만드니까 불일치가 계속 생김"*).
 *  ★`on` 은 **골라져 있음**을 뜻한다 — 강조가 필요 없는 자리는 안 넘기면 된다. */
export function Ratio({
  w,
  h,
  max,
  on = false,
}: {
  w: number;
  h: number;
  max: number;
  on?: boolean;
}) {
  const k = max / Math.max(w, h);
  return (
    <span
      aria-hidden
      style={{
        width: Math.round(w * k),
        height: Math.round(h * k),
        borderRadius: 2,
        flexShrink: 0,
        background: on ? "var(--accent)" : "var(--ink-ghost)",
      }}
    />
  );
}

/** 가로/세로를 나타내는 대표 비율 — 해상도 기본값과 같은 값이다 (`SIZE_PRESETS` 의 ✦) */
export const RATIO_LANDSCAPE = { w: 1216, h: 832 };
export const RATIO_PORTRAIT = { w: 832, h: 1216 };
