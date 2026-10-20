# apply-source-edits.ps1
# ------------------------------------------------------------
# Applies the pollIntervalStrict change to the Rust SOURCE on the
# BUILD MACHINE - without git. Same edits as pollIntervalStrict.patch.
#
# DO NOT RUN THIS ON THE CUSTOMER MACHINE. It edits source code;
# the customer machine has no source and needs no git. There, you
# only run apply-patch.ps1 on the finished zip.
#
# Usage (from this kit folder):
#   powershell -ExecutionPolicy Bypass -File apply-source-edits.ps1 -RepoRoot C:\path\to\hyperclip-repo
#   ... -CheckOnly     # verify the anchors only, write nothing
#
# It edits exactly two files:
#   <repo>\crates\hyperclip_ipc\src\poller.rs
#   <repo>\src-tauri\src\commands.rs
# (also finds them under <repo>\source\... automatically)
#
# Safe by design: every anchor must occur EXACTLY ONCE; all 6 edits are
# computed in memory first and nothing is written unless all 6 succeed;
# both files are backed up as <name>.bak-<timestamp> BEFORE either write,
# and a failed second write rolls the first one back. Re-running is safe:
# it detects an already-applied tree, and refuses to touch a HALF-applied
# one (which would compile but ignore the setting).
#
# ASCII ONLY in this file (Windows PowerShell 5.1 reads a BOM-less
# script as CP1252). The Vietnamese code text lives in fragments\*.txt,
# which are read explicitly as UTF-8.
# ------------------------------------------------------------

param(
    [string]$RepoRoot = "",
    [string]$PollerPath = "",
    [string]$CommandsPath = "",
    [switch]$CheckOnly
)

$ErrorActionPreference = "Stop"

function Write-Ok([string]$msg)   { Write-Host "  OK  $msg" -ForegroundColor Green }
function Write-Fail([string]$msg) { Write-Host "  FAIL  $msg" -ForegroundColor Red }

$KitRoot = $PSScriptRoot
$FragDir = Join-Path $KitRoot "fragments"
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Read-Utf8([string]$path) {
    # Deliberately NOT File::ReadAllText(path, encoding): that enables BOM
    # sniffing, which silently swallows a UTF-8 BOM (the write side cannot
    # put it back) and silently re-decodes a UTF-16 file. Decode by hand so
    # a BOM survives as a leading U+FEFF and round-trips byte for byte.
    $bytes = [System.IO.File]::ReadAllBytes($path)
    if ($bytes.Length -ge 2 -and
        (($bytes[0] -eq 0xFF -and $bytes[1] -eq 0xFE) -or ($bytes[0] -eq 0xFE -and $bytes[1] -eq 0xFF))) {
        throw "$path is UTF-16 encoded; this patcher only handles UTF-8 sources."
    }
    $enc = New-Object System.Text.UTF8Encoding($false, $true)
    return $enc.GetString($bytes)
}

function Count-Occurrence([string]$haystack, [string]$needle) {
    if ([string]::IsNullOrEmpty($needle)) {
        # An empty needle would spin forever below (IndexOf always returns 0).
        throw "empty anchor - a fragment file is 0 bytes; re-extract the kit."
    }
    $n = 0
    $i = $haystack.IndexOf($needle, [System.StringComparison]::Ordinal)
    while ($i -ge 0) {
        $n++
        $i = $haystack.IndexOf($needle, $i + $needle.Length, [System.StringComparison]::Ordinal)
    }
    return $n
}

function Replace-First([string]$haystack, [string]$needle, [string]$with) {
    $i = $haystack.IndexOf($needle, [System.StringComparison]::Ordinal)
    if ($i -lt 0) { throw "anchor not found" }
    return $haystack.Substring(0, $i) + $with + $haystack.Substring($i + $needle.Length)
}

Write-Host ""
Write-Host "HyperClip source patcher - pollIntervalStrict" -ForegroundColor Cyan
Write-Host "(BUILD machine only - never run this on the customer machine)" -ForegroundColor DarkGray

if (-not (Test-Path -LiteralPath $FragDir)) {
    Write-Fail "fragments\ folder missing next to this script - extract the whole kit, not just the .ps1"
    exit 1
}

