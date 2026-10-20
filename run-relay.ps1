# run-relay.ps1 -- start the WebSub relay with settings from relay.env (Pass 85).
#
# ASCII ONLY in this file: PowerShell 5.1 reads a BOM-less .ps1 as CP1252 and
# UTF-8 characters inside strings break the parser (lesson 12/08).
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File run-relay.ps1
#
# relay.env format (KEY=VALUE, one per line, no quotes):
#   WEBSUB_PUBLIC_URL=https://relay.example.com
#   WEBSUB_TOKEN=...
#   WEBSUB_HUB_SECRET=...
#   PORT=8787
#
# Keep relay.env OUT of git (it holds secrets) -- see .gitignore next to this file.

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$envFile = Join-Path $here "relay.env"
if (-not (Test-Path $envFile)) {
    Write-Host "relay.env not found at $envFile" -ForegroundColor Red
    Write-Host "Copy relay.env.example to relay.env and fill in the values." -ForegroundColor Yellow
    exit 1
}

Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -eq "" -or $line.StartsWith("#")) { return }
    $idx = $line.IndexOf("=")
    if ($idx -lt 1) { return }
    $k = $line.Substring(0, $idx).Trim()
    $v = $line.Substring($idx + 1).Trim()
    [System.Environment]::SetEnvironmentVariable($k, $v, "Process")
}

# Pass 135c: when run as a SYSTEM scheduled task, PATH may not contain node --
# relay.env can pin it with NODE_EXE=C:\path\to\node.exe.
$nodeExe = $env:NODE_EXE
if (-not $nodeExe) {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
        Write-Host "node.exe not found in PATH. Install Node 18+ or set NODE_EXE in relay.env." -ForegroundColor Red
        exit 1
    }
    $nodeExe = $node.Source
}

Set-Location $here
Write-Host "Starting relay on port $env:PORT with public URL $env:WEBSUB_PUBLIC_URL" -ForegroundColor Green
# Loop so a crash restarts the relay (subscriptions.json keeps channels + seen).
while ($true) {
    & $nodeExe "relay.mjs"
    Write-Host "relay exited with code $LASTEXITCODE -- restarting in 5s" -ForegroundColor Yellow
    Start-Sleep -Seconds 5
}
