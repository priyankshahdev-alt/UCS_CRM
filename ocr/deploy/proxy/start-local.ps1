<#
  One-command launcher for the no-domain local OCR setup.

  - starts ocr/start.bat (with OCR_API_KEY)
  - starts a Cloudflare Quick Tunnel to localhost:8010
  - reads the random *.trycloudflare.com URL and puts it in wrangler.jsonc
  - redeploys the Worker proxy

  Usage (from this folder):
    .\start-local.ps1 -ApiKey "your-long-random-key"

  Run it again after a PC restart. The public workers.dev URL never changes.
#>
param(
  [Parameter(Mandatory = $true)]
  [string]$ApiKey
)

$ErrorActionPreference = 'Stop'

$proxyDir = $PSScriptRoot
$ocrDir = (Resolve-Path (Join-Path $proxyDir '..\..')).Path
$configPath = Join-Path $proxyDir 'wrangler.jsonc'
$log = Join-Path $env:TEMP 'ucs-ocr-cloudflared.log'
$errLog = Join-Path $env:TEMP 'ucs-ocr-cloudflared.err.log'

# 1. Start the OCR service unless something is already listening on 8010.
$listener = Get-NetTCPConnection -LocalPort 8010 -State Listen -ErrorAction SilentlyContinue
if (-not $listener) {
  $env:OCR_API_KEY = $ApiKey
  Start-Process -FilePath 'cmd.exe' -ArgumentList '/c start.bat' -WorkingDirectory $ocrDir | Out-Null
  Write-Host 'Started local OCR service (first run may download ~100 MB of models).' -ForegroundColor Cyan
} else {
  Write-Host 'OCR service already listening on 8010; reusing it.' -ForegroundColor Cyan
}

# 2. Start a Quick Tunnel unless one is already running.
if (-not (Get-Process cloudflared -ErrorAction SilentlyContinue)) {
  Start-Process -FilePath 'cloudflared' `
    -ArgumentList 'tunnel --url http://localhost:8010' `
    -RedirectStandardOutput $log -RedirectStandardError $errLog | Out-Null
  Write-Host 'Starting Cloudflare tunnel...' -ForegroundColor Cyan
} else {
  Write-Host 'cloudflared already running; reusing its tunnel.' -ForegroundColor Cyan
}

# 3. Wait for the tunnel URL in its output.
$url = $null
for ($i = 0; $i -lt 90; $i++) {
  if (Test-Path $log) {
    $match = Select-String -Path $log -Pattern 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($match) {
      $url = $match.Matches[0].Value
      break
    }
  }
  Start-Sleep -Seconds 1
}
if (-not $url) {
  throw "No tunnel URL found after 90s. Check $log and $errLog. Is cloudflared installed and logged in?"
}
Write-Host "Tunnel URL: $url" -ForegroundColor Green

# 4. Update the proxy target and redeploy.
$raw = Get-Content -Path $configPath -Raw
$updated = $raw -replace 'https://[a-zA-Z0-9-]+\.trycloudflare\.com', $url
if ($updated -eq $raw -and $raw -notmatch 'TARGET_URL') {
  throw "Could not find TARGET_URL in $configPath"
}
Set-Content -Path $configPath -Value $updated -NoNewline

Push-Location $proxyDir
try {
  npx wrangler deploy
} finally {
  Pop-Location
}

Write-Host ''
Write-Host 'Done. Your public URL is unchanged:' -ForegroundColor Green
Write-Host '  https://ucs-ocr-proxy.<your-subdomain>.workers.dev/?key=<your key>' -ForegroundColor Green
Write-Host 'Keep the OCR and cloudflared windows open. Re-run this script after a PC restart.' -ForegroundColor Yellow
