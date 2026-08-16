@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
cd /d "%~dp0"

rem ============================================================
rem  TianShu Release Publisher
rem
rem  Normal:
rem    publish-release.bat
rem
rem  Dry run with an optional non-interactive version:
rem    publish-release.bat --dry-run 0.1.3
rem
rem  Verify the release matching desktop/package.json:
rem    publish-release.bat --verify
rem ============================================================

call :main %*
set "EXIT_CODE=%errorlevel%"
echo.
if "%EXIT_CODE%"=="0" (
  echo 完成，按任意键关闭窗口...
) else (
  echo 出错（错误码 %EXIT_CODE%），按任意键关闭窗口...
)
pause >nul
exit /b %EXIT_CODE%

:main
git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo [错误] 当前目录不是 Git 仓库。
  exit /b 1
)

call :read_current_version
if errorlevel 1 exit /b 1

if /i "%~1"=="--verify" goto :verify

set "DRYRUN="
set "NEW_VERSION="
if /i "%~1"=="--dry-run" (
  set "DRYRUN=1"
  set "NEW_VERSION=%~2"
) else if not "%~1"=="" (
  set "NEW_VERSION=%~1"
)

echo ============================================================
echo  TianShu Release Publisher
echo ============================================================
echo  当前版本：!CURRENT_VERSION!
if not defined NEW_VERSION set /p "NEW_VERSION= 更新版本："

rem Accept either 0.1.3 or v0.1.3 as input.
set "NEW_VERSION=!NEW_VERSION: =!"
if /i "!NEW_VERSION:~0,1!"=="v" set "NEW_VERSION=!NEW_VERSION:~1!"
if not defined NEW_VERSION (
  echo [取消] 未输入更新版本。
  exit /b 1
)

set "TS_NEW_VERSION=!NEW_VERSION!"
powershell -NoProfile -Command "if ($env:TS_NEW_VERSION -notmatch '^\d+\.\d+\.\d+$') { exit 1 }"
if errorlevel 1 (
  echo [错误] 版本号必须是 SemVer 格式，例如 0.1.3。
  exit /b 1
)

set "RESUME_RELEASE="
if "!NEW_VERSION!"=="!CURRENT_VERSION!" (
  git ls-remote --exit-code --tags origin "refs/tags/v!NEW_VERSION!" >nul 2>&1
  if not errorlevel 1 (
    echo [错误] v!NEW_VERSION! 已存在于远端，不能重复发布。
    exit /b 1
  )
  git rev-parse -q --verify "refs/tags/v!NEW_VERSION!" >nul 2>&1
  if errorlevel 1 (
    echo [错误] 更新版本与当前版本相同，请输入更高的版本号。
    exit /b 1
  )
  set "RESUME_RELEASE=1"
  echo [恢复] 检测到本地标签 v!NEW_VERSION! 尚未推送，将继续上次发布。
) else (
  set "TS_CURRENT_VERSION=!CURRENT_VERSION!"
  powershell -NoProfile -Command "if ([version]$env:TS_NEW_VERSION -le [version]$env:TS_CURRENT_VERSION) { exit 1 }"
  if errorlevel 1 (
    echo [错误] 更新版本 !NEW_VERSION! 必须高于当前版本 !CURRENT_VERSION!。
    exit /b 1
  )
  git rev-parse -q --verify "refs/tags/v!NEW_VERSION!" >nul 2>&1
  if not errorlevel 1 (
    echo [错误] 本地标签 v!NEW_VERSION! 已存在。
    exit /b 1
  )
  git ls-remote --exit-code --tags origin "refs/tags/v!NEW_VERSION!" >nul 2>&1
  if not errorlevel 1 (
    echo [错误] 远端标签 v!NEW_VERSION! 已存在。
    exit /b 1
  )
)

echo  发布版本：!NEW_VERSION!
echo.
echo [本次将提交的工作区改动]
git status --short
echo.

if defined DRYRUN (
  if not defined RESUME_RELEASE echo [DRY-RUN] 更新 dev\desktop\package.json 和 package-lock.json 到 !NEW_VERSION!
  echo [DRY-RUN] git add -A
  echo [DRY-RUN] git commit -m "chore: prepare v!NEW_VERSION! release"
  if not defined RESUME_RELEASE echo [DRY-RUN] git tag v!NEW_VERSION!
  echo [DRY-RUN] git push origin HEAD:当前分支
  echo [DRY-RUN] git push origin refs/tags/v!NEW_VERSION!
  echo.
  echo [DRY-RUN] 未修改任何文件。
  exit /b 0
)

