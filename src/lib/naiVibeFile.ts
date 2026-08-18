/** NAI 가 내보낸 `.naiv4vibe` 파일을 읽는다 — v2 `index.html:22758-22830` 이식.
 *
 *  ★안에 **구워 둔 인코딩**이 들어 있다. 그것을 그대로 쓰면 Anlas 가 안 나간다
 *    (인코딩은 바이브당 2 Anlas). 인코딩을 못 찾으면 그림만 들여오고 생성 때 굽는다.
 *  ★파일은 JSON 이다. 모델마다 인코딩이 따로 들어 있어 **모델 약칭으로 찾아 들어간다.**
 */

export type NaiVibeImport = {
  name: string;
  /** base64 (접두어 없음) */
  image: string;
  strength: number;
  info_extracted: number;
  encoded?: string;
  encoded_model?: string;
  encoded_info_extracted?: number;
};

/** 파일 안의 인코딩 묶음 이름 (v2 `modelKeyMap` 그대로) */
const MODEL_KEY: Record<string, string> = {
  "nai-diffusion-4-5-full": "v4-5full",
  "nai-diffusion-4-curated-preview": "v4-curated",
  "nai-diffusion-4-full": "v4-full",
};

const DEFAULT_MODEL = "nai-diffusion-4-5-full";

export const NAI_VIBE_EXT = ".naiv4vibe";

export function isNaiVibeFile(name: string): boolean {
  return name.toLowerCase().endsWith(NAI_VIBE_EXT);
}

type Enc = { encoding?: string; params?: { information_extracted?: number } };

/** 파일 본문(텍스트)을 바이브 항목으로 옮긴다. 형식이 아니면 던진다. */
export function parseNaiVibeFile(text: string, fileName: string): NaiVibeImport {
  const raw: unknown = JSON.parse(text);
  const d = (raw ?? {}) as Record<string, unknown>;
  if (d.identifier !== "novelai-vibe-transfer") throw new Error("novelai-vibe-transfer");

  const info = (d.importInfo ?? {}) as Record<string, unknown>;
  const model = typeof info.model === "string" ? info.model : DEFAULT_MODEL;
  const strength = typeof info.strength === "number" ? info.strength : 0.6;
  const ie = typeof info.information_extracted === "number" ? info.information_extracted : 1.0;

  const all = (d.encodings ?? {}) as Record<string, Record<string, Enc>>;
  const bag = all[MODEL_KEY[model] ?? "v4-5full"] ?? {};

  // ★정보추출 값이 똑같은 것을 먼저 찾고, 없으면 첫 번째를 쓴다 (v2 루프 그대로).
  //   그때는 인코딩에 구워진 값을 함께 들고 와야 재사용 판정이 맞는다.
  let encoded: string | undefined;
  let encodedIe = ie;
  for (const e of Object.values(bag)) {
    if (e?.params?.information_extracted === ie) {
      encoded = e.encoding;
      encodedIe = ie;
      break;
    }
    if (!encoded && e?.encoding) {
      encoded = e.encoding;
      encodedIe = e.params?.information_extracted ?? ie;
    }
  }

  // ★그림이 비면 안 된다 — 인코딩을 다시 구워야 할 때 빈 그림을 열다 죽는다 (A1 과 같은 자국).
  //   본문에 원본이 없으면 미리보기라도 쓴다 (그쪽은 data: 접두어가 붙어 온다).
  const thumb = typeof d.thumbnail === "string" ? d.thumbnail : "";
  const image = (typeof d.image === "string" && d.image) || thumb.split(",").pop() || "";

  const name =
    (typeof d.name === "string" && d.name) || fileName.replace(new RegExp(`${NAI_VIBE_EXT}$`, "i"), "");

  return encoded
    ? { name, image, strength, info_extracted: ie, encoded, encoded_model: model, encoded_info_extracted: encodedIe }
    : { name, image, strength, info_extracted: ie };
}
