# 清理 dsh-acrylic-light 卸载残留（重启 DSH 后运行）
#
# 为什么需要：卸载时 DSH 正在运行，loader 加载着这些模块，
# 文件被占用无法删除，于是留下半卸载状态。
# 重启后占用释放，这个脚本把 node_modules 里的目录删掉。

$ErrorActionPreference = 'Continue'
$target = Join-Path $env:USERPROFILE '.dsh\profiles\desktop\node_modules\dsh-acrylic-light'

if (-not (Test-Path $target)) {
  Write-Host "目录不存在，无需清理：$target" -ForegroundColor Green
  exit 0
}

# 先探测是否还被占用
$blocked = 0
Get-ChildItem $target -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {
  try {
    $s = [System.IO.File]::Open($_.FullName, 'Open', 'ReadWrite', 'None')
    $s.Close()
  } catch { $blocked++ }
}

if ($blocked -gt 0) {
  Write-Host "仍有 $blocked 个文件被占用。" -ForegroundColor Yellow
  Write-Host "请先完全退出 DeepSeek Harness（托盘右键退出），再运行本脚本。" -ForegroundColor Yellow
  exit 1
}

Remove-Item $target -Recurse -Force -ErrorAction SilentlyContinue
if (Test-Path $target) {
  Write-Host "删除失败，请重启后再试。" -ForegroundColor Red
  exit 1
}
Write-Host "已删除：$target" -ForegroundColor Green
