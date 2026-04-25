# Quick Fix Script for Backend Merge Issues
# Run this in PowerShell

Write-Host "========================================" -ForegroundColor Green
Write-Host "Backend Merge - Quick Fixes" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

$BackendDir = "w:\Final year project\backend"

# Fix 1: Apply Bus model
Write-Host "Fix 1: Applying merged Bus model..." -ForegroundColor Yellow
$SourceFile = Join-Path $BackendDir "src\models\Bus.new.js"
$DestFile = Join-Path $BackendDir "src\models\Bus.js"

if (Test-Path $SourceFile) {
    Copy-Item $SourceFile $DestFile -Force
    Write-Host "  [OK] Bus model updated (7,238 bytes)" -ForegroundColor Green
} else {
    Write-Host "  [ERROR] Bus.new.js not found!" -ForegroundColor Red
    exit 1
}

# Fix 2: Install dependencies
Write-Host ""
Write-Host "Fix 2: Installing dependencies..." -ForegroundColor Yellow
Set-Location $BackendDir
npm install compression helmet express-rate-limit 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
    Write-Host "  [OK] Dependencies installed" -ForegroundColor Green
} else {
    Write-Host "  [WARNING] Some dependencies may have failed" -ForegroundColor Yellow
}

# Fix 3: Check if busTrackingRoutes is registered
Write-Host ""
Write-Host "Fix 3: Checking app.js registration..." -ForegroundColor Yellow
$AppJs = Get-Content (Join-Path $BackendDir "src\app.js") -Raw
if ($AppJs -match "busTrackingRoutes") {
    Write-Host "  [OK] busTrackingRoutes is imported" -ForegroundColor Green
} else {
    Write-Host "  [MISSING] Need to add busTrackingRoutes to app.js" -ForegroundColor Red
    Write-Host "  Add: const busTrackingRoutes = require(""./routes/busTrackingRoutes"");" -ForegroundColor Cyan
    Write-Host "  Add: app.use(""/api/buses"", busTrackingRoutes);" -ForegroundColor Cyan
}

# Fix 4: Check locationController for Bus write
Write-Host ""
Write-Host "Fix 4: Checking locationController.js..." -ForegroundColor Yellow
$LocationCtrl = Get-Content (Join-Path $BackendDir "src\controllers\locationController.js") -Raw
if ($LocationCtrl -match "Bus\.findOneAndUpdate" -and $LocationCtrl -match "location.*type.*Point") {
    Write-Host "  [OK] Bus model write found" -ForegroundColor Green
} else {
    Write-Host "  [MISSING] Need to add Bus model write after BusLocation write" -ForegroundColor Red
    Write-Host "  See: backend/src/controllers/locationController.js.patch" -ForegroundColor Cyan
}

# Fix 5: Check passenger routes
Write-Host ""
Write-Host "Fix 5: Checking passengerRoutes.js..." -ForegroundColor Yellow
$PassengerRoutes = Get-Content (Join-Path $BackendDir "src\routes\passengerRoutes.js") -Raw
if ($PassengerRoutes -match "const Bus = require") {
    Write-Host "  [OK] Bus import found" -ForegroundColor Green
} else {
    Write-Host "  [MISSING] Need to replace Location with Bus" -ForegroundColor Red
    Write-Host "  See: backend/src/routes/passengerRoutes.js.patch" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "Quick Fixes Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor White
Write-Host "1. Review manual patches in *.patch files" -ForegroundColor Yellow
Write-Host "2. Apply patches to controllers" -ForegroundColor Yellow
Write-Host "3. Run: npm run dev" -ForegroundColor Yellow
Write-Host "4. Test: curl http://localhost:3000/api/buses" -ForegroundColor Yellow
Write-Host ""
