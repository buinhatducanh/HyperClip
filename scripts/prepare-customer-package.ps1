# HyperClip Customer Package Builder
# =================================
# Run this script on YOUR machine (the operator) AFTER you've logged into Chrome.
# This script extracts your cookies, clones sessions, and packages everything
# into a distributable .zip that the customer can extract and run immediately.
#
# PREREQUISITES:
#   - Node.js installed (for sql.js cookie extraction)
#   - Chrome CLOSED before running
#   - You must be logged into YouTube in Chrome
#
# USAGE:
#   .\prepare-customer-package.ps1 -CustomerName "AcmeCorp"
#
# Full options:
#   .\prepare-customer-package.ps1 -CustomerName "AcmeCorp" -OAuthTokensSource "D:\HyperClip-Data\app\oauth_tokens.json" -ChannelsSource "D:\HyperClip-Data\app\channels.json"

param(
    [Parameter(Mandatory=$true)]
    [string]$CustomerName,

    [Parameter(Mandatory=$false)]
    [string]$ChromeProfilePath = "",

    [Parameter(Mandatory=$false)]
    [string]$OutputDir = ".\customer-packages",

    [Parameter(Mandatory=$false)]
    [string]$OAuthTokensSource = "",

    [Parameter(Mandatory=$false)]
    [string]$ChannelsSource = "",

    [Parameter(Mandatory=$false)]
    [int]$SessionCount = 30
)

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

# Helpers
function step($msg) { Write-Host ""; Write-Host (">>> " + $msg) -ForegroundColor Cyan }
function ok($msg) { Write-Host ("[OK] " + $msg) -ForegroundColor Green }
function warn($msg) { Write-Host ("[WARN] " + $msg) -ForegroundColor Yellow }
function err($msg) { Write-Host ("[ERR] " + $msg) -ForegroundColor Red }
function mkdir_p($dir) { if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null } }

# Extract cookies via Node.js engine
function Extract-Cookies-viaNode($profilePath) {
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    $extractScript = Join-Path $scriptDir "extract-cookies.js"
    if (!(Test-Path $extractScript)) {
        err "extract-cookies.js not found at: $extractScript"
        return $null
    }

    $nodeArgs = @($extractScript)
    if ($profilePath) { $nodeArgs += @("--profile", $profilePath) }

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "node"
    $psi.Arguments = ($nodeArgs | ForEach-Object { "'" + $_ + "'" }) -join " "
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true

    $proc = New-Object System.Diagnostics.Process
    $proc.StartInfo = $psi
    $proc.Start() | Out-Null
    $stdout = $proc.StandardOutput.ReadToEnd()
    $stderr = $proc.StandardError.ReadToEnd()
    $proc.WaitForExit()

    if ($proc.ExitCode -ne 0) {
        err ("Cookie extraction failed (exit " + $proc.ExitCode + ")")
        if ($stderr) { Write-Host ("  " + $stderr) -ForegroundColor Red }
        return $null
    }

    try {
        $result = $stdout | ConvertFrom-Json
        if ($result.success) {
            $sid = $result.cookies.SAPISID
            $psd = $result.cookies.PSID
            $sidDisplay = $sid.Substring(0, [Math]::Min(6, $sid.Length))
            $psdDisplay = $psd.Substring(0, [Math]::Min(4, $psd.Length))
            ok ("Cookies extracted: SAPISID=" + $sidDisplay + "... PSID=" + $psdDisplay + "... SOCS=" + $result.cookies.socs)
            return $result.cookies
        }
        else {
            err ("Cookie extraction failed: " + $result.error)
            return $null
        }
    }
    catch {
        err ("Failed to parse extraction output: " + $_)
        return $null
    }
}

