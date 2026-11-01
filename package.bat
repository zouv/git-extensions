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
rem 构建前记录已有安装包，collect 时只导出本次新生成的产物。
node "scripts\copy-bundle.mjs" snapshot
set "CODE=%ERRORLEVEL%"
if not "%CODE%"=="0" (
    popd & exit /b %CODE%
)
call pnpm tauri:build
set "CODE=%ERRORLEVEL%"
if not "%CODE%"=="0" (
    popd & exit /b %CODE%
)
rem 把本次安装包、unpack\ 便携目录与 unpack zip 收集到 dist\release\，并生成 SHA256 校验文件。
node "scripts\copy-bundle.mjs" collect
set "CODE=%ERRORLEVEL%"
if %CODE%==0 echo [OK] Installers, unpack folder and zip are under dist\release\
popd
exit /b %CODE%
