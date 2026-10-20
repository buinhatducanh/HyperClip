# finish-patch.ps1
# ------------------------------------------------------------
# HyperClip Patch Finisher - run on the BUILD machine.
#
# Takes the freshly built hyperclip-tauri.exe, drops it into this
# kit's app/ tree, regenerates patch-manifest.json (sha256 + size
# for every file under app/), writes patch-version.json and zips
# everything into HyperClip-Patch-<timestamp>.zip ready to copy to
# the customer machine.
#
# Usage (from this kit folder, after building the exe):
#   powershell -ExecutionPolicy Bypass -File finish-patch.ps1 `
#     -ExePath ..\target\release\hyperclip-tauri.exe `
#     -GitHead abc1234
#
# ASCII ONLY in this file: it may ship without a BOM and Windows
# PowerShell 5.1 then reads it as CP1252 - non-ASCII breaks parsing.
# ------------------------------------------------------------

param(
    [Parameter(Mandatory=$true)][string]$ExePath,
    [string]$GitHead = "unknown",
    [string]$GitBranch = "pass-60-61-detect-3s",
    [string]$Note = "Nen pass-60-61 + pollIntervalStrict mac dinh BAT (nhip chay dung pollIntervalMs, WARN du bao can quota moi 10 phut, can HAN van lui 5 phut/nhip) + giu tiktok_helper.js va PollerPanel.qml cua ban fixall 28/08 de khong ghi de nguoc."
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Write-Ok([string]$msg)   { Write-Host "  OK  $msg" -ForegroundColor Green }
function Write-Fail([string]$msg) { Write-Host "  FAIL  $msg" -ForegroundColor Red }

$KitRoot = $PSScriptRoot
Write-Host ""
Write-Host "HyperClip Patch Finisher" -ForegroundColor Cyan
Write-Host "Kit root: $KitRoot" -ForegroundColor DarkGray

# -- 1. Validate the exe -------------------------------------

Write-Host "[1/5] Checking exe..." -ForegroundColor Cyan

if (-not (Test-Path -LiteralPath $ExePath)) {
    Write-Fail "Exe not found: $ExePath"
    exit 1
}
$exeItem = Get-Item -LiteralPath $ExePath
$exeMB = $exeItem.Length / 1MB
if ($exeItem.Length -lt 10MB -or $exeItem.Length -gt 80MB) {
    Write-Fail ("Exe size {0:F1} MB is outside the sane 10-80 MB range - wrong file? (release hyperclip-tauri.exe is ~18 MB)" -f $exeMB)
    exit 1
}

# The strict fix leaves the literal string pollIntervalStrict inside the
# binary (settings key + log lines). If it is absent, the exe was built
# WITHOUT pollIntervalStrict.patch applied - shipping it would change
# nothing on the customer machine.
$bytes = [System.IO.File]::ReadAllBytes($exeItem.FullName)
$text = [System.Text.Encoding]::ASCII.GetString($bytes)
if (-not $text.Contains("pollIntervalStrict")) {
    Write-Fail "Exe does NOT contain the pollIntervalStrict marker."
    Write-Host "  Apply pollIntervalStrict.patch to the source branch, rebuild, then rerun this script." -ForegroundColor Yellow
    exit 1
}
$bytes = $null
$text = $null
Write-Ok ("Exe looks right ({0:F1} MB, pollIntervalStrict marker present)" -f $exeMB)

# -- 2. Drop exe into the kit tree ---------------------------

Write-Host "[2/5] Placing exe into app/_internal/..." -ForegroundColor Cyan

$destExe = Join-Path $KitRoot "app\_internal\hyperclip-tauri.exe"
$destDir = Split-Path $destExe -Parent
if (-not (Test-Path -LiteralPath $destDir)) { New-Item -Path $destDir -ItemType Directory -Force | Out-Null }
Copy-Item -LiteralPath $exeItem.FullName -Destination $destExe -Force
Write-Ok "app/_internal/hyperclip-tauri.exe"

# -- 3. Regenerate patch-manifest.json -----------------------

Write-Host "[3/5] Building manifest (sha256 + size for every file under app/)..." -ForegroundColor Cyan

$appDir = Join-Path $KitRoot "app"
$files = Get-ChildItem -LiteralPath $appDir -Recurse -File | Sort-Object FullName
$entries = @()
foreach ($f in $files) {
    $rel = $f.FullName.Substring($KitRoot.Length).TrimStart('\', '/') -replace '\\', '/'
    $hash = (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash.ToLower()
    $entries += [pscustomobject]@{
        path   = $rel
        sha256 = $hash
        size   = [int64]$f.Length
    }
    Write-Host ("    {0}  ({1} bytes)" -f $rel, $f.Length) -ForegroundColor DarkGray
}

# Guard against a broken kit tree: an empty or short manifest would make
# apply-patch.ps1 report a vacuous "All 0 files verified" PASS.
if ($entries.Count -lt 3) {
    Write-Fail ("Manifest only has {0} file(s) - expected at least 3 (exe + tiktok_helper.js + PollerPanel.qml). Kit tree broken?" -f $entries.Count)
    exit 1
}
if (-not ($entries | Where-Object { $_.path -eq "app/_internal/hyperclip-tauri.exe" })) {
    Write-Fail "app/_internal/hyperclip-tauri.exe missing from manifest - exe copy failed?"
    exit 1
}

$builtAt = Get-Date -Format "yyyy-MM-ddTHH:mm:ssK"
$manifest = [pscustomobject]@{
    builtAt   = $builtAt
    version   = "0.1.0"
    gitBranch = $GitBranch
    gitHead   = $GitHead
    files     = $entries
}
$manifestPath = Join-Path $KitRoot "patch-manifest.json"
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
Write-Ok ("patch-manifest.json ({0} files)" -f $entries.Count)

# -- 4. Write patch-version.json -----------------------------

Write-Host "[4/5] Writing patch-version.json..." -ForegroundColor Cyan

$version = [pscustomobject]@{
    patchBuiltAt = $builtAt
    gitBranch    = $GitBranch
    gitDate      = $builtAt
    gitHead      = $GitHead
    version      = "0.1.0"
    note         = $Note
}
$versionPath = Join-Path $KitRoot "patch-version.json"
$version | ConvertTo-Json | Set-Content -LiteralPath $versionPath -Encoding UTF8
Write-Ok "patch-version.json"

# -- 5. Zip it -----------------------------------------------

Write-Host "[5/5] Zipping..." -ForegroundColor Cyan

# Name must match apply-patch.ps1's auto-detect filter: HyperClip-Patch-*.zip
$stamp = Get-Date -Format "yyyyMMddHHmmss"
$zipPath = Join-Path $KitRoot ("HyperClip-Patch-{0}.zip" -f $stamp)
$toZip = @(
    (Join-Path $KitRoot "app"),
    (Join-Path $KitRoot "apply-patch.ps1"),
    $manifestPath,
    $versionPath
)
Compress-Archive -LiteralPath $toZip -DestinationPath $zipPath -Force
$zipMB = (Get-Item -LiteralPath $zipPath).Length / 1MB
Write-Ok ("{0} ({1:F1} MB)" -f (Split-Path -LiteralPath $zipPath -Leaf), $zipMB)

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host " Patch ready!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Next, on the CUSTOMER machine:" -ForegroundColor White
Write-Host ("  1. Copy {0} into C:\Users\Administrator\Desktop\HyperClip\" -f (Split-Path -LiteralPath $zipPath -Leaf)) -ForegroundColor White
Write-Host "  2. Close HyperClip completely (tray icon too)." -ForegroundColor White
Write-Host "  3. Run: powershell -ExecutionPolicy Bypass -File apply-patch.ps1" -ForegroundColor White
Write-Host "  4. Start HyperClip and check the log for:" -ForegroundColor White
Write-Host "     [Poller] pollIntervalStrict=true" -ForegroundColor White
Write-Host ""
