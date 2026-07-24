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
if not exist "web\client-old\node_modules" (
    echo [ERROR] Old client dependencies not found. Run setup.bat first.
    pause
    exit /b 1
)

:: Kill existing processes on ports
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3210 " ^| findstr "LISTENING"') do taskkill /f /pid %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5173 " ^| findstr "LISTENING"') do taskkill /f /pid %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5174 " ^| findstr "LISTENING"') do taskkill /f /pid %%a >nul 2>&1
timeout /t 1 /nobreak >nul

:: Start server
echo Starting TianShu Server on :3210 ...
set PORT=3210
start "TianShu Server" cmd /k "cd /d %~dp0web\server && node_modules\.bin\tsx.cmd src\index.ts"
timeout /t 3 /nobreak >nul

:: Start client
echo Starting TianShu Client on :5173 ...
start "TianShu Client" cmd /k "cd /d %~dp0web\client && node_modules\.bin\vite.cmd --port 5173 --host"
timeout /t 2 /nobreak >nul

:: Start old client
echo Starting TianShu Old Client on :5174 ...
start "TianShu Old Client" cmd /k "cd /d %~dp0web\client-old && node_modules\.bin\vite.cmd --port 5174 --host"
timeout /t 4 /nobreak >nul

:: Open browser
start "" "http://localhost:5173"
start "" "http://localhost:5174"

echo.
echo  Server :3210  |  Client :5173  |  Old Client :5174
echo  Close this window to stop all.