# -- 1. Locate the two source files --------------------------

Write-Host "[1/4] Locating source files..." -ForegroundColor Cyan

if (-not $RepoRoot) { $RepoRoot = (Get-Location).Path }

function Find-Source([string]$explicit, [string]$relative, [string]$leaf) {
    if ($explicit) {
        if (-not (Test-Path -LiteralPath $explicit)) { throw "Not found: $explicit" }
        return (Resolve-Path -LiteralPath $explicit).ProviderPath
    }
    foreach ($base in @($RepoRoot, (Join-Path $RepoRoot "source"))) {
        $p = Join-Path $base $relative
        if (Test-Path -LiteralPath $p) { return (Resolve-Path -LiteralPath $p).ProviderPath }
    }
    # Last resort: search the tree (bounded to this repo root)
    $hits = @(Get-ChildItem -LiteralPath $RepoRoot -Recurse -File -Filter $leaf -ErrorAction SilentlyContinue |
              Where-Object { $_.FullName -like "*$($relative -replace '/','\')" })
    if ($hits.Count -eq 1) { return $hits[0].FullName }
    if ($hits.Count -gt 1) {
        throw "Found $($hits.Count) copies of $relative under $RepoRoot - pass -PollerPath / -CommandsPath explicitly"
    }
    throw "Could not find $relative under $RepoRoot (pass -RepoRoot or -PollerPath / -CommandsPath)"
}

try {
    $srcPaths = @{
        poller   = Find-Source $PollerPath   "crates\hyperclip_ipc\src\poller.rs" "poller.rs"
        commands = Find-Source $CommandsPath "src-tauri\src\commands.rs"          "commands.rs"
    }
} catch {
    Write-Fail $_.Exception.Message
    exit 1
}
Write-Ok "poller.rs   : $($srcPaths.poller)"
Write-Ok "commands.rs : $($srcPaths.commands)"

# -- 2. Read + idempotence check -----------------------------

Write-Host "[2/4] Reading files..." -ForegroundColor Cyan

$texts = @{}
$hadCrlf = @{}
$already = @()
foreach ($k in @("poller", "commands")) {
    try {
        $raw = Read-Utf8 $srcPaths[$k]
    } catch {
        Write-Fail $_.Exception.Message
        exit 1
    }
    $hadCrlf[$k] = $raw.Contains("`r`n")
    $texts[$k] = $raw.Replace("`r`n", "`n")
    if ($texts[$k].Contains("poll_interval_strict")) { $already += $k }
}

# Check BOTH files before deciding. Exiting on the first match would hide a
# half-applied tree: poller.rs alone still compiles, but nothing ever reads
# the pollIntervalStrict setting (that code lives in commands.rs), so the
# operator would ship an exe that silently ignores it.
if ($already.Count -eq 2) {
    Write-Host ""
    Write-Ok "Both files already contain poll_interval_strict - the change is ALREADY APPLIED."
    Write-Host "  Nothing to do. Build the exe and run finish-patch.ps1." -ForegroundColor Yellow
    # Exit 3, not 0: patch_s1.ps1 uses this to tell "I just changed the
    # sources" (0) from "they were already patched" (3). Only the first case
    # requires cargo to produce a freshly linked exe.
    exit 3
}
if ($already.Count -eq 1) {
    $done = $already[0]
    $todo = @("poller", "commands") | Where-Object { $_ -ne $done }
    Write-Host ""
    Write-Fail "HALF-APPLIED TREE: $done is patched but $todo is not."
    Write-Host "  An exe built from this tree would COMPILE but silently ignore the setting." -ForegroundColor Yellow
    Write-Host "  Fix it one of these ways, then rerun:" -ForegroundColor Yellow
    Write-Host "    a) restore $($srcPaths[$done]) from its newest .bak-* backup, or" -ForegroundColor Yellow
    Write-Host "    b) apply the $todo fragments by hand (fragments\05-*, fragments\06-* for commands;" -ForegroundColor Yellow
    Write-Host "       fragments\01-* .. 04-* for poller)." -ForegroundColor Yellow
    exit 1
}
Write-Ok "both files clean (change not applied yet)"

# -- 3. Apply every op in memory -----------------------------

