# Close only the AdsPower profiles managed by the current HyperClip session.
param(
    [switch]$IncludeHyperClip
)

$ErrorActionPreference = 'SilentlyContinue'
$apiUrl = if ($env:ADSPOWER_API_URL) { $env:ADSPOWER_API_URL.TrimEnd('/') } else { 'http://127.0.0.1:50325' }
$dataDir = if ($env:HYPERCLIP_DATA_DIR) { $env:HYPERCLIP_DATA_DIR } elseif ($env:HYPERCLIPB_DATA_DIR) { $env:HYPERCLIPB_DATA_DIR } else { Join-Path $PSScriptRoot 'HyperClip-Data' }
$hyperClipDir = Join-Path $dataDir '.hyperclip'
$sessionFile = Join-Path $hyperClipDir 'adspower_session.json'
$startLock = Join-Path $hyperClipDir 'adspower_start.lock'
$cleanupLock = Join-Path $hyperClipDir 'adspower_cleanup.lock'
$lockStream = $null
$apiReady = $false
$packagePattern = [regex]::Escape($PSScriptRoot)
$runningHyperClip = Get-Process -Name 'HyperClip' | Where-Object {
    try { $_.Path -match $packagePattern } catch { $false }
}
if ($runningHyperClip -and -not $IncludeHyperClip) { return }

if (Test-Path $sessionFile) {
    try {
        $status = Invoke-RestMethod -Uri "$apiUrl/status" -Method Get -TimeoutSec 2
        $apiReady = ($status.code -eq 0)
    } catch { $apiReady = $false }
}

try {
    while (Test-Path $startLock) {
        $lockInfo = Get-Item -LiteralPath $startLock -ErrorAction SilentlyContinue
        if (-not $lockInfo) { break }
        $lockAge = [DateTime]::UtcNow - $lockInfo.LastWriteTimeUtc
        if ($lockAge.TotalMinutes -ge 10) {
            Remove-Item -LiteralPath $startLock -Force
            break
        }
        Start-Sleep -Seconds 1
    }

    if ((Test-Path $sessionFile) -and -not $apiReady) {
        try {
            $status = Invoke-RestMethod -Uri "$apiUrl/status" -Method Get -TimeoutSec 2
            $apiReady = ($status.code -eq 0)
        } catch { $apiReady = $false }
    }

    if ((Test-Path $sessionFile) -and $apiReady) {
        try {
            $lockStream = [System.IO.File]::Open($cleanupLock, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
        } catch {
            # Another lifecycle owner is already stopping these profiles.
            exit 0
        }

        $session = Get-Content $sessionFile -Raw | ConvertFrom-Json
        $profiles = @($session.profiles)
        $failedProfiles = @()
        $index = 0

        foreach ($profile in $profiles) {
            $profileId = [string]$profile.profileId
            $serial = [string]$profile.adsPowerSerial
            if ([string]::IsNullOrWhiteSpace($profileId) -and [string]::IsNullOrWhiteSpace($serial)) { continue }

            $target = if (-not [string]::IsNullOrWhiteSpace($profileId)) {
                'user_id=' + [uri]::EscapeDataString($profileId)
            } else {
                'serial_number=' + [uri]::EscapeDataString($serial)
            }

            $stopped = $false
            for ($attempt = 1; $attempt -le 3 -and -not $stopped; $attempt++) {
                try {
                    $response = Invoke-RestMethod -Uri "$apiUrl/api/v1/browser/stop?$target" -Method Get -TimeoutSec 5
                    $stopped = ($response.code -eq 0)
                } catch {
                    $stopped = $false
                }
                if (-not $stopped -and $attempt -lt 3) { Start-Sleep -Milliseconds 1200 }
            }

            if (-not $stopped) { $failedProfiles += $profile }
            $index++
            if ($index -lt $profiles.Count) { Start-Sleep -Milliseconds 1100 }
        }

        if ($failedProfiles.Count -eq 0) {
            Remove-Item -LiteralPath $sessionFile -Force
        } else {
            $retryState = [ordered]@{
                updatedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
                profiles = $failedProfiles
            }
            $retryJson = $retryState | ConvertTo-Json -Depth 5
            [System.IO.File]::WriteAllText($sessionFile, $retryJson, [System.Text.UTF8Encoding]::new($false))
        }
    }
} catch {
    # Keep shutdown best-effort. The GUI is already closed at this point.
} finally {
    if ($lockStream) {
        $lockStream.Dispose()
        Remove-Item -LiteralPath $cleanupLock -Force
    }
}

# Close HyperClip-owned Chrome and helper processes only; never kill every SunBrowser.
Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq 'chrome.exe' -and $_.CommandLine -and (
        $_.CommandLine -match [regex]::Escape($dataDir) -or
        $_.CommandLine -match 'TikTok-Profiles'
    )
} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

$hcRunning = Get-Process -Name 'HyperClip' | Where-Object {
    try { $_.Path -match 'app\\HyperClip\.exe' } catch { $false }
}
if (-not $hcRunning -or $IncludeHyperClip) {
    Get-Process -Name 'hyperclip-tauri' | Stop-Process -Force
    Get-CimInstance Win32_Process | Where-Object {
        $_.Name -eq 'node.exe' -and $_.CommandLine -and (
            $_.CommandLine -match $packagePattern -and
            $_.CommandLine -match 'tiktok_helper|innertube_helper|adspower_bridge'
        )
    } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
}

if ($IncludeHyperClip) {
    Get-Process | Where-Object { $_.ProcessName -match 'HyperClip|HyperShort' } | Stop-Process -Force
    Get-CimInstance Win32_Process | Where-Object {
        $_.Name -eq 'cmd.exe' -and $_.CommandLine -and (
            $_.CommandLine -match 'HyperClip-Debug\.bat' -or
            $_.CommandLine -match 'HyperClip-AutoRestart\.bat'
        )
    } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
}
