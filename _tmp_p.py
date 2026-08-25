import io
p = "src/store/llm.ts"
s = io.open(p, encoding="utf-8").read()

# ── 1) 시작하는 자리에서 이름을 짓는다 ────────────────────────
old = '''    push({ role: "user", content: [{ type: "text", text }] });'''
new = '''    push({ role: "user", content: [{ type: "text", text }] });
    /* ★★**첫 요청으로 곧바로 이름을 짓는다** (사용자 지시 2026-08-25 — 클로드 코드가
         그렇게 한다). 답이 끝나기를 기다리지 않으므로 이름이 머리 줄에 먼저 뜬다.
       ★턴과 **나란히** 돈다 — `await` 하지 않는다. 이름 때문에 대답이 늦어지면 안 된다. */
    void nameChat(get().id);'''
assert old in s
s = s.replace(old, new, 1)

# ── 2) 「열쇠」를 API 키로 ────────────────────────────────────
s = s.replace("\uc5f4\uc1e0\uac00 \uc5c6\uc744 \ub54c\uc758 \ud3f4\ubc31", "API \ud0a4\uac00 \uc5c6\uc744 \ub54c\uc758 \ud3f4\ubc31")
s = s.replace("\uc5f4\uc1e0\uac00 \uc5c6\uc73c\uba74 \ud3f4\ubc31\uc744 \uc4f4\ub2e4", "API \ud0a4\uac00 \uc5c6\uc73c\uba74 \ud3f4\ubc31\uc744 \uc4f4\ub2e4")
s = s.replace("**BYOK \uc5f4\uc1e0\uac00 \uc788\uc73c\uba74 \uadf8\ucabd\uc73c\ub85c**", "**BYOK API \ud0a4\uac00 \uc788\uc73c\uba74 \uadf8\ucabd\uc73c\ub85c**")

# ── 3) save 쪽 방아쇠는 **재시도**로 뜻을 좁힌다 ───────────────
old_t = '''  /* \u2605\uc774\ub984\uc774 \uc544\uc9c1 \uc5c6\uc73c\uba74 \uc5ec\uae30\uc11c \uc9d3\ub294\ub2e4 \u2014 **\ud134\uc774 \ub05d\ub098\ub294 \uc790\ub9ac\uac00 \uc5ec\uae30 \ud558\ub098**\ub77c \ub2e4\ub978 \uacf3\uc5d0
     \ub9e4\ub2ec\uba74 CLI \uacbd\ub85c\uc640 API \uacbd\ub85c \ub458\uc5d0 \uac19\uc740 \uac83\uc744 \uc801\uac8c \ub41c\ub2e4. \uc548\uc5d0\uc11c \ud55c \ubc88\ub9cc \ub3cc\ub2e4. */
  void nameChat(s.id);'''
new_t = '''  /* \u2605\uc815\uc0c1 \uacbd\ub85c\ub294 **\uccab \uc694\uccad\uc744 \ubcf4\ub0b4\ub294 \uc790\ub9ac**\ub2e4 (`send`). \uc5ec\uae30 \uac83\uc740 \uadf8\ub54c \ubabb \uc9c0\uc740
     \uacbd\uc6b0\uc758 **\uc7ac\uc2dc\ub3c4**\ub2e4 \u2014 \ub124\ud2b8\uc6cc\ud06c\uac00 \ub048\uacbc\uac70\ub098 \uacf5\uae09\uc790\uac00 \ube48 \ub2f5\uc744 \ub0b4\uba74 \uc774\ub984\uc774 \ube44\uc5b4
     \uc788\ub294\ub370, \uadf8\ub300\ub85c \ub450\uba74 \uadf8 \ub300\ud654\ub294 \uc601\uc601 \ubaa9\ub85d\uc5d0 \uccab \ubc1c\ud654\ub85c \ub0a8\ub294\ub2e4.
     \u2605\uc9d3\ub294 \uc7a5\uce58\ub294 `nameChat` \ud558\ub098\uace0, \uadf8 \uc548\uc5d0\uc11c \uc774\ub984\uc774 \ucc28 \uc788\uc73c\uba74 \ubc14\ub85c \ub418\ub3cc\uc544\uc628\ub2e4. */
  void nameChat(s.id);'''
assert old_t in s
s = s.replace(old_t, new_t, 1)
io.open(p, "w", encoding="utf-8").write(s)
print("적용")
