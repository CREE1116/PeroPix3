/** 스팀(구름) 텍스처 — **순수 계산**이다. 캔버스도 DOM 도 안 쓴다.
 *
 *  ★★**박스 안은 반드시 전부 덮인다** (사용자 지적 2026-08-23: *"실제 박스 범위랑 가려지는
 *    범위가 오차가 있어서 쓰기가 좀 어렵다"*). 옛 구름은 **타원**이라
 *    `√((x/(w/2))² + (y/(h/2))²)` 가 1.18 인 네 모서리를 **원리상 못 덮었고**, 변 가운데도
 *    61% 만 덮었다. 여기서는 바탕 모양을 **둥근 사각형의 부호 있는 거리**로 잡고, 노이즈가
 *    그 윤곽을 **바깥으로만** 밀게 했다. 그래서 박스가 곧 「반드시 가려지는 범위」이고,
 *    구름은 그 밖으로만 번진다.
 *
 *  ★★계산을 **두 겹으로 나눈다**. 무늬(노이즈)는 비싸고 잘 안 바뀌지만, 밝기·진하기는
 *    슬라이더라 매 프레임 바뀐다. 그래서 `plate()` 가 무늬만 만들어 캐시해 두고,
 *    `plateRGBA()` 가 거기에 밝기·진하기를 곱한다 (픽셀당 곱셈 하나라 사실상 공짜다).
 *    ★무늬는 **박스 짧은 변을 1 로 놓은 좌표**에서 만든다 — 박스 크기가 바뀌어도 다시 만들
 *      필요가 없고, 늘려 쓰기만 하면 된다 (파이썬도 512 판을 만들어 늘려 썼다).
 */
import { fbm, makeNoise, sdRoundRect, smoothstep } from "./noise.ts";

/** 무늬 판의 긴 변 (픽셀). ★비용이 여기 걸린다 — 픽셀마다 fBm 을 세 번 돈다.
 *  320 이면 판 하나가 10만 픽셀이라 한 장에 수십 ms 이고, 캐시되므로 끄는 동안에는 0 이다. */
const PLATE_MAX = 320;

export type Plate = {
  /** 덮는 정도 0..255. ★박스 안은 언제나 255 다 */
  cover: Uint8Array;
  /** 구름의 두께(밝기) 0..255. 밝기 슬라이더가 이 값을 편다 */
  lum: Uint8Array;
  /** 판의 픽셀 크기 */
  pw: number;
  ph: number;
  /** 박스 짧은 변을 1 로 놓았을 때 판이 박스 밖으로 나가는 폭. 그릴 자리를 여기서 셈한다 */
  margin: number;
};

/** 이 판이 무엇으로 만들어졌나 — 캐시 열쇠 */
export type PlateKey = { seed: number; feather: number; aspect: number };

/** 가로세로비를 **5% 단위로 뭉갠다.** 늘리는 동안 판을 다시 만들지 않기 위한 것이고,
 *  5% 는 눈에 안 띈다 (판을 그 비율로 늘려 쓴다). */
export const bucketAspect = (w: number, h: number) =>
  Math.max(0.05, Math.round((w / Math.max(h, 1e-6)) * 20) / 20);

/** 짧은 변 대비 구름이 밖으로 번지는 폭. **고정값이다.**
 *
 *  ★★사용자 지적 2026-08-23: *"덮는 범위도 이상함. 부드럽게를 높이면 스팀 영역이 넓어짐"*.
 *    한때 이 값이 「부드럽게」에 따라 커졌는데, 그러면 **가려지는 범위 자체가 바뀐다** —
 *    가장자리를 부드럽게 하려고 만진 슬라이더가 덮는 넓이를 흔드는 셈이라, 어디까지
 *    가려질지 예측할 수 없다. 이제 「부드럽게」는 **가장자리가 얼마나 완만한지만** 정하고
 *    구름이 닿는 끝은 언제나 같다. */
export const MARGIN = 0.3;
export const marginOf = (_feather?: number) => MARGIN;

