"""생성 큐 + WebSocket 브로드캐스트 — v2 `backend.py:2296-2430, 4592-4681` 이식.

★**동시성을 1보다 크게 바꾸지 말 것.** 진행률 회계(completed/total), 취소 플래그,
  "지금 생성 중인 칸은 하나"라는 프런트 규칙이 전부 직렬 실행을 전제한다. NAI 429 도 늘어난다.

★여기 든 방어 셋은 전부 **실사용 사고를 겪고** 들어간 것이다 (docs/v2-port-plan.md):

  1. `_unregister` 의 **identity 확인** — 재연결로 새 소켓이 슬롯을 차지한 뒤 구 소켓
     핸들러가 무조건 지우면, 새 연결이 브로드캐스트 명단에서 빠져 이후 아무것도 못 받는다.
  2. `broadcast` 의 **스냅샷 순회** — await 중 다른 코루틴이 연결·해제로 dict 를 바꾸면
     RuntimeError 로 브로드캐스트가 통째로 죽어 image/job_done 이 누락된다.
  3. `add_completed_image` 가 **사본을 저장** — 저장 뒤에 progress 등을 덧붙이므로,
     원본을 그대로 넣으면 복원분에 그때그때의 진행률이 섞여 들어간다.
"""
from __future__ import annotations

import asyncio
import uuid
from collections import deque
from typing import Any

#: 재연결·새로고침 복원 상한. v2 와 같은 값.
RECENT_LIMIT = 500


class GenerationQueue:
    def __init__(self) -> None:
        self.queue: deque[dict] = deque()
        self.current_job: dict | None = None
        self.current_job_id: str | None = None
        self.cancel_current = False
        self.is_processing = False

        #: client_id → WebSocket
        self.clients: dict[str, Any] = {}

        self.completed_images = 0
        self.total_images = 0

        #: 재연결 동기화용. seq 는 1부터 증가한다.
        self.recent_images: list[dict] = []
        self.image_sequence = 0

    # ── 큐 ──
    def add_job(self, request: Any, count: int) -> str:
        job_id = str(uuid.uuid4())[:8]
        self.queue.append({"id": job_id, "request": request, "count": count})
        self.total_images += count
        return job_id

    def get_next_job(self) -> dict | None:
        return self.queue.popleft() if self.queue else None

    def clear_queue(self) -> tuple[int, int]:
        """대기 큐만 비운다 — **현재 작업은 유지한다.**"""
        jobs = len(self.queue)
        images = sum(j["count"] for j in self.queue)
        self.queue.clear()
        return jobs, images

    def cancel_current_job(self) -> None:
        self.cancel_current = True

    def get_status(self) -> dict:
        return {
            "queue_length": len(self.queue),
            "current_job_id": self.current_job_id,
            "is_processing": self.is_processing,
            "queued_jobs": [{"id": j["id"], "count": j["count"]} for j in self.queue],
            "completed_images": self.completed_images,
            "total_images": self.total_images,
            "image_sequence": self.image_sequence,
        }

    # ── 복원 ──
    def add_completed_image(self, image_data: dict) -> None:
        """완료된 그림을 기록한다. seq 를 **원본에도** 부여하고 **사본을** 보관한다."""
        self.image_sequence += 1
        image_data["seq"] = self.image_sequence
        self.recent_images.append(dict(image_data))
        if len(self.recent_images) > RECENT_LIMIT:
            self.recent_images.pop(0)

    def get_images_since(self, last_seq: int) -> list[dict]:
        return [i for i in self.recent_images if i.get("seq", 0) > last_seq]

    # ── 소켓 ──
    def _unregister(self, client_id: str, ws: Any) -> None:
        """★이 슬롯이 **아직 이 소켓을 가리킬 때만** 해제한다 (위 주석 1번)."""
        if self.clients.get(client_id) is ws:
            self.clients.pop(client_id, None)

    async def broadcast(self, data: dict) -> None:
        """★**스냅샷을 순회한다** (위 주석 2번)."""
        dead: list[tuple[str, Any]] = []
        for client_id, ws in list(self.clients.items()):
            try:
                await ws.send_json(data)
            except Exception:
                dead.append((client_id, ws))
        for client_id, ws in dead:
            self._unregister(client_id, ws)

    def progress(self) -> dict:
        return {
            "completed": self.completed_images,
            "total": self.total_images,
            "queue_length": len(self.queue),
        }


async def run_loop(q: GenerationQueue, process_job) -> None:
    """큐 처리 루프. ★한 번에 **하나만** 돈다."""
    while True:
        if not q.is_processing and q.queue:
            job = q.get_next_job()
            if job:
                q.is_processing = True
                q.current_job = job
                q.current_job_id = job["id"]
                q.cancel_current = False
                try:
                    await process_job(job)
                except Exception as e:  # 한 잡이 죽어도 루프는 계속 돈다
                    print(f"[queue] job {job['id']} 실패: {e}")
                    await q.broadcast({"type": "job_error", "job_id": job["id"], "error": str(e)})
                q.is_processing = False
                q.current_job = None
                q.current_job_id = None
                q.cancel_current = False
        await asyncio.sleep(0.1)
