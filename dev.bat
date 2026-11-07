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
echo [INFO] Starting Git Extensions in dev mode (separate from installed release)...
pnpm tauri:dev
set "CODE=%ERRORLEVEL%"
if not "%CODE%"=="0" (
    echo.
    echo [ERROR] Dev exited with code %CODE%.
    echo Check the messages above, then press any key to close this window.
    pause >nul
)
popd
exit /b %CODE%
