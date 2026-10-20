# patch_s1.ps1
# ------------------------------------------------------------
# ONE COMMAND on the BUILD MACHINE: patch source -> build exe -> zip patch.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File patch_s1.ps1 -RepoRoot C:\path\to\repo
#
# Output: HyperClip-Patch-<timestamp>.zip in this folder. Send that ONE file
# over Zalo; on the customer machine: close the app, drop the zip into
# C:\Users\Administrator\Desktop\HyperClip\, run apply-patch.ps1.
#
# DO NOT RUN THIS ON THE CUSTOMER MACHINE - it needs the Rust source + cargo.
#
# ASCII ONLY (Windows PowerShell 5.1 reads a BOM-less script as CP1252).
# ------------------------------------------------------------

param(
    [Parameter(Mandatory=$true)][string]$RepoRoot,
    [string]$GitHead = "",
    [switch]$SkipBuild,
    [ValidateRange(1, 50)][int]$KeepZips = 2
)

$ErrorActionPreference = "Stop"
$KitRoot = $PSScriptRoot

function Step([string]$n, [string]$msg) { Write-Host "`n=== $n $msg ===" -ForegroundColor Cyan }
function Die([string]$msg) { Write-Host "  FAIL  $msg" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  HyperClip patch_s1 - pollIntervalStrict" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

if (-not (Test-Path -LiteralPath $RepoRoot)) { Die "RepoRoot not found: $RepoRoot" }
$RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).ProviderPath

# Cargo.toml lives at the repo root, or one level down in source\
$cargoRoot = $null
foreach ($c in @($RepoRoot, (Join-Path $RepoRoot "source"))) {
    if (Test-Path -LiteralPath (Join-Path $c "Cargo.toml")) { $cargoRoot = $c; break }
}
if (-not $cargoRoot) { Die "No Cargo.toml under $RepoRoot (or its source\ subfolder)" }

# Pin the two source files to the SAME tree cargo will build. Without this,
# apply-source-edits.ps1 does its own lookup (with a recursive fallback) and
# could patch a copy under target\package\, an old\ folder or a second
# worktree - we would then compile unpatched sources and only notice after a
# full release build.
$pollerPath   = Join-Path $cargoRoot "crates\hyperclip_ipc\src\poller.rs"
$commandsPath = Join-Path $cargoRoot "src-tauri\src\commands.rs"
foreach ($p in @($pollerPath, $commandsPath)) {
    if (-not (Test-Path -LiteralPath $p)) { Die "Expected source file missing: $p" }
}
Write-Host "Repo   : $RepoRoot" -ForegroundColor DarkGray
Write-Host "Cargo  : $cargoRoot" -ForegroundColor DarkGray

# -- 1/3 source edits ----------------------------------------

Step "1/3" "Patching Rust source"

