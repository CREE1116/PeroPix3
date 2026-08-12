/** 스크롤이 바닥에 가까워지면 다음 쪽을 당긴다 (v2 `fmHandleScroll` 이식).
 *
 *  ★**바닥에 닿기 전에** 부른다 (300px). 닿고 나서 부르면 빈 화면을 보며 기다리게 된다.
 *  ★100ms 디바운스 — 스크롤 이벤트는 초당 수십 번 오고, 그때마다 판단할 이유가 없다.
 *  ★`more` 는 **자기가 중복을 막는다** (`loading` 검사). 여기서는 부르기만 한다.
 */
export function onNearBottom(more: () => void, px = 300) {
  let timer: number | null = null;
  return (e: React.UIEvent<HTMLElement>) => {
    if (timer) return;
    const el = e.currentTarget;
    timer = window.setTimeout(() => {
      timer = null;
      if (el.scrollHeight - el.scrollTop - el.clientHeight < px) more();
    }, 100);
  };
}
