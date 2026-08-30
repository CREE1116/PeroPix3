#!/usr/bin/env bash
set -e

# PeroPix 3.0 — production build (macOS / Linux).
# Output: src-tauri/target/release/

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if ! command -v npm >/dev/null 2>&1; then
    echo "[ERROR] npm not found in PATH. Install Node.js first."
    exit 1
fi

if ! command -v cargo >/dev/null 2>&1; then
    echo "[ERROR] cargo not found in PATH. Install Rust first: https://rustup.rs or brew install rust"
    exit 1
fi

if [ ! -d "node_modules" ]; then
    echo "[PeroPix] node_modules missing. Running npm install..."
    npm install
fi

echo "[PeroPix] Starting tauri build... (first build takes a few minutes)"
echo ""
npm run tauri build

echo ""
echo "[PeroPix] Build done."
echo "Output: src-tauri/target/release/"
