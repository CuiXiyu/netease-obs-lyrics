param(
    [string]$ProjectRoot = (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
)

$ErrorActionPreference = "Stop"

$vendorRoot = Join-Path $ProjectRoot ".runtime"
$nodeRoot = Join-Path $vendorRoot "node"
$nodeExe = Join-Path $nodeRoot "node.exe"

function Get-NodeMajor([string]$NodePath) {
    try {
        $version = & $NodePath --version
        if ($version -match "^v(\d+)\.") {
            return [int]$Matches[1]
        }
    } catch {}
    return 0
}

$globalNode = Get-Command node.exe -ErrorAction SilentlyContinue
if ($globalNode -and (Get-NodeMajor $globalNode.Source) -ge 20) {
    Write-Output $globalNode.Source
    exit 0
}

if ((Test-Path $nodeExe) -and (Get-NodeMajor $nodeExe) -ge 20) {
    Write-Output $nodeExe
    exit 0
}

New-Item -ItemType Directory -Force -Path $vendorRoot | Out-Null
$indexUrl = "https://nodejs.org/dist/index.json"
$nodeIndex = Invoke-RestMethod -Uri $indexUrl -UseBasicParsing
$release = $nodeIndex |
    Where-Object { $_.lts -and ($_.files -contains "win-x64-zip") -and ([int]($_.version.TrimStart("v").Split(".")[0]) -ge 20) } |
    Select-Object -First 1

if (-not $release) {
    throw "Could not find a suitable Node.js LTS release from $indexUrl"
}

$version = $release.version
$zipName = "node-$version-win-x64.zip"
$zipUrl = "https://nodejs.org/dist/$version/$zipName"
$zipPath = Join-Path $vendorRoot $zipName
$extractTemp = Join-Path $vendorRoot "node-extract"

Write-Host "Downloading Node.js $version..."
Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing

Remove-Item -LiteralPath $extractTemp -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $nodeRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $extractTemp | Out-Null

Expand-Archive -LiteralPath $zipPath -DestinationPath $extractTemp -Force
$extracted = Get-ChildItem -LiteralPath $extractTemp -Directory | Select-Object -First 1
if (-not $extracted) {
    throw "Node.js archive did not contain an extracted folder"
}

Move-Item -LiteralPath $extracted.FullName -Destination $nodeRoot -Force
Remove-Item -LiteralPath $extractTemp, $zipPath -Recurse -Force -ErrorAction SilentlyContinue

Write-Output $nodeExe
