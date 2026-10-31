@echo off
chcp 65001 >nul
setlocal
rem Git Extensions - setup: check toolchain and install dependencies.
pushd "%~dp0"
if errorlevel 1 exit /b 1
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js 22+ is required. Add node to PATH.
    popd & exit /b 1
)
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
where git >nul 2>&1
if errorlevel 1 (
    echo [ERROR] git is required. Add git to PATH.
    popd & exit /b 1
)
pnpm install
set "CODE=%ERRORLEVEL%"
if %CODE%==0 echo [OK] Dependencies installed. Use dev.bat to start.
popd
exit /b %CODE%
