"""썸네일 저장 방식 이전 (2026-08-02) — 목적지마다 따로 굽던 것을 tid 하나로.

옛 구조는 같은 그림을 **세 벌** 들고 있었다.

    outputs/<ws>/thumbs/t_*.png    섹션 배너용 사본
    data/cards/thumbs/<cid>.png    카드 앞면용 사본

새 구조는 `data/thumbs/<tid>.webp` 하나이고, 셋 다 그걸 가리킨다 (thumbs.py 참조).

★옛 파일은 **지우지 않는다.** 되돌릴 수 있게 두는 편이 수십 MB 아끼는 것보다 낫다.
★여러 번 돌려도 같다 — 이미 `tid` 가 있으면 건드리지 않는다.
★그림을 못 찾은 항목은 **그대로 둔다.** 지워 버리면 사용자는 자기가 꽂았던 그림이
  왜 사라졌는지 알 길이 없다. 콘솔에만 남긴다.
"""
from __future__ import annotations

import json
from pathlib import Path

from cards import KINDS


def _view(d: dict, *keys: str) -> dict:
    return {k: d[k] for k in keys if k in d}


def _migrate_cards(cards, pins, log: list[str]) -> None:
    legacy_dir = cards.root / "thumbs"
    for kind in KINDS:
        for card in cards.list(kind):
            t = card.get("thumb")
            if not isinstance(t, dict) or t.get("tid"):
                continue
            src = legacy_dir / f"{card['id']}.png"
            tid = pins.pin(src, f"legacy:card:{card['id']}")
            if not tid:
                log.append(f"카드 그림 없음: {kind}/{card['id']} ({card.get('name')})")
                continue
            keep = {k: v for k, v in t.items() if k in ("banner", "face", "zoom", "px", "py")}
            cards.set_thumb(kind, card["id"], tid, keep)
            log.append(f"카드 {kind}/{card['id']} → {tid}")


def _walk(node, fn) -> None:
    """spec 안 어디에 있든 썸네일 dict 를 찾아낸다 — 스키마가 바뀌어도 따라간다."""
    if isinstance(node, dict):
        fn(node)
        for v in node.values():
            _walk(v, fn)
    elif isinstance(node, list):
        for v in node:
            _walk(v, fn)


def _migrate_specs(store, cards, pins, log: list[str]) -> None:
    # 카드에서 온 배너({card: cid})는 그 카드가 이미 얻은 tid 를 그대로 쓴다.
    #   (_migrate_cards 가 먼저 돌았으므로 tid 가 채워져 있다)
    by_card = {
        c["id"]: c["thumb"]["tid"]
        for k in KINDS
        for c in cards.list(k)
        if isinstance(c.get("thumb"), dict) and c["thumb"].get("tid")
    }

    for info in store.list():
        ws = info["name"]
        spec = store.load(ws)
        if not spec:
            continue
        changed = False

        def fix(d: dict) -> None:
            nonlocal changed
            # 옛 배너 썸네일: {ws, file, banner, face} 또는 {card, banner, face}.
            # ★banner/face 를 함께 보는 이유: records 의 {file: ...} 같은 남남을 건드리지 않으려고.
            if d.get("tid"):
                return
            if not (isinstance(d.get("banner"), dict) or isinstance(d.get("face"), dict)):
                return

            if isinstance(d.get("card"), str):
                tid = by_card.get(d["card"])
                where = f"카드 {d['card']}"
            elif isinstance(d.get("file"), str):
                src_ws = d.get("ws") or ws
                src = store.file_path(src_ws, d["file"])
                tid = pins.pin(src, f"legacy:ws:{src_ws}/{d['file']}") if src else None
                where = f"{src_ws}/{d['file']}"
            else:
                return

            if not tid:
                log.append(f"배너 그림 없음: {ws} ← {where}")
                return
            d["tid"] = tid
            for k in ("ws", "file", "card", "rev"):
                d.pop(k, None)
            changed = True

        _walk(spec.get("prompt"), fix)
        if changed:
            store.save(ws, spec)
            log.append(f"워크스페이스 {ws} 배너 이전")


def run(cards, store, pins) -> list[str]:
    log: list[str] = []
    try:
        _migrate_cards(cards, pins, log)
        _migrate_specs(store, cards, pins, log)
    except Exception as e:  # 이전이 실패해도 앱은 떠야 한다
        log.append(f"이전 중 오류(무시하고 계속): {e!r}")
    return log