$prevEap = $ErrorActionPreference
try {
    # Continue, not Stop: a child that writes to stderr would otherwise
    # raise NativeCommandError in this parent and skip the Die below.
    $ErrorActionPreference = "Continue"
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $KitRoot "apply-source-edits.ps1") `
        -RepoRoot $cargoRoot -PollerPath $pollerPath -CommandsPath $commandsPath
    $editExit = $LASTEXITCODE
} catch {
    Die "Could not run apply-source-edits.ps1: $($_.Exception.Message)"
} finally {
    $ErrorActionPreference = $prevEap
}

# 0 = just patched, 3 = was already patched (see apply-source-edits.ps1)
if ($editExit -ne 0 -and $editExit -ne 3) {
    Die "Source patch failed - read the child output above. If it got as far as writing, a .bak-<timestamp> of each file sits next to it and one file may need restoring."
}
if ($editExit -eq 0 -and $SkipBuild) {
    # The sources changed seconds ago, so no pre-existing exe can contain the
    # change. Refuse rather than package a binary that silently lacks it.
    Die "-SkipBuild but the sources were just patched - any existing exe predates the change. Rerun without -SkipBuild."
}

# -- 2/3 build -----------------------------------------------

Step "2/3" "Building hyperclip-tauri.exe (release)"

$buildStart = Get-Date

if (-not $SkipBuild) {
    # Resolve the bare name the way `& cargo` will: alias > function > cmdlet
    # > application. -CommandType Application would only filter the result
    # set, so a profile function named cargo would still win at call time and
    # leave $LASTEXITCODE stale (a "successful build" that built nothing).
    $cargoCmd = Get-Command cargo -ErrorAction SilentlyContinue
    if (-not $cargoCmd) {
        Die "cargo not found. Open a shell where 'cargo --version' works (or install Rust), then rerun."
    }
    if ($cargoCmd.CommandType -ne 'Application') {
        Die "'cargo' resolves to a $($cargoCmd.CommandType), not the real cargo.exe - your PowerShell profile shadows it. Rerun with -NoProfile."
    }
    Push-Location -LiteralPath $cargoRoot
    $prevEap = $ErrorActionPreference
    try {
        # cargo prints Compiling/Finished/warnings on STDERR. Under
        # $ErrorActionPreference='Stop' PowerShell turns each stderr line
        # into a terminating NativeCommandError whenever output is
        # redirected (ISE, VS Code console, or "... > build.log 2>&1"),
        # which would abort mid-build with a raw .NET exception. Drop to
        # Continue for the call and judge the result by $LASTEXITCODE.
        # Emit the lines as strings on the SUCCESS stream (not Write-Host,
        # which "> build.log" cannot capture) so a failed build still
        # leaves the operator a log.
        $ErrorActionPreference = "Continue"
        & $cargoCmd.Source build --release --bin hyperclip-tauri 2>&1 | ForEach-Object { [string]$_ }
        $cargoExit = $LASTEXITCODE
    } catch {
        Die "Could not run cargo: $($_.Exception.Message)"
    } finally {
        # MUST be in finally: a throw above (cargo not on PATH) would
        # otherwise leave the whole script running under Continue, so every
        # later failure would be printed and ignored.
        $ErrorActionPreference = $prevEap
        Pop-Location
    }
    if ($cargoExit -ne 0) { Die "cargo build failed (exit $cargoExit)" }
}

# Ask CARGO where it put the binary instead of assuming <root>\target.
# CARGO_TARGET_DIR or .cargo\config.toml [build] target-dir move it, and
# packaging a leftover exe from the default path would ship a stale binary.
$targetDir = Join-Path $cargoRoot "target"
Push-Location -LiteralPath $cargoRoot
$prevEap = $ErrorActionPreference
try {
    $ErrorActionPreference = "Continue"
    # -join, NOT Out-String: Out-String renders through the format engine at
    # the host width and would chop this one very long JSON line, so the
    # parse would fail (or worse, yield a truncated path).
    $metaRaw = ((& cargo metadata --format-version 1 --no-deps 2>$null) -join "`n")
    if ($LASTEXITCODE -eq 0 -and $metaRaw.Trim()) {
        $meta = $metaRaw | ConvertFrom-Json
        # Only trust it if it exists: PS 5.1 decodes native stdout with the
        # OEM codepage, so a repo path with Vietnamese diacritics comes back
        # mojibake and would throw away a perfectly good default.
        if ($meta.target_directory -and (Test-Path -LiteralPath $meta.target_directory)) {
            $targetDir = $meta.target_directory
        }
    }
} catch {
    Write-Host "  (cargo metadata unavailable; assuming $targetDir)" -ForegroundColor DarkGray
} finally {
    $ErrorActionPreference = $prevEap
    Pop-Location
}

# Collect EVERY place cargo could have put it and take the NEWEST. Preferring
# <target>\release\ would package a months-old binary sitting there from
# before a target triple was configured, since the fresh one then lands in
# <target>\<triple>\release\ and the old path still exists.
$candidates = @()
foreach ($dir in @($targetDir) + @(Get-ChildItem -LiteralPath $targetDir -Directory -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })) {
    $c = Join-Path $dir "release\hyperclip-tauri.exe"
    if (Test-Path -LiteralPath $c) { $candidates += (Get-Item -LiteralPath $c) }
}
if ($candidates.Count -eq 0) {
    if ($SkipBuild) { Die "No hyperclip-tauri.exe under $targetDir - drop -SkipBuild" }
    Die "Build reported success but there is no hyperclip-tauri.exe under $targetDir. Run finish-patch.ps1 by hand with -ExePath pointing at the real one."
}
$exeItem = ($candidates | Sort-Object LastWriteTime -Descending)[0]
$exePath = $exeItem.FullName
if ($candidates.Count -gt 1) {
    Write-Host "  $($candidates.Count) candidate exes found; taking the newest:" -ForegroundColor Yellow
    foreach ($c in $candidates) { Write-Host "    $($c.LastWriteTime)  $($c.FullName)" -ForegroundColor DarkGray }
}

# Freshness measured against the SOURCES, not against this run's clock. That
# holds on both paths: a re-run where cargo had nothing to relink still has
# exe newer than the sources, while any exe predating the patched sources -
# a leftover from another output directory, or -SkipBuild against a tree we
# just edited - is caught.
$srcStamp = @(
    (Get-Item -LiteralPath $pollerPath).LastWriteTime,
    (Get-Item -LiteralPath $commandsPath).LastWriteTime
) | Sort-Object -Descending | Select-Object -First 1

