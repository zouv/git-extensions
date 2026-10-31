@echo off
chcp 65001 >nul
setlocal
rem Git Extensions - dev: run the desktop app with frontend HMR.
pushd "%~dp0"
if errorlevel 1 exit /b 1
where pnpm >nul 2>&1
if errorlevel 1 (
    echo [ERROR] pnpm is required. Run: npm i -g pnpm
    popd & exit /b 1
)
if not exist node_modules (
    echo [INFO] node_modules missing, running pnpm install first...
    pnpm install || (popd & exit /b 1)
)
pnpm tauri:dev
set "CODE=%ERRORLEVEL%"
popd
exit /b %CODE%
