@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

rem ============================================
rem  TianShu Release Publisher
rem  Reads the version from dev\desktop\package.json,
rem  commits changes, tags v<version>, and pushes
rem  the branch and the tag (triggers desktop-release.yml).
rem ============================================

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Not a git repository.
  exit /b 1
)

for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "(Get-Content -Raw -Encoding UTF8 'dev\desktop\package.json' | ConvertFrom-Json).version"`) do set "VERSION=%%i"
if "%VERSION%"=="" (
  echo [ERROR] Cannot read version from dev\desktop\package.json
  exit /b 1
)

echo ============================================
echo  TianShu Release Publisher  v%VERSION%
echo ============================================
echo.

set "DRYRUN="
if /i "%~1"=="--dry-run" set "DRYRUN=1"

if defined DRYRUN (
  echo [DRY-RUN] git add -A
  echo [DRY-RUN] git commit -m "chore: prepare v%VERSION% release"
  echo [DRY-RUN] git tag v%VERSION%
  echo [DRY-RUN] git push origin ^(current branch^)
  echo [DRY-RUN] git push origin v%VERSION%
  echo.
  echo [DRY-RUN] no changes were made.
  exit /b 0
)

rem ---- 1. stage + commit (skip if nothing to commit) ----
git add -A
git diff --cached --quiet
if errorlevel 1 (
  git commit -m "chore: prepare v%VERSION% release"
  if errorlevel 1 (
    echo [ERROR] commit failed.
    exit /b 1
  )
) else (
  echo [INFO] No changes to commit.
)

rem ---- 2. tag (skip if already exists) ----
git rev-parse -q --verify "refs/tags/v%VERSION%" >nul 2>&1
if errorlevel 1 (
  git tag v%VERSION%
  if errorlevel 1 (
    echo [ERROR] failed to create tag v%VERSION%.
    exit /b 1
  )
) else (
  echo [INFO] tag v%VERSION% already exists, skipping.
)

rem ---- 3. push branch + tag ----
for /f %%b in ('git rev-parse --abbrev-ref HEAD') do set "BRANCH=%%b"
echo [PUSH] branch %BRANCH%
git push origin %BRANCH%
if errorlevel 1 (
  echo [ERROR] branch push failed.
  exit /b 1
)

echo [PUSH] tag v%VERSION%
git push origin v%VERSION%
if errorlevel 1 (
  echo [ERROR] tag push failed.
  exit /b 1
)

echo.
echo ============================================
echo  Released v%VERSION% on branch %BRANCH%.
echo  Watch CI: https://github.com/dmql98/tianshu/actions
echo ============================================
endlocal
