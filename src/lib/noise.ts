/** 심플렉스 노이즈와 fBm — **순수 함수**다 (캔버스도 DOM 도 안 쓴다).
 *
 *  ★여기 있는 것만으로 스팀 구름의 모든 무늬가 나온다. 그래서 노드에서 그대로 돌려
 *    그림으로 찍어 볼 수 있다 (`steam.test.ts`).
 *  ★씨앗을 주면 **언제나 같은 무늬**가 나온다. 같은 박스를 다시 그려도 구름이 안 바뀐다.
 */

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

/** grad3 열둘의 x·y 성분 (2D 는 z 를 안 쓴다) */
const GRAD: readonly (readonly [number, number])[] = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [1, 0], [-1, 0],
  [0, 1], [0, -1], [0, 1], [0, -1],
];

export type Noise = (x: number, y: number) => number;

/** 씨앗 하나로 노이즈 함수를 만든다. 결과는 대략 -1..1.
 *
 *  ★섞는 규칙은 v2 `SimplexNoise.seed` 그대로다 (LCG 로 256개를 섞어 512로 늘린다).
 *    같은 씨앗이면 v2·파이썬과 같은 무늬가 나온다. */
export function makeNoise(seed: number): Noise {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let s = Math.floor(seed) || 1;
  for (let i = 255; i > 0; i--) {
    s = (s * 16807 + 1) % 2147483647;
    const j = s % (i + 1);
    const tmp = p[i];
    p[i] = p[j];
    p[j] = tmp;
  }
  const perm = new Uint8Array(512);
  const pm12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) {
    perm[i] = p[i & 255];
    pm12[i] = perm[i] % 12;
  }

  return (x, y) => {
    const sk = (x + y) * F2;
    const i = Math.floor(x + sk);
    const j = Math.floor(y + sk);
    const t = (i + j) * G2;
    const x0 = x - (i - t);
    const y0 = y - (j - t);
    const upper = x0 > y0;
    const i1 = upper ? 1 : 0;
    const j1 = upper ? 0 : 1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;

    const corner = (dx: number, dy: number, gi: number) => {
      const tt = 0.5 - dx * dx - dy * dy;
      if (tt < 0) return 0;
      const g = GRAD[gi];
      const t2 = tt * tt;
      return t2 * t2 * (g[0] * dx + g[1] * dy);
    };

    return 70 * (
      corner(x0, y0, pm12[ii + perm[jj]]) +
      corner(x1, y1, pm12[ii + i1 + perm[jj + j1]]) +
      corner(x2, y2, pm12[ii + 1 + perm[jj + 1]])
    );
  };
}

/** 옥타브를 겹친 노이즈. 결과는 대략 -1..1 (진폭 합으로 나눠 맞춘다).
 *
 *  ★`lacunarity` 는 옥타브마다 주파수가 몇 배가 되는지, `gain` 은 진폭이 몇 배로 줄어드는지다.
 *    2.0 / 0.5 가 표준이고, 구름은 조금 어긋난 값(2.07)이 더 자연스럽다 — 배수가 정확히 2 면
 *    옥타브들의 격자가 겹쳐 **바둑판 같은 규칙성**이 눈에 띈다. */
export function fbm(
  n: Noise, x: number, y: number, octaves = 4, lacunarity = 2.07, gain = 0.5,
): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let fx = x;
  let fy = y;
  for (let o = 0; o < octaves; o++) {
    sum += amp * n(fx, fy);
    norm += amp;
    amp *= gain;
    fx *= lacunarity;
    fy *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}

/** 매끄러운 계단 (`smoothstep`). `e0` 이하면 0, `e1` 이상이면 1 */
export function smoothstep(e0: number, e1: number, x: number): number {
  if (e1 <= e0) return x < e0 ? 0 : 1;
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** 모서리를 둥글린 사각형까지의 **부호 있는 거리** (안쪽이 음수).
 *
 *  ★구름의 바탕 모양이다. 타원이 아니라 이것을 쓰는 이유가 하나다 —
 *    **박스 안이 전부 덮여야 하기 때문이다** (사용자 지적 2026-08-23: 실제 박스 범위와
 *    가려지는 범위가 어긋나 쓰기 어렵다). 타원은 박스의 네 모서리를 원리상 못 덮는다. */
export function sdRoundRect(
  dx: number, dy: number, halfW: number, halfH: number, radius: number,
): number {
  const r = Math.min(radius, halfW, halfH);
  const qx = Math.abs(dx) - (halfW - r);
  const qy = Math.abs(dy) - (halfH - r);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}
