# HyperClip Customer Package Builder
# ==================================
# Builds the production installer and creates a deliverable ZIP for the customer.
# Usage: .\build-customer-package.ps1 [-Version "1.0.0"] [-OutputDir ".\release"]
#
# Prerequisites:
#   - Node.js 20+ installed
#   - Git installed
#   - ~500MB disk space
#
# Output:
#   release/HyperClip-<version>-setup.exe   (NSIS installer)
#   release/HyperClip-<version>.zip        (portable ZIP for operator extraction)

param(
    [Parameter(Mandatory=$false)]
    [string]$Version = "1.0.0",

    [Parameter(Mandatory=$false)]
    [string]$OutputDir = "$PSScriptRoot\..\release",

    [Parameter(Mandatory=$false)]
    [switch]$SkipFFmpeg,

    [Parameter(Mandatory=$false)]
    [switch]$Sign
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

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

# ─── Step 0: Verify prerequisites ────────────────────────────────────────────
Write-Host ""
Write-Host "══════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  HyperClip Customer Package Builder v$Version" -ForegroundColor White
Write-Host "══════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

Write-Step "Step 0: Verifying prerequisites..."
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Err "Node.js not found. Please install Node.js 20+ from https://nodejs.org"
    exit 1
}
$nodeVersion = (node --version).Trim()
Write-Success "Node.js $nodeVersion"

$npm = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npm) {
    Write-Err "npm not found."
    exit 1
}
Write-Success "npm $($npm.Version)"

# Verify git
$git = Get-Command git -ErrorAction SilentlyContinue
if (-not $git) {
    Write-Warn "Git not found — skipping git status check"
} else {
    Write-Success "Git available"
}

# ─── Step 1: Clean previous build ────────────────────────────────────────────
Write-Step "Step 1: Cleaning previous build..."
$cleanDirs = @(
    "$root\dist",
    "$root\dist-electron",
    "$root\release",
    "$root\.next"
)
foreach ($d in $cleanDirs) {
    if (Test-Path $d) {
        Remove-Item -Recurse -Force $d -ErrorAction SilentlyContinue
        Write-Host "  Removed: $d" -ForegroundColor DarkGray
    }
}
Write-Success "Clean complete"

# ─── Step 2: TypeScript check ────────────────────────────────────────────────
Write-Step "Step 2: TypeScript check..."
$tsErrors = 0
$tsErrors += (npx tsc --noEmit 2>&1 | Where-Object { $_ -match "error TS" }).Count
$tsErrors += (npx tsc --noEmit -p electron/tsconfig.main.json 2>&1 | Where-Object { $_ -match "error TS" }).Count
$tsErrors += (npx tsc --noEmit -p electron/tsconfig.preload.json 2>&1 | Where-Object { $_ -match "error TS" }).Count
if ($tsErrors -gt 0) {
    Write-Err "TypeScript found $tsErrors error(s)"
    exit 1
}
Write-Success "TypeScript: 0 errors"

# ─── Step 3: Build Next.js ───────────────────────────────────────────────────
Write-Step "Step 3: Building Next.js..."
Push-Location $root
try {
    npm run build 2>&1 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
    if ($LASTEXITCODE -ne 0) { throw "Next.js build failed with exit code $LASTEXITCODE" }
} finally {
    Pop-Location
}
Write-Success "Next.js build complete"

# ─── Step 4: Build Electron ───────────────────────────────────────────────────
Write-Step "Step 4: Building Electron TypeScript..."
Push-Location $root
try {
    npx tsc -p electron/tsconfig.main.json 2>&1 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
    if ($LASTEXITCODE -ne 0) { throw "electron main TypeScript failed" }
    npx tsc -p electron/tsconfig.preload.json 2>&1 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
    if ($LASTEXITCODE -ne 0) { throw "electron preload TypeScript failed" }
} finally {
    Pop-Location
}
Write-Success "Electron TypeScript compile complete"

# ─── Step 5: Electron Builder ───────────────────────────────────────────────
Write-Step "Step 5: Building Electron installer..."
Write-Host "  FFmpeg will be downloaded automatically if not present (~177MB)" -ForegroundColor DarkGray

Push-Location $root
try {
    # Set version for electron-builder
    $env:VERSION = $Version
    npm run electron:build 2>&1 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
    if ($LASTEXITCODE -ne 0) { throw "electron:build failed with exit code $LASTEXITCODE" }
} finally {
    Pop-Location
    Remove-Item Env:VERSION -ErrorAction SilentlyContinue
}
Write-Success "Electron build complete"

# ─── Step 6: Verify output ────────────────────────────────────────────────────
Write-Step "Step 6: Verifying output..."
$installerPath = Get-ChildItem -Path "$root\release" -Filter "HyperClip-Setup-*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
$portableZip = Get-ChildItem -Path "$root\release" -Filter "HyperClip-portable.zip" -ErrorAction SilentlyContinue | Select-Object -First 1

