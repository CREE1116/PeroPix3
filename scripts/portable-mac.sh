#!/usr/bin/env bash
set -e

# PeroPix 3.0 — macOS 포터블 한 벌을 조립한다.
#
# 결과: _dist/PeroPix/          (그대로 실행할 수 있는 macOS 포터블 한 벌)
#       _dist/PeroPix-<버전>-macos.zip
#
# 사용: ./portable.sh [--skip-build] [--skip-python]

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/_dist"
APP_DIR="$DIST_DIR/PeroPix"
INNER_DIR="$APP_DIR/app"
CACHE_DIR="$DIST_DIR/_cache"

SKIP_BUILD=false
SKIP_PYTHON=false

for arg in "$@"; do
    case "$arg" in
        --skip-build|-SkipBuild|skipbuild)
            SKIP_BUILD=true
            ;;
        --skip-python|-SkipPython|skippython)
            SKIP_PYTHON=true
            ;;
    esac
done

# 버전 추출 (tauri.conf.json)
VERSION=$(node -e 'console.log(JSON.parse(require("fs").readFileSync("src-tauri/tauri.conf.json", "utf8")).version)')
echo "[포터블] PeroPix $VERSION (macOS)"

# 1. Tauri 릴리즈 빌드
if [ "$SKIP_BUILD" = false ]; then
    echo "[포터블] 릴리즈 빌드 시작 (몇 분 소요될 수 있습니다)"
    cd "$ROOT_DIR"
    npm run tauri build -- --no-bundle
fi

EXE="$ROOT_DIR/src-tauri/target/release/peropix"
if [ ! -f "$EXE" ]; then
    echo "[오류] 실행 파일이 없습니다: $EXE (먼저 ./build.sh 또는 npm run tauri build)"
    exit 1
fi

# 2. 폴더 초기화
mkdir -p "$DIST_DIR" "$CACHE_DIR"
if [ "$SKIP_PYTHON" = true ] && [ -d "$INNER_DIR/python" ]; then
    # 파이썬 보존
    find "$APP_DIR" -mindepth 1 -maxdepth 1 ! -name "app" -exec rm -rf {} +
    find "$INNER_DIR" -mindepth 1 -maxdepth 1 ! -name "python" -exec rm -rf {} +
else
    rm -rf "$APP_DIR"
fi
mkdir -p "$APP_DIR" "$INNER_DIR"

# 3. 파이썬 환경 구성 (app/python)
if [ "$SKIP_PYTHON" = false ] || [ ! -d "$INNER_DIR/python" ]; then
    echo "[포터블] 파이썬 런타임 환경 구성 중..."
    rm -rf "$INNER_DIR/python"
    
    # Python 3 선택
    PY_SYSTEM=""
    for cand in python3.11 python3.12 python3.10 python3; do
        if command -v "$cand" >/dev/null 2>&1; then
            PY_SYSTEM="$cand"
            break
        fi
    done
    
    if [ -z "$PY_SYSTEM" ]; then
        echo "[오류] Python 3 을 찾을 수 없습니다."
        exit 1
    fi
    
    "$PY_SYSTEM" -m venv "$INNER_DIR/python"
    "$INNER_DIR/python/bin/pip" install --upgrade pip
    "$INNER_DIR/python/bin/pip" install -r "$ROOT_DIR/backend/requirements.txt"
fi

# 4. 앱 파일 복사
echo "[포터블] 앱 및 백엔드 복사"
cp "$EXE" "$APP_DIR/PeroPix"
chmod +x "$APP_DIR/PeroPix"

# 백엔드 소스 복사
cp -R "$ROOT_DIR/backend" "$INNER_DIR/"
find "$INNER_DIR/backend" -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
rm -f "$INNER_DIR/backend"/test_*.py

# 검열 모델 복사 (가장 작은 기본 모델 하나)
mkdir -p "$INNER_DIR/models/censor"
FIRST_MODEL=$(ls -S "$ROOT_DIR/models/censor"/*.onnx 2>/dev/null | tail -n 1 || true)
if [ -n "$FIRST_MODEL" ] && [ -f "$FIRST_MODEL" ]; then
    cp "$FIRST_MODEL" "$INNER_DIR/models/censor/"
    echo "[포터블] 검열 모델 복사: $(basename "$FIRST_MODEL")"
fi

# 문서 복사
for doc in LICENSE THIRD-PARTY.md README.md README.ko.md README.ja.md; do
    if [ -f "$ROOT_DIR/$doc" ]; then
        cp "$ROOT_DIR/$doc" "$APP_DIR/"
    fi
done

# 버전 파일 기록
BUILD_DATE=$(date "+%Y-%m-%d")
cat <<EOF > "$INNER_DIR/version.json"
{
  "version": "$VERSION",
  "built": "$BUILD_DATE",
  "platform": "darwin"
}
EOF

# 사용자 폴더 미리 생성
for user_dir in data gallery logs workspaces; do
    mkdir -p "$APP_DIR/$user_dir"
done

# 5. 아카이브 압축 (.zip)
ARCH=$(uname -m)
ZIP_NAME="PeroPix-$VERSION-macos-$ARCH.zip"
ZIP_PATH="$DIST_DIR/$ZIP_NAME"
rm -f "$ZIP_PATH"

echo "[포터블] 압축 파일 생성 중: $ZIP_NAME"
cd "$DIST_DIR"
zip -r -q "$ZIP_NAME" "PeroPix"

MB=$(du -h "$ZIP_PATH" | cut -f1)
echo ""
echo "[포터블] 완료 — 산출물 크기: $MB"
echo "  폴더: $APP_DIR"
echo "  압축: $ZIP_PATH"
