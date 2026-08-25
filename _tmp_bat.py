import io
p = "test.bat"
s = io.open(p, encoding="utf-8", newline="").read()
old = """echo.
echo === Hooks are never called inside JSX props ==="""
new = """echo.
echo === Enter while composing Hangul must not fire a command ===
call node --experimental-strip-types --disable-warning=ExperimentalWarning src\lib\ime.test.ts
if errorlevel 1 (
    echo.
    echo [ERROR] a text field takes Enter mid-composition - the last syllable comes back after clearing
    pause
    exit /b 1
)

echo.
echo === Hooks are never called inside JSX props ==="""
assert old in s
io.open(p, "w", encoding="utf-8", newline="").write(s.replace(old, new, 1))
print("등록")