if ($installerPath) {
    $installerSizeMB = [math]::Round($installerPath.Length / 1MB, 1)
    Write-Success "Installer: $($installerPath.Name) ($installerSizeMB MB)"
} else {
    Write-Err "Installer .exe not found in release/"
}

if ($portableZip) {
    $zipSizeMB = [math]::Round($portableZip.Length / 1MB, 1)
    Write-Success "Portable ZIP: $($portableZip.Name) ($zipSizeMB MB)"
}

# ─── Step 7: Create customer delivery package ─────────────────────────────────
Write-Step "Step 7: Creating customer delivery package..."
$pkgDir = "$OutputDir\HyperClip-$Version"
$customerZip = "$OutputDir\HyperClip-$Version.zip"

# Clean
if (Test-Path $pkgDir) { Remove-Item -Recurse -Force $pkgDir }
New-Item -ItemType Directory -Path $pkgDir -Force | Out-Null

# Copy installer
if ($installerPath) {
    Copy-Item $installerPath.FullName $pkgDir\
    Write-Host "  + Installer" -ForegroundColor DarkGray
}

# Copy portable ZIP
if ($portableZip) {
    Copy-Item $portableZip.FullName $pkgDir\
    Write-Host "  + Portable ZIP" -ForegroundColor DarkGray
}

# Copy templates
$templatesSrc = "$root\templates"
if (Test-Path $templatesSrc) {
    $templatesDst = Join-Path $pkgDir "templates"
    Copy-Item $templatesSrc $templatesDst -Recurse
    Write-Host "  + Templates (projects CSV)" -ForegroundColor DarkGray
}

# Copy customer-first-run.ps1
$cfScript = "$root\scripts\customer-first-run.ps1"
if (Test-Path $cfScript) {
    Copy-Item $cfScript $pkgDir\
    Write-Host "  + customer-first-run.ps1" -ForegroundColor DarkGray
}

# Create README for customer
$readmeContent = @"
# HyperClip Customer Package

## Included Files
- `HyperClip-Setup-X.X.X.exe` — NSIS Installer (recommended)
- `HyperClip-portable.zip` — Portable version (extract and run)
- `customer-first-run.ps1` — Setup script
- `templates/projects-template.csv` — GCP Projects CSV template

## Installation (Recommended: Installer)
1. Double-click `HyperClip-Setup-X.X.X.exe`
2. Follow the installer wizard
3. HyperClip will launch automatically

## Installation (Portable)
1. Extract `HyperClip-portable.zip` to any folder
2. Run `customer-first-run.ps1` to complete setup
3. Open the extracted folder and run HyperClip.exe

## Pre-Requisites
- Windows 10/11 (64-bit)
- NVIDIA GPU with NVENC support (RTX series recommended)
- Google account with YouTube access
- Google Cloud Platform projects (optional, for OAuth quota)

## Included Chrome Cookies
If your operator provided a `_hyperclip_cookies.zip`, extract it to the HyperClip-Data folder.

## Support
Contact your operator for technical support.
Generated: $(Get-Date -Format "yyyy-MM-dd HH:mm")
"@
$readmeContent | Out-File -FilePath "$pkgDir\README.md" -Encoding UTF8

# Create ZIP
Write-Host "  Compressing to $customerZip..." -ForegroundColor DarkGray
if (Test-Path $customerZip) { Remove-Item $customerZip -Force }
Compress-Archive -Path "$pkgDir\*" -DestinationPath $customerZip -Force
$finalZipSizeMB = [math]::Round((Get-Item $customerZip).Length / 1MB, 1)
Write-Success "Customer package: $(Split-Path $customerZip -Leaf) ($finalZipSizeMB MB)"

# ─── Summary ────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "══════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "  Build Complete!" -ForegroundColor White
Write-Host "══════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host ""
Write-Host "  Customer package: $customerZip" -ForegroundColor White
Write-Host "  Version: $Version" -ForegroundColor Gray
Write-Host ""
Write-Host "  Deliver to customer:" -ForegroundColor Cyan
Write-Host "    1. ZIP file at: $customerZip" -ForegroundColor White
Write-Host "    2. Cookies ZIP (if included by operator)" -ForegroundColor White
Write-Host "    3. GCP Projects CSV (if included by operator)" -ForegroundColor White
Write-Host ""
Write-Host "  Operator next steps:" -ForegroundColor Cyan
Write-Host "    1. Prepare customer cookies: run extract-cookies.js on operator machine" -ForegroundColor Gray
Write-Host "    2. Create GCP projects CSV using projects-template.csv" -ForegroundColor Gray
Write-Host "    3. Include cookies ZIP + projects CSV in customer delivery" -ForegroundColor Gray
Write-Host ""
