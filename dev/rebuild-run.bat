@echo off
cd /d "%~dp0"
title TianShu Rebuild & Run

:: Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found. Run setup.bat first.
    pause
    exit /b 1
)

:: Kill existing processes on ports
echo Stopping existing processes...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3210 " ^| findstr "LISTENING"') do taskkill /f /pid %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5173 " ^| findstr "LISTENING"') do taskkill /f /pid %%a >nul 2>&1
timeout /t 1 /nobreak >nul

:: Install dependencies
echo Installing dependencies...
cd /d "%~dp0web\server"
call npm install
if %errorlevel% neq 0 (
    echo [ERROR] Server install failed.
    pause
    exit /b 1
)

cd /d "%~dp0web\client"
call npm install
if %errorlevel% neq 0 (
    echo [ERROR] Client install failed.
    pause
    exit /b 1
)

:: Build client
echo Building client...
cd /d "%~dp0web\client"
call npx vite build
if %errorlevel% neq 0 (
    echo [ERROR] Client build failed.
    pause
    exit /b 1
)

:: Run
echo Starting TianShu Server on :3210 ...
set PORT=3210
start "TianShu Server" cmd /k "cd /d %~dp0web\server && npx tsx src\index.ts"
timeout /t 2 /nobreak >nul

echo Starting TianShu Client on :5173 ...
start "TianShu Client" cmd /k "cd /d %~dp0web\client && npx vite"
timeout /t 2 /nobreak >nul

start "" "http://localhost:5173"

echo.
echo  Server :3210  |  Client :5173
echo  Close this window to stop all.
