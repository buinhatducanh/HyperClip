# doctor.ps1 -- one-command WebSub relay check (Pass 135c). ASCII ONLY (PS 5.1 lesson 12/08).
#
# Runs the reopen runbook (docs/DETECTION_LATENCY.md section 51F) and prints a verdict:
#   1. GET  /health            -> subscription state (verified / pings / uptime)
#   2. GET  /yt-callback?hub.challenge=... -> hub verification path reaches relay?
#   3. POST /yt-callback       -> hub notification path reaches relay? (Cloudflare block check)
#
# Usage (any machine, ideally NOT the relay host so the request goes through Cloudflare):
#   powershell -ExecutionPolicy Bypass -File doctor.ps1 -RelayUrl https://relay.example.com -Token <WEBSUB_TOKEN>
# On the relay host with relay.env next to this file, both params are read from it.

param(
    [string]$RelayUrl = "",
    [string]$Token = ""
)

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$envFile = Join-Path $here "relay.env"
if ((-not $RelayUrl -or -not $Token) -and (Test-Path $envFile)) {
    Get-Content $envFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -eq "" -or $line.StartsWith("#")) { return }
        $idx = $line.IndexOf("=")
        if ($idx -lt 1) { return }
        $k = $line.Substring(0, $idx).Trim(); $v = $line.Substring($idx + 1).Trim()
        if ($k -eq "WEBSUB_PUBLIC_URL" -and -not $RelayUrl) { $RelayUrl = $v }
        if ($k -eq "WEBSUB_TOKEN" -and -not $Token) { $Token = $v }
    }
}
if (-not $RelayUrl -or -not $Token) {
    Write-Host "Need -RelayUrl and -Token (or relay.env next to this script)." -ForegroundColor Red
    exit 2
}
$RelayUrl = $RelayUrl.TrimEnd("/")
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$fail = 0

function Step($n, $msg) { Write-Host ""; Write-Host ("[{0}] {1}" -f $n, $msg) -ForegroundColor Cyan }
function Ok($msg)   { Write-Host ("    OK   " + $msg) -ForegroundColor Green }
function Bad($msg)  { Write-Host ("    FAIL " + $msg) -ForegroundColor Red; $script:fail++ }
function Note($msg) { Write-Host ("    note " + $msg) -ForegroundColor Yellow }

