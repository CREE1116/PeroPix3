import io
p = "src/store/llm.ts"
s = io.open(p, encoding="utf-8").read()

# ── 1) 따로 부르던 이름 짓기를 걷어낸다 ─────────────────────────
i = s.index("/** \ub300\ud654\uc5d0 \ubd99\uc77c \uc774\ub984\uc744")
j = s.index("type S = {", i)
new_block = '''/** 첫 턴에만 지침 끝에 붙는 한 줄 — **이름부터 짓고 시작하라**.
 *
 *  ★★사용자 지시 2026-08-25: *"이름짓기를 왜 API 키로 호출함? 지금 대화하는 ai가 지어야지."*
 *    한때 이름 하나를 위해 BYOK 로 따로 한 번 더 불렀다. 그러면 CLI 로 도는 사용자에게는
 *    **대화하는 쪽과 다른 모델**이 이름을 지었고, 호출도 하나 더 들었다.
 *  ★★호출을 늘리지 않는 길은 **첫 턴 안에서 시키는 것**이다 (사용자 지시: *"그냥 처음에
 *    그걸 먼저 하고 작업 시작하라고 하면 되는 거 아님?"*). 클로드 코드도 이 모양이다.
 *  ★**이름이 없을 때만** 붙인다 — 매 턴 붙이면 지침이 턴마다 달라져 프롬프트 캐시가 깨진다.
 *    CLI 는 애초에 첫 턴에만 지침을 받는다 (`cliagent.argv` 의 `--append-system-prompt`). */
const NAME_FIRST =
  "\n\n[first turn] This chat has no name yet. Before anything else, call `name_chat` " +
  "with a short title (about 20 characters) saying what the chat is about, " +
  "in the user's language. Then do the work.";

'''
s = s[:i] + new_block + s[j:]

# ── 2) 상태에 setTitle ──────────────────────────────────────────
old = '''  newChat: () => void;'''
new = '''  newChat: () => void;
  /** 조수가 지은 이름을 받는다 (`name_chat` 액션) — 창구는 여기 하나다 */
  setTitle: (name: string) => void;'''
assert old in s
s = s.replace(old, new, 1)

old = '''  newChat() {'''
new = '''  setTitle(name) {
    if (!name.trim()) return;
    set({ title: name.trim() });
    void save(get());
  },

  newChat() {'''
assert old in s
s = s.replace(old, new, 1)

# ── 3) send 의 호출을 걷는다 ────────────────────────────────────
old = '''    /* \u2605\u2605**\uccab \uc694\uccad\uc73c\ub85c \uacf7\ubc14\ub85c \uc774\ub984\uc744 \uc9d3\ub294\ub2e4**'''
i = s.index(old)
j = s.index("void nameChat(get().id);", i) + len("void nameChat(get().id);")
s = s[:i] + "/* \u2605\uc774\ub984\uc740 \uc870\uc218\uac00 \uccab \ud134\uc5d0 `name_chat` \uc73c\ub85c \ubd99\uc778\ub2e4 (`NAME_FIRST`) */" + s[j:]

# ── 4) save 쪽 재시도도 걷는다 ──────────────────────────────────
i = s.index("  /* \u2605\uc815\uc0c1 \uacbd\ub85c\ub294 **\uccab \uc694\uccad\uc744 \ubcf4\ub0b4\ub294 \uc790\ub9ac**")
j = s.index("void nameChat(s.id);", i) + len("void nameChat(s.id);\n")
s = s[:i] + s[j:]

# ── 5) 지침에 첫 턴 줄을 얹는다 (두 경로) ───────────────────────
s = s.replace("            system: SYSTEM,", "            system: SYSTEM + (get().title ? \"\" : NAME_FIRST),", 1)
s = s.replace("      system: SYSTEM,", "      system: SYSTEM + (s.title ? \"\" : NAME_FIRST),", 1)
io.open(p, "w", encoding="utf-8").write(s)
print("llm.ts 적용")
