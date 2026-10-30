$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$runtimeRoot = Join-Path $projectRoot '.local'
$env:XDG_CONFIG_HOME = Join-Path $runtimeRoot 'config'
$env:MEDUSA_DISABLE_TELEMETRY = 'true'

function Test-LocalPort([int]$Port) {
    $client = [Net.Sockets.TcpClient]::new()
    try { $client.Connect('127.0.0.1', $Port); return $true }
    catch { return $false }
    finally { $client.Dispose() }
}
function Start-LocalService($Name, $Executable, $Arguments, $Directory, $Port) {
    if (Test-LocalPort $Port) { Write-Host "$Name already listens on $Port"; return }
    $process = Start-Process -FilePath $Executable -ArgumentList $Arguments -WorkingDirectory $Directory -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeRoot "$Name.log") -RedirectStandardError (Join-Path $runtimeRoot "$Name-error.log")
    Set-Content (Join-Path $runtimeRoot "$Name.pid") $process.Id
    Write-Host "$Name started (PID $($process.Id))"
}

$postgresRoot = (Get-Content (Join-Path $runtimeRoot 'runtime-path.txt') -Raw).Trim()
if (!(Test-Path $postgresRoot)) { New-Item -ItemType Junction -Path $postgresRoot -Target $runtimeRoot | Out-Null }
$postgresBin = Join-Path $postgresRoot 'postgres\pgsql\bin'
if (!(Test-LocalPort 5432)) {
    & (Join-Path $postgresBin 'pg_ctl.exe') -D (Join-Path $postgresRoot 'pgdata') -l (Join-Path $postgresRoot 'postgres.log') -w start
    if ($LASTEXITCODE) { throw 'PostgreSQL failed to start' }
}
Start-LocalService 'redis' (Join-Path $runtimeRoot 'redis\Redis-8.10.3-Windows-x64-cygwin\redis-server.exe') '--bind 127.0.0.1 --port 6379 --appendonly no' $runtimeRoot 6379
Start-LocalService 'meilisearch' (Join-Path $runtimeRoot 'meilisearch.exe') '--http-addr 127.0.0.1:7700 --master-key nuts-local-search-key-2026 --no-analytics' $runtimeRoot 7700
$node = (Get-Command node.exe).Source
Start-LocalService 'backend' $node 'node_modules/@medusajs/cli/cli.js develop --host 127.0.0.1 --no-lint' (Join-Path $projectRoot 'бекенд') 9000
Start-LocalService 'frontend' $node 'node_modules/next/dist/bin/next dev --webpack --hostname 127.0.0.1' (Join-Path $projectRoot 'фронтенд') 3000
Write-Host 'Store: http://localhost:3000'
Write-Host 'Admin: http://localhost:9000/app'

