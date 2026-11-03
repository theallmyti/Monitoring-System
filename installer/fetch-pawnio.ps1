# Downloads the official PawnIO files the installer bundles into installer\vendor\pawnio.
# - PawnIO_setup.exe: signed driver installer (github.com/namazso/PawnIO.Setup, GPL-2.0)
# - AMDFamily17.bin, IntelMSR.bin + COPYING: signed modules (github.com/namazso/PawnIO.Modules, LGPL-2.1)
# Needs the GitHub CLI (gh). Versions are pinned; bump them deliberately.
$ErrorActionPreference = "Stop"
$setupVersion = "2.2.0"
$modulesVersion = "0.2.11"
$dir = Join-Path $PSScriptRoot "vendor\pawnio"
New-Item -ItemType Directory -Force $dir | Out-Null

gh release download $setupVersion -R namazso/PawnIO.Setup -p "PawnIO_setup.exe" -D $dir --clobber
$sig = Get-AuthenticodeSignature (Join-Path $dir "PawnIO_setup.exe")
if ($sig.Status -ne "Valid") { throw "PawnIO_setup.exe signature is $($sig.Status)" }

$zip = Join-Path $env:TEMP "pawnio-modules-$modulesVersion.zip"
gh release download $modulesVersion -R namazso/PawnIO.Modules -p "release_*.zip" -O $zip --clobber
$tmp = Join-Path $env:TEMP "pawnio-modules-$modulesVersion"
Expand-Archive $zip -DestinationPath $tmp -Force
foreach ($f in "AMDFamily17.bin", "IntelMSR.bin", "COPYING") {
  Copy-Item (Get-ChildItem $tmp -Recurse -Filter $f | Select-Object -First 1).FullName $dir -Force
}
Get-ChildItem $dir | Select-Object Name, Length
