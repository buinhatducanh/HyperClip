# HyperClip Customer First-Run Setup
# ===================================
# Run this ONCE on the customer's machine after extracting the ZIP.
# This script:
#   1. Locates the HyperClip-Data folder
#   2. Sets the HYPERCLIP_DATA_DIR environment variable persistently
#   3. Optionally clones cookies from an existing Chrome profile
#   4. Verifies the setup

param(
    [Parameter(Mandatory=$false)]
    [switch]$SkipEnvSetup,

    [Parameter(Mandatory=$false)]
    [switch]$SkipCookieClone,

    [Parameter(Mandatory=$false)]
    [switch]$AutoDetect,

    [Parameter(Mandatory=$false)]
    [string]$DataDir = "",

    [Parameter(Mandatory=$false)]
    [string]$HyperClipExePath = ""
)

$ErrorActionPreference = "Continue"

function Write-Step($msg) {
    Write-Host ""
    Write-Host ">>> $msg" -ForegroundColor Cyan
}

function Write-Success($msg) {
    Write-Host "[OK] $msg" -ForegroundColor Green
}

function Write-Warn($msg) {
    Write-Host "[WARN] $msg" -ForegroundColor Yellow
}

function Write-Err($msg) {
    Write-Host "[ERR] $msg" -ForegroundColor Red
}

function Find-HyperClipExe {
    $paths = @(
        # Common install locations
        "$env:LOCALAPPDATA\HyperClip\HyperClip.exe",
        "$env:APPDATA\HyperClip\HyperClip.exe",
        "$env:ProgramFiles\HyperClip\HyperClip.exe",
        "C:\HyperClip\HyperClip.exe",
        "D:\HyperClip\HyperClip.exe",
        # Dev / repo build
        "D:\LOOP_COMPANY\HyperClip\dist\HyperClip.exe",
        "D:\LOOP_COMPANY\HyperClip\out\HyperClip.exe",
        # Current dir
        ".\HyperClip.exe",
        "..\HyperClip.exe"
    )
    foreach ($p in $paths) {
        if (Test-Path $p) { return (Resolve-Path $p).Path }
    }

    # Search for it
    Write-Warn "HyperClip.exe not found in common locations."
    $searchDirs = @("C:\", "D:\", $env:USERPROFILE)
    $search = $searchDirs | ForEach-Object {
        if ($_) {
            Get-ChildItem -Path $_ -Filter "HyperClip.exe" -Recurse -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -notmatch "\\node_modules\\|\\.git\\|\\AppData\\Roaming\\npm\\" }
        }
    } | Select-Object -First 5 -ExpandProperty FullName

    if ($search) {
        Write-Host "  Found:" -ForegroundColor Yellow
        $search | ForEach-Object { Write-Host "    $_" -ForegroundColor Gray }
        return $null
    }
    return $null
}

function Find-DataDir {
    param([string]$hint = "")

    if ($hint -and (Test-Path $hint)) { return $hint }

    # Common locations relative to script
    $scriptDir = ""
    try {
        $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    }
    catch { }
    if ($scriptDir) {
        $relative = @(
            Join-Path $scriptDir "HyperClip-Data",
            Join-Path $scriptDir "..\HyperClip-Data",
            Join-Path $scriptDir "..\..\HyperClip-Data",
            Join-Path $scriptDir "data\HyperClip-Data"
        )
        foreach ($r in $relative) {
            if ($r -and (Test-Path $r)) { return (Resolve-Path $r).Path }
        }
    }

    # Search for HyperClip-Data
    $searchDirs = @("C:\", "D:\", $env:USERPROFILE, $env:LOCALAPPDATA)
    $search = $searchDirs | ForEach-Object {
        if ($_) {
            Get-ChildItem -Path $_ -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -eq "HyperClip-Data" }
        }
    } | Select-Object -First 3 -ExpandProperty FullName

    if ($search) {
        Write-Host "  Found HyperClip-Data at:" -ForegroundColor Yellow
        $search | ForEach-Object { Write-Host ("    " + $_) -ForegroundColor Gray }
        return $null
    }
    return $null
}

