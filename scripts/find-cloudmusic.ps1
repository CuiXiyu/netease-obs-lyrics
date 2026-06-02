$ErrorActionPreference = "Stop"

$paths = New-Object System.Collections.Generic.List[string]

Get-Process cloudmusic -ErrorAction SilentlyContinue |
    Where-Object { $_.Path } |
    ForEach-Object { $paths.Add($_.Path) }

$uninstallRoots = @(
    "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*"
)

foreach ($root in $uninstallRoots) {
    Get-ItemProperty -Path $root -ErrorAction SilentlyContinue |
        Where-Object {
            $_.DisplayName -match "NetEase Cloud Music|CloudMusic|163"
        } |
        ForEach-Object {
            foreach ($candidate in @($_.DisplayIcon, $_.InstallLocation)) {
                if (-not $candidate) { continue }
                $clean = [string]$candidate
                $clean = $clean.Trim('"')
                if ($clean -match "\.exe") {
                    $clean = $clean -replace ",\d+$", ""
                    $paths.Add($clean)
                } else {
                    $paths.Add((Join-Path $clean "cloudmusic.exe"))
                }
            }
        }
}

$commonRoots = @(
    "$env:ProgramFiles\Netease\CloudMusic",
    "${env:ProgramFiles(x86)}\Netease\CloudMusic",
    "$env:LOCALAPPDATA\Netease\CloudMusic",
    "C:\Program Files\Netease\CloudMusic",
    "C:\Program Files (x86)\Netease\CloudMusic",
    "D:\CloudMusic"
) | Where-Object { $_ }

foreach ($root in $commonRoots) {
    $paths.Add((Join-Path $root "cloudmusic.exe"))
}

Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue |
    ForEach-Object {
        $driveRoot = $_.Root
        foreach ($relative in @(
            "CloudMusic\cloudmusic.exe",
            "Netease\CloudMusic\cloudmusic.exe",
            "Program Files\Netease\CloudMusic\cloudmusic.exe",
            "Program Files (x86)\Netease\CloudMusic\cloudmusic.exe"
        )) {
            $paths.Add((Join-Path $driveRoot $relative))
        }
    }

$cloudMusic = $paths |
    Where-Object { $_ -and (Test-Path $_) -and ((Split-Path -Leaf $_) -ieq "cloudmusic.exe") } |
    Select-Object -Unique -First 1

[pscustomobject]@{
    Found = [bool]$cloudMusic
    ExePath = $cloudMusic
    InstallDir = if ($cloudMusic) { Split-Path -Parent $cloudMusic } else { "" }
} | ConvertTo-Json -Depth 3
