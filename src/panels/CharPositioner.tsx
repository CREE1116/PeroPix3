import { useEffect, useMemo, useRef, useState } from "react";
import { useGen, modelCaps } from "../store/gen";
import { usePrompt } from "../store/prompt";
import { useImageInput } from "../store/imageInput";
import { crowded, snapCenter, toCenter, CENTER_GRID, type Center } from "../lib/charPos";

/** 캐릭터 배치 판 — 큰 그림 위에 겹쳐 인물이 설 자리를 정한다.
 *
 *  ★★공홈 `sk()`·`sD()` 를 옮긴 것이다 (`_tmp/nai-v5/chunks/1388`, 대조 2026-08-21).
 *    좌표 값 자체는 `lib/charPos` 가 갖고 있고(회귀 `charPos.test.ts`), 여기는 화면이다.
 *    공홈에서 갈리는 자리 셋을 그대로 지킨다:
 *
 *      1. **판의 크기는 생성 해상도의 비율**이다. 남는 자리에 contain 으로 줄여 넣으므로,
 *         보고 있는 그림과 비율이 같으면 그 그림 위에 정확히 얹힌다.
 *         ★해상도가 아니라 **비율**이다 — 공홈 판정도 `|I.w/I.h - f.w/f.h| > 0.01` 이라
 *           1216×832 를 보다가 1536×1024 로 바꿔도 같은 판이다.
 *         ★큰 그림도 `objectFit: contain` 이라, 우리는 공홈처럼 두 갈래(그림 위 · 빈 판)로
 *           나눌 필요가 없다. **같은 사각형**이 나와서 한 경로로 둘 다 된다.
 *      2. **판 안은 모델이 가른다.** 자유 배치(V5·custom)는 끌어 놓는 면, 그 밖(V4.5)은 5×5 격자.
 *      3. **자리를 찍으면 `use_coords` 가 켜지고**, 그것을 끄면 판이 닫힌다.
 *
 *  ★i2i 베이스 그림이 있으면 판 바닥에 깐다 (공홈 `sD` 의 `backgroundUrl`).
 *  ★판 전체에 반투명 막을 덮는다 (공홈 `sN`) — 그림 위든 빈 판이든 마커가 보여야 한다.
 */
export function CharPositioner() {
  const params = useGen((s) => s.params);
  const setParam = useGen((s) => s.set);
  const chars = usePrompt((s) => s.chars);
  const setCenter = usePrompt((s) => s.setCenter);
  const baseImage = useImageInput((s) => s.baseImage);
  const [picked, setPicked] = useState(0);

  const freeform = modelCaps(params.model).freeform_position;
  /** 화면에 서는 인물만 — 꺼 둔 인물은 나가지 않으므로 자리도 없다 */
  const live = chars.filter((c) => c.on);

  useEffect(() => {
    if (picked > live.length - 1) setPicked(Math.max(0, live.length - 1));
  }, [live.length, picked]);

  /** 자리를 찍으면 좌표를 **켠다** — 끈 채로 옮기면 아무 일도 안 일어난다 (공홈 `p()`) */
  const place = (i: number, at: Center) => {
    if (!params.use_coords) setParam("use_coords", true);
    const c = live[i];
    if (c) setCenter(c.id, at);
  };

  if (!live.length) return null;

  return (
    <Board w={params.width} h={params.height} bg={baseImage ? `data:image/png;base64,${baseImage}` : null}>
      {freeform ? (
        <FreeSurface chars={live} picked={picked} setPicked={setPicked} place={place} />
      ) : (
        <GridSurface chars={live} picked={picked} place={place} />
      )}
    </Board>
  );
}

