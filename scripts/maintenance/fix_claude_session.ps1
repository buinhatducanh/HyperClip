# PowerShell wrapper for Claude Code session repair tool
$ErrorActionPreference = "SilentlyContinue"

# Fix encoding issues in standard Windows PowerShell
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "      Claude Code Session Repair" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Ensure node is installed
$nodeVersion = node -v 2>$null
if ($null -eq $nodeVersion) {
    Write-Host "[ERROR] Node.js is not installed or not in PATH." -ForegroundColor Red
    Write-Host "Please install Node.js to use this tool." -ForegroundColor Yellow
    Exit 1
}

# Resolve paths
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$JsScript = Join-Path $ScriptDir "fix_claude_session.cjs"

if (-not (Test-Path $JsScript)) {
    # Try local dev workspace path
    $JsScript = "D:\LOOP_COMPANY\HyperClip\scripts\maintenance\fix_claude_session.cjs"
}

if (-not (Test-Path $JsScript)) {
    Write-Host "[ERROR] Helper script 'fix_claude_session.cjs' not found." -ForegroundColor Red
    Exit 1
}

# Run the Node script and parse the output
$corruptedFiles = @()
$fixedFiles = @()

& node $JsScript | ForEach-Object {
    $line = $_
    if ($line.StartsWith("{") -and $line.EndsWith("}")) {
        try {
            $data = ConvertFrom-Json $line
            switch ($data.status) {
                "info" {
                    Write-Host "[INFO] $($data.message)" -ForegroundColor Gray
                }
                "warning" {
                    Write-Host "[WARNING] $($data.message)" -ForegroundColor Yellow
                }
                "error" {
                    Write-Host "[ERROR] $($data.message)" -ForegroundColor Red
                }
                "corrupted" {
                    Write-Host "[CORRUPTED] Found null bytes in session file!" -ForegroundColor Yellow
                    Write-Host "  File: $($data.file)" -ForegroundColor Cyan
                    Write-Host "  Size: $([math]::Round($data.size / 1KB, 2)) KB" -ForegroundColor Gray
                }
                "fixed" {
                    Write-Host "[RECOVERED] Successfully repaired session!" -ForegroundColor Green
                    Write-Host "  Backup saved to: $($data.file).bak" -ForegroundColor DarkGray
                    Write-Host "  New Size: $([math]::Round($data.cleanedSize / 1KB, 2)) KB" -ForegroundColor Gray
                    Write-Host ""
                }
                "summary" {
                    Write-Host ""
                    Write-Host "========================================" -ForegroundColor Cyan
                    Write-Host "            SCAN SUMMARY" -ForegroundColor Cyan
                    Write-Host "========================================" -ForegroundColor Cyan
                    Write-Host "  Scanned Sessions:   $($data.scanned)" -ForegroundColor White
                    
                    if ($data.corrupted -gt 0) {
                        Write-Host "  Corrupted Sessions: $($data.corrupted)" -ForegroundColor Red
                        Write-Host "  Fixed Sessions:     $($data.fixed)" -ForegroundColor Green
                    } else {
                        Write-Host "  Corrupted Sessions: 0" -ForegroundColor Green
                        Write-Host "  All sessions are healthy! No repairs needed." -ForegroundColor Green
                    }
                    Write-Host "========================================" -ForegroundColor Cyan
                }
            }
        } catch {
            # Fallback if parsing fails
            Write-Host $line -ForegroundColor White
        }
    } else {
        # Raw text line
        Write-Host $line -ForegroundColor White
    }
}

Write-Host ""
Write-Host "Luu y phong ngua (Preventative tips):" -ForegroundColor Yellow
Write-Host "  1. Khi session dai (>200 messages), Claude Code de bi loi corrupt neu may bi crash hoac force-kill." -ForegroundColor Gray
Write-Host "  2. Nen dong Claude Code dung cach (go 'exit' hoac doi no luu xong) truoc khi tat may." -ForegroundColor Gray
Write-Host "  3. Khuyen nghi tao session moi moi 1-2 ngay lam viec de tranh session qua dai." -ForegroundColor Gray
Write-Host ""
