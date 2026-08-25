/** **지금 보고 있는 그림을 어떻게 재고 어떻게 보고 있나** — 재는 자리는 여기 하나다.
 *
 *  ★★왜 스토어로 뺐나 (사용자 지시 2026-08-25): *"이미지 배율 조정 UI를 아래의 시드 있는
 *    곳으로 내려 줘. 꽉차게 봤을 때 이미지를 가림."* 조절 단추가 그림 위에 겹쳐 있었는데,
 *    그 단추가 쓰는 값(무대 크기·그림 실제 크기·보고 있는 자리)은 **프리뷰 안의 지역
 *    상태**였다. 값이 거기 갇혀 있으면 단추를 다른 줄로 못 옮긴다.
 *
 *  ★★같은 값을 **해상도 표시**도 쓴다 (사용자 지시 2026-08-25: *"생성된 이미지 하단에
 *    해당 이미지의 해상도도 표기. 시드 옆에"*). 한때 그 자리는 `dims` 라는 **별도 상태**를
 *    두고 아무도 안 채워서 **영영 안 떴다** (`SceneActions` 의 `setDims` 를 부르는 곳이
 *    없었다). 실제 크기는 하나뿐이니 재는 곳도 하나여야 한다.
 *
 *  ★**배율 자체는 여기 없다.** 그것은 워크스페이스에 남는 설정이다 (`spec.preview`) —
 *    여기 있는 것은 「지금 이 장을 재어 보니 이렇더라」뿐이라 장이 바뀌면 사라진다.
 */
import { create } from "zustand";
import {
  ZOOM_MAX, ZOOM_MIN, drawSize, keepCenter, stepZoom, zoomFrom,
  type Pan, type Size,
} from "../lib/zoomView";
import { useWs } from "./workspace";
import { useUi } from "./ui";

type S = {
  /** 그림의 **실제 크기** (`naturalWidth/Height`) — 해상도 표시가 읽는 값이기도 하다 */
  nat: Size;
  /** 그림이 놓이는 **무대**의 안쪽 크기 */
  box: Size;
  /** 지금 보고 있는 **자리** — ★남기지 않는다 (장이 바뀌면 가운데에서 다시 시작) */
  pan: Pan;
  setNat: (s: Size) => void;
  setBox: (s: Size) => void;
  setPan: (p: Pan | ((p: Pan) => Pan)) => void;
};

export const usePreviewBox = create<S>((set) => ({
  nat: { w: 0, h: 0 },
  box: { w: 0, h: 0 },
  pan: { x: 0, y: 0 },
  setNat: (nat) => set({ nat }),
  setBox: (box) => set({ box }),
  setPan: (p) => set((s) => ({ pan: typeof p === "function" ? p(s.pan) : p })),
}));

/** 지금 실제로 걸려 있는 「꽉차게」 — ★배치판이 열려 있으면 잠긴다 (`CharPositioner`) */
export const fitNow = (): boolean =>
  (useWs.getState().spec?.preview?.fit ?? true) || useUi.getState().positioning;

/** 배율을 정한다. ★**보고 있던 지점을 붙든다**(`keepCenter`) — 안 그러면 %를 만질 때마다
 *  화면이 왼쪽 위로 튄다. 그래서 자리(`pan`)를 아는 이 자리에 있어야 한다. */
export function setZoom(z: number): void {
  const { nat, box, pan } = usePreviewBox.getState();
  const view = useWs.getState().spec?.preview ?? { fit: true, zoom: 1 };
  const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
  const from = drawSize(nat, fitNow() ? zoomFrom(box, nat, true, view.zoom) : view.zoom);
  usePreviewBox.getState().setPan(keepCenter(pan, box, from, drawSize(nat, next)));
  useWs.getState().setPreview({ fit: false, zoom: next });
}

/** 휠(Ctrl) 한 칸 · 단추 한 칸 — 「꽉차게」에서 만지면 **보이던 크기에서** 이어진다 */
export function bumpZoom(d: 1 | -1): void {
  const { nat, box } = usePreviewBox.getState();
  const view = useWs.getState().spec?.preview ?? { fit: true, zoom: 1 };
  setZoom(stepZoom(zoomFrom(box, nat, fitNow(), view.zoom), d));
}
