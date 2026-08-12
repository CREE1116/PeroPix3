import { useCards, type AnyCard, type CardKind } from "../store/cards";
import { setCardThumb } from "./thumbUpload";
import { type Thumb } from "../store/prompt";

/** 카드 저장의 **유일한 창구** — 프롬프트를 넣고, 섹션에 꽂혀 있던 그림도 함께 건다.
 *
 *  두 단계인 이유: 그림을 어느 카드에 걸지는 **id 가 정해진 뒤에야** 알 수 있다.
 *  새로 추가면 id 가 저장 응답에서 나오고, 덮어쓰기면 원래 id 를 그대로 쓴다.
 *
 *  ★그림 바이트가 오가지 않는다 — 섹션 배너가 쓰던 tid 를 카드도 **그대로 가리킨다.**
 *    그래서 배너와 카드 앞면이 같은 파일 하나를 공유한다. */
export async function saveCardWithThumb(
  kind: CardKind,
  card: Partial<AnyCard> & { name: string },
  thumb: Thumb | null,
): Promise<AnyCard> {
  const saved = await useCards.getState().save(kind, card);
  if (!thumb) return saved;

  const withThumb = await setCardThumb(kind, saved.id, thumb.tid, {
    banner: thumb.banner,
    face: thumb.face,
  });
  if (!withThumb) return saved; // 그림을 못 걸어도 카드 자체는 저장돼 있다

  // 목록의 그 카드만 갈아 끼운다 — 전체를 다시 읽지 않는다
  const cur = useCards.getState()[kind] as AnyCard[];
  useCards.setState({
    [kind]: cur.map((c) => (c.id === withThumb.id ? { ...c, ...withThumb } : c)),
  } as never);
  return withThumb;
}
