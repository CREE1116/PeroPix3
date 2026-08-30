#!/usr/bin/env bash
set -e

# PeroPix 3.0 — macOS 개발 및 런타임 환경 설정 스크립트

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "=== PeroPix 3.0 macOS 환경 설정 ==="

# 1. Node.js & npm 확인
if ! command -v npm >/dev/null 2>&1; then
    echo "[오류] npm 을 찾을 수 없습니다. Node.js (v20 이상)를 먼저 설치해 주세요."
    exit 1
fi
echo "[1/4] Node.js / npm 확인 완료 ($(node -v), npm $(npm -v))"

# 2. Python 확인 및 venv 생성
PY_BIN=""
for cand in python3.11 python3.12 python3.10 python3 python; do
    if command -v "$cand" >/dev/null 2>&1; then
        PY_BIN="$cand"
        break
    fi
done

if [ -z "$PY_BIN" ]; then
    echo "[오류] Python 3 을 찾을 수 없습니다. brew install python 을 실행해 주세요."
    exit 1
fi
echo "[2/4] Python 확인 완료 ($($PY_BIN --version))"

if [ ! -d ".venv" ]; then
    echo "[PeroPix] 가상환경(.venv) 생성 중..."
    "$PY_BIN" -m venv .venv
fi

# 3. 백엔드 의존성 설치
echo "[3/4] 백엔드 의존성 설치 중..."
./.venv/bin/pip install --upgrade pip
./.venv/bin/pip install -r backend/requirements.txt

# 4. 프론트엔드 의존성 설치
if [ ! -d "node_modules" ]; then
    echo "[4/4] 프론트엔드 의존성 설치 (npm install)..."
    npm install
else
    echo "[4/4] 프론트엔드 의존성 확인 완료"
fi

# 스크립트 실행 권한 부여
chmod +x build.sh portable.sh scripts/*.sh 2>/dev/null || true

# Rust 확인
if ! command -v cargo >/dev/null 2>&1; then
    echo ""
    echo "[참고] Rust / Cargo 가 설치되어 있지 않습니다."
    echo "  Tauri 네이티브 빌드를 하려면 Rust 가 필요합니다:"
    echo "    brew install rust"
    echo "  또는"
    echo "    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
fi

echo ""
echo "=== 설정 완료 ==="
echo "  개발 모드 실행: npm run tauri dev"
echo "  백엔드만 실행: ./.venv/bin/python backend/server.py"
echo "  빌드: ./build.sh"
echo "  포터블 패키징: ./portable.sh"
