import type { ImageMeta } from "../store/gallery";
import type { GenParams } from "../store/gen";

/** 그림의 메타데이터를 **생성 설정으로** 되돌리는 표 — 어느 필드가 어느 설정인가.
 *
 *  ★쓰는 곳이 **둘**이라 표를 여기 하나로 뒀다:
 *   - 갤러리의 「설정 불러오기」(`GalleryMeta.applyMeta`) — **화면 상태를 바꾼다**
 *   - **강화**(`EnhanceDialog`) — 그 요청에만 싣고 화면은 안 건드린다
 *    표가 두 벌이면 "이 그림 설정대로"가 두 화면에서 조용히 달라진다.
 *
 *  ★**없는 값은 안 낸다.** 기본값으로 메우면 갤러리에서는 사용자가 잡아 둔 값이 날아가고,
 *    강화에서는 "메타데이터가 없으면 지금 화면 값" 이라는 폴백이 막힌다
 *    (v2 `buildEnhanceRequest` 의 `normalized?.x || 사이드바`, `index.html:24455-24486`).
 *
 *  ★**시드와 해상도는 여기 없다** — 쓰는 자리마다 뜻이 다르다.
 *    갤러리는 그 그림을 재현하려고 시드까지 되살리지만, 강화는 v2 와 같이 **화면의 시드**로
 *    다시 그린다 (`index.html:24476`: 원본 시드 그대로면 같은 그림이 나와 강화의 뜻이 없다).
 *    해상도도 강화에서는 원본 크기 × 배율이라 메타데이터의 값이 아니다. */
export function metaParams(m: ImageMeta): Partial<GenParams> {
  const p: Partial<GenParams> = {};
  if (m.steps !== undefined) p.steps = m.steps;
  if (m.cfg !== undefined) p.cfg = m.cfg;
  if (m.sampler) p.sampler = m.sampler;
  if (m.scheduler) p.scheduler = m.scheduler;
  if (m.cfg_rescale !== undefined) p.cfg_rescale = m.cfg_rescale;
  // ★서버가 정규화해 준 값들 (`backend/meta.py`). 프롬프트에서 퀄리티 태그를, 네거티브에서
  //   UC 프리셋을 이미 떼어 냈으므로 그 둘을 **설정으로 되돌려야** 다시 그렸을 때 같아진다.
  if (m.uc_preset) p.uc_preset = m.uc_preset;
  if (m.quality_tags !== undefined) p.quality_tags = m.quality_tags;
  if (m.variety_plus !== undefined) p.variety_plus = m.variety_plus;
  // ★프롬프트 앞의 `fur dataset, ` 도 서버가 떼어 내 값으로 돌려준다 — 빠져 있던 자리다
  if (m.furry_mode !== undefined) p.furry_mode = m.furry_mode;
  // ★재생성에 쓰는 **모델 id** 다 (`source` 는 표시용 문자열이라 여기 못 쓴다)
  if (m.nai_model) p.model = m.nai_model;
  return p;
}

/** 이 그림에 **쓸 수 있는 메타데이터가 있는가.**
 *
 *  ★`meta.read()` 는 밖에서 가져온 그림에도 **가로·세로는 채워서** 돌려준다
 *    (`backend/meta.py` `read`) — 그래서 "응답이 null 이 아니다"로는 못 가른다.
 *    생성 설정을 되살릴 수 있는 자리는 프롬프트나 모델 id 가 있느냐다. */
export const hasMeta = (m: ImageMeta | null | undefined): boolean =>
  !!(m && (m.prompt?.trim() || m.nai_model));