if ($exeItem.LastWriteTime -lt $srcStamp) {
    Die "The exe is OLDER than the patched sources (exe $($exeItem.LastWriteTime), sources $srcStamp): $exePath. It does not contain the change - build again without -SkipBuild, or point finish-patch.ps1 at the right exe."
}
if ($SkipBuild) {
    Write-Host "  -SkipBuild: reusing $exePath ($($exeItem.LastWriteTime))" -ForegroundColor Yellow
} elseif ($exeItem.LastWriteTime -lt $buildStart) {
    Write-Host "  cargo had nothing to relink; exe unchanged from $($exeItem.LastWriteTime)" -ForegroundColor DarkGray
} else {
    Write-Host "  fresh exe: $($exeItem.LastWriteTime)" -ForegroundColor DarkGray
}

# -- 3/3 package ---------------------------------------------

Step "3/3" "Packaging patch zip"

if (-not $GitHead) {
    $GitHead = "unknown"
    Push-Location -LiteralPath $cargoRoot
    $prevEap = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        # 2>$null, not 2>&1: a git that warns on stderr but still succeeds
        # would otherwise hand back an array and fail the shape check.
        $lines = @(& git rev-parse --short HEAD 2>$null)
        $probe = @($lines | Where-Object { $_ -is [string] } | Select-Object -Last 1)[0]
        # A shadowed git (profile function) leaves $LASTEXITCODE untouched,
        # so also sanity-check the shape of what came back.
        if ($LASTEXITCODE -eq 0 -and $probe -and ($probe.Trim() -match '^[0-9a-f]{7,40}$')) {
            $GitHead = $probe.Trim()
        }
    } catch {
        $GitHead = "unknown"
    } finally {
        $ErrorActionPreference = $prevEap
        Pop-Location
    }
    if ($GitHead -eq "unknown") {
        Write-Host "  (could not read a commit hash; patch-version.json will say 'unknown')" -ForegroundColor DarkGray
    }
}

$prevEap = $ErrorActionPreference
try {
    $ErrorActionPreference = "Continue"
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $KitRoot "finish-patch.ps1") `
        -ExePath $exePath -GitHead $GitHead
    $packExit = $LASTEXITCODE
} catch {
    Die "Could not run finish-patch.ps1: $($_.Exception.Message)"
} finally {
    $ErrorActionPreference = $prevEap
}
if ($packExit -ne 0) { Die "Packaging failed (exit $packExit) - see the output above" }

$zips = @(Get-ChildItem -LiteralPath $KitRoot -Filter "HyperClip-Patch-*.zip" -File |
          Sort-Object LastWriteTime -Descending)
if ($zips.Count -eq 0) { Die "finish-patch.ps1 reported success but produced no zip" }
$zip = $zips[0]
if ($zip.LastWriteTime -lt $buildStart) { Die "Newest zip predates this run - packaging did not produce a fresh file" }

# Keep the folder from filling up with ~18 MB zips, one per run. Never
# touch the zip we are about to hand the operator, whatever -KeepZips says.
if ($zips.Count -gt $KeepZips) {
    foreach ($old in ($zips | Select-Object -Skip $KeepZips)) {
        if ($old.FullName -eq $zip.FullName) { continue }
        # Best-effort: a zip held open by antivirus or an upload must not
        # abort the run - the deliverable is already built at this point.
        Remove-Item -LiteralPath $old.FullName -Force -ErrorAction SilentlyContinue
        if (-not (Test-Path -LiteralPath $old.FullName)) {
            Write-Host "  removed old zip: $($old.Name)" -ForegroundColor DarkGray
        }
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host " DONE - send this ONE file over Zalo:" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  $($zip.FullName)" -ForegroundColor White
Write-Host ("  ({0:F1} MB)" -f ($zip.Length / 1MB)) -ForegroundColor DarkGray
Write-Host ""
Write-Host " On the customer machine:" -ForegroundColor White
Write-Host "   1. Close HyperClip completely (tray icon too)" -ForegroundColor White
Write-Host "   2. Drop the zip into C:\Users\Administrator\Desktop\HyperClip\" -ForegroundColor White
Write-Host "   3. powershell -ExecutionPolicy Bypass -File apply-patch.ps1" -ForegroundColor White
Write-Host "   4. Start the app; the log must show: [Poller] pollIntervalStrict=true" -ForegroundColor White
Write-Host ""
Write-Host " Source backups (.bak-*) were left next to poller.rs / commands.rs." -ForegroundColor DarkGray
Write-Host ""
