@echo off
chcp 65001 >nul
setlocal
rem Git Extensions - clean: remove build artifacts (dist and Rust target).
pushd "%~dp0"
if errorlevel 1 exit /b 1
if exist dist (
    rmdir /s /q dist
    echo [OK] Removed dist\
)
if exist src-tauri\target (
    rmdir /s /q src-tauri\target
    echo [OK] Removed src-tauri\target\
)
echo [OK] Clean done.
popd
exit /b 0
