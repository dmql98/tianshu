@echo off
cd /d "%~dp0"
title TianShu Setup

echo.
echo ========================================
echo        TianShu Environment Setup
echo ========================================
echo.

:: Check Node.js
echo [1/3] Checking Node.js...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found.
    echo Please install Node.js from: https://nodejs.org/
    echo.
    pause
    exit /b 1
)
node -v
echo.

:: Install server dependencies
echo [2/3] Installing server dependencies...
cd /d "%~dp0web\server"
call npm install
if %errorlevel% neq 0 (
    echo [ERROR] Server install failed.
    pause
    exit /b 1
)
echo.

:: Install client dependencies
echo [3/3] Installing client dependencies...
cd /d "%~dp0web\client"
call npm install
if %errorlevel% neq 0 (
    echo [ERROR] Client install failed.
    pause
    exit /b 1
)
echo.

echo ========================================
echo  Setup complete!
echo  Run: run.bat
echo ========================================
echo.
pause
