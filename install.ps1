# HyperClip One-Command Installer
# Run on Windows PowerShell:
#   powershell -ExecutionPolicy Bypass -Command "iex ((New-Object System.Net.WebClient).DownloadString('https://raw.githubusercontent.com/loopcompany/hyperclip/main/install.ps1'))"
#
# Or download and run locally:
#   irm https://raw.githubusercontent.com/loopcompany/hyperclip/main/install.ps1 | iex
#   irm https://bit.ly/hyperclip-install | iex
param(
    [string]$InstallPath = "$env:USERPROFILE\HyperClip",
    [string]$RepoUrl = "https://github.com/loopcompany/hyperclip.git"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Write-Step($msg) { Write-Host "[1/8] $msg" -ForegroundColor Cyan }
function Write-Success($msg) { Write-Host "  OK  $msg" -ForegroundColor Green }
function Write-Fail($msg) { Write-Host "  FAIL  $msg" -ForegroundColor Red }

# ── 1. Prerequisites ────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "=== HyperClip Installer ===" -ForegroundColor White
Write-Step "Kiểm tra prerequisites..."

$nodeOk = $false
if (Get-Command node -ErrorAction SilentlyContinue) {
    $v = node -v
    $nodeOk = $true
    Write-Success "Node.js $v"
}
if (-not $nodeOk) {
    Write-Host "  Installing Node.js 22..."
    $nodeUrl = "https://nodejs.org/dist/v22.16.0/node-v22.16.0-x64.msi"
    $nodeMsi = "$env:TEMP\node-setup.msi"
    Invoke-WebRequest -Uri $nodeUrl -OutFile $nodeMsi -UseBasicParsing
    Start-Process msiexec.exe -ArgumentList "/i `"$nodeMsi`" /quiet /norestart" -Wait -NoNewWindow
    Remove-Item $nodeMsi -Force
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "User") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "Machine")
    $nodeOk = $true
    Write-Success "Node.js installed"
}

$pnpmOk = $false
if (Get-Command pnpm -ErrorAction SilentlyContinue) {
    Write-Success "pnpm $(pnpm -v)"
    $pnpmOk = $true
}
if (-not $pnpmOk) {
    Write-Host "  Installing pnpm..."
    npm install -g pnpm --silent
    Write-Success "pnpm installed"
    $pnpmOk = $true
}

$gitOk = $false
if (Get-Command git -ErrorAction SilentlyContinue) {
    Write-Success "Git $(git --version | Select-Object -First 1)"
    $gitOk = $true
}
if (-not $gitOk) {
    Write-Fail "Git chua duoc cai dat. Tai Git o: https://git-scm.com/download/win"
    exit 1
}

# ── 2. Clone / Update repo ───────────────────────────────────────────────────────
Write-Step "Tai repo..."
$repoName = Split-Path $RepoUrl -Leaf -Resolve
if ($RepoUrl -match "https://github.com/") {
    $isGitHub = $true
}
if (Test-Path $InstallPath) {
    Write-Success "Thu muc da ton tai: $InstallPath"
    Set-Location $InstallPath
    if (Test-Path .git) {
        Write-Host "  Pulling latest changes..."
        git pull origin main 2>$null
        Write-Success "Updated"
    }
} else {
    git clone $RepoUrl $InstallPath --depth 1
    Set-Location $InstallPath
    Write-Success "Clone vao $InstallPath"
}

# ── 3. Install dependencies ──────────────────────────────────────────────────────
Write-Step "Cai dat dependencies (pnpm install)..."
pnpm install --silent 2>$null
if ($LASTEXITCODE -ne 0) { pnpm install }
Write-Success "Dependencies ready"

# ── 4. Setup FFmpeg ─────────────────────────────────────────────────────────────
Write-Step "Cai dat FFmpeg (CUDA build)..."
$ffmpegBin = "resources\ffmpeg\bin\ffmpeg.exe"
if (Test-Path $ffmpegBin) {
    Write-Success "FFmpeg da co san"
} else {
    $ffmpegZip = "$env:TEMP\ffmpeg-7.1-full_build.zip"
    $ffmpegUrl = "https://github.com/GyanD/codexffmpeg/releases/download/7.1/ffmpeg-7.1-full_build.zip"
    Write-Host "  Downloading FFmpeg (~177MB)..."
    Invoke-WebRequest -Uri $ffmpegUrl -OutFile $ffmpegZip -UseBasicParsing
    Expand-Archive -Path $ffmpegZip -DestinationPath "resources\ffmpeg" -Force
    Move-Item "resources\ffmpeg\ffmpeg-7.1-full_build\bin\*" "resources\ffmpeg\bin\" -Force
    Remove-Item $ffmpegZip -Force
    Remove-Item "resources\ffmpeg\ffmpeg-7.1-full_build" -Recurse -Force -ErrorAction SilentlyContinue
    New-Item "resources\ffmpeg\bin" -ItemType Directory -Force | Out-Null
    Move-Item "resources\ffmpeg\ffmpeg-7.1-full_build\bin\*" "resources\ffmpeg\bin\" -Force -ErrorAction SilentlyContinue
    Write-Success "FFmpeg CUDA ready"
}

# ── 5. Setup yt-dlp ────────────────────────────────────────────────────────────
Write-Step "Cai dat yt-dlp..."
$ytDlpBin = "resources\yt-dlp\yt-dlp.exe"
if (Test-Path $ytDlpBin) {
    Write-Success "yt-dlp da co san"
} else {
    New-Item "resources\yt-dlp" -ItemType Directory -Force | Out-Null
    Invoke-WebRequest -Uri "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe" -OutFile $ytDlpBin -UseBasicParsing
    Write-Success "yt-dlp ready"
}

# ── 6. Copy demo GCP projects ───────────────────────────────────────────────────
Write-Step "Cai dat GCP projects (30 projects)..."
$HYPERCLIP_DATA = "D:\HyperClip-Data"
if (-not (Test-Path "D:\")) {
    $largestDrive = Get-Volume | Where-Object { $_.DriveLetter -and $_.DriveType -eq 'Fixed' } | Sort-Object SizeRemaining -Descending | Select-Object -First 1
    if ($largestDrive) {
        $HYPERCLIP_DATA = "$($largestDrive.DriveLetter):\HyperClip-Data"
    } else {
        $HYPERCLIP_DATA = "C:\HyperClip-Data"
    }
}
$DEMO_PROJECTS_SRC = "$InstallPath\demo-data\projects"
$DEMO_PROJECTS_DST = "$HYPERCLIP_DATA\projects"
if (Test-Path $DEMO_PROJECTS_SRC) {
    if (-not (Test-Path $DEMO_PROJECTS_DST)) {
        New-Item $DEMO_PROJECTS_DST -ItemType Directory -Force | Out-Null
    }
    $count = 0
    Get-ChildItem $DEMO_PROJECTS_SRC -Directory | ForEach-Object {
        $dst = Join-Path $DEMO_PROJECTS_DST $_.Name
        if (-not (Test-Path $dst)) {
            Copy-Item $_.FullName $dst -Recurse
            $count++
        }
    }
    Write-Success "Da copy $count GCP projects vao $HYPERCLIP_DATA\projects"
    Write-Host "  (Neu may da co projects, cac project cu khong bi ghi de)"
} else {
    Write-Host "  Bo qua — khong co demo-data/projects/"
}

# ── 7. Build ────────────────────────────────────────────────────────────────────
Write-Step "Build Electron app..."
Write-Host "  (Co the mat 5-15 phut lan dau, chi mat 1-2 phut lan sau)"
node node_modules\.pnpm\typescript@6.0.3\node_modules\typescript\lib\tsc.js -p electron/tsconfig.main.json 2>$null
node node_modules\.pnpm\typescript@6.0.3\node_modules\typescript\lib\tsc.js -p electron/tsconfig.preload.json 2>$null

# Patch __dirname shim
$mainJs = "dist-electron\main.js"
if (Test-Path $mainJs) {
    $c = Get-Content $mainJs -Raw
    $c = $c -replace "const __dirname = .+;`n", ""
    $c = $c -replace "const __filename = .+;`n", ""
    Set-Content $mainJs $c
}

# Next.js build (ignore errors — SSR pages are fine)
node node_modules\next\dist\bin\next build 2>&1 | Out-Null

# Electron builder
npx electron-builder --win --config electron-builder.yml
Write-Success "Build xong"

# ── 8. Done ─────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "=== Xong! ===" -ForegroundColor Green
Write-Host ""

$exePath = "release\win-unpacked\HyperClip.exe"
if (Test-Path $exePath) {
    Write-Host "App:  $InstallPath\release\win-unpacked\HyperClip.exe" -ForegroundColor White
    Write-Host "Installer: $InstallPath\release\HyperClip-Setup-0.0.1.exe" -ForegroundColor White
    Write-Host "Portable zip: $InstallPath\release\HyperClip-portable.zip" -ForegroundColor White
    Write-Host ""
    Write-Host "Chay lenh nay de mo app:" -ForegroundColor Yellow
    Write-Host "  & `"$InstallPath\release\win-unpacked\HyperClip.exe`"" -ForegroundColor White
    Write-Host ""
    Write-Host "Hoac kich doi vao: $InstallPath\release\win-unpacked\HyperClip.exe" -ForegroundColor Gray
} else {
    Write-Fail "Build chua tao duoc HyperClip.exe"
    Write-Host "Kiem tra loi: $InstallPath\release\"
}

Write-Host ""