# Clone cookies to all 30 HyperClip profile directories
function Clone-Cookies-ToProfiles($cookies, $hyperClipDataDir) {
    step ("Cloning Session 1 cookies to all " + $SessionCount + " profiles...")
    $profilesDir = Join-Path $hyperClipDataDir "chrome-profiles"
    $cookiesJson = $cookies | ConvertTo-Json -Depth 10
    $success = 0

    for ($i = 1; $i -le $SessionCount; $i++) {
        $profileDir = Join-Path $profilesDir ("profile-" + $i)
        if (!(Test-Path $profileDir)) { mkdir_p $profileDir }
        $cookieFile = Join-Path $profileDir "_hyperclip_cookies.json"
        try {
            $cookiesJson | Out-File -FilePath $cookieFile -Encoding UTF8
            $success++
        }
        catch {
            warn ("Failed to write profile " + $i + " : " + $_)
        }
    }

    # Also write to Chrome User Data for Session 1 fast path
    $chromeDefault = $env:LOCALAPPDATA + "\Google\Chrome\User Data"
    try {
        $cookieFile = Join-Path $chromeDefault "_hyperclip_cookies.json"
        $cookiesJson | Out-File -FilePath $cookieFile -Encoding UTF8
    }
    catch { }

    ok ("Cloned to " + $success + "/" + $SessionCount + " profiles")
    return $success
}

# Build the customer package
function Build-CustomerPackage($cookies, $outputDir) {
    step ("Building customer package for: " + $CustomerName)
    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $safeName = $CustomerName -replace '[^\w\-]', ''
    $pkgName = "HyperClip-" + $safeName + "-" + $timestamp
    $pkgDir = Join-Path $outputDir $pkgName

    try {
        mkdir_p $outputDir
        mkdir_p $pkgDir
    }
    catch {
        err ("Cannot create output directory: " + $outputDir + " -- access denied")
        return $null
    }

    $dataRoot = Join-Path $pkgDir "HyperClip-Data"
    $appDir = Join-Path $dataRoot "app"
    $profilesDir = Join-Path $dataRoot "chrome-profiles"
    $downloadsDir = Join-Path $dataRoot "downloads"
    $blurDir = Join-Path $dataRoot "blur"
    $outputDir = Join-Path $dataRoot "output"
    $archivedDir = Join-Path $dataRoot "archived"
    mkdir_p $appDir
    mkdir_p $profilesDir
    mkdir_p $downloadsDir
    mkdir_p $blurDir
    mkdir_p $outputDir
    mkdir_p $archivedDir

    # Empty data files
    ok "Initializing data files..."
    '{"workspaces":[],"version":1}' | Out-File (Join-Path $appDir "workspaces.json") -Encoding UTF8
    '[]' | Out-File (Join-Path $appDir "channels.json") -Encoding UTF8
    '{}' | Out-File (Join-Path $appDir "seen-videos.json") -Encoding UTF8
    '[]' | Out-File (Join-Path $appDir "rendered.json") -Encoding UTF8

    # Copy OAuth tokens if provided
    if ($OAuthTokensSource -and (Test-Path $OAuthTokensSource)) {
        ok ("Including OAuth tokens from: " + $OAuthTokensSource)
        Copy-Item $OAuthTokensSource (Join-Path $appDir "oauth_tokens.json") -Force
        $cfgDir = [System.IO.Path]::GetDirectoryName($OAuthTokensSource)
        $cfgFile = Join-Path $cfgDir "oauth_config.json"
        $statsFile = Join-Path $cfgDir "token_stats.json"
        if (Test-Path $cfgFile) { Copy-Item $cfgFile (Join-Path $appDir "oauth_config.json") -Force }
        if (Test-Path $statsFile) { Copy-Item $statsFile (Join-Path $appDir "token_stats.json") -Force }
    }

    # Copy channels if provided
    if ($ChannelsSource -and (Test-Path $ChannelsSource)) {
        ok ("Including channels from: " + $ChannelsSource)
        Copy-Item $ChannelsSource (Join-Path $appDir "channels.json") -Force
    }

    # Clone cookies
    ok ("Cloning cookies to " + $SessionCount + " profiles...")
    Clone-Cookies-ToProfiles $cookies $dataRoot | Out-Null

    # Create profile directories
    for ($i = 1; $i -le $SessionCount; $i++) {
        $pd = Join-Path $profilesDir ("profile-" + $i)
        if (!(Test-Path $pd)) { mkdir_p $pd }
    }

    # Write README from template
    step "Writing README..."
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    $templatePath = Join-Path $scriptDir "README-template.md"
    $readmePath = Join-Path $pkgDir ("README-" + $CustomerName + ".md")
    if (Test-Path $templatePath) {
        $readme = Get-Content $templatePath -Raw
        $createdDate = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        $readme = $readme -replace '{{CUSTOMER_NAME}}', $CustomerName
        $readme = $readme -replace '{{CREATED_DATE}}', $createdDate
        $readme = $readme -replace '{{OPERATOR_USER}}', $env:USERNAME
        $readme = $readme -replace '{{OPERATOR_PC}}', $env:COMPUTERNAME
        $readme | Out-File -FilePath $readmePath -Encoding UTF8
        ok "README written"
    }

    # ZIP it
    step "Compressing package..."
    $zipPath = Join-Path $outputDir ($pkgName + ".zip")

    $sevenZip = @(
        ($env:ProgramFiles + "\7-Zip\7z.exe"),
        (${env:ProgramFiles(x86)} + "\7-Zip\7z.exe")
    )
    $zipExe = $sevenZip | Where-Object { Test-Path $_ } | Select-Object -First 1

    if ($zipExe) {
        ok "Using 7-Zip..."
        $null = & $zipExe a -tzip -mx=5 $zipPath ($pkgDir + "\*") 2>&1 | Out-Null
    }
    else {
        warn "7-Zip not found -- using PowerShell Compress-Archive (slower)..."
        Compress-Archive -Path ($pkgDir + "\*") -DestinationPath $zipPath -CompressionLevel Optimal -Force
    }

    if (Test-Path $zipPath) {
        $zipSize = (Get-Item $zipPath).Length
        if ($zipSize -gt 1GB) {
            $zipSizeStr = ("{0:N1} GB" -f ($zipSize / 1GB))
        }
        else {
            $zipSizeStr = ("{0:N1} MB" -f ($zipSize / 1MB))
        }
        ok ("Package created: " + $zipPath + " (" + $zipSizeStr + ")")
    }
    else {
        err "Failed to create ZIP"
        return $null
    }

    # Cleanup temp cookie from Chrome dir
    $chromeCookie = Join-Path $env:LOCALAPPDATA "Google\Chrome\User Data\_hyperclip_cookies.json"
    if (Test-Path $chromeCookie) {
        Remove-Item $chromeCookie -ErrorAction SilentlyContinue
    }

    ok ("Unpacked directory: " + $pkgDir)
    return $pkgDir
}

