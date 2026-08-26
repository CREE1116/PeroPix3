"""저장 파일의 낱말을 화면 낱말에 맞춘다 — **1회 이전** (2026-08-24).

★★화면과 코드가 뒤집혀 있었다 (`docs/terms-plan.md`):

      화면 「탭」  ← `spec.chars` · `activeChar`      (옛 이름 「캐릭터」의 흔적)
      화면 「세트」 ← `spec.tabs`  · `activeTab`       (그래서 `tabs` 가 「탭」으로 읽혔다)

  이제 화면 낱말대로 `tabs`(탭) · `sets`(세트) 로 옮긴다.

★★**이름이 자리를 맞바꾼다** (`chars→tabs`, `tabs→sets`). 그래서 열쇠를 하나씩 옮기면 안 된다 —
  중간 상태에서 `tabs` 가 두 가지를 가리킨다. **한 번에 통째로** 새 dict 를 만든다.
  이미 옮겼는지는 `specVersion` 으로 가린다 (여러 번 돌려도 같다).

★**옛 파일을 먼저 베낀다** (`.bak-v1`). 되돌릴 수 있는 것이 수십 KB 아끼는 것보다 낫다
  (`migrate_thumbs.py` 머리 주석과 같은 규약).
★**한 워크스페이스가 실패해도 나머지는 옮긴다.** 실패한 것은 로그에 남기고 원본 그대로 둔다.
★**옛 열쇠를 읽는 폴백을 코드에 남기지 않는다.** 남기면 두 모양을 영원히 떠안는다 —
  이 파일이 유일한 경로다.
"""
from __future__ import annotations

import json
from pathlib import Path

#: 이 판까지 옮겼다는 표. 앞으로 또 옮길 일이 생기면 숫자를 올린다
SPEC_VERSION = 3

SPEC_NAME = "workspace.json"
RECORDS_NAME = "records.jsonl"


def migrate_spec(old: dict) -> dict | None:
    """옛 spec → 새 spec. 이미 새 모양이면 `None` (건드릴 것이 없다).

    ★`chars` 도 `tabs` 도 없는 아주 옛 파일이면 빈 목록으로 세워 준다 — 화면의
      `ensure*` 가 채우던 자리다. 여기서 만들어 두면 그쪽이 옛 열쇠를 안 봐도 된다."""
    at = int(old.get("specVersion") or 0)
    if at >= SPEC_VERSION:
        return None
    # ★이미 v2 면 낱말만 옮기면 된다 — v2 의 자리 맞바꾸기를 또 돌리면 안 된다
    if at >= 2:
        return _v3(old)

    sets = list(old.get("tabs") or [])       # 옛 `tabs` 가 세트다
    tabs = list(old.get("chars") or [])      # 옛 `chars` 가 탭이다

    out = dict(old)
    for k in ("tabs", "chars", "activeTab", "activeChar"):
        out.pop(k, None)

    # 세트가 가리키던 탭 열쇠 — `charId` → `tabId`
    fixed = []
    for st in sets:
        st = dict(st)
        if "charId" in st:
            st["tabId"] = st.pop("charId")
        fixed.append(st)

    out["tabs"] = tabs
    out["sets"] = fixed
    if old.get("activeChar") is not None:
        out["activeTab"] = old.get("activeChar")
    if old.get("activeTab") is not None:
        out["activeSet"] = old.get("activeTab")
    out["specVersion"] = SPEC_VERSION
    return _v3(out)


def _v3(sp: dict) -> dict:
    """v2 → v3: **「세트」를 「씬 그룹」으로** (사용자 결정 2026-08-27).

    ★★영어 `set` 이 이 분야에서는 **촬영장**을 뜻해서, `scene set` 이 「장면 여럿의 묶음」으로
      안 읽혔다. 화면·코드·조수 계약을 한꺼번에 `sceneGroup` 으로 옮겼고 (`shared/terms.json`),
      저장 파일도 여기서 따라간다.
    ★열쇠 이름만 바뀐다 — **값도 구조도 그대로**다. 자리를 맞바꾸는 v2 와 달리 순서 문제가 없다.
    ★`kind` 리터럴도 함께 옮긴다 (`"set"` → `"sceneGroup"`). 화면의 가드가 그것을 본다."""
    out = dict(sp)
    if "sets" in out:
        out["sceneGroups"] = out.pop("sets")
    if "activeSet" in out:
        out["activeSceneGroup"] = out.pop("activeSet")
    out["sceneGroups"] = [
        {**g, "kind": "sceneGroup"} if g.get("kind") == "set" else g
        for g in (out.get("sceneGroups") or [])
    ]
    out["specVersion"] = SPEC_VERSION
    return out


