param(
    [string]$CloudMusicDir = "",
    [switch]$Elevated
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$dllPath = Join-Path $projectRoot "dist\BetterNCMII.dll"

if (-not (Test-Path $dllPath)) {
    throw "BetterNCMII.dll was not found: $dllPath"
}

if (-not $CloudMusicDir) {
    $cloudMusic = & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $projectRoot "scripts\find-cloudmusic.ps1") | ConvertFrom-Json
    if (-not $cloudMusic.Found) {
        throw "NetEase Cloud Music was not found. Install it first, or run scripts\install-betterncm.ps1 -CloudMusicDir <CloudMusic folder>."
    }
    $CloudMusicDir = $cloudMusic.InstallDir
}

$cloudMusicExe = Join-Path $CloudMusicDir "cloudmusic.exe"
if (-not (Test-Path $cloudMusicExe)) {
    throw "cloudmusic.exe was not found in: $CloudMusicDir"
}

$targetDll = Join-Path $CloudMusicDir "msimg32.dll"
$alreadyInstalled = Test-Path $targetDll

function Test-IsAdmin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not $alreadyInstalled) {
    Get-Process cloudmusic -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -and ((Split-Path -Parent $_.Path) -ieq $CloudMusicDir) } |
        Stop-Process -Force -ErrorAction SilentlyContinue

    try {
        Copy-Item -LiteralPath $dllPath -Destination $targetDll -Force
    } catch [System.UnauthorizedAccessException] {
        if (-not $Elevated -and -not (Test-IsAdmin)) {
            Write-Host "Administrator permission is required to install BetterNCM here. Requesting elevation..."
            $arguments = @(
                "-NoLogo",
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                "`"$PSCommandPath`"",
                "-CloudMusicDir",
                "`"$CloudMusicDir`"",
                "-Elevated"
            )
            $process = Start-Process -FilePath "powershell.exe" -ArgumentList $arguments -Verb RunAs -Wait -PassThru
            if ($process.ExitCode -ne 0) {
                throw "Elevated BetterNCM install failed with exit code $($process.ExitCode)."
            }
        } else {
            throw
        }
    }

    if (-not (Test-Path $targetDll)) {
        throw "BetterNCM loader was not installed: $targetDll"
    }

    Write-Host "BetterNCM installed to:"
    Write-Host $targetDll
} else {
    Write-Host "BetterNCM loader already exists:"
    Write-Host $targetDll
}

$pluginRoot = "C:\betterncm\plugins"
New-Item -ItemType Directory -Force -Path $pluginRoot | Out-Null

[pscustomobject]@{
    Installed = $true
    CloudMusicDir = $CloudMusicDir
    LoaderPath = $targetDll
    PluginDir = $pluginRoot
    WasAlreadyInstalled = $alreadyInstalled
} | ConvertTo-Json -Depth 3
