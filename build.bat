@echo off
setlocal

REM PeroPix 3.0 - production build.
REM Output: src-tauri\target\release\bundle\
REM NOTE: the Python runtime is not bundled yet (dev stage), so the built
REM       app still relies on a Python on PATH.

cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] npm not found in PATH. Install Node.js first.
    pause
    exit /b 1
)

where cargo >nul 2>nul
if errorlevel 1 (
    echo [ERROR] cargo not found in PATH. Install Rust first: https://rustup.rs
    pause
    exit /b 1
)

if not exist node_modules (
    echo [PeroPix] node_modules missing. Running npm install...
    call npm install
    if errorlevel 1 (
        echo.
        echo [ERROR] npm install failed
        pause
        exit /b 1
    )
)

echo [PeroPix] Starting tauri build... (first build takes a few minutes)
echo.
call npm run tauri build

if errorlevel 1 (
    echo.
    echo [ERROR] build failed
    pause
    exit /b 1
)

echo.
echo [PeroPix] Build done.
echo Output: src-tauri\target\release\bundle\
pause
