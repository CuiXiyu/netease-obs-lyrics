$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$distRoot = Join-Path $projectRoot "dist"
$releaseRoot = Join-Path $distRoot "netease-obs-lyrics"
$packageJson = Get-Content -LiteralPath (Join-Path $projectRoot "package.json") -Raw | ConvertFrom-Json
$version = [string]$packageJson.version
if (-not $version) {
    throw "package.json 中必须提供版本号。"
}
$releaseZip = Join-Path $distRoot "netease-obs-lyrics-windows-v$version.zip"
$latestZip = Join-Path $distRoot "netease-obs-lyrics-windows.zip"

& (Join-Path $projectRoot "scripts\build-betterncm-plugin.ps1")

Remove-Item -LiteralPath $releaseRoot, $releaseZip, $latestZip -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null

$items = @(
    "betterncm-plugin",
    "overlay",
    "scripts",
    "package.json",
    "package-lock.json",
    "VERSION",
    "CHANGELOG.zh-CN.md",
    "server.js",
    "README.md",
    "setup.ps1",
    "launch.ps1",
    "health.ps1",
    "stop-service.ps1",
    "start.ps1",
    "Setup and Start.cmd",
    "Start OBS Lyrics.cmd",
    "Check Status.cmd"
)

foreach ($item in $items) {
    $source = Join-Path $projectRoot $item
    if (Test-Path $source) {
        Copy-Item -LiteralPath $source -Destination $releaseRoot -Recurse -Force
    }
}

Get-ChildItem -LiteralPath $projectRoot -Filter "*.cmd" -File |
    Copy-Item -Destination $releaseRoot -Force

New-Item -ItemType Directory -Force -Path (Join-Path $releaseRoot "dist") | Out-Null
Copy-Item -LiteralPath (Join-Path $distRoot "netease-obs-lyrics-bridge.plugin") `
    -Destination (Join-Path $releaseRoot "dist\netease-obs-lyrics-bridge.plugin") `
    -Force

$betterNcmDll = Join-Path $distRoot "BetterNCMII.dll"
if (Test-Path $betterNcmDll) {
    Copy-Item -LiteralPath $betterNcmDll `
        -Destination (Join-Path $releaseRoot "dist\BetterNCMII.dll") `
        -Force
}

Compress-Archive -Path (Join-Path $releaseRoot "*") -DestinationPath $releaseZip -Force
Copy-Item -LiteralPath $releaseZip -Destination $latestZip -Force

Write-Host "发布包已构建："
Write-Host $releaseZip
Write-Host $latestZip
