$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Runtime.WindowsRuntime
[void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
[void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime]

function Await-AsyncOperation {
    param(
        [Parameter(Mandatory = $true)] $AsyncOperation,
        [Parameter(Mandatory = $true)] [Type] $ResultType
    )

    $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() |
        Where-Object {
            $_.Name -eq "AsTask" -and
            $_.IsGenericMethod -and
            $_.GetParameters().Count -eq 1
        } |
        Select-Object -First 1

    $task = $asTask.MakeGenericMethod($ResultType).Invoke($null, @($AsyncOperation))
    $task.Wait()
    return $task.Result
}

function Read-MediaSession {
    param([Parameter(Mandatory = $true)] $Session)

    $properties = Await-AsyncOperation `
        $Session.TryGetMediaPropertiesAsync() `
        ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])

    $timeline = $Session.GetTimelineProperties()
    $playback = $Session.GetPlaybackInfo()

    $durationMs = 0
    if ($timeline.EndTime -and $timeline.StartTime) {
        $durationMs = [math]::Max(0, ($timeline.EndTime - $timeline.StartTime).TotalMilliseconds)
    }
    $positionMs = [int64][math]::Max(0, $timeline.Position.TotalMilliseconds)
    $isReliable = $durationMs -gt 0 -and $positionMs -le ($durationMs + 1000)

    [pscustomobject]@{
        title = [string]$properties.Title
        artist = [string]$properties.Artist
        album = [string]$properties.AlbumTitle
        source = [string]$Session.SourceAppUserModelId
        playbackStatus = [string]$playback.PlaybackStatus
        positionMs = $positionMs
        durationMs = [int64]$durationMs
        capturedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        positionReliable = $isReliable
        progressSource = "windows-media-session"
    }
}

function Get-NowUnixMs {
    return [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
}

function Read-CloudMusicWindow {
    $process = Get-Process -Name "cloudmusic" -ErrorAction SilentlyContinue |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_.MainWindowTitle) } |
        Sort-Object StartTime -Descending |
        Select-Object -First 1

    if ($null -eq $process) {
        return $null
    }

    $windowTitle = [string]$process.MainWindowTitle
    if ([string]::IsNullOrWhiteSpace($windowTitle)) {
        return $null
    }

    $title = $windowTitle.Trim()
    $artist = ""
    $parts = $windowTitle -split "\s+-\s+"
    if ($parts.Count -ge 2) {
        $artist = ($parts[$parts.Count - 1]).Trim()
        $title = (($parts[0..($parts.Count - 2)] -join " - ")).Trim()
    }

    [pscustomobject]@{
        title = $title
        artist = $artist
        album = ""
        source = "cloudmusic-window-title"
        playbackStatus = "Unknown"
        positionMs = 0
        durationMs = 0
        capturedAt = Get-NowUnixMs
        positionReliable = $false
        progressSource = "none"
    }
}

$manager = Await-AsyncOperation `
    ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) `
    ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])

$pattern = $env:NCM_SOURCE_PATTERN
if ([string]::IsNullOrWhiteSpace($pattern)) {
    $pattern = "cloudmusic|netease|orpheus"
}

while ($true) {
    try {
        $all = @()
        foreach ($session in $manager.GetSessions()) {
            try {
                $item = Read-MediaSession $session
                if (-not [string]::IsNullOrWhiteSpace($item.title) -or -not [string]::IsNullOrWhiteSpace($item.artist)) {
                    $all += $item
                }
            }
            catch {
                # A media session can disappear while it is being read.
            }
        }

        $selected = $all |
            Where-Object {
                $_.source -match $pattern -or
                $_.title -match "NetEase|Cloud Music" -or
                $_.artist -match "NetEase|Cloud Music"
            } |
            Select-Object -First 1

        if ($null -eq $selected -or [string]::IsNullOrWhiteSpace($selected.title)) {
            $fallback = Read-CloudMusicWindow
            if ($null -ne $fallback) {
                $fallback.capturedAt = Get-NowUnixMs
                $selected = $fallback
            }
        }

        if ($null -eq $selected) {
            $selected = [pscustomobject]@{
                title = ""
                artist = ""
                album = ""
                source = ""
                playbackStatus = "Closed"
                positionMs = 0
                durationMs = 0
                capturedAt = Get-NowUnixMs
                positionReliable = $false
                progressSource = "none"
            }
        }

        $selected | ConvertTo-Json -Compress -Depth 5
    }
    catch {
        [pscustomobject]@{
            error = $_.Exception.Message
            capturedAt = Get-NowUnixMs
        } | ConvertTo-Json -Compress -Depth 3
    }

    Start-Sleep -Milliseconds 400
}
