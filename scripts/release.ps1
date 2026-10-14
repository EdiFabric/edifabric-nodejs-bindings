<#
.SYNOPSIS
Build the npm packages, smoke-test the one for this machine, and publish them.

.DESCRIPTION
Publishing needs `npm login` or an NPM_TOKEN in ~/.npmrc with publish rights to edifabric-x12
and the @edifabric scope.

.EXAMPLE
./scripts/release.ps1 -DryRun
./scripts/release.ps1 -Tag next
./scripts/release.ps1
#>
param(
    [switch]$DryRun,
    [string]$Tag = 'latest',
    [switch]$SkipFetch
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

function Invoke-Checked {
    # Native tools write progress to stderr; only the exit code decides failure.
    $ErrorActionPreference = 'Continue'
    & $args[0] $args[1..($args.Count - 1)] 2>&1 | ForEach-Object { "$_" }
    if ($LASTEXITCODE -ne 0) { throw "$($args -join ' ') failed with exit code $LASTEXITCODE" }
}

$nodeMajor = [int]((node -p 'process.versions.node') -split '\.')[0]
if ($nodeMajor -lt 18) { throw "Node.js 18 or later is required; found $(node --version)" }

if (-not $SkipFetch) { & "$PSScriptRoot/fetch-natives.ps1" -Destination natives }
Invoke-Checked node scripts/build-packages.mjs

# Smoke test: install the packed main package and this machine's platform package into a scratch project.
$work = Join-Path ([IO.Path]::GetTempPath()) ([IO.Path]::GetRandomFileName())
New-Item -ItemType Directory $work | Out-Null
try {
    $platform = "x12-$(node -p 'process.platform')-$(node -p 'process.arch')"
    Push-Location $work
    try {
        $mainTgz = (npm pack --silent (Join-Path $root 'dist/npm/edifabric-x12')) | Select-Object -Last 1
        $platformTgz = (npm pack --silent (Join-Path $root "dist/npm/$platform")) | Select-Object -Last 1
        Invoke-Checked npm init -y | Out-Null
        Invoke-Checked npm install --silent --no-audit --no-fund "./$mainTgz" "./$platformTgz"
        Copy-Item (Join-Path $root 'scripts/smoke-test.cjs') .
        Invoke-Checked node smoke-test.cjs
    }
    finally {
        Pop-Location
    }
}
finally {
    Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
}

$publishArgs = @('--access', 'public', '--tag', $Tag)
if ($DryRun) { $publishArgs += '--dry-run' }
# Platform packages first, so the main package's optional dependencies resolve.
foreach ($dir in Get-ChildItem dist/npm -Directory -Filter 'x12-*') {
    Invoke-Checked npm publish $dir.FullName @publishArgs
}
Invoke-Checked npm publish (Join-Path $root 'dist/npm/edifabric-x12') @publishArgs
if ($DryRun) { Write-Host 'Dry run: nothing was published.' }
