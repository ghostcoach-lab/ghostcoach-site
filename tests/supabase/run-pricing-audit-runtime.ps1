$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$tempRoot = Join-Path $tempBase "ghostcoach-pricing-audit-runtime-$PID"
$projectId = 'ghostcoach-pricing-audit-runtime-test'
$cliVersion = '2.117.0'
$stackStarted = $false
$cleanupFailed = $false

function Invoke-Checked([scriptblock] $Command, [string] $FailureMessage) {
  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "$FailureMessage (exit code $LASTEXITCODE)."
  }
}

try {
  New-Item -ItemType Directory -Path (Join-Path $tempRoot 'supabase') -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'config.toml') `
    -Destination (Join-Path $tempRoot 'supabase/config.toml')
  Copy-Item -LiteralPath (Join-Path $repoRoot 'supabase/functions') `
    -Destination (Join-Path $tempRoot 'supabase/functions') `
    -Recurse

  Invoke-Checked {
    npx -y "supabase@$cliVersion" start `
      --workdir $tempRoot `
      --exclude realtime,storage-api,imgproxy,studio,mailpit,postgres-meta,logflare,vector,supavisor |
      Out-Null
  } 'Could not start the isolated Supabase stack'
  $stackStarted = $true

  $dbContainer = "supabase_db_$projectId"
  Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'pricing-audit-runtime-baseline.sql') |
    docker exec --interactive $dbContainer `
      psql --set ON_ERROR_STOP=1 --username postgres --dbname postgres
  if ($LASTEXITCODE -ne 0) {
    throw "Could not install the runtime baseline (exit code $LASTEXITCODE)."
  }

  Get-Content -Raw -LiteralPath `
    (Join-Path $repoRoot 'supabase/migrations/20260919105053_quarterly_pricing_audit_foundation.sql') |
    docker exec --interactive $dbContainer `
      psql --set ON_ERROR_STOP=1 --username postgres --dbname postgres
  if ($LASTEXITCODE -ne 0) {
    throw "Could not apply the pricing-audit migration (exit code $LASTEXITCODE)."
  }

  docker exec $dbContainer psql --set ON_ERROR_STOP=1 --username postgres --dbname postgres `
    --command "notify pgrst, 'reload schema';"
  if ($LASTEXITCODE -ne 0) {
    throw "Could not reload the Data API schema cache (exit code $LASTEXITCODE)."
  }

  $statusJson = npx -y "supabase@$cliVersion" status --workdir $tempRoot --output json
  if ($LASTEXITCODE -ne 0) {
    throw "Could not read isolated Supabase status (exit code $LASTEXITCODE)."
  }
  $status = $statusJson | ConvertFrom-Json

  $env:GC_RUNTIME_API_URL = $status.API_URL
  $env:GC_RUNTIME_ANON_KEY = $status.ANON_KEY
  $env:GC_RUNTIME_SERVICE_ROLE_KEY = $status.SERVICE_ROLE_KEY

  Invoke-Checked {
    node (Join-Path $PSScriptRoot 'pricing-audit-runtime.test.mjs')
  } 'Pricing-audit runtime assertions failed'
}
finally {
  # Windows PowerShell 5.1 turns redirected native stderr, such as the CLI's update notice, into
  # a terminating error under 'Stop', which would fail a passing run and skip the temp folder
  # removal below. So cleanup judges the exit code instead.
  $ErrorActionPreference = 'Continue'
  if ($stackStarted) {
    npx -y "supabase@$cliVersion" stop --workdir $tempRoot --no-backup 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
      $cleanupFailed = $true
      Write-Warning "Could not stop the isolated Supabase stack (exit code $LASTEXITCODE). Stop it with: npx supabase@$cliVersion stop --project-id $projectId --no-backup"
    }
  }

  $resolvedTempRoot = [IO.Path]::GetFullPath($tempRoot)
  if (
    $resolvedTempRoot.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase) -and
    [IO.Path]::GetFileName($resolvedTempRoot).StartsWith(
      'ghostcoach-pricing-audit-runtime-',
      [StringComparison]::Ordinal
    )
  ) {
    Remove-Item -LiteralPath $resolvedTempRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}

if ($cleanupFailed) {
  exit 1
}
