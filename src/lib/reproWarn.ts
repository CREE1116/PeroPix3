/** **이 그림은 메타데이터만으로 재현되지 않는다** — 그 까닭을 가른다.
 *
 *  ★★공홈과 **같은 갈래**다 (번들 실측 2026-08-25, `reference/nai-web-2026-08-21` 의
 *    `notReproducibleReason`): img2img · inpainting · 인코딩 없는 바이브 · Precise Reference.
 *    공홈 문구는 *"This image was generated using [0] cannot be reproduced from its metadata."*
 *
 *  ★★**되살리는 것이 아니라 알리는 것**이다 (사용자 결정 2026-08-25). 공홈도 v2 도
 *    Precise Reference 는 복원하지 않는다 — 참조한 그림이 PNG 에 안 남기 때문이다.
 *    바이브는 **인코딩이 실려 있을 때만** 되살아난다 (그때는 다시 굽지 않아 값도 안 나간다).
 *  ★없던 알림이라 사용자는 *"왜 이 그림처럼 안 나오지"* 를 스스로 알아내야 했다.
 *  ★순서가 규칙이다 — 공홈과 같게 둔다. i2i·인페인트가 먼저다 (그림 자체가 없는 쪽이
 *    더 크게 어긋난다), 그다음이 바이브, 마지막이 레퍼런스.
 */
export type ReproWarn = "img2img" | "inpainting" | "vibeNoEncoding" | "preciseRef" | null;

type Meta = {
  request_type?: string;
  nai_vibes?: { images?: string[]; strengths?: number[] };
  precise_ref_count?: number;
};

export function reproWarn(m: Meta | null | undefined): ReproWarn {
  if (!m) return null;
  if (m.request_type === "Img2ImgRequest") return "img2img";
  if (m.request_type === "NativeInfillingRequest") return "inpainting";
  /* ★강도는 남았는데 인코딩이 없는 경우 — 바이브를 썼다는 것만 알 수 있고 되살릴 수 없다 */
  const v = m.nai_vibes;
  if ((v?.strengths?.length ?? 0) > 0 && (v?.images?.length ?? 0) === 0) return "vibeNoEncoding";
  if ((m.precise_ref_count ?? 0) > 0) return "preciseRef";
  return null;
}