# ========================= MAIN =========================

Write-Host ""
Write-Host "==============================================================" -ForegroundColor DarkCyan
Write-Host "  HyperClip Customer Package Builder" -ForegroundColor Cyan
Write-Host "==============================================================" -ForegroundColor DarkCyan
Write-Host ""

# Check Node.js
step "Checking prerequisites..."
$nodeVersion = & node --version 2>$null
if ($LASTEXITCODE -ne 0 -or !$nodeVersion) {
    err "Node.js not found. Please install Node.js from https://nodejs.org"
    exit 1
}
ok ("Node.js: " + $nodeVersion)

# Check sql.js
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$sqlJsPath = Join-Path $scriptDir "..\node_modules\sql.js\dist\sql-wasm.wasm"
if (!(Test-Path $sqlJsPath)) {
    warn ("sql.js not found at: " + $sqlJsPath)
    Write-Host "  Make sure you're running from the HyperClip project directory." -ForegroundColor Yellow
    $confirm = Read-Host "Continue anyway? (y/n)"
    if ($confirm -ne "y" -and $confirm -ne "Y") { exit 0 }
}
else {
    ok ("sql.js: " + $sqlJsPath)
}

# Check Chrome
$chromeDefault = $env:LOCALAPPDATA + "\Google\Chrome\User Data"
if (Test-Path $chromeDefault) {
    ok ("Chrome profile: " + $chromeDefault)
}
else {
    warn ("Chrome User Data not found at: " + $chromeDefault)
}

