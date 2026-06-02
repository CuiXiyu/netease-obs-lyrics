$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$pluginRoot = Join-Path $projectRoot "betterncm-plugin\netease-obs-lyrics-bridge"
$distRoot = Join-Path $projectRoot "dist"
$zipPath = Join-Path $distRoot "netease-obs-lyrics-bridge.zip"
$pluginPath = Join-Path $distRoot "netease-obs-lyrics-bridge.plugin"

if (-not (Test-Path $pluginRoot)) {
    throw "未找到插件源码目录：$pluginRoot"
}

New-Item -ItemType Directory -Force -Path $distRoot | Out-Null
Remove-Item -LiteralPath $zipPath, $pluginPath -Force -ErrorAction SilentlyContinue

Compress-Archive -Path (Join-Path $pluginRoot "*") -DestinationPath $zipPath -Force
Move-Item -LiteralPath $zipPath -Destination $pluginPath -Force

Write-Host "BetterNCM 插件已构建："
Write-Host $pluginPath