function Set-EnvVarPersistently($name, $value) {
    try {
        [System.Environment]::SetEnvironmentVariable($name, $value, [System.EnvironmentVariableTarget]::User)
        # Also set for current session
        Set-Item -Path ("Env:" + $name) -Value $value -ErrorAction SilentlyContinue
        Write-Success "Environment variable set: $name = $value"
        return $true
    }
    catch {
        Write-Err "Failed to set environment variable: $_"
        return $false
    }
}

function Clone-Cookies-ToDataDir($dataDir) {
    $profilesDir = Join-Path $dataDir "chrome-profiles"

    # Find user's Chrome Default profile cookies
    $chromeDefaultCookies = "$env:LOCALAPPDATA\Google\Chrome\User Data\_hyperclip_cookies.json"
    $chromeDefaultCookiesAlt = Join-Path $env:LOCALAPPDATA "Google\Chrome\User Data\Default\_hyperclip_cookies.json"

    $sourceCookie = $null
    if (Test-Path $chromeDefaultCookies) {
        $sourceCookie = $chromeDefaultCookies
    }
    elseif (Test-Path $chromeDefaultCookiesAlt) {
        $sourceCookie = $chromeDefaultCookiesAlt
    }

    if (!$sourceCookie) {
        Write-Warn "No _hyperclip_cookies.json found in Chrome User Data."
        Write-Host "  The customer package may not have included cookies." -ForegroundColor Gray
        Write-Host "  Cookies will need to be extracted from Chrome or re-cloned." -ForegroundColor Gray
        return $false
    }

    Write-Host "  Found source cookies: $sourceCookie" -ForegroundColor Gray

    # Copy to all 30 profiles in HyperClip-Data
    $sourceCookies = Get-Content $sourceCookie -Raw | ConvertFrom-Json
    $sourceCookiesJson = $sourceCookies | ConvertTo-Json -Depth 10

    for ($i = 1; $i -le 30; $i++) {
        $profileDir = Join-Path $profilesDir "profile-$i"
        if (!(Test-Path $profileDir)) {
            New-Item -ItemType Directory -Path $profileDir -Force | Out-Null
        }
        $destCookie = Join-Path $profileDir "_hyperclip_cookies.json"
        $sourceCookiesJson | Out-File -FilePath $destCookie -Encoding UTF8
    }

    Write-Success "Cookies cloned to $profilesDir"
    return $true
}

# ─── MAIN ──────────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "══════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  HyperClip Customer First-Run Setup" -ForegroundColor White
Write-Host "══════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# Step 1: Find HyperClip-Data
Write-Step "Step 1: Locating HyperClip-Data..."
if ($DataDir -and (Test-Path $DataDir)) {
    $dataDir = $DataDir
    Write-Success "Using provided path: $dataDir"
}
else {
    $dataDir = Find-DataDir $DataDir
    if (!$dataDir) {
        Write-Err "HyperClip-Data folder not found."
        Write-Host ""
        Write-Host "Please:" -ForegroundColor Yellow
        Write-Host "  1. Extract the ZIP to any location" -ForegroundColor White
        Write-Host "  2. Run this script again with -DataDir parameter:" -ForegroundColor White
        Write-Host "     .\customer-first-run.ps1 -DataDir 'C:\Path\To\HyperClip-Data'" -ForegroundColor Gray
        exit 1
    }
}

if (!(Test-Path $dataDir)) {
    Write-Err "HyperClip-Data not found at: $dataDir"
    exit 1
}

Write-Host "  Data directory: $dataDir" -ForegroundColor Gray
$appDir = Join-Path $dataDir "app"
if (Test-Path $appDir) {
    Write-Success "App directory found"
}
else {
    New-Item -ItemType Directory -Path $appDir -Force | Out-Null
    Write-Success "App directory created"
}

# Step 2: Set environment variable
if (!$SkipEnvSetup) {
    Write-Step "Step 2: Setting HYPERCLIP_DATA_DIR..."
    $ok = Set-EnvVarPersistently "HYPERCLIP_DATA_DIR" $dataDir

    if ($ok) {
        Write-Host ""
        Write-Host "  NOTE: You may need to restart applications" -ForegroundColor Yellow
        Write-Host "  for the environment variable to take effect." -ForegroundColor Yellow
    }
}

