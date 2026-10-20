# install-service.ps1 -- make relay + tunnel survive reboots (Pass 135c). ASCII ONLY. RUN AS ADMIN.
#
# Does DEPLOY-DOMAIN.md step A4 in one go on the relay host (Windows):
#   1. cloudflared as a Windows service using cloudflared-named.yml (starts before login)
#   2. Scheduled task "HyperClip-WebSub-Relay": run-relay.ps1 at startup as SYSTEM, restart on failure
#   3. starts both now
#
# Prereqs (do once, see DEPLOY-DOMAIN.md A1-A3): cloudflared-named.yml filled in, relay.env filled in,
# node.exe installed for all users (or set NODE_EXE=<full path> in relay.env).
#
#   powershell -ExecutionPolicy Bypass -File install-service.ps1
#   powershell -ExecutionPolicy Bypass -File install-service.ps1 -Uninstall

param([switch]$Uninstall)

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { Write-Host "Run this from an elevated (Administrator) PowerShell." -ForegroundColor Red; exit 2 }

$taskName = "HyperClip-WebSub-Relay"
$cf = Join-Path $here "cloudflared.exe"
$cfg = Join-Path $here "cloudflared-named.yml"
$runRelay = Join-Path $here "run-relay.ps1"

if ($Uninstall) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    if (Test-Path $cf) { & $cf service uninstall }
    Write-Host "Removed scheduled task and cloudflared service." -ForegroundColor Green
    exit 0
}

# ---- sanity ------------------------------------------------------------------
$errors = 0
if (-not (Test-Path $cf)) { Write-Host "cloudflared.exe not found in $here" -ForegroundColor Red; $errors++ }
if (-not (Test-Path $cfg)) { Write-Host "cloudflared-named.yml not found" -ForegroundColor Red; $errors++ }
elseif (Select-String -Path $cfg -Pattern "<TUNNEL-UUID>|<USER>|<DOMAIN>" -Quiet) { Write-Host "cloudflared-named.yml still has <...> placeholders -- fill them (DEPLOY-DOMAIN.md A2)." -ForegroundColor Red; $errors++ }
if (-not (Test-Path (Join-Path $here "relay.env"))) { Write-Host "relay.env not found -- copy relay.env.example and fill it." -ForegroundColor Red; $errors++ }
else {
    $envText = Get-Content (Join-Path $here "relay.env") -Raw
    if ($envText -match "WEBSUB_PUBLIC_URL=\s*(auto)?\s*(\r?\n|$)") { Write-Host "relay.env: WEBSUB_PUBLIC_URL must be the fixed https://relay.<domain> for a named tunnel." -ForegroundColor Red; $errors++ }
    if ($envText -notmatch "WEBSUB_HUB_SECRET=\S+") { Write-Host "relay.env: WEBSUB_HUB_SECRET must be set and FIXED (random per restart invalidates every subscription)." -ForegroundColor Red; $errors++ }
}
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node -and ($envText -notmatch "NODE_EXE=\S+")) { Write-Host "node.exe not in PATH and NODE_EXE not set in relay.env -- SYSTEM task will not find node." -ForegroundColor Red; $errors++ }
if ($errors -gt 0) { exit 1 }

# ---- 1. cloudflared service -------------------------------------------------------
Write-Host "Installing cloudflared service with $cfg ..." -ForegroundColor Cyan
& $cf --config $cfg service install 2>&1 | ForEach-Object { "    $_" }
Start-Service cloudflared -ErrorAction SilentlyContinue
Set-Service cloudflared -StartupType Automatic -ErrorAction SilentlyContinue
$svc = Get-Service cloudflared -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq "Running") { Write-Host "    cloudflared service running" -ForegroundColor Green }
else { Write-Host "    cloudflared service NOT running -- check: cloudflared.exe --config $cfg tunnel run" -ForegroundColor Red }

# ---- 2. relay scheduled task (SYSTEM, at startup, restart on failure) ---------------
Write-Host "Registering scheduled task $taskName ..." -ForegroundColor Cyan
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ("-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"{0}`"" -f $runRelay) -WorkingDirectory $here
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 3650) -MultipleInstances IgnoreNew -StartWhenAvailable
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings | Out-Null
Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 3
$t = Get-ScheduledTask -TaskName $taskName
Write-Host ("    task state: {0}" -f $t.State) -ForegroundColor Green

Write-Host ""
Write-Host "Done. Verify from ANOTHER machine:  powershell -File doctor.ps1 -RelayUrl https://relay.<domain> -Token <WEBSUB_TOKEN>" -ForegroundColor Green
Write-Host "Relay stdout is not captured by the task; for logs run run-relay.ps1 in a console once, or add NODE_EXE + redirect in run-relay.ps1." -ForegroundColor Yellow
