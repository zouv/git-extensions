@echo off
chcp 65001 >nul
setlocal
rem Git Extensions - test: frontend type-check/build + Rust unit and integration tests.
pushd "%~dp0"
if errorlevel 1 exit /b 1
where pnpm >nul 2>&1
if errorlevel 1 (
    echo [ERROR] pnpm is required. Run: npm i -g pnpm
    popd & exit /b 1
)
where cargo >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Rust toolchain is required. Install via https://rustup.rs
    popd & exit /b 1
)
call pnpm build
if errorlevel 1 (
    echo [ERROR] Frontend build failed.
    popd & exit /b 1
)
pushd src-tauri
cargo test
set "CODE=%ERRORLEVEL%"
popd
popd
exit /b %CODE%
