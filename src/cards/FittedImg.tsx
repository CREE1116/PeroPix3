import { useState } from "react";
import type { View } from "../store/prompt";

/** cover 맞춤 이미지를 **직접 계산해** 그린다 — objectPosition 을 쓰지 않는다.
 *
 *  ★이유: objectPosition 의 %는 "넘치는 양에 대한 비율"이라 커서 이동량과 1:1 이 아니고,
 *    transform: scale 까지 겹치면 위치 잡는 창과 실제 표시가 어긋난다.
 *    여기서 좌표를 픽셀로 확정하면 **미리보기 = 실물**이 수학적으로 보장된다.
 *
 *  px·py 의 뜻은 그대로다: 넘치는 축에서 0% = 왼쪽/위 끝, 100% = 오른쪽/아래 끝. */
export function coverLayout(
  w: number,
  h: number,
  W: number,
  H: number,
  view: View,
): { left: number; top: number; dW: number; dH: number; overX: number; overY: number } {
  const s = Math.max(w / W, h / H) * view.zoom;
  const dW = W * s;
  const dH = H * s;
  const overX = Math.max(0, dW - w);
  const overY = Math.max(0, dH - h);
  return { dW, dH, overX, overY, left: -(view.px / 100) * overX, top: -(view.py / 100) * overY };
}

export function FittedImg({
  url,
  w,
  h,
  view,
}: {
  url: string;
  w: number;
  h: number;
  view: View;
}) {
  const [nat, setNat] = useState<{ W: number; H: number } | null>(null);

  if (!nat) {
    // 자연 크기를 알기 전에는 안 보이게 로드만 한다 — 한 프레임 튀는 것을 막는다
    return (
      <img
        src={url}
        alt=""
        draggable={false}
        onLoad={(e) =>
          setNat({ W: e.currentTarget.naturalWidth, H: e.currentTarget.naturalHeight })
        }
        style={{ display: "none" }}
      />
    );
  }

  const L = coverLayout(w, h, nat.W, nat.H, view);
  return (
    <img
      src={url}
      alt=""
      draggable={false}
      style={{
        position: "absolute",
        left: L.left,
        top: L.top,
        width: L.dW,
        height: L.dH,
        maxWidth: "none",
        pointerEvents: "none",
      }}
    />
  );
}
