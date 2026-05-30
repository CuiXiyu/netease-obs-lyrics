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
    Write-Host "No BetterNCM plugins folder was found automatically."
    Write-Host "Import this file from BetterNCM plugin manager:"
    Write-Host $pluginPath
    exit 0
}

$target = $candidates[0]
Copy-Item -LiteralPath $pluginPath -Destination (Join-Path $target "netease-obs-lyrics-bridge.plugin") -Force

Write-Host "Installed BetterNCM plugin to:"
Write-Host $target
Write-Host "Restart NetEase Cloud Music after enabling the plugin."
