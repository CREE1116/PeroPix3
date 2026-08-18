import { useUi } from "../store/ui";

/** 큐가 다 끝났을 때의 알림음 — ★소리 파일은 v2 것을 그대로 가져왔다
 *  (`public/sound_noti.wav`, v2 `assets/sound_noti.wav`).
 *
 *  ★볼륨은 1~100 으로 두고 여기서 0~1 로 바꾼다 (v2 `playNotificationSound` 와 같다).
 *  ★실패해도 조용히 넘긴다 — 브라우저가 소리를 막았을 수 있고, 그것 때문에 생성 흐름이
 *    끊기면 안 된다. */
export async function playDoneSound(): Promise<void> {
  const { notifyVolume } = useUi.getState();
  try {
    const a = new Audio("/sound_noti.wav");
    a.volume = Math.min(1, Math.max(0, notifyVolume / 100));
    await a.play();
  } catch {
    /* 브라우저가 막았거나 파일이 없다 — 알림음은 부수적이라 조용히 넘긴다 */
  }
}
