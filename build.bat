@echo off
chcp 65001 >nul
setlocal
rem Git Extensions - build: type-check and build the frontend bundle.
pushd "%~dp0"
if errorlevel 1 exit /b 1
where pnpm >nul 2>&1
if errorlevel 1 (
    echo [ERROR] pnpm is required. Run: npm i -g pnpm
    popd & exit /b 1
)
pnpm build
set "CODE=%ERRORLEVEL%"
popd
exit /b %CODE%
