param(
    [string]$CloudMusicDir = "",
    [switch]$Elevated
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$dllPath = Join-Path $projectRoot "dist\BetterNCMII.dll"

if (-not (Test-Path $dllPath)) {
    throw "未找到 BetterNCMII.dll：$dllPath"
}

if (-not $CloudMusicDir) {
    $cloudMusic = & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $projectRoot "scripts\find-cloudmusic.ps1") | ConvertFrom-Json
    if (-not $cloudMusic.Found) {
        throw "未找到网易云音乐。请先安装网易云音乐，或运行 scripts\install-betterncm.ps1 -CloudMusicDir <网易云音乐目录>。"
    }
    $CloudMusicDir = $cloudMusic.InstallDir
}

$cloudMusicExe = Join-Path $CloudMusicDir "cloudmusic.exe"
if (-not (Test-Path $cloudMusicExe)) {
    throw "在目录中未找到 cloudmusic.exe：$CloudMusicDir"
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
            Write-Host "安装 BetterNCM 需要管理员权限，正在请求提权..."
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
                throw "管理员权限安装 BetterNCM 失败，退出码：$($process.ExitCode)。"
            }
        } else {
            throw
        }
    }

    if (-not (Test-Path $targetDll)) {
        throw "BetterNCM 加载器未安装成功：$targetDll"
    }

    Write-Host "BetterNCM 已安装到："
    Write-Host $targetDll
} else {
    Write-Host "BetterNCM 加载器已存在："
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
