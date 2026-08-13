@echo off
setlocal
cd /d "%~dp0"
title TianShu Release Build

echo.
echo ========================================
echo     TianShu Desktop Release Build
echo ========================================
echo.

:: Check Node.js
echo [1/5] Checking Node.js...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found. Run setup.bat first.
    pause
    exit /b 1
)

:: Check dependencies
if not exist "web\server\node_modules" (
    echo [ERROR] Server dependencies missing. Run setup.bat first.
    pause
    exit /b 1
)
if not exist "web\client\node_modules" (
    echo [ERROR] Client dependencies missing. Run setup.bat first.
    pause
    exit /b 1
)
if not exist "desktop\node_modules" (
    echo [ERROR] Desktop dependencies missing. Run setup.bat first.
    pause
    exit /b 1
)

:: Clean old release output so no stale installers remain
echo [2/5] Cleaning previous release output...
if exist "desktop\release" rmdir /s /q "desktop\release"

:: Build server + client + desktop
echo [3/5] Building server / client / desktop...
call npm run build
if %errorlevel% neq 0 (
    echo [ERROR] Build failed. Fix the errors above and re-run.
    pause
    exit /b 1
)

:: Prepare packaged runtime (portable Node + staging)
echo [4/5] Preparing desktop runtime...
call npm run prepare:desktop
if %errorlevel% neq 0 (
    echo [ERROR] Runtime prepare failed. Fix the errors above and re-run.
    pause
    exit /b 1
)

:: Package Windows installer
echo [5/5] Packaging Windows installer (may take a few minutes)...
call npm run dist:win --prefix desktop
if %errorlevel% neq 0 (
    echo [ERROR] Packaging failed. Fix the errors above and re-run.
    pause
    exit /b 1
)

:: Show result
echo.
echo ========================================
echo  Build complete!
echo  Output: %~dp0desktop\release
echo ========================================
dir /b "desktop\release"

:: Open the release folder
start "" explorer "desktop\release"

echo.
echo  Press any key to close this window.
pause >nul