def migrate_record(line: dict) -> dict | None:
    """레코드 한 줄 → 새 열쇠. 바꿀 것이 없으면 `None`.

    ★`tab`·`tab_id` 는 **세트**를 가리키던 이름이다 (`tab`= 세트 이름, `tab_id`= 세트 id)."""
    if not any(k in line for k in ("tab", "tab_id", "set", "set_id")):
        return None
    out = dict(line)
    if "tab" in out:
        out["set"] = out.pop("tab")
    if "tab_id" in out:
        out["set_id"] = out.pop("tab_id")
    # v3 — 낱말만 옮긴다 (위 ★★주)
    if "set" in out:
        out["scene_group"] = out.pop("set")
    if "set_id" in out:
        out["scene_group_id"] = out.pop("set_id")
    return out


def _backup(p: Path) -> None:
    """옛 파일을 한 번만 베낀다. 이미 있으면 덮지 않는다 (첫 모습이 정본이다)."""
    bak = p.with_suffix(p.suffix + ".bak-v1")
    if p.exists() and not bak.exists():
        bak.write_bytes(p.read_bytes())


def _write_atomic(p: Path, text: str) -> None:
    """임시 파일에 쓰고 바꿔 끼운다 — 쓰는 중 죽어도 반쯤 옮긴 파일이 안 남는다."""
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(p)


def migrate_dir(d: Path, log: list[str]) -> bool:
    """워크스페이스 폴더 하나. 옮겼으면 True.

    ★spec 을 못 옮기면 **레코드도 안 건드린다** — 반만 옮긴 워크스페이스를 만들지 않는다."""
    spec_path = d / SPEC_NAME
    if not spec_path.exists():
        return False
    try:
        old = json.loads(spec_path.read_text(encoding="utf-8"))
    except Exception as e:
        log.append(f"[낱말 이전] {d.name}: spec 을 못 읽었습니다 ({e!r}) — 그대로 둡니다")
        return False

    new = migrate_spec(old)
    if new is None:
        return False

    try:
        _backup(spec_path)
        _write_atomic(spec_path, json.dumps(new, ensure_ascii=False, indent=2))
    except Exception as e:
        log.append(f"[낱말 이전] {d.name}: spec 을 못 썼습니다 ({e!r}) — 그대로 둡니다")
        return False

    rec = d / RECORDS_NAME
    if rec.exists():
        try:
            lines = rec.read_text(encoding="utf-8").splitlines()
            out, hit = [], 0
            for ln in lines:
                s = ln.strip()
                if not s:
                    continue
                try:
                    obj = json.loads(s)
                except Exception:
                    out.append(ln)          # 못 읽는 줄은 그대로 둔다
                    continue
                fixed = migrate_record(obj)
                if fixed is not None:
                    hit += 1
                    obj = fixed
                out.append(json.dumps(obj, ensure_ascii=False))
            if hit:
                _backup(rec)
                _write_atomic(rec, "\n".join(out) + "\n")
        except Exception as e:
            log.append(f"[낱말 이전] {d.name}: 레코드를 못 옮겼습니다 ({e!r})")

    log.append(f"[낱말 이전] {d.name}: 탭 {len(new.get('tabs') or [])}개 · 씬 그룹 {len(new.get('sceneGroups') or [])}개")
    return True


def run(root: Path) -> list[str]:
    """워크스페이스 뿌리 아래를 전부 훑는다. ★점으로 시작하는 폴더는 우리 내부 것이다."""
    log: list[str] = []
    try:
        if not root.exists():
            return log
        for d in sorted(root.iterdir()):
            if not d.is_dir() or d.name.startswith("."):
                continue
            try:
                migrate_dir(d, log)
            except Exception as e:  # 하나가 죽어도 나머지는 옮긴다
                log.append(f"[낱말 이전] {d.name}: 건너뜁니다 ({e!r})")
    except Exception as e:  # 이전이 실패해도 앱은 떠야 한다
        log.append(f"[낱말 이전] 통째로 실패(무시하고 계속): {e!r}")
    return log
