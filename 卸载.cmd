@echo off
chcp 65001 >nul
setlocal

rem ============================================================
rem  一键卸载 dsh-acrylic-light
rem
rem  双击本文件即可。它会：
rem    1. 移除插件（目录 / package.json / cordis.patch.yml）
rem    2. 还原 app.asar 的窗口材质补丁
rem    3. 清理备份
rem
rem  ⚠ 执行前请先从托盘完全退出 DeepSeek Harness，
rem    否则 app.asar 被占用、窗口材质无法还原。
rem ============================================================

title 卸载 dsh-acrylic-light

echo.
echo ════════════════════════════════════════════
echo   dsh-acrylic-light 一键卸载
echo ════════════════════════════════════════════
echo.

rem ── 先检查 DSH 是否在运行 ──────────────────────
tasklist /FI "IMAGENAME eq DeepSeek Harness.exe" 2>nul | find /I "DeepSeek Harness.exe" >nul
if not errorlevel 1 (
  echo ⚠ 检测到 DeepSeek Harness 正在运行。
  echo.
  echo   窗口材质补丁需要独占 app.asar 才能还原，
  echo   请先从【托盘图标右键 → 退出】完全关闭 DSH。
  echo.
  choice /C YN /M "仍然继续卸载插件部分吗（窗口材质会跳过）"
  if errorlevel 2 goto :cancelled
)

rem ── 找 node ───────────────────────────────────
set "NODE="
where node >nul 2>nul
if not errorlevel 1 set "NODE=node"

if not defined NODE (
  if exist "%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" (
    set "NODE=%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
  )
)

if not defined NODE (
  echo.
  echo ✗ 找不到 node.exe
  echo   请安装 Node.js 18+ ，或手动运行：
  echo     node uninstall-all.mjs
  echo.
  pause
  exit /b 1
)

echo 使用 node: %NODE%
echo.

rem ── 执行卸载 ──────────────────────────────────
"%NODE%" "%~dp0uninstall-all.mjs" %*
set "CODE=%ERRORLEVEL%"

echo.
if "%CODE%"=="0" (
  echo ════════════════════════════════════════════
  echo   ✓ 卸载完成
  echo.
  echo   请重新打开 DeepSeek Harness，
  echo   界面将恢复原生外观。
  echo ════════════════════════════════════════════
) else (
  echo ════════════════════════════════════════════
  echo   ✗ 卸载过程有错误（退出码 %CODE%）
  echo   请查看上面的输出。
  echo ════════════════════════════════════════════
)

echo.
pause
exit /b %CODE%

:cancelled
echo.
echo 已取消，未做任何修改。
pause
exit /b 0
