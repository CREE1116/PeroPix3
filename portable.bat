@echo off
setlocal

REM PeroPix 3.0 - portable build (exe + backend + embedded python + censor model).
REM Output: _dist\PeroPix\  and  _dist\PeroPix-<version>-win64.zip
REM
REM   portable.bat            build, then assemble
REM   portable.bat skipbuild  reuse the exe already in src-tauri\target\release
REM   portable.bat skippython reuse the python already in _dist\PeroPix\python

cd /d "%~dp0"

set ARGS=
if /i "%1"=="skipbuild"  set ARGS=-SkipBuild
if /i "%1"=="skippython" set ARGS=-SkipPython
if /i "%2"=="skipbuild"  set ARGS=%ARGS% -SkipBuild
if /i "%2"=="skippython" set ARGS=%ARGS% -SkipPython

powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\portable.ps1" %ARGS%
if errorlevel 1 (
    echo.
    echo [ERROR] portable build failed
    pause
    exit /b 1
)
pause