# Step 1: Extract cookies
$profileArg = if ($ChromeProfilePath) { $ChromeProfilePath } else { "Chrome Default" }
step "Step 1: Extracting YouTube cookies..."
Write-Host ("  Profile: " + $profileArg) -ForegroundColor Gray
Write-Host "  IMPORTANT: Make sure Chrome is CLOSED before continuing!" -ForegroundColor Yellow
Write-Host ""
$confirm = Read-Host "Proceed with cookie extraction? (y/n)"
if ($confirm -ne "y" -and $confirm -ne "Y") {
    Write-Host "Cancelled." -ForegroundColor Yellow
    exit 0
}

$cookies = Extract-Cookies-viaNode $ChromeProfilePath
if (!$cookies) {
    err "Cookie extraction failed."
    Write-Host ""
    Write-Host "Troubleshooting:" -ForegroundColor Yellow
    Write-Host "  1. Close Chrome COMPLETELY (check Task Manager)" -ForegroundColor White
    Write-Host "  2. Make sure you're logged into YouTube in Chrome" -ForegroundColor White
    Write-Host "  3. Make sure you've accepted YouTube/Google terms" -ForegroundColor White
    Write-Host "  4. Try running PowerShell as Administrator" -ForegroundColor White
    exit 1
}

$socsDisplay = if ($cookies.socs) { $cookies.socs } else { "N/A" }
Write-Host ""
Write-Host "  Cookie summary:" -ForegroundColor Gray
Write-Host ("    SAPISID  : " + $cookies.SAPISID.Substring(0, [Math]::Min(6, $cookies.SAPISID.Length)) + "...") -ForegroundColor Gray
Write-Host ("    PSID     : " + $cookies.PSID.Substring(0, [Math]::Min(4, $cookies.PSID.Length)) + "...") -ForegroundColor Gray
$socsVal = if ($cookies.socs) { $cookies.socs } else { "N/A" }
Write-Host ("    SOCS     : " + $socsVal) -ForegroundColor Gray

# Step 2: OAuth
if ($OAuthTokensSource -and (Test-Path $OAuthTokensSource)) {
    step "Step 2: Including OAuth tokens..."
    ok ("OAuth tokens found: " + $OAuthTokensSource)
}
else {
    step "Step 2: OAuth tokens (optional)"
    Write-Host "  No OAuth tokens provided." -ForegroundColor Gray
    Write-Host "  Customer will need to set up OAuth in Settings." -ForegroundColor Gray
}

# Step 3: Channels
if ($ChannelsSource -and (Test-Path $ChannelsSource)) {
    step "Step 3: Including channels..."
    ok ("Channels found: " + $ChannelsSource)
}
else {
    step "Step 3: Channels (optional)"
    Write-Host "  No channels provided." -ForegroundColor Gray
    Write-Host "  Customer will add channels in Settings." -ForegroundColor Gray
}

# Step 4: Build
step "Step 4: Building customer package..."
$pkgDir = Build-CustomerPackage $cookies $OutputDir

# Summary
if ($pkgDir) {
    Write-Host ""
    Write-Host "==============================================================" -ForegroundColor Green
    Write-Host "  Package ready!" -ForegroundColor Green
    Write-Host "==============================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "DELIVERY:" -ForegroundColor Cyan
    $zipFile = Join-Path $OutputDir "*.zip"
    $latestZip = Get-ChildItem $OutputDir -Filter ($safeName + "-*.zip") | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($latestZip) {
        Write-Host ("  ZIP archive : " + $latestZip.FullName) -ForegroundColor White
    }
    Write-Host ("  Unpacked    : " + $pkgDir) -ForegroundColor White
    Write-Host ""
    Write-Host "CUSTOMER INSTRUCTIONS:" -ForegroundColor Cyan
    Write-Host "  1. Send the ZIP file to the customer" -ForegroundColor White
    Write-Host "  2. Customer extracts ZIP to any location" -ForegroundColor White
    Write-Host "  3. Customer runs: .\customer-first-run.ps1" -ForegroundColor White
    Write-Host "  4. Customer sets OAuth in Settings - Google Projects" -ForegroundColor White
    Write-Host ""
    Write-Host "NOTE: Close Chrome before running extract on YOUR machine again." -ForegroundColor Yellow
}
else {
    err "Package build failed"
    exit 1
}
