@echo off
REM Backend Merge Fix Script for Windows
REM This script applies all critical patches

echo ========================================
echo Backend Merge - Critical Patches
echo ========================================
echo.

set BACKEND_DIR=%~dp0backend

echo Step 1: Replacing Bus model with geospatial version...
copy /Y "%BACKEND_DIR%\src\models\Bus.new.js" "%BACKEND_DIR%\src\models\Bus.js"
if %ERRORLEVEL% neq 0 (
    echo FAILED to copy Bus model
    exit /b 1
)
echo [OK] Bus model updated

echo.
echo Step 2: Installing required dependencies...
cd "%BACKEND_DIR%"
npm install compression helmet express-rate-limit
if %ERRORLEVEL% neq 0 (
    echo FAILED to install dependencies
    exit /b 1
)
echo [OK] Dependencies installed

echo.
echo Step 3: Running migration script...
node scripts\migrateToGeospatial.js
if %ERRORLEVEL% neq 0 (
    echo WARNING: Migration had issues, check output above
) else (
    echo [OK] Migration completed
)

echo.
echo ========================================
echo Patches Applied!
echo ========================================
echo.
echo NEXT STEPS:
echo 1. Review the manual patches in BACKEND_AUDIT_CRITICAL_ISSUES.md
echo 2. Update locationController.js (lines 141-151, 452-454)
echo 3. Update passengerController.js (lines 1, 15-27)
echo 4. Update passengerRoutes.js (line 14)
echo 5. Test locally: npm run dev
echo 6. Deploy to production
echo.
pause
