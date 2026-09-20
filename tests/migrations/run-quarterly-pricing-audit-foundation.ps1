$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$containerName = "ghostcoach-audit-migration-$PID"
$containerStarted = $false

try {
  docker run --rm --detach `
    --name $containerName `
    --env POSTGRES_PASSWORD=postgres `
    --mount "type=bind,source=$repoRoot,target=/workspace" `
    public.ecr.aws/docker/library/postgres:17@sha256:f4c66b820c6f974249089d3d16d86a3698eae11e8746eb6644b2271031e91232 | Out-Null

  if ($LASTEXITCODE -ne 0) {
    throw "Could not start the Postgres test container (exit code $LASTEXITCODE)."
  }
  $containerStarted = $true

  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    docker exec `
      $containerName `
      pg_isready --host 127.0.0.1 --username postgres --dbname postgres `
      2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
      $ready = $true
      break
    }
    Start-Sleep -Milliseconds 500
  }

  if (-not $ready) {
    throw 'Postgres test container did not become ready.'
  }

  docker exec `
    --env PGPASSWORD=postgres `
    $containerName `
    psql --set ON_ERROR_STOP=1 --username postgres --dbname postgres `
    --file /workspace/tests/migrations/quarterly-pricing-audit-foundation.sql

  if ($LASTEXITCODE -ne 0) {
    throw "Migration contract test failed with exit code $LASTEXITCODE."
  }

  docker exec `
    --env PGPASSWORD=postgres `
    $containerName `
    createdb --username postgres legacy_drift

  if ($LASTEXITCODE -ne 0) {
    throw "Could not create the legacy-drift test database (exit code $LASTEXITCODE)."
  }

  docker exec `
    --env PGPASSWORD=postgres `
    $containerName `
    psql --set ON_ERROR_STOP=1 --username postgres --dbname legacy_drift `
    --file /workspace/tests/migrations/quarterly-pricing-audit-rejects-legacy-data.sql

  if ($LASTEXITCODE -ne 0) {
    throw "Could not prepare the legacy-drift test database (exit code $LASTEXITCODE)."
  }

  docker exec `
    --env PGPASSWORD=postgres `
    $containerName `
    psql --set ON_ERROR_STOP=1 --username postgres --dbname legacy_drift `
    --file /workspace/supabase/migrations/20260919105053_quarterly_pricing_audit_foundation.sql `
    2>$null

  if ($LASTEXITCODE -eq 0) {
    throw 'Migration accepted populated legacy audit data instead of aborting.'
  }

  docker exec `
    --env PGPASSWORD=postgres `
    $containerName `
    psql --set ON_ERROR_STOP=1 --username postgres --dbname legacy_drift `
    --file /workspace/tests/migrations/quarterly-pricing-audit-legacy-data-remains.sql

  if ($LASTEXITCODE -ne 0) {
    throw "Legacy-data rollback check failed with exit code $LASTEXITCODE."
  }
}
finally {
  if ($containerStarted) {
    docker stop $containerName 2>$null | Out-Null
  }
}
