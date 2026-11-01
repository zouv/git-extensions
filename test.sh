#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
pnpm test
pnpm build
cd src-tauri
cargo test