/** 무늬 판 하나를 만든다. ★비싸다 — 부르는 쪽이 캐시한다 (`censorRender`). */
export function plate(key: PlateKey): Plate {
  const { seed, feather } = key;
  const aspect = Math.max(0.05, key.aspect);
  // 짧은 변을 1 로 놓는다. 긴 쪽만 비율만큼 늘어난다
  const hw = aspect >= 1 ? aspect / 2 : 0.5;
  const hh = aspect >= 1 ? 0.5 : 1 / aspect / 2;
  const margin = marginOf(feather);
  const halfPW = hw + margin;
  const halfPH = hh + margin;

  const perUnit = PLATE_MAX / (2 * Math.max(halfPW, halfPH));
  const pw = Math.max(8, Math.round(2 * halfPW * perUnit));
  const ph = Math.max(8, Math.round(2 * halfPH * perUnit));

  const nEdge = makeNoise(seed * 2 + 1);
  const nLum = makeNoise(seed * 2 + 977);

  // ★「부드럽게」를 올리면 덩어리가 커지고 잔가지가 잦아든다 (닿는 끝은 안 변한다)
  const soft = Math.min(50, Math.max(0, feather)) / 50;
  const lobeScale = 0.32 + soft * 0.4;
  const wispScale = lobeScale * 0.32;
  const wispMix = 0.45 - soft * 0.22;
  /* ★★**무늬(밝기)는 v2 원문 그대로다** (사용자 지시 2026-08-23: *"새로 바뀐 스팀 텍스처가
     더 이상함. 원래 걸로 복구"*). 한때 도메인 워프를 건 5옥타브로 바꿔 봤는데, 안쪽에
     회색 결이 생겨 「연기」가 아니라 「얼룩」으로 보였다. 옛것은 **거의 흰색**이고 흔들림이
     13계조뿐이라 그게 이 그림의 성격에 맞는다.
     ★되돌린 것은 **무늬뿐이다.** 덮는 범위(둥근 사각형 + 바깥으로만 부푸는 윤곽)는 그대로
       둔다 — 박스가 다 안 가려지던 것이 원래 고치려던 문제다. */
  const lumScale = Math.max(halfPW, halfPH) * (1 + soft * 2);

  /* ★★바탕 모양을 **박스보다 한 겹 키우고 모서리를 크게 둥글린다.** 박스에 딱 맞춰
     두면 구름이 「털 난 네모」로 보인다. 키운 만큼(`grow`) 여유가 생기므로 반지름을
     그보다 크게 잡아도 **박스 네 모서리는 여전히 안쪽**이다 (R < grow·3.41 이면 성립).
     ★키운 폭(`grow`)까지 합쳐 판의 여백(`margin`)을 넘지 않는다 — 넘으면 구름이
       네모나게 잘린다. */
  const grow = margin * 0.25;
  const radius = Math.min(grow * 2.2, hw + grow, hh + grow);
  /* ★★남은 폭(`reach`)을 **완만함(`fade`)과 굴곡(`solid`)이 나눠 쓴다.** 둘을 더하면
     언제나 `reach` 라, 「부드럽게」를 아무리 올려도 구름이 닿는 끝은 그대로다.
       부드럽게 0   좁은 fade + 큰 solid  → 윤곽이 또렷하고 울퉁불퉁하다
       부드럽게 50  넓은 fade + 작은 solid → 윤곽이 뭉개지며 아지랑이처럼 흐려진다 */
  const reach = margin - grow;
  const fade = reach * (0.15 + soft * 0.8);
  const solid = reach - fade;

  const cover = new Uint8Array(pw * ph);
  const lum = new Uint8Array(pw * ph);

  for (let py = 0; py < ph; py++) {
    const dy = (py + 0.5) / perUnit - halfPH;
    for (let px = 0; px < pw; px++) {
      const dx = (px + 0.5) / perUnit - halfPW;
      const i = py * pw + px;

      // ── 덮는 범위 ──────────────────────────────────────────
      // ★`sd` 가 음수인 곳이 **박스 안**이다. 부풀리는 항은 언제나 0 이상이라
      //   윤곽은 **밖으로만** 밀린다. 그래서 박스 안이 파이는 일이 없다.
      const sd = sdRoundRect(dx, dy, hw + grow, hh + grow, radius);
      const lobe = fbm(nEdge, dx / lobeScale, dy / lobeScale, 3) * 0.5 + 0.5;
      const wisp = fbm(nEdge, dx / wispScale + 31.7, dy / wispScale + 11.3, 4) * 0.5 + 0.5;
      // ★덩어리에 굴곡을 준다 — 고르게 부풀면 윤곽이 그대로라 바탕 모양이 드러난다
      const bulge = smoothstep(0.15, 0.85, lobe) * (1 - wispMix) + wisp * wispMix;
      const d = sd - bulge * solid;
      cover[i] = Math.round(255 * (1 - smoothstep(0, fade, d)));

      // ── 구름의 두께 ────────────────────────────────────────
      // ★v2 `generateSteamTexture` 그대로: 3옥타브(1 · 0.5 · 0.25)를 0.5~1 로 편다
      const v = fbm(nLum, dx / lumScale, dy / lumScale, 3, 2, 0.5);
      lum[i] = Math.round(255 * (0.5 + ((v + 1) / 2) * 0.5));
    }
  }
  return { cover, lum, pw, ph, margin };
}

/** 회색 범위 — **v2 원문 그대로** (`floor(b*230) + floor(bright * floor(b*25))`).
 *  ★230 을 바탕으로 25 단계만 흔든다. 거의 흰색이고, 그것이 이 구름의 원래 성격이다. */
const GRAY_BASE = 230;
const GRAY_RANGE = 25;

/** 무늬 판에 **밝기·진하기**를 입혀 RGBA 로 만든다. 픽셀당 곱셈이라 슬라이더가 안 걸린다.
 *
 *  `out` 을 주면 거기에 쓴다 (매 프레임 새 배열을 만들지 않기 위해). */
export function plateRGBA(
  p: Plate, brightness: number, alpha: number, out?: Uint8ClampedArray,
): Uint8ClampedArray {
  const n = p.pw * p.ph;
  const rgba = out && out.length === n * 4 ? out : new Uint8ClampedArray(n * 4);
  const b = Math.min(100, Math.max(0, brightness)) / 100;
  const a = Math.min(100, Math.max(0, alpha)) / 100;
  const base = Math.floor(GRAY_BASE * b);
  const range = Math.floor(GRAY_RANGE * b);
  for (let i = 0; i < n; i++) {
    const g = base + Math.floor((p.lum[i] / 255) * range);
    const o = i * 4;
    rgba[o] = g;
    rgba[o + 1] = g;
    rgba[o + 2] = g;
    rgba[o + 3] = p.cover[i] * a;
  }
  return rgba;
}
