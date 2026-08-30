#!/usr/bin/env bash
set -e

# PeroPix 3.0 — portable build for macOS.
# Output: _dist/PeroPix/ and _dist/PeroPix-<version>-macos-<arch>.zip

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

bash "$ROOT_DIR/scripts/portable-mac.sh" "$@"
