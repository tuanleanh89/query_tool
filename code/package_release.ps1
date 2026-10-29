# ==============================================================================
# Clean Release Packaging Script
# Excludes database logs, user report sessions, and temporary files
# ==============================================================================

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

# 1. Read version from manifest.json
$manifestPath = Join-Path $scriptDir "manifest.json"
if (!(Test-Path $manifestPath)) {
    Write-Host "[ERROR] manifest.json not found!" -ForegroundColor Red
    exit 1
}

$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$currentVer = $manifest.version
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  PACKAGING EXTENSION UPDATE - VERSION v$currentVer" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 2. Prepare release_dist folder
$distDir = Join-Path $scriptDir "release_dist"
if (Test-Path $distDir) {
    Remove-Item -Path $distDir -Recurse -Force
}
New-Item -ItemType Directory -Path $distDir | Out-Null

$tempPackDir = Join-Path $distDir "temp_pack"
New-Item -ItemType Directory -Path $tempPackDir | Out-Null

# 3. Copy clean source files
Write-Host "[1/4] Copying clean source files (excluding db, logs, sessions)..." -ForegroundColor Yellow

$includeFiles = @(
    "manifest.json",
    "background.js",
    "content.js",
    "ui.html",
    "ui.js",
    "sites_data.json",
    "sql-formatter.min.js",
    "sweetalert2.all.min.js",
    "bootstrap.bundle.min.js",
    "xlsx.full.min.js",
    "icon_red.png"
)

foreach ($f in $includeFiles) {
    $src = Join-Path $scriptDir $f
    if (Test-Path $src) {
        Copy-Item -Path $src -Destination $tempPackDir -Force
    } else {
        Write-Host "  [WARN] File not found: $f" -ForegroundColor Yellow
    }
}

# Copy vs/ folder (Monaco Editor)
$vsDir = Join-Path $scriptDir "vs"
if (Test-Path $vsDir) {
    Copy-Item -Path $vsDir -Destination (Join-Path $tempPackDir "vs") -Recurse -Force
}

# 4. Zip for Chrome
Write-Host "[2/4] Creating query_tool_chrome.zip..." -ForegroundColor Yellow
$chromeZip = Join-Path $distDir "query_tool_chrome.zip"
Compress-Archive -Path "$tempPackDir\*" -DestinationPath $chromeZip -Force

# 5. Package for Firefox (.xpi)
Write-Host "[3/4] Creating query_tool.xpi..." -ForegroundColor Yellow
$firefoxXpi = Join-Path $distDir "query_tool.xpi"
Copy-Item -Path $chromeZip -Destination $firefoxXpi -Force

# Clean up temp folder
Remove-Item -Path $tempPackDir -Recurse -Force

# 6. Generate version.json
Write-Host "[4/4] Generating version.json..." -ForegroundColor Yellow
$today = (Get-Date).ToString("yyyy-MM-dd")
$versionObj = [ordered]@{
    "version" = $currentVer
    "release_date" = $today
    "changelog" = @(
        "Cap nhat tinh nang va toi uu hoa hieu nang",
        "Tu dong dong bo va bao luu 100% lich su lam viec"
    )
    "download_urls" = [ordered]@{
        "chrome" = "https://raw.githubusercontent.com/tuanleanh89/query_tool/main/query_tool_chrome.zip"
        "firefox" = "https://raw.githubusercontent.com/tuanleanh89/query_tool/main/query_tool.xpi"
    }
}

$versionJsonPath = Join-Path $distDir "version.json"
$versionObj | ConvertTo-Json -Depth 5 | Set-Content $versionJsonPath -Encoding UTF8

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "  PACKAGING COMPLETED SUCCESSFULLY!" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "Output directory: $distDir" -ForegroundColor White
Write-Host "  - query_tool_chrome.zip (For Chrome/Edge/Coc Coc)"
Write-Host "  - query_tool.xpi (For Firefox)"
Write-Host "  - version.json (Update manifest)"
Write-Host ""
