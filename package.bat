@echo off
chcp 65001 >nul
setlocal
rem Git Extensions - package: build the desktop installer (frontend + Rust release).
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
call pnpm tauri:build
set "CODE=%ERRORLEVEL%"
if %CODE%==0 echo [OK] Installers are under src-tauri\target\release\bundle\
popd
exit /b %CODE%
