#!/usr/bin/env bash
set -e

# PeroPix 3.0 — macOS .app 번들 및 패키징 스크립트
#
# 결과: _dist/PeroPix.app              (더블클릭 실행 가능한 macOS 앱 번들)
#       _dist/PeroPix/                 (포터블 패키지)
#       _dist/PeroPix-<버전>-macos-<arch>.zip
#       _dist/PeroPix-<버전>-macos-<arch>.dmg (DMG 설치 이미지)
#
# 사용: ./portable.sh [--skip-build] [--skip-python]

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/_dist"
APP_BUNDLE="$DIST_DIR/PeroPix.app"
INNER_DIR="$APP_BUNDLE/Contents/Resources/app"
CACHE_DIR="$DIST_DIR/_cache"
PORTABLE_DIR="$DIST_DIR/PeroPix"

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
ARCH=$(uname -m)
echo "=== [PeroPix $VERSION macOS .app 패키징 ($ARCH)] ==="

# 1. Tauri 빌드 (.app 생성)
if [ "$SKIP_BUILD" = false ]; then
    echo "[1/4] Tauri release 빌드 (.app / .dmg 생성)"
    cd "$ROOT_DIR"
    npm run tauri build
fi

mkdir -p "$DIST_DIR" "$CACHE_DIR"

# 2. .app 번들 준비
echo "[2/4] PeroPix.app 번들 리소스 구성"
KEEP_PY=false
if [ "$SKIP_PYTHON" = true ] && [ -d "$INNER_DIR/python" ]; then
    KEEP_PY=true
    mkdir -p "$DIST_DIR/_temp_py"
    cp -R "$INNER_DIR/python" "$DIST_DIR/_temp_py/"
fi

rm -rf "$APP_BUNDLE"

if [ -d "$TAURI_APP" ]; then
    cp -R "$TAURI_APP" "$APP_BUNDLE"
else
    EXE="$ROOT_DIR/src-tauri/target/release/peropix"
    if [ ! -f "$EXE" ]; then
        echo "[오류] 실행 파일이 없습니다: $EXE (먼저 npm run tauri build)"
        exit 1
    fi
    echo "[안내] 컴파일된 바이너리로 PeroPix.app 번들 구조를 생성합니다."
    mkdir -p "$APP_BUNDLE/Contents/MacOS" "$APP_BUNDLE/Contents/Resources"
    cp "$EXE" "$APP_BUNDLE/Contents/MacOS/peropix"
    chmod +x "$APP_BUNDLE/Contents/MacOS/peropix"
    if [ -f "$ROOT_DIR/src-tauri/icons/icon.icns" ]; then
        cp "$ROOT_DIR/src-tauri/icons/icon.icns" "$APP_BUNDLE/Contents/Resources/icon.icns"
    fi
    cat <<PLIST > "$APP_BUNDLE/Contents/Info.plist"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>peropix</string>
  <key>CFBundleIconFile</key>
  <string>icon</string>
  <key>CFBundleIdentifier</key>
  <string>com.mrm987.peropix</string>
  <key>CFBundleName</key>
  <string>PeroPix</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>$VERSION</string>
  <key>CFBundleVersion</key>
  <string>$VERSION</string>
  <key>LSMinimumSystemVersion</key>
  <string>10.13</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
PLIST
fi

mkdir -p "$INNER_DIR"

# 3. 파이썬 런타임 환경 구성 (Contents/Resources/app/python)
echo "[3/4] 임베디드 Python 환경 구성"
if [ "$KEEP_PY" = true ] && [ -d "$DIST_DIR/_temp_py/python" ]; then
    cp -R "$DIST_DIR/_temp_py/python" "$INNER_DIR/"
    rm -rf "$DIST_DIR/_temp_py"
else
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

# 백엔드 소스 복사
cp -R "$ROOT_DIR/backend" "$INNER_DIR/"
find "$INNER_DIR/backend" -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
rm -f "$INNER_DIR/backend"/test_*.py

# 검열 모델 복사
mkdir -p "$INNER_DIR/models/censor"
FIRST_MODEL=$(ls -S "$ROOT_DIR/models/censor"/*.onnx 2>/dev/null | tail -n 1 || true)
if [ -n "$FIRST_MODEL" ] && [ -f "$FIRST_MODEL" ]; then
    cp "$FIRST_MODEL" "$INNER_DIR/models/censor/"
    echo "[패키징] 검열 모델 복사: $(basename "$FIRST_MODEL")"
fi

# version.json 기록
BUILD_DATE=$(date "+%Y-%m-%d")
cat <<EOF > "$INNER_DIR/version.json"
{
  "version": "$VERSION",
  "built": "$BUILD_DATE",
  "platform": "darwin"
}
EOF

# 4. 포터블 폴더 및 압축 생성
echo "[4/4] 배포용 아카이브 및 DMG 패키징"
rm -rf "$PORTABLE_DIR"
mkdir -p "$PORTABLE_DIR"
cp -R "$APP_BUNDLE" "$PORTABLE_DIR/"

for doc in LICENSE THIRD-PARTY.md README.md README.ko.md README.ja.md; do
    if [ -f "$ROOT_DIR/$doc" ]; then
        cp "$ROOT_DIR/$doc" "$PORTABLE_DIR/"
    fi
done

for user_dir in data gallery logs workspaces; do
    mkdir -p "$PORTABLE_DIR/$user_dir"
done

# src-tauri 내부 번들에도 리소스 동기화
if [ -d "$TAURI_APP" ]; then
    rm -rf "$TAURI_APP/Contents/Resources/app"
    cp -R "$INNER_DIR" "$TAURI_APP/Contents/Resources/"
fi

# .zip 압축 생성 (PeroPix.app 포함)
ZIP_NAME="PeroPix-$VERSION-macos-$ARCH.zip"
ZIP_PATH="$DIST_DIR/$ZIP_NAME"
rm -f "$ZIP_PATH"

cd "$DIST_DIR"
zip -r -q "$ZIP_NAME" "PeroPix"

# DMG 생성 (완성된 PeroPix.app 을 포함하는 디스크 이미지)
DMG_PATH="$DIST_DIR/PeroPix-$VERSION-macos-$ARCH.dmg"
rm -f "$DMG_PATH"
DMG_DIR="$DIST_DIR/_dmg_tmp"
rm -rf "$DMG_DIR"
mkdir -p "$DMG_DIR"
cp -R "$APP_BUNDLE" "$DMG_DIR/"
ln -s /Applications "$DMG_DIR/Applications"
hdiutil create -volname "PeroPix" -srcfolder "$DMG_DIR" -ov -format UDZO "$DMG_PATH"
rm -rf "$DMG_DIR"

ZIP_MB=$(du -h "$ZIP_PATH" | cut -f1)
DMG_MB=$(du -h "$DMG_PATH" | cut -f1)
echo ""
echo "=== [패키징 완료] ==="
echo "  .app 번들: $APP_BUNDLE"
echo "  포터블 폴더: $PORTABLE_DIR"
echo "  ZIP 아카이브: $ZIP_PATH ($ZIP_MB)"
echo "  DMG 이미지: $DMG_PATH ($DMG_MB)"
