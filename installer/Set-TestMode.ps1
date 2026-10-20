<#
.SYNOPSIS
    Bat/tat che do TEST HIEU NANG: mo toan bo kenh de tao tai that cho may.

.DESCRIPTION
    Bo channels.json khach dang dung co 54 kenh nhung 42 kenh de pollPolicy="off"
    (channel_policy.rs decide() -> Skip(PolicyOff), khong ton unit, KHONG QUET).
    Chi 12 kenh thuc su duoc quet, khong du tai de danh gia may 5070.

    -On  : luu lai pollPolicy goc cua tung kenh roi bat het thanh "continuous".
    -Off : tra lai dung pollPolicy goc tung kenh tu file backup.

    Backup nam canh channels.json nen -Off luon khoi phuc CHINH XAC cau hinh cu,
    khong phai doan.

.EXAMPLE
    .\Set-TestMode.ps1 -On
    .\Set-TestMode.ps1 -Off
#>
[CmdletBinding(SupportsShouldProcess = $true, DefaultParameterSetName = 'On')]
param(
    [Parameter(ParameterSetName = 'On')]  [switch] $On,
    [Parameter(ParameterSetName = 'Off')] [switch] $Off,
    [string] $DataDir
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# Duoi Set-StrictMode -Version Latest, `$obj.PSObject.Properties.Name` NEM LOI
# khi object khong co property nao. Luon di qua ham nay.
function Test-HasProp {
    param($Obj, [string]$Name)
    if ($null -eq $Obj) { return $false }
    return (@($Obj.PSObject.Properties | ForEach-Object { $_.Name }) -contains $Name)
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $DataDir) { $DataDir = Join-Path (Split-Path -Parent $ScriptDir) 'HyperClip-Data' }

$chPath     = Join-Path $DataDir '.hyperclip\channels\channels.json'
$backupPath = Join-Path $DataDir '.hyperclip\channels\channels.testmode-backup.json'

if (-not (Test-Path $chPath)) { throw "Khong thay channels.json: $chPath" }

$root = Get-Content -LiteralPath $chPath -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not (Test-HasProp $root 'channels')) {
    throw "channels.json sai dinh dang: thieu mang 'channels'."
}

function Save-Channels {
    param($Obj, [string]$Path)
    $json = $Obj | ConvertTo-Json -Depth 12
    $tmp = "$Path.tmp"
    [System.IO.File]::WriteAllText($tmp, $json, (New-Object System.Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $tmp -Destination $Path -Force
}

if ($Off) {
    if (-not (Test-Path $backupPath)) {
        throw "Khong co file backup ($backupPath) — che do test chua tung duoc bat."
    }
    $bk = Get-Content -LiteralPath $backupPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $map = @{}
    foreach ($e in $bk.saved) { $map[$e.id] = $e.pollPolicy }

    $n = 0
    foreach ($c in $root.channels) {
        if ($map.ContainsKey($c.id)) {
            $c | Add-Member -NotePropertyName pollPolicy -NotePropertyValue $map[$c.id] -Force
            $n++
        }
    }
    if ($PSCmdlet.ShouldProcess($chPath, "Khoi phuc pollPolicy cho $n kenh")) {
        Save-Channels -Obj $root -Path $chPath
        Remove-Item -LiteralPath $backupPath -Force
        Write-Host "  OK  Da tra lai cau hinh goc cho $n kenh. Che do test TAT." -ForegroundColor Green
    }
    return
}

# ─── -On (mac dinh) ─────────────────────────────────────────────────────────
if (Test-Path $backupPath) {
    Write-Host "  !!  Che do test da bat tu truoc — giu nguyen backup goc, khong ghi de." -ForegroundColor Yellow
} else {
    $saved = @()
    foreach ($c in $root.channels) {
        $pp = if (Test-HasProp $c 'pollPolicy') { $c.pollPolicy } else { '' }
        $saved += [pscustomobject]@{ id = $c.id; pollPolicy = $pp }
    }
    $bk = [pscustomobject]@{
        savedAt = (Get-Date).ToString('o')
        note    = 'pollPolicy goc truoc khi bat che do test hieu nang. Set-TestMode.ps1 -Off de khoi phuc.'
        saved   = $saved
    }
    if ($PSCmdlet.ShouldProcess($backupPath, 'Luu pollPolicy goc')) {
        Save-Channels -Obj $bk -Path $backupPath
        Write-Host "  OK  Da luu pollPolicy goc cua $($saved.Count) kenh." -ForegroundColor Green
    }
}

$turnedOn = 0; $already = 0; $skippedPaused = 0
foreach ($c in $root.channels) {
    $paused = (Test-HasProp $c 'paused') -and $c.paused
    if ($paused) { $skippedPaused++; continue }
    $pp = if (Test-HasProp $c 'pollPolicy') { $c.pollPolicy } else { '' }
    if ($pp -eq 'off') {
        $c | Add-Member -NotePropertyName pollPolicy -NotePropertyValue 'continuous' -Force
        $turnedOn++
    } else {
        $already++
    }
}

if ($PSCmdlet.ShouldProcess($chPath, "Bat $turnedOn kenh")) {
    Save-Channels -Obj $root -Path $chPath
}

Write-Host ""
Write-Host "  Che do TEST HIEU NANG: BAT" -ForegroundColor Green
Write-Host "    Vua bat them        : $turnedOn kenh (tu 'off' -> 'continuous')"
Write-Host "    Von da quet san     : $already kenh"
Write-Host "    Bo qua vi dang pause: $skippedPaused kenh"
Write-Host "    Tong dang quet      : $($turnedOn + $already) kenh"
Write-Host ""
Write-Host "  Tat di khi test xong :  .\Set-TestMode.ps1 -Off" -ForegroundColor Yellow
Write-Host ""