Write-Host "[3/4] Applying 6 edits (in memory)..." -ForegroundColor Cyan

$planPath = Join-Path $FragDir "plan.json"
$plan = Get-Content -LiteralPath $planPath -Raw | ConvertFrom-Json

$applied = 0
foreach ($op in $plan) {
    $anchor  = (Read-Utf8 (Join-Path $FragDir ($op.name + ".anchor.txt"))).Replace("`r`n", "`n")
    $payload = (Read-Utf8 (Join-Path $FragDir ($op.name + ".payload.txt"))).Replace("`r`n", "`n")
    $k = $op.file
    $n = Count-Occurrence $texts[$k] $anchor
    if ($n -ne 1) {
        Write-Host ""
        Write-Fail "$($op.name): anchor occurs $n time(s) in $($srcPaths[$k]) - expected exactly 1."
        Write-Host "  Your branch changed that region. Nothing was written." -ForegroundColor Yellow
        Write-Host "  Apply this one by hand: see fragments\$($op.name).anchor.txt (find)" -ForegroundColor Yellow
        Write-Host "  and fragments\$($op.name).payload.txt (insert after / replace with)." -ForegroundColor Yellow
        Write-Host "  kind = $($op.kind)" -ForegroundColor Yellow
        exit 1
    }
    if ($op.kind -eq "insert_after") {
        $texts[$k] = Replace-First $texts[$k] $anchor ($anchor + $payload)
    } else {
        $texts[$k] = Replace-First $texts[$k] $anchor $payload
    }
    $applied++
    Write-Ok "$($op.name)  [$($op.kind)]"
}

if ($applied -ne 6) {
    Write-Fail "Expected 6 edits, applied $applied - kit incomplete. Nothing was written."
    exit 1
}

if ($CheckOnly) {
    Write-Host ""
    Write-Ok "CheckOnly: all 6 anchors matched. Nothing written."
    exit 0
}

# -- 4. Backup + write ---------------------------------------

Write-Host "[4/4] Writing files..." -ForegroundColor Cyan

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"

# Back BOTH files up first, then write. If the second write fails (file
# locked by an editor or AV, read-only, disk full), restore whatever was
# already written - a half-applied tree compiles but ignores the setting.
$backups = @{}
try {
    foreach ($k in @("poller", "commands")) {
        $backups[$k] = "$($srcPaths[$k]).bak-$stamp"
        Copy-Item -LiteralPath $srcPaths[$k] -Destination $backups[$k] -Force
    }
} catch {
    Write-Fail "Could not create backups: $($_.Exception.Message)"
    Write-Host "  Nothing was written." -ForegroundColor Yellow
    exit 1
}

$written = @()
try {
    foreach ($k in @("poller", "commands")) {
        $path = $srcPaths[$k]
        $out = $texts[$k]
        if ($hadCrlf[$k]) { $out = $out.Replace("`n", "`r`n") }
        [System.IO.File]::WriteAllText($path, $out, $Utf8NoBom)
        $written += $k
        Write-Ok "$([System.IO.Path]::GetFileName($path))  (backup: $([System.IO.Path]::GetFileName($backups[$k])))"
    }
} catch {
    Write-Host ""
    Write-Fail "Write failed: $($_.Exception.Message)"
    foreach ($k in $written) {
        try {
            Copy-Item -LiteralPath $backups[$k] -Destination $srcPaths[$k] -Force
            Write-Host "  Rolled back $([System.IO.Path]::GetFileName($srcPaths[$k]))" -ForegroundColor Yellow
        } catch {
            Write-Fail "ROLLBACK FAILED for $($srcPaths[$k]) - restore it by hand from $($backups[$k])"
        }
    }
    exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host " Source updated!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Next:" -ForegroundColor White
Write-Host "  1. cargo build --release --bin hyperclip-tauri" -ForegroundColor White
Write-Host "  2. powershell -ExecutionPolicy Bypass -File finish-patch.ps1 -ExePath <repo>\target\release\hyperclip-tauri.exe" -ForegroundColor White
Write-Host "  3. Copy the produced HyperClip-Patch-*.zip to the customer machine." -ForegroundColor White
Write-Host ""

# Explicit, so patch_s1.ps1 never has to infer the "just patched" code.
exit 0
