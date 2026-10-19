param(
  [int]$TimeoutMinutes = 120,
  [string]$Asar,
  [string]$Exe,
  [switch]$NoRestart
)

<#
  等 DeepSeek Harness 完全退出 -> 还原干净 asar -> 打材质补丁 -> 重启。

  为什么需要独立进程：补丁要求 app.asar 不被占用，而补丁生效又要求重启 DSH。
  用计划任务托管本脚本，可保证它不随 DSH 退出而被杀掉。

  用法（在仓库根目录执行）：
    powershell -ExecutionPolicy Bypass -File .\apply-when-closed.ps1
#>
$ErrorActionPreference = 'Continue'

$here = $PSScriptRoot
if (-not $here) { $here = (Get-Location).Path }
$log = Join-Path $here 'apply.log'

function Find-First($paths) {
  foreach ($p in $paths) { if ($p -and (Test-Path $p)) { return $p } }
  return $null
}

# ── 路径探测 ────────────────────────────────────────────────
$asar = $Asar
if (-not $asar) {
  $asar = Find-First @(
    'C:\Program Files\DeepSeek Harness\resources\app.asar'
    'C:\Program Files (x86)\DeepSeek Harness\resources\app.asar'
    (Join-Path $env:LOCALAPPDATA 'Programs\deepseek-harness\resources\app.asar')
    'E:\gongju\deepseek\resources\app.asar'
  )
}
$exe = $Exe
if (-not $exe) {
  $exe = Find-First @(
    'C:\Program Files\DeepSeek Harness\DeepSeek Harness.exe'
    'C:\Program Files (x86)\DeepSeek Harness\DeepSeek Harness.exe'
    (Join-Path $env:LOCALAPPDATA 'Programs\deepseek-harness\DeepSeek Harness.exe')
    'E:\gongju\deepseek\DeepSeek Harness.exe'
  )
}
if ($asar -eq $null) { Write-Host '找不到 app.asar，请用 -Asar 指定'; exit 2 }

# Node：优先 PATH，其次 DSH 自带运行时
$nodeCmd = (Get-Command node -ErrorAction SilentlyContinue).Source
if ($nodeCmd -eq $null) {
  $candidates = @(
    (Join-Path $env:USERPROFILE '.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe')
  )
  $runtime = Join-Path $env:USERPROFILE '.dsh\dsh-runtimes'
  if (Test-Path $runtime) {
    $found = Get-ChildItem $runtime -Recurse -Filter node.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found -ne $null) { $candidates += $found.FullName }
  }
  $nodeCmd = Find-First $candidates
}
if ($nodeCmd -eq $null) { Write-Host '找不到 node.exe'; exit 2 }

function Write-Log([string]$message) {
  $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $message
  Add-Content -Path $log -Value $line -Encoding utf8
  Write-Host $line
}

Write-Log "=== dsh-acrylic-light helper started (pid $PID) ==="
Write-Log "asar = $asar"

# ── 等 app.asar 释放 ────────────────────────────────────────
$deadline = (Get-Date).AddMinutes($TimeoutMinutes)
$free = $false
while ((Get-Date) -lt $deadline) {
  try {
    $stream = [System.IO.File]::Open($asar, 'Open', 'ReadWrite', 'None')
    $stream.Close()
    $free = $true
    break
  } catch { Start-Sleep -Milliseconds 700 }
}
if (-not $free) { Write-Log 'timeout: asar still locked'; exit 1 }
Write-Log 'asar released'

# ── 1. 还原到最近一次干净备份，保证补丁总是打在干净文件上 ────
$backups = Get-ChildItem (Join-Path $here 'backups') -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending
if ($backups.Count -gt 0) {
  $restoreFrom = Join-Path $backups[0].FullName 'app.asar'
  if (Test-Path $restoreFrom) {
    Write-Log "restoring clean asar from $restoreFrom"
    Copy-Item $restoreFrom $asar -Force
  }
}

# ── 2. 打补丁：只加 backgroundMaterial，不加透明 backgroundColor ──
Write-Log 'patching'
$patched = $false
try {
  $output = & $nodeCmd (Join-Path $here 'patch-asar.mjs') --asar $asar --material acrylic 2>&1
  Write-Log ($output -join "`n")
  if ($LASTEXITCODE -eq 0) { $patched = $true; Write-Log 'PATCH OK' }
  else { Write-Log "PATCH FAILED exit=$LASTEXITCODE" }
} catch { Write-Log "patch threw: $($_.Exception.Message)" }

# ── 3. 校验补丁确实落进归档 ─────────────────────────────────
if ($patched) {
  $check = & $nodeCmd (Join-Path $here 'verify-asar.mjs') --asar $asar 2>&1
  Write-Log ($check -join "`n")
}

# ── 4. 重启，避免把用户留在打不开的应用前 ───────────────────
if (-not $NoRestart -and $exe -ne $null) {
  Write-Log "relaunching (patched=$patched)"
  Start-Process -FilePath $exe
} else {
  Write-Log 'not relaunching (-NoRestart specified or exe not found)'
}
