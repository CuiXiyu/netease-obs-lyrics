$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$buildScript = Join-Path $projectRoot "scripts\build-betterncm-plugin.ps1"
& $buildScript

$pluginPath = Join-Path $projectRoot "dist\netease-obs-lyrics-bridge.plugin"
$candidates = @(@(
    "C:\betterncm\plugins",
    (Join-Path $env:APPDATA "BetterNCM\plugins"),
    (Join-Path $env:LOCALAPPDATA "BetterNCM\plugins")
) | Where-Object { $_ -and (Test-Path $_) })

if (-not $candidates.Count) {
    Write-Host "未自动找到 BetterNCM 插件目录。"
    Write-Host "请在 BetterNCM 插件管理器中手动导入这个文件："
    Write-Host $pluginPath
    exit 0
}

$target = $candidates[0]
Copy-Item -LiteralPath $pluginPath -Destination (Join-Path $target "netease-obs-lyrics-bridge.plugin") -Force

Write-Host "BetterNCM 桥接插件已安装到："
Write-Host $target
Write-Host "启用插件后请重启网易云音乐。"
