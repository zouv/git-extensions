@echo off
chcp 65001 >nul
setlocal
rem Git Extensions - clean: remove build artifacts, keep published packages under dist\release.
pushd "%~dp0"
if errorlevel 1 exit /b 1
if exist .runtime\dist (
    rmdir /s /q .runtime\dist
    echo [OK] Removed .runtime\dist\ (frontend bundle)
)
if exist .runtime\package-staging (
    rmdir /s /q .runtime\package-staging
    echo [OK] Removed .runtime\package-staging\
)
if exist .runtime\package-snapshot.json del /q .runtime\package-snapshot.json
if exist src-tauri\target (
    rmdir /s /q src-tauri\target
    echo [OK] Removed src-tauri\target\
)
if exist dist\release echo [OK] Kept dist\release\ (published installers and zip)
echo [OK] Clean done.
popd
exit /b 0