# ---- 1. /health -------------------------------------------------------------
Step 1 "GET $RelayUrl/health"
try {
    $h = Invoke-RestMethod -Uri "$RelayUrl/health" -Headers @{ Authorization = "Bearer $Token" } -TimeoutSec 15
} catch {
    Bad ("relay not reachable or token wrong: " + $_.Exception.Message)
    Note "502 = tunnel down or wrong port; 401 = WEBSUB_TOKEN mismatch."
    exit 1
}
$uptimeH = if ($h.startedAtMs) { [math]::Round(([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - $h.startedAtMs) / 3600000.0, 1) } else { $null }
Write-Host ("    client={8} publicUrl={0} channels={1} verified={2} neverPinged={3} pingsTotal={4} listeners={5} subscribeErrors={6} uptimeH={7}" -f `
    $h.publicUrl, $h.channels, $h.verified, $h.neverPinged, $h.pingsTotal, $h.listeners, $h.subscribeErrors, $uptimeH, $h.client)
if ($h.clients) {
    foreach ($c in $h.clients.PSObject.Properties) {
        Write-Host ("    machine {0}: channels={1} verified={2} neverPinged={3} listeners={4}" -f $c.Name, $c.Value.channels, $c.Value.verified, $c.Value.neverPinged, $c.Value.listeners)
    }
}
if ($h.publicUrl -ne $RelayUrl) { Bad ("relay thinks its public URL is '" + $h.publicUrl + "' but you reached it at '" + $RelayUrl + "' -> hub callbacks go to the wrong place. Fix WEBSUB_PUBLIC_URL in relay.env and restart relay.") } else { Ok "publicUrl matches" }
if ($h.channels -eq 0) { Bad "0 channels registered -> app never POSTed /subscribe (check websubRelayUrl/Token in app settings)." }
elseif ($h.verified -lt $h.channels) { Bad ("{0}/{1} channels NOT verified by hub -> hub GET to /yt-callback is not arriving (see step 2). Relay retries unverified channels every 10 min." -f ($h.channels - $h.verified), $h.channels) }
else { Ok ("all {0} channels verified by hub" -f $h.channels) }
if ($h.listeners -eq 0) { Note "0 SSE listeners: no app connected right now." } else { Ok ("{0} app(s) listening on SSE" -f $h.listeners) }
if ($h.pingsTotal -eq 0) {
    if ($uptimeH -ne $null -and $uptimeH -ge 6) { Bad ("relay up {0}h with 0 pings from hub -> hub POST is blocked (see step 3)." -f $uptimeH) }
    else { Note "0 pings so far; relay uptime too short to conclude. Publish a test video after the other steps pass." }
} else { Ok ("hub has delivered {0} pings" -f $h.pingsTotal) }
if ($h.subscribeErrors -gt 0) { Bad ("{0} channels had a hub subscribe error -> see websub_ledger.jsonl kind=subscribe" -f $h.subscribeErrors) }

# ---- 2. hub verification path (GET) ---------------------------------------------
Step 2 "GET $RelayUrl/yt-callback?hub.mode=subscribe&hub.challenge=doctor (simulates hub verification)"
try {
    $r = Invoke-WebRequest -Uri "$RelayUrl/yt-callback?hub.mode=subscribe&hub.challenge=doctor123&hub.topic=https://example.invalid/doctor" -UseBasicParsing -TimeoutSec 15
    if ($r.StatusCode -eq 200 -and $r.Content.Trim() -eq "doctor123") { Ok "relay echoes hub.challenge (verification path open)" }
    else { Bad ("unexpected response {0}: {1}" -f $r.StatusCode, ($r.Content.Substring(0, [math]::Min(120, $r.Content.Length)))) }
} catch {
    Bad ("GET blocked: " + $_.Exception.Message)
    Note "If this fails from outside but relay log shows nothing, Cloudflare/tunnel is not passing GET -> check tunnel ingress and WAF."
}

# ---- 3. hub notification path (POST) ----------------------------------------------
Step 3 "POST $RelayUrl/yt-callback as FeedFetcher-Google (simulates hub notification; relay must answer 204 and log 'BO ping sai chu ky HMAC')"
try {
    $r = Invoke-WebRequest -Uri "$RelayUrl/yt-callback" -Method POST -Body "<x/>" -ContentType "application/atom+xml" `
        -Headers @{ "User-Agent" = "FeedFetcher-Google; (+http://www.google.com/feedfetcher.html)" } -UseBasicParsing -TimeoutSec 15
    if ($r.StatusCode -eq 204) { Ok "POST reaches relay (204). Hub notifications are NOT blocked at the edge." }
    else { Bad ("POST answered {0} instead of 204; body starts: {1}" -f $r.StatusCode, ($r.Content.Substring(0, [math]::Min(120, $r.Content.Length)))) }
} catch {
    $resp = $_.Exception.Response
    $code = if ($resp) { [int]$resp.StatusCode } else { 0 }
    Bad ("POST blocked (HTTP {0}): {1}" -f $code, $_.Exception.Message)
    if ($code -eq 403 -or $code -eq 503) {
        Note "403/503 with an HTML body = Cloudflare is challenging the hub. Fix in Cloudflare dashboard:"
        Note "  Security > Settings: Browser Integrity Check = OFF; Bot Fight Mode = OFF (Free plan cannot skip it by rule)"
        Note "  Security > WAF > Custom rules: Skip all managed rules + rate limiting for hostname relay.<domain>, path /yt-callback"
        Note "  Cannot change it? Move relay to path B in DEPLOY-DOMAIN.md (VPS + Caddy), no Cloudflare in front of POST."
    }
}

# ---- verdict --------------------------------------------------------------------
Write-Host ""
if ($fail -eq 0) {
    Write-Host "VERDICT: relay path is open. Next: publish a test video and expect relay log 'ping <id> MOI -- sau publish X.Xs' and app log '[WebSub] Ping MOI ... video chua seen' + '[Detect] src=websub'. X.X must be < 3s to beat the API path." -ForegroundColor Green
    exit 0
} else {
    Write-Host ("VERDICT: {0} problem(s) above. Fix the FIRST failing step, restart relay, run this again." -f $fail) -ForegroundColor Red
    exit 1
}
