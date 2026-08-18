/** 시드를 **언제 새로 뽑나** — 규칙은 여기 하나뿐이다.
 *
 *  ★★**적혀 있는 시드는 언제나 쓰인다** (사용자 지적 2026-08-16). 랜덤이라고 해서 아무
 *    상관없는 숫자를 넣는 게 아니다 — **생성 칸에 적힌 시드로 한 장을 뽑고, 그 다음에**
 *    칸을 새 난수로 갈아 끼운다. 그래서 랜덤이어도 시드를 손으로 고쳐 쓸 수 있다.
 *
 *  페로픽스 v2 의 규칙 그대로다 (`index.html` · `backend.py` 대조 2026-08-16):
 *
 *      request.seed = 시드 칸의 값                     // 언제나
 *      if random_seed_per_image and prompt_idx > 0:    // ★첫 장은 제외
 *          current_seed = 새 난수
 *      ...제출 뒤...
 *      if (!lockSeed) 시드 칸 = 새 난수                 // 다음 클릭이 달라지게
 *
 *  ★고치기 전에는 `fixed` 가 아니면 칸을 **무시하고** 매번 새 난수를 넣었다. 그래서
 *    "이 시드로 한 장 더" 가 아예 불가능했다.
 */

/** ★랜덤이어도 **구체적인 숫자**를 박는다 — 서버에 `-1` 을 넘기면 무엇이 나왔는지 못 되짚는다.
 *  범위는 v2 와 같다 (0 ~ 4294967294. `-1` 은 "랜덤" 표식이라 뺀다). */
export const randomSeed = () => Math.floor(Math.random() * 4294967295);

/** 시드를 언제 새로 뽑나 */
export type SeedMode = "fixed" | "round" | "scene";
export const SEED_MODES: SeedMode[] = ["fixed", "round", "scene"];

/** 한 바퀴에 씬 전부, 그것을 `count` 번.
 *
 *  ★**첫 장은 적힌 시드**다 (머리 주석). 그 뒤로만 새로 뽑는다:
 *
 *      fixed   전부 적힌 시드          — 몇 번을 돌려도 같은 그림
 *      round   바퀴마다 하나           — 그 바퀴의 씬들이 같은 조건이라 서로 견줄 수 있다
 *      scene   같은 바퀴 안에서도 씬마다 — 첫 씬만 적힌 시드
 *
 *  ★순서는 **바퀴가 바깥**이다. `server.py` 의 큐 루프·화면의 대기 칸과 같아야 한다.
 *  ★`roll` 은 난수 만드는 자리 — 테스트가 갈아 끼운다. */
export function rounds<S, R>(
  count: number,
  params: { seed_mode: SeedMode; seed: number },
  scenes: S[],
  make: (scene: S, seed: number) => R,
  roll: () => number = randomSeed,
): R[] {
  const out: R[] = [];
  let first = true;
  for (let r = 0; r < Math.max(1, count); r++) {
    // ★첫 바퀴는 적힌 시드로 시작한다 (v2 의 `request.seed = 시드 칸`)
    const roundSeed = params.seed_mode === "fixed" || r === 0 ? params.seed : roll();
    for (const sc of scenes) {
      // ★`scene` 이어도 **맨 첫 장**은 적힌 시드다 (v2 의 `prompt_idx > 0`)
      const seed = params.seed_mode === "scene" && !first ? roll() : roundSeed;
      first = false;
      out.push(make(sc, seed));
    }
  }
  return out;
}
