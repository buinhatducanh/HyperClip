# build/apply-patch.ps1
# ─────────────────────────────────────────────────────────────
# HyperClip Patch Applier
# Automatically applies a HyperClip patch ZIP to the current installation.
#
# Usage (run from HyperClip root folder):
#   powershell -ExecutionPolicy Bypass -File apply-patch.ps1
#   powershell -ExecutionPolicy Bypass -File apply-patch.ps1 -PatchZip "HyperClip-Patch-20260708.zip"
#
# Features:
#   - Auto-detects latest patch ZIP in current directory
#   - Backs up existing app/ before overwriting
#   - Verifies patch integrity via manifest checksums
#   - Rolls back automatically on failure
#   - Cleans up old backups (keeps last 2)
# ─────────────────────────────────────────────────────────────

param(
    [string]$PatchZip = "",
    [switch]$SkipBackup,
    [switch]$Force,
    [int]$MaxBackups = 2
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# ── Helpers ──────────────────────────────────────────────────

function Write-Step([string]$step, [string]$msg) {
    Write-Host "[$step] $msg" -ForegroundColor Cyan
}

function Write-Ok([string]$msg) {
    Write-Host "  OK  $msg" -ForegroundColor Green
}

function Write-Fail([string]$msg) {
    Write-Host "  FAIL  $msg" -ForegroundColor Red
}

function Get-FileHash256([string]$path) {
    return (Get-FileHash -Path $path -Algorithm SHA256).Hash.ToLower()
}

function Stop-HyperClipProcesses {
    $names = @("hyperclip-tauri", "HyperClip", "hyperclip-launcher")
    foreach ($name in $names) {
        $procs = Get-Process -Name $name -ErrorAction SilentlyContinue
        if ($procs) {
            Write-Host "  Stopping $name..." -ForegroundColor Yellow
            $procs | Stop-Process -Force -ErrorAction SilentlyContinue
            Start-Sleep -Milliseconds 500
        }
    }
}

# ── Detect installation root ────────────────────────────────

$InstallRoot = $PSScriptRoot
# If the script is inside a patch ZIP extraction, the root is likely the parent
if (-not (Test-Path (Join-Path $InstallRoot "app"))) {
    # Try parent directory
    $parent = Split-Path $InstallRoot -Parent
    if (Test-Path (Join-Path $parent "app")) {
        $InstallRoot = $parent
    }
}

# Also support being run from the HyperClip root directly
if (-not (Test-Path (Join-Path $InstallRoot "app"))) {
    # Fresh install scenario - app/ will be created
    Write-Host "  Note: app/ directory not found. This appears to be a fresh install." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "     HyperClip Patch Applier           " -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Install root: $InstallRoot" -ForegroundColor DarkGray

# ── 1. Find patch ZIP ───────────────────────────────────────

Write-Step "1/6" "Finding patch ZIP..."

if ($PatchZip -and (Test-Path $PatchZip)) {
    $zipFile = (Resolve-Path $PatchZip).Path
} elseif ($PatchZip) {
    # Try relative to install root
    $candidate = Join-Path $InstallRoot $PatchZip
    if (Test-Path $candidate) {
        $zipFile = (Resolve-Path $candidate).Path
    } else {
        Write-Fail "Patch ZIP not found: $PatchZip"
        exit 1
    }
} else {
    # Auto-detect: find newest HyperClip-Patch-*.zip in install root
    $zips = Get-ChildItem -Path $InstallRoot -Filter "HyperClip-Patch-*.zip" -File |
            Sort-Object LastWriteTime -Descending
    if ($zips.Count -eq 0) {
        # Also check current working directory
        $zips = Get-ChildItem -Path (Get-Location) -Filter "HyperClip-Patch-*.zip" -File |
                Sort-Object LastWriteTime -Descending
    }
    if ($zips.Count -eq 0) {
        Write-Fail "No HyperClip-Patch-*.zip found in $InstallRoot"
        Write-Host "  Specify path: apply-patch.ps1 -PatchZip 'path\to\patch.zip'" -ForegroundColor Gray
        exit 1
    }
    $zipFile = $zips[0].FullName
    if ($zips.Count -gt 1) {
        Write-Host "  Found $($zips.Count) patch ZIPs, using newest:" -ForegroundColor Yellow
    }
}

$zipSize = (Get-Item $zipFile).Length / 1MB
Write-Ok "Using: $(Split-Path $zipFile -Leaf) ($($zipSize.ToString('F1')) MB)"

# ── 2. Stop running processes ───────────────────────────────

Write-Step "2/6" "Stopping HyperClip processes..."
Stop-HyperClipProcesses
Write-Ok "Processes stopped"

# ── 3. Backup current installation ──────────────────────────

Write-Step "3/6" "Backing up current installation..."

$appDir = Join-Path $InstallRoot "app"
$backupDir = $null

if ((Test-Path $appDir) -and -not $SkipBackup) {
    $backupTimestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $backupDir = Join-Path $InstallRoot "app.backup-$backupTimestamp"
    
    Write-Host "  Backing up app/ -> app.backup-$backupTimestamp/" -ForegroundColor Yellow
    Copy-Item -Path $appDir -Destination $backupDir -Recurse -Force
    Write-Ok "Backup created: app.backup-$backupTimestamp/"
} elseif ($SkipBackup) {
    Write-Host "  Skipping backup (-SkipBackup)" -ForegroundColor Yellow
} else {
    Write-Host "  No existing app/ to backup (fresh install)" -ForegroundColor Yellow
}

# ── 4. Extract and apply patch ──────────────────────────────

Write-Step "4/6" "Extracting and applying patch..."

$tempExtract = Join-Path $env:TEMP "hyperclip-patch-$([guid]::NewGuid().ToString('N').Substring(0,8))"

try {
    # Extract to temp first
    Expand-Archive -Path $zipFile -DestinationPath $tempExtract -Force

    # Determine the actual content root (may be nested in a folder)
    $extractedItems = Get-ChildItem $tempExtract
    $contentRoot = $tempExtract
    
    # If there's a single subfolder, use that as content root
    if ($extractedItems.Count -eq 1 -and $extractedItems[0].PSIsContainer) {
        $contentRoot = $extractedItems[0].FullName
    }

    # Count files to copy
    $filesToCopy = Get-ChildItem $contentRoot -Recurse -File
    $totalFiles = $filesToCopy.Count
    Write-Host "  Applying $totalFiles files..." -ForegroundColor Yellow

    # Copy all files, preserving directory structure
    $copied = 0
    foreach ($file in $filesToCopy) {
        $relativePath = $file.FullName.Substring($contentRoot.Length).TrimStart('\', '/')
        $destPath = Join-Path $InstallRoot $relativePath
        $destDir = Split-Path $destPath -Parent

        if (-not (Test-Path $destDir)) {
            New-Item -Path $destDir -ItemType Directory -Force | Out-Null
        }

        Copy-Item -Path $file.FullName -Destination $destPath -Force
        $copied++
    }

    Write-Ok "Applied $copied files"
} catch {
    Write-Fail "Extraction failed: $_"

    # Rollback if backup exists
    if ($backupDir -and (Test-Path $backupDir)) {
        Write-Host "  Rolling back from backup..." -ForegroundColor Yellow
        if (Test-Path $appDir) { Remove-Item $appDir -Recurse -Force }
        Rename-Item $backupDir $appDir
        Write-Ok "Rollback complete"
    }

    # Clean up temp
    if (Test-Path $tempExtract) { Remove-Item $tempExtract -Recurse -Force }
    exit 1
} finally {
    # Clean up temp extraction
    if (Test-Path $tempExtract) { Remove-Item $tempExtract -Recurse -Force }
}

# ── 5. Verify patch ─────────────────────────────────────────

Write-Step "5/6" "Verifying patch..."

$verifyOk = $true
$manifestPath = Join-Path $InstallRoot "patch-manifest.json"
$versionPath = Join-Path $InstallRoot "patch-version.json"

# Check patch-version.json
if (Test-Path $versionPath) {
    try {
        $versionInfo = Get-Content $versionPath -Raw | ConvertFrom-Json
        Write-Host "  Patch version:" -ForegroundColor DarkGray
        Write-Host "    Git:   $($versionInfo.gitHead) ($($versionInfo.gitBranch))" -ForegroundColor DarkGray
        Write-Host "    Built: $($versionInfo.patchBuiltAt)" -ForegroundColor DarkGray
    } catch {
        Write-Host "  Warning: Could not parse patch-version.json" -ForegroundColor Yellow
    }
} else {
    Write-Host "  No patch-version.json found (older patch format)" -ForegroundColor Yellow
}

# Verify checksums from manifest
if (Test-Path $manifestPath) {
    try {
        $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
        $totalChecks = 0
        $passedChecks = 0
        $failedFiles = @()

        foreach ($entry in $manifest.files) {
            $filePath = Join-Path $InstallRoot $entry.path
            $totalChecks++

            if (-not (Test-Path $filePath)) {
                $failedFiles += "MISSING: $($entry.path)"
                continue
            }

            $actualHash = Get-FileHash256 $filePath
            if ($actualHash -eq $entry.sha256) {
                $passedChecks++
            } else {
                $failedFiles += "HASH MISMATCH: $($entry.path)"
            }
        }

        if ($failedFiles.Count -gt 0) {
            Write-Host "  Verification: $passedChecks/$totalChecks passed" -ForegroundColor Yellow
            foreach ($f in $failedFiles) {
                Write-Host "    - $f" -ForegroundColor Red
            }
            $verifyOk = $false
        } else {
            Write-Ok "All $totalChecks files verified (SHA256)"
        }
    } catch {
        Write-Host "  Warning: Could not parse patch-manifest.json: $_" -ForegroundColor Yellow
    }
} else {
    Write-Host "  No patch-manifest.json (checksum verification skipped)" -ForegroundColor Yellow
    
    # Fallback: verify critical files exist
    $criticalFiles = @(
        "app\HyperClip.exe",
        "app\_internal\hyperclip-tauri.exe"
    )
    foreach ($cf in $criticalFiles) {
        $cfPath = Join-Path $InstallRoot $cf
        if (Test-Path $cfPath) {
            Write-Host "  + $cf" -ForegroundColor Green
        } else {
            Write-Host "  x $cf MISSING" -ForegroundColor Red
            $verifyOk = $false
        }
    }
}

# Rollback on verification failure (unless forced)
if (-not $verifyOk -and -not $Force) {
    Write-Fail "Verification failed!"
    if ($backupDir -and (Test-Path $backupDir)) {
        Write-Host "  Rolling back from backup..." -ForegroundColor Yellow
        if (Test-Path $appDir) { Remove-Item $appDir -Recurse -Force }
        Rename-Item $backupDir $appDir
        Write-Ok "Rollback complete. Use -Force to skip verification."
    }
    exit 1
}

# ── 6. Cleanup old backups ──────────────────────────────────

Write-Step "6/6" "Cleaning up old backups..."

$backups = Get-ChildItem -Path $InstallRoot -Filter "app.backup-*" -Directory |
           Sort-Object Name -Descending

if ($backups.Count -gt $MaxBackups) {
    $toRemove = $backups | Select-Object -Skip $MaxBackups
    foreach ($old in $toRemove) {
        Write-Host "  Removing old backup: $($old.Name)" -ForegroundColor Yellow
        Remove-Item $old.FullName -Recurse -Force
    }
    Write-Ok "Kept $MaxBackups most recent backups"
} else {
    Write-Ok "No cleanup needed ($($backups.Count) backups)"
}

# ── Done ─────────────────────────────────────────────────────

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "     Patch Applied Successfully!       " -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "You can now start HyperClip." -ForegroundColor White
Write-Host ""
