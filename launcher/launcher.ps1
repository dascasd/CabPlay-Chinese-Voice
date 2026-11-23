# CabPlay 语音增强启动器
$ErrorActionPreference = 'Continue'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$cab = 'C:\rj\cabplay'
if (-not (Test-Path (Join-Path $cab 'CabPlay.exe'))) { $cab = Join-Path $env:LOCALAPPDATA 'Programs\CabPlay' }
if (-not (Test-Path (Join-Path $cab 'CabPlay.exe'))) {
  Write-Host "[错误] 找不到 CabPlay 安装目录。" -ForegroundColor Red
  Read-Host "按回车退出"
  exit 1
}
Write-Host "=========================================="
Write-Host "   CabPlay 语音增强启动器"
Write-Host "   $cab"
Write-Host "=========================================="
Write-Host ""
Write-Host "[检查语音增强版本...]"
$env:ELECTRON_RUN_AS_NODE = '1'
$out = & (Join-Path $cab 'CabPlay.exe') (Join-Path $here 'apply-patch.js') "--dir=$cab" 2>&1 | Out-String
$rc = $LASTEXITCODE
$env:ELECTRON_RUN_AS_NODE = $null
$out.Trim() | Write-Host
$out | Set-Content -Path (Join-Path $here 'patch-log.txt') -Encoding UTF8
Write-Host ""
if ($rc -ne 0) {
  Write-Host "==========================================" -ForegroundColor Yellow
  Write-Host " [提示] 官方已更新，语音增强需要重新适配！" -ForegroundColor Yellow
  Write-Host " 官方代码可能大改，无法自动打补丁。" -ForegroundColor Yellow
  Write-Host " 现在将以「官方原版」启动（无语音增强）。" -ForegroundColor Yellow
  Write-Host " 需要增强：把 patch-log.txt 发给 AI 重新适配。" -ForegroundColor Yellow
  Write-Host "==========================================" -ForegroundColor Yellow
  Read-Host "按回车继续启动"
}
Write-Host "[启动 CabPlay...]"
Start-Process (Join-Path $cab 'CabPlay.exe')
Start-Sleep -Milliseconds 1500