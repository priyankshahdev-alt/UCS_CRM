$ErrorActionPreference = 'Stop'

$key = "$env:USERPROFILE\.ssh\ucs-backend.pem"
$rds = 'ucs-crm-db.cv8asue2a57e.ap-south-1.rds.amazonaws.com'
$localPort = 5434

if (-not (Test-Path $key)) {
  Write-Host "ERROR: SSH key not found at $key" -ForegroundColor Red
  exit 1
}

$existing = Get-NetTCPConnection -LocalPort $localPort -State Listen -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "Port $localPort already in use (PID $($existing.OwningProcess)) - tunnel may already be running." -ForegroundColor Yellow
  exit 1
}

$sshArgs = @(
  '-N',
  '-o', 'ServerAliveInterval=30',
  '-o', 'ServerAliveCountMax=3',
  '-o', 'ExitOnForwardFailure=yes',
  '-o', 'StrictHostKeyChecking=accept-new',
  '-o', 'ConnectTimeout=10',
  '-i', $key,
  '-L', "$localPort`:$rds`:5432",
  'ec2-user@13.207.47.116'
)

Start-Process -FilePath 'ssh' -ArgumentList $sshArgs -WindowStyle Hidden `
  -RedirectStandardOutput "$PSScriptRoot\.tunnel.log" `
  -RedirectStandardError "$PSScriptRoot\.tunnel.err.log"

Start-Sleep -Seconds 3
$t = Test-NetConnection -ComputerName localhost -Port $localPort -WarningAction SilentlyContinue
if ($t.TcpTestSucceeded) {
  Write-Host "Tunnel UP - localhost:$localPort -> $rds (EC2 13.207.47.116)" -ForegroundColor Green
} else {
  Write-Host "Tunnel FAILED - check $PSScriptRoot\.tunnel.err.log" -ForegroundColor Red
  exit 1
}
