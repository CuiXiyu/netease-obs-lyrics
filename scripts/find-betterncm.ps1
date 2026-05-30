$ErrorActionPreference = "Stop"

$roots = @(
    "C:\betterncm",
    (Join-Path $env:APPDATA "BetterNCM"),
    (Join-Path $env:LOCALAPPDATA "BetterNCM"),
    (Join-Path $env:APPDATA "betterncm"),
    (Join-Path $env:LOCALAPPDATA "betterncm")
) | Where-Object { $_ -and (Test-Path $_) }

$pluginDirs = @()
foreach ($root in $roots) {
    $pluginDirs += Get-ChildItem -LiteralPath $root -Directory -Recurse -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match "^(plugins|Plugins)$" } |
        Select-Object -ExpandProperty FullName
}

$pluginDirs = $pluginDirs | Select-Object -Unique

[pscustomobject]@{
    Installed = [bool]$pluginDirs.Count
    Roots = $roots
    PluginDirs = $pluginDirs
} | ConvertTo-Json -Depth 4
