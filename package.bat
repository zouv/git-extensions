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
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js is required to collect the installers.
    popd & exit /b 1
)
call pnpm tauri:build
set "CODE=%ERRORLEVEL%"
if not "%CODE%"=="0" (
    popd & exit /b %CODE%
)
rem 把当前版本的 NSIS / MSI 安装包收集到 dist\release\ 并生成 SHA256 校验文件。
node "scripts\copy-bundle.mjs"
set "CODE=%ERRORLEVEL%"
if %CODE%==0 echo [OK] Installers are under dist\release\
popd
exit /b %CODE%
