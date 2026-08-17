@echo off
cd /d "%~dp0"
title TianShu (isolated stack)

REM ==========================================================================
REM Ports: this stack uses its OWN ports so it can run side by side with the
REM tianshu dev client (3456/3457) or the packaged desktop app (random port)
REM without killing or fighting them. Override with TIANSHU_SERVER_PORT /
REM TIANSHU_CLIENT_PORT if 3556/3557 are taken on this machine.
REM ==========================================================================
if defined TIANSHU_SERVER_PORT (set "PORT=%TIANSHU_SERVER_PORT%") else (set "PORT=3556")
if defined TIANSHU_CLIENT_PORT (set "CLIENT_PORT=%TIANSHU_CLIENT_PORT%") else (set "CLIENT_PORT=3557")
set "TIANSHU_SERVER_PORT=%PORT%"
set "TIANSHU_CLIENT_PORT=%CLIENT_PORT%"

REM ==========================================================================
REM Environment isolation: if run.bat is launched from inside the tianshu
REM client (an agent terminal), children inherit the client server's TIANSHU_*
REM / NODE_ENV. That would point this server at the client's own config.json,
REM data dir and dist, so two processes would fight over the same sessions.db
REM and the startup sweep would cancel the client's live runs. Pin an explicit,
REM isolated environment instead:
REM ==========================================================================
set "TIANSHU_CONFIG_DIR="
set "TIANSHU_DEFAULT_DATA_DIR="
set "TIANSHU_CLIENT_DIST="
set "TIANSHU_BUILTIN_CONTENT_DIR="
set "DATA_DIR="
set "HOST=127.0.0.1"
set "NODE_ENV=development"
REM Dedicated dev data dir for this stack (never shared with the client).
set "TIANSHU_DATA_DIR=%~dp0devdata"

REM Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found. Run setup.bat first.
    pause
    exit /b 1
)

REM Check dependencies
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

REM Kill a stale stack from a previous run.bat: ONLY on our own ports, and only
REM processes whose command line mentions tianshu/tsx/vite. The dev client's
REM 3456/3457 (or the packaged app) is never touched.
echo Stopping previous stack on :%PORT% / :%CLIENT_PORT% ...
powershell -NoProfile -Command "foreach ($p in (Get-NetTCPConnection -LocalPort %PORT%,%CLIENT_PORT% -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)) { $c = (Get-CimInstance Win32_Process -Filter ('ProcessId=' + $p) -ErrorAction SilentlyContinue).CommandLine; if ($c -and $c -match 'tianshu|tsx|vite') { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue } }"
timeout /t 1 /nobreak >nul

REM Start server
echo Starting TianShu Server on :%PORT% ...
start "TianShu Server" cmd /k "cd /d %~dp0web\server && node_modules\.bin\tsx.cmd src\index.ts"
timeout /t 3 /nobreak >nul

REM Start client
echo Starting TianShu Client on :%CLIENT_PORT% ...
start "TianShu Client" cmd /k "cd /d %~dp0web\client && node_modules\.bin\vite.cmd --port %CLIENT_PORT% --host 127.0.0.1"
timeout /t 2 /nobreak >nul

REM Open browser
start "" "http://127.0.0.1:%CLIENT_PORT%"

echo.
echo  Server :%PORT%  |  Client :%CLIENT_PORT%  |  Data: %~dp0devdata
echo  Close this window to stop all.
