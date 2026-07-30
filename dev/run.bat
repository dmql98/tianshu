@echo off
cd /d "%~dp0"
title TianShu

:: Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found. Run setup.bat first.
    pause
    exit /b 1
)

:: Check dependencies
if not exist "web\server\node_modules" (
    echo [ERROR] Server dependencies not found. Run setup.bat first.
    pause
    exit /b 1
)
if not exist "web\client\node_modules" (
    echo [ERROR] Client dependencies not found. Run setup.bat first.
    pause
    exit /b 1
)

:: Kill existing processes on ports
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3456 " ^| findstr "LISTENING"') do taskkill /f /pid %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3457 " ^| findstr "LISTENING"') do taskkill /f /pid %%a >nul 2>&1
timeout /t 1 /nobreak >nul

:: Start server
echo Starting TianShu Server on :3456 ...
set PORT=3456
start "TianShu Server" cmd /k "cd /d %~dp0web\server && node_modules\.bin\tsx.cmd src\index.ts"
timeout /t 3 /nobreak >nul

:: Start client
echo Starting TianShu Client on :3457 ...
start "TianShu Client" cmd /k "cd /d %~dp0web\client && node_modules\.bin\vite.cmd --port 3457 --host"
timeout /t 2 /nobreak >nul

:: Open browser
start "" "http://localhost:3457"

echo.
echo  Server :3456  |  Client :3457
echo  Close this window to stop all.