# Step 3: Clone cookies (if not already in HyperClip-Data)
if (!$SkipCookieClone) {
    Write-Step "Step 3: Setting up Chrome sessions..."

    $existingCookies = $null
    for ($i = 1; $i -le 30; $i++) {
        $p = Join-Path $dataDir "chrome-profiles\profile-$i\_hyperclip_cookies.json"
        if (Test-Path $p) {
            $existingCookies = $p
            break
        }
    }

    if ($existingCookies) {
        Write-Success "Cookies already present in HyperClip-Data ($existingCookies)"
    }
    else {
        Write-Host "  No cookies found in HyperClip-Data." -ForegroundColor Yellow
        Write-Host "  Attempting to clone from Chrome..." -ForegroundColor Gray
        Clone-Cookies-ToDataDir $dataDir
    }
}

# Step 4: Find HyperClip.exe
Write-Step "Step 4: Locating HyperClip.exe..."
$exePath = Find-HyperClipExe
if ($exePath) {
    Write-Success "Found: $exePath"
}
else {
    Write-Warn "HyperClip.exe not found yet."
    Write-Host "  You can specify it manually with:" -ForegroundColor Gray
    Write-Host "     .\customer-first-run.ps1 -HyperClipExePath 'C:\...\HyperClip.exe'" -ForegroundColor Gray
}

# Step 5: Summary
Write-Host ""
Write-Host "══════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "  Setup Summary" -ForegroundColor White
Write-Host "══════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host ""
Write-Host "  Data Directory : $dataDir" -ForegroundColor White
Write-Host "  App Folder    : $appDir" -ForegroundColor White
Write-Host "  HyperClip.exe : $(if($exePath){$exePath}else{'NOT FOUND - please install'})" -ForegroundColor $(if($exePath){'Green'}else{'Yellow'})
Write-Host ""
Write-Host "  Environment   : HYPERCLIP_DATA_DIR = $dataDir" -ForegroundColor White

# Create launch shortcut
if ($exePath -and $appDir) {
    Write-Step "Creating desktop shortcut..."
    $desktop = [Environment]::GetFolderPath("Desktop")
    $shortcutPath = Join-Path $desktop "HyperClip.lnk"

    try {
        $ws = New-Object -ComObject WScript.Shell
        $shortcut = $ws.CreateShortcut($shortcutPath)
        $shortcut.TargetPath = $exePath
        $shortcut.WorkingDirectory = Split-Path $exePath -Parent
        $shortcut.Description = "HyperClip - Auto video catcher for YouTube"
        $shortcut.Save()
        Write-Success "Desktop shortcut created: $shortcutPath"
    }
    catch {
        Write-Warn "Could not create shortcut: $_"
    }
}

Write-Host ""
Write-Host "NEXT STEPS:" -ForegroundColor Cyan
Write-Host "  1. RESTART your terminal / VS Code / any app that needs" -ForegroundColor White
Write-Host "     the HYPERCLIP_DATA_DIR environment variable" -ForegroundColor White
Write-Host ""
Write-Host "  2. Open HyperClip — Onboarding Wizard will guide you through setup" -ForegroundColor White
if ($exePath) {
    Write-Host "     Start: $exePath" -ForegroundColor Gray
}
Write-Host ""
Write-Host "  3. Follow the 5-step Onboarding Wizard to configure:" -ForegroundColor White
Write-Host "     - Chrome login for detection (Step 1)" -ForegroundColor Gray
Write-Host "     - Add YouTube channels to track (Step 2)" -ForegroundColor Gray
Write-Host "     - Add GCP projects for OAuth backup (Step 3, optional)" -ForegroundColor Gray
Write-Host "     - Configure detection speed (Step 4)" -ForegroundColor Gray
Write-Host ""
Write-Host "  After onboarding, HyperClip will auto-detect new videos 24/7." -ForegroundColor Green
Write-Host ""
Write-Host "  Done! HyperClip will auto-detect new videos every 5 seconds." -ForegroundColor Green
Write-Host ""
