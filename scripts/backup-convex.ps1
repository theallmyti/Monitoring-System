# Backs up the PC Monitor Convex database (every table) to backups\convex-<target>-<date>.zip.
#
#   powershell -File scripts\backup-convex.ps1          # prod (needs `npx convex login`)
#   powershell -File scripts\backup-convex.ps1 -Dev     # dev deployment
#
# The ZIP holds email addresses, password hashes and device-secret hashes: keep it private.
# backups\ is git-ignored. Only the newest -Keep backups of each target are kept (default 8).
# Restore: see scripts\README.md.
param(
  [switch]$Dev,
  [int]$Keep = 8
)
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root 'backups'
New-Item -ItemType Directory -Force $outDir | Out-Null

$target = if ($Dev) { 'dev' } else { 'prod' }
$file = Join-Path $outDir ('convex-{0}-{1}.zip' -f $target, (Get-Date -Format 'yyyy-MM-dd_HHmm'))

$cliArgs = @('convex', 'export', '--path', $file)
if (-not $Dev) { $cliArgs += '--prod' }

Push-Location (Join-Path $root 'convex')
try {
  & npx @cliArgs
  if ($LASTEXITCODE -ne 0) { throw "npx convex export failed (exit code $LASTEXITCODE)" }
} finally {
  Pop-Location
}
if (-not (Test-Path $file)) { throw "Export finished but $file was not created" }

# Keep the newest $Keep backups of this target.
Get-ChildItem $outDir -Filter "convex-$target-*.zip" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -Skip $Keep |
  Remove-Item

$size = [math]::Round((Get-Item $file).Length / 1KB)
Write-Host "Saved $file ($size KB)"