choice /C YN /N /M "确认把以上改动纳入 v!NEW_VERSION! 并发布？[Y/N] "
if errorlevel 2 (
  echo [取消] 发布已取消，未修改版本号。
  exit /b 1
)

rem ---- 1. update desktop package + lockfile version ----
if not defined RESUME_RELEASE (
  pushd "dev\desktop"
  call npm version !NEW_VERSION! --no-git-tag-version
  set "NPM_VERSION_EXIT=!errorlevel!"
  popd
  if not "!NPM_VERSION_EXIT!"=="0" (
    echo [错误] 更新 desktop 版本失败。
    exit /b 1
  )
)

call :read_current_version
if errorlevel 1 exit /b 1
if not "!CURRENT_VERSION!"=="!NEW_VERSION!" (
  echo [错误] 版本文件更新后仍为 !CURRENT_VERSION!，预期为 !NEW_VERSION!。
  exit /b 1
)
set "VERSION=!NEW_VERSION!"

rem ---- 2. stage + commit (skip when resuming a failed tag push) ----
if not defined RESUME_RELEASE (
  git add -A
  git diff --cached --quiet
  if errorlevel 1 (
    git commit -m "chore: prepare v!VERSION! release"
    if errorlevel 1 (
      echo [错误] 提交失败。版本文件已保留，请修复后重试。
      exit /b 1
    )
  ) else (
    echo [信息] 没有需要提交的改动。
  )
)

rem ---- 3. create local tag ----
git rev-parse -q --verify "refs/tags/v!VERSION!" >nul 2>&1
if errorlevel 1 (
  git tag "v!VERSION!"
  if errorlevel 1 (
    echo [错误] 创建标签 v!VERSION! 失败。
    exit /b 1
  )
) else (
  echo [信息] 本地标签 v!VERSION! 已存在，将继续推送。
)

rem ---- 4. push branch + tag, retry transient network failures ----
for /f %%b in ('git rev-parse --abbrev-ref HEAD') do set "BRANCH=%%b"
if "!BRANCH!"=="HEAD" (
  echo [错误] 当前处于 detached HEAD，不能发布。
  exit /b 1
)

echo [推送] 分支 !BRANCH!
call :push_with_retry "HEAD:refs/heads/!BRANCH!" "分支 !BRANCH!"
if errorlevel 1 exit /b 1

echo [推送] 标签 v!VERSION!
call :push_with_retry "refs/tags/v!VERSION!:refs/tags/v!VERSION!" "标签 v!VERSION!"
if errorlevel 1 exit /b 1

git ls-remote --exit-code --tags origin "refs/tags/v!VERSION!" >nul 2>&1
if errorlevel 1 (
  echo [错误] 推送后仍未在远端找到标签 v!VERSION!。
  exit /b 1
)

echo.
echo ============================================================
echo  v!VERSION! 已推送，GitHub Actions 正在构建 Release。
echo  进度：https://github.com/dmql98/tianshu/actions
echo  完成后校验：publish-release.bat --verify
echo ============================================================
exit /b 0

:read_current_version
set "CURRENT_VERSION="
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "(Get-Content -Raw -Encoding UTF8 'dev\desktop\package.json' | ConvertFrom-Json).version"`) do set "CURRENT_VERSION=%%i"
if not defined CURRENT_VERSION (
  echo [错误] 无法读取 dev\desktop\package.json 中的版本号。
  exit /b 1
)
exit /b 0

:push_with_retry
set "PUSH_REF=%~1"
set "PUSH_LABEL=%~2"
for /l %%n in (1,1,3) do (
  git push origin "!PUSH_REF!"
  if not errorlevel 1 exit /b 0
  if %%n lss 3 (
    echo [警告] !PUSH_LABEL! 推送失败，3 秒后重试（%%n/3）...
    timeout /t 3 /nobreak >nul
  )
)
echo [错误] !PUSH_LABEL! 连续三次推送失败。
exit /b 1

:verify
echo ============================================================
echo  TianShu Release Verifier  v!CURRENT_VERSION!
echo ============================================================
rem 多平台资产清单校验（迁移指南 §13）：latest*.yml + Windows exe/blockmap
rem + macOS x64/arm64 dmg+zip + Linux AppImage。
node "%~dp0dev\scripts\verify-desktop-release.mjs" --remote "v!CURRENT_VERSION!" --repo dmql98/tianshu
exit /b %errorlevel%
