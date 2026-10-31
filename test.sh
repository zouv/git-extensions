#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
pnpm build
cd src-tauri
cargo test