/** 판 — 남는 자리에 `w×h` 비율을 contain 으로 줄여 넣는다 (공홈 `sD`) */
function Board(p: { w: number; h: number; bg: string | null; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver((es) => {
      for (const e of es) setAvail({ width: e.contentRect.width, height: e.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const k =
    p.w > 0 && p.h > 0 ? Math.max(0, Math.min(avail.width / p.w, avail.height / p.h)) : 0;

  return (
    <div
      ref={box}
      data-char-positioner
      style={{ width: "100%", height: "100%", display: "flex", justifyContent: "center", alignItems: "center" }}
    >
      <div
        style={{
          position: "relative",
          width: p.w * k,
          height: p.h * k,
          borderRadius: "var(--r-1)",
          border: "1px solid var(--line-strong)",
          overflow: "hidden",
        }}
      >
        {p.bg && (
          <img
            src={p.bg}
            alt=""
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "fill" }}
          />
        )}
        {/* ★반투명 막 (공홈 `sN`) — 아래 그림을 죽여야 번호가 읽힌다 */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "color-mix(in srgb, var(--bg-deep) 50%, transparent)",
            display: "flex",
          }}
        >
          {p.children}
        </div>
      </div>
    </div>
  );
}

type Live = { id: string; name: string; center: Center }[];
type Surface = { chars: Live; picked: number; place: (i: number, at: Center) => void };

/** 자유 배치 — 끌어서 옮긴다 (공홈 `sV`).
 *  ★빈 곳을 누르면 **지금 고른 인물**이 거기로 간다. 마커 **18px 안**을 누르면 그것을 집는다. */
function FreeSurface(p: Surface & { setPicked: (i: number) => void }) {
  const surface = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);
  const warn = useMemo(() => crowded(p.chars.map((c) => c.center)), [p.chars]);

  /** 누른 자리에서 가장 가까운 마커 — 18px 밖이면 없는 것으로 본다 */
  const grab = (px: number, py: number) => {
    const r = surface.current?.getBoundingClientRect();
    if (!r) return undefined;
    let best = 18;
    let hit: number | undefined;
    p.chars.forEach((c, i) => {
      const d = Math.hypot(c.center.x * r.width - (px - r.left), c.center.y * r.height - (py - r.top));
      if (d <= best) {
        best = d;
        hit = i;
      }
    });
    return hit;
  };

  return (
    <div
      ref={surface}
      style={{ width: "100%", height: "100%", position: "relative", cursor: "crosshair", touchAction: "none" }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        const hit = grab(e.clientX, e.clientY);
        const r = surface.current?.getBoundingClientRect();
        if (hit === undefined) {
          dragging.current = p.picked;
          if (r) p.place(p.picked, toCenter(e.clientX, e.clientY, r));
        } else {
          dragging.current = hit;
          p.setPicked(hit);
        }
      }}
      onPointerMove={(e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        const i = dragging.current;
        const r = surface.current?.getBoundingClientRect();
        if (i !== null && r) p.place(i, toCenter(e.clientX, e.clientY, r));
      }}
      onPointerUp={() => {
        dragging.current = null;
      }}
    >
      {p.chars.map((c, i) => (
        <Marker
          key={c.id}
          n={i + 1}
          name={c.name}
          selected={i === p.picked}
          warning={warn.has(i)}
          style={{
            position: "absolute",
            left: `${100 * c.center.x}%`,
            top: `${100 * c.center.y}%`,
            transform: "translate(-50%, -50%)",
            zIndex: i === p.picked ? 2 : 1,
            pointerEvents: "none",
          }}
        />
      ))}
    </div>
  );
}

/** 격자 배치 — 칸을 누르면 고른 인물이 그리로 (공홈 `sF`).
 *  ★한 칸에 둘 이상이 서면 경고 색이고, 칸에는 **맨 앞 번호만** 보인다 (공홈과 같다). */
function GridSurface(p: Surface) {
  /** 칸마다 그 자리에 선 인물 번호들 */
  const cell = useMemo(() => {
    const at = p.chars.map((c, i) => ({ i, ...snapCenter(c.center) }));
    return CENTER_GRID.map((y) => CENTER_GRID.map((x) => at.filter((a) => a.x === x && a.y === y)));
  }, [p.chars]);
  const here = p.chars[p.picked] ? snapCenter(p.chars[p.picked].center) : undefined;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "grid",
        gridTemplateColumns: "repeat(5, 1fr)",
        gridTemplateRows: "repeat(5, 1fr)",
        gap: 4,
        padding: 4,
      }}
    >
      {CENTER_GRID.map((y, r) =>
        CENTER_GRID.map((x, c) => {
          const on = cell[r][c];
          const sel = here?.x === x && here?.y === y;
          return (
            <button
              key={`${r}-${c}`}
              type="button"
              onClick={() => p.place(p.picked, { x, y })}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "var(--r-1)",
                border: `1px solid ${sel ? "var(--accent-line)" : "var(--line)"}`,
                background: sel ? "var(--accent-bg)" : "color-mix(in srgb, var(--panel) 35%, transparent)",
                cursor: "pointer",
                padding: 0,
              }}
            >
              {on.length > 0 && (
                <Marker
                  n={on[0].i + 1}
                  name={p.chars[on[0].i].name}
                  selected={sel}
                  warning={on.length > 1}
                />
              )}
            </button>
          );
        }),
      )}
    </div>
  );
}

/** 인물 번호 마커 — 28px 원 (공홈 `sU`·`sW`) */
function Marker(p: {
  n: number;
  name: string;
  selected: boolean;
  warning: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <div
      data-char-marker={p.n}
      title={p.name}
      style={{
        width: 28,
        height: 28,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "50%",
        fontSize: "var(--text-sm)",
        fontWeight: "var(--w-semi)",
        background: p.warning ? "var(--warn)" : p.selected ? "var(--accent)" : "var(--panel)",
        color: p.warning || p.selected ? "var(--accent-on)" : "var(--ink)",
        border: `1px solid ${p.selected ? "var(--accent-line)" : "var(--line-strong)"}`,
        ...p.style,
      }}
    >
      {p.n}
    </div>
  );
}
