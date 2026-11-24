<#
.SYNOPSIS
  Builds the two release downloads of the Spirit Island history site.

.DESCRIPTION
  Creates, in dist\:
    spirit-island-history-<version>.zip                      (needs Python installed)
    spirit-island-history-<version>-windows-with-python.zip  (includes portable Python)

  Only an allowlist of project files is packaged, so personal data (data\),
  the old config.json and downloaded artwork (web\art\) can never end up in a
  release, even when building from your own working folder.

  The portable Python is the official "embeddable package" from python.org.
  Its version and SHA256 checksum are pinned below; the build stops if the
  download doesn't match.

  Works in Windows PowerShell 5.1 and PowerShell 7 (used by the GitHub Action).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\build-release.ps1 -Version v1.0.0
#>
param(
  [Parameter(Mandatory = $true)] [string] $Version,
  [string] $OutDir,
  [switch] $SkipPython   # only build the plain ZIP (no download)
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"   # makes Invoke-WebRequest much faster in 5.1

# --- Pinned portable Python ----------------------------------------------------
# To update: pick a version on https://www.python.org/downloads/windows/, open its
# release page and copy the SHA256 of "Windows embeddable package (64-bit)".
$PythonVersion = "3.14.10"
$PythonSha256  = "90905e64a840557d8c1bc4f5b74db3d7ee85e3ffb217611cac1c7813acea4159"
$PythonUrl     = "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-embed-amd64.zip"

# --- What goes into a release ------------------------------------------------------
$Root = Split-Path -Parent $PSScriptRoot
$Files = @("server.py", "start.bat", "README.md", "LICENSE", "LICENSE.md", "LICENSE.txt")
$Folders = @("web")
# Never packaged, whatever the allowlist says (relative paths, regex on "\"-separated paths):
$Forbidden = @('^data(\\|$)', '^config\.json$', '^web\\art\\.', '^dist(\\|$)', '^python(\\|$)', '\.tmp$', '__pycache__')

if ($Version -notmatch '^[A-Za-z0-9._-]+$') { throw "Version may only contain letters, digits, '.', '_' and '-': $Version" }
if (-not $OutDir) { $OutDir = Join-Path $Root "dist" }
$Name = "spirit-island-history"
$Work = Join-Path ([IO.Path]::GetTempPath()) ("si-release-" + [Guid]::NewGuid().ToString("N").Substring(0, 8))

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Copy-Allowlisted([string] $Dest) {
  New-Item -ItemType Directory -Force $Dest | Out-Null
  foreach ($f in $Files) {
    $src = Join-Path $Root $f
    if (Test-Path $src -PathType Leaf) { Copy-Item $src (Join-Path $Dest $f) }
  }
  foreach ($folder in $Folders) {
    $srcDir = Join-Path $Root $folder
    Get-ChildItem $srcDir -Recurse -File | ForEach-Object {
      $rel = $_.FullName.Substring($Root.Length + 1)
      if ($Forbidden | Where-Object { $rel -match $_ }) { return }   # e.g. web\art\*
      $target = Join-Path $Dest $rel
      New-Item -ItemType Directory -Force (Split-Path $target) | Out-Null
      Copy-Item $_.FullName $target
    }
  }
  # start.bat must have Windows line endings, or cmd.exe can misread it.
  $bat = Join-Path $Dest "start.bat"
  $text = [IO.File]::ReadAllText($bat) -replace "`r?`n", "`r`n"
  [IO.File]::WriteAllText($bat, $text, [Text.Encoding]::ASCII)
}

function Assert-Clean([string] $Dir) {
  $bad = Get-ChildItem $Dir -Recurse -Force | ForEach-Object { $_.FullName.Substring($Dir.Length + 1) } |
    Where-Object { $rel = $_; ($Forbidden | Where-Object { $rel -match $_ }) -and $rel -notmatch '^python\\' }
  if ($bad) { throw "Refusing to build: these must never be released:`n  " + ($bad -join "`n  ") }
}

# Zip with "/" separators and a top folder, so it unzips cleanly everywhere.
function New-Zip([string] $Dir, [string] $ZipPath) {
  if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }
  $zip = [IO.Compression.ZipFile]::Open($ZipPath, [IO.Compression.ZipArchiveMode]::Create)
  try {
    Get-ChildItem $Dir -Recurse -File | Sort-Object FullName | ForEach-Object {
      $entry = "$Name/" + $_.FullName.Substring($Dir.Length + 1).Replace('\', '/')
      [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $entry, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
  } finally { $zip.Dispose() }
}

try {
  New-Item -ItemType Directory -Force $OutDir | Out-Null

  # 1. Plain version (needs Python installed)
  $plain = Join-Path $Work "plain"
  Copy-Allowlisted $plain
  Assert-Clean $plain
  $plainZip = Join-Path $OutDir "$Name-$Version.zip"
  New-Zip $plain $plainZip
  Write-Host "Built $plainZip"

  if (-not $SkipPython) {
    # 2. Windows version with portable Python
    $download = Join-Path $Work "python-embed.zip"
    Write-Host "Downloading Python $PythonVersion (embeddable, 64-bit) from python.org..."
    Invoke-WebRequest -UseBasicParsing -Uri $PythonUrl -OutFile $download
    $hash = (Get-FileHash $download -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($hash -ne $PythonSha256) { throw "Checksum mismatch for $PythonUrl`n  expected $PythonSha256`n  got      $hash" }
    Write-Host "Checksum OK."

    $bundled = Join-Path $Work "with-python"
    Copy-Allowlisted $bundled
    Assert-Clean $bundled
    Expand-Archive -Path $download -DestinationPath (Join-Path $bundled "python")
    $bundledZip = Join-Path $OutDir "$Name-$Version-windows-with-python.zip"
    New-Zip $bundled $bundledZip
    Write-Host "Built $bundledZip"
  }

  Write-Host ""
  Get-ChildItem $OutDir -Filter "$Name-$Version*.zip" | ForEach-Object {
    Write-Host ("  {0}  ({1:N1} MB)" -f $_.Name, ($_.Length / 1MB))
  }
} finally {
  if (Test-Path $Work) { Remove-Item -Recurse -Force $Work }
}
