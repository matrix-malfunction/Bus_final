# Backend Merge Verification Report

**Date:** April 23, 2026  
**Status:** 🔴 **FAILED - Critical Issues Found**  
**Action Required:** Immediate fixes needed

---

## Verification Checklist Results

### ❌ 1. Only ONE model (Bus) used across all routes
**Result:** FAILED - Three models still in use

| Model | Status | Bytes | Used By |
|-------|--------|-------|---------|
| Bus.js | ⚠️ OLD version | 372 | driverController.js, adminController.js |
| Bus.new.js | ✅ New (not applied) | 7,238 | **SITTING UNUSED** |
| BusLocation.js | ⚠️ Still used | 335 | locationController.js, driverFeatureController.js |
| Location.js | ⚠️ Still used | 1,454 | passengerRoutes.js, passengerController.js, driverController.js |

**Problem:**  
- `Bus.new.js` exists but was never copied to `Bus.js`
- Current `Bus.js` only has `busId` and `routeId` fields
- Missing: `location`, `latitude`, `longitude`, `speed`, `status`, `lastUpdate`

**Fix Required:**
```bash
cd "w:\Final year project\backend"
copy /Y src\models\Bus.new.js src\models\Bus.js
```

---

### ❌ 2. Driver location updates write to Bus model
**Result:** FAILED - Writes to BusLocation only

**Evidence:**
```javascript
// backend/src/controllers/locationController.js:141-151
const updated = await BusLocation.findOneAndUpdate(
  { busId: busId.trim() },
  {
    busId: busId.trim(),
    lat: numLat,
    lng: numLng,
    source: source || "mobile",
    updatedAt: new Date(),
  },
  { upsert: true, new: true }
);
// NO Bus model update after this!
```

**Missing:** No `Bus.findOneAndUpdate()` call to write geospatial data

**Fix Required:**
Add after line 151 in `locationController.js`:
```javascript
// ALSO update the geospatial Bus model
await Bus.findOneAndUpdate(
  { busId: busId.trim() },
  {
    $set: {
      busId: busId.trim(),
      location: {
        type: "Point",
        coordinates: [numLng, numLat],
      },
      latitude: numLat,
      longitude: numLng,
      lat: numLat,
      lng: numLng,
      speed: req.body.speed || 0,
      source: source || "mobile",
      status: "active",
      lastUpdate: new Date(),
    },
  },
  { upsert: true, new: true }
);
```

---

### ❌ 3. Passenger APIs read from Bus model
**Result:** FAILED - Still reads from Location model

**Evidence 1 - passengerRoutes.js:**
```javascript
// backend/src/routes/passengerRoutes.js:4
const Location = require("../models/Location");  // ❌ WRONG MODEL

// backend/src/routes/passengerRoutes.js:14
const buses = await Location.find()  // ❌ WRONG MODEL
  .select("busId latitude longitude timestamp -_id")
  .sort({ timestamp: -1 })
  .lean();
```

**Evidence 2 - passengerController.js:**
```javascript
// backend/src/controllers/passengerController.js:1
const Location = require("../models/Location");  // ❌ WRONG MODEL

// backend/src/controllers/passengerController.js:15
const buses = await Location.find({  // ❌ WRONG MODEL
  location: {
    $near: {
      $geometry: {
        type: "Point",
        coordinates: [longitude, latitude],
      },
      $maxDistance: radiusMeters,
    },
  },
})
```

**Fix Required for passengerRoutes.js:**
```javascript
// Line 4: Add Bus import
const Bus = require("../models/Bus");

// Lines 14-17: Replace Location.find with Bus.find
const buses = await Bus.find({
  status: "active",
  lastUpdate: { $gte: new Date(Date.now() - 5 * 60 * 1000) },
})
  .select("busId latitude longitude speed source lastUpdate -_id")
  .sort({ lastUpdate: -1 })
  .lean();
```

**Fix Required for passengerController.js:**
```javascript
// Line 1: Change import
const Bus = require("../models/Bus");

// Lines 15-27: Replace query
const buses = await Bus.find({
  location: {
    $near: {
      $geometry: {
        type: "Point",
        coordinates: [longitude, latitude],
      },
      $maxDistance: radiusMeters,
    },
  },
  status: "active",
  lastUpdate: { $gte: new Date(Date.now() - 5 * 60 * 1000) },
})
  .select("busId latitude longitude speed source lastUpdate -_id")
  .lean();
```

---

### ❌ 4. No remaining usage of Location or BusLocation models
**Result:** FAILED - Both models still actively used

**BusLocation Usage:**
```
backend/src/controllers/locationController.js:1    (import)
backend/src/controllers/locationController.js:141  (write)
backend/src/controllers/locationController.js:231  (read)
backend/src/controllers/locationController.js:454  (read)
backend/src/controllers/locationController.js:510  (read)
backend/src/controllers/driverFeatureController.js:2   (import)
backend/src/controllers/driverFeatureController.js:46  (read)
```

**Location Usage:**
```
backend/src/controllers/driverController.js:3    (import)
backend/src/controllers/driverController.js:24   (write)
backend/src/routes/passengerRoutes.js:4          (import)
backend/src/routes/passengerRoutes.js:14         (read)
backend/src/controllers/passengerController.js:1 (import)
backend/src/controllers/passengerController.js:15 (read)
```

**Files needing fixes:**
1. `locationController.js` - Replace all BusLocation with Bus
2. `driverFeatureController.js` - Replace BusLocation with Bus
3. `driverController.js` - Replace Location with Bus
4. `passengerRoutes.js` - Replace Location with Bus
5. `passengerController.js` - Replace Location with Bus

---

### ❌ 5. MongoDB has 2dsphere index on Bus.location
**Result:** CANNOT VERIFY - Schema not applied

**Issue:** The current `Bus.js` doesn't have a `location` field, so no 2dsphere index can exist.

**Verification command (after applying Bus.new.js):**
```javascript
// In MongoDB shell
db.buses.getIndexes()

// Should show:
{ key: { location: "2dsphere" }, name: "location_2dsphere" }
```

**Fix Required:**
1. Apply Bus.new.js to Bus.js
2. Create index:
```javascript
db.buses.createIndex({ location: "2dsphere" })
```

---

### ❌ 6. /api/buses/nearby returns non-empty data after driver update
**Result:** FAILED - Endpoint not even registered!

**Evidence:**
```javascript
// backend/src/app.js - NO busTrackingRoutes registration!
app.use("/api/health", healthRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/driver", driverRoutes);
// ...
// MISSING: app.use("/api/buses", busTrackingRoutes);
```

**File exists but not registered:** `backend/src/routes/busTrackingRoutes.js` exists but is never imported or used in `app.js`.

**Fix Required:**
```javascript
// backend/src/app.js - Add these lines after line 12
const busTrackingRoutes = require("./routes/busTrackingRoutes");

// backend/src/app.js - Add after line 53
app.use("/api/buses", busTrackingRoutes);
```

---

## Summary of Required Fixes

### Immediate (Critical)

| Priority | File | Line(s) | Action |
|----------|------|---------|--------|
| 1 | `models/Bus.js` | All | Replace with Bus.new.js content |
| 2 | `app.js` | After 12, After 53 | Import and register busTrackingRoutes |
| 3 | `controllers/locationController.js` | 1, 141-151, 231, 454, 510 | Add Bus write, replace reads |
| 4 | `routes/passengerRoutes.js` | 4, 14-17 | Replace Location with Bus |
| 5 | `controllers/passengerController.js` | 1, 15-27 | Replace Location with Bus |

### Secondary (High)

| Priority | File | Line(s) | Action |
|----------|------|---------|--------|
| 6 | `controllers/driverFeatureController.js` | 2, 46-48 | Replace BusLocation with Bus |
| 7 | `controllers/driverController.js` | 3, 24 | Replace Location with Bus |
| 8 | `controllers/locationController.js` | 454, 510 | Replace BusLocation.find with Bus.find |

### Database

| Priority | Action | Command |
|----------|--------|---------|
| 9 | Create 2dsphere index | `db.buses.createIndex({ location: "2dsphere" })` |
| 10 | Run data migration | `node scripts/migrateToGeospatial.js` |

---

## Minimal Fix Script

Save and run this PowerShell script to apply critical fixes:

```powershell
# Fix 1: Apply Bus model
copy-Item "w:\Final year project\backend\src\models\Bus.new.js" "w:\Final year project\backend\src\models\Bus.js" -Force

# Fix 2: Install dependencies
cd "w:\Final year project\backend"
npm install compression helmet express-rate-limit

Write-Host "Bus model updated. Now manually apply patches to controllers."
```

Then manually apply the patches documented in:
- `backend/src/controllers/locationController.js.patch`
- `backend/src/routes/passengerRoutes.js.patch`
- `backend/src/controllers/passengerController.js.patch`

---

## Test Procedure

After fixes, verify with:

```bash
# 1. Start server
cd backend
npm run dev

# 2. Check health
curl http://localhost:3000/health

# 3. Check /api/buses endpoint exists
curl http://localhost:3000/api/buses

# 4. Driver updates location
curl -X POST http://localhost:3000/api/driver/location \
  -H "Authorization: Bearer TOKEN" \
  -d '{"busId":"TEST001","lat":40.7128,"lng":-74.0060}'

# 5. Verify geospatial endpoint returns data (NOT empty!)
curl "http://localhost:3000/api/buses/nearby?lat=40.7128&lng=-74.0060&radius=5000"
# Expected: { meta: {...}, buses: [{i: "TEST001", la: 40.7128, ...}] }
# NOT: { meta: {...}, buses: [] }

# 6. Verify passenger endpoint
curl http://localhost:3000/api/passenger/nearby-buses \
  -H "Authorization: Bearer TOKEN"
```

---

## Root Cause

The merge was incomplete because:

1. **Bus.new.js was never applied** - The merged model with geospatial fields exists but wasn't copied over the old Bus.js
2. **busTrackingRoutes.js not registered** - The file exists but app.js doesn't import/use it
3. **Controllers not updated** - Still using old Location and BusLocation models
4. **No dual-write logic** - Driver updates don't write to the new Bus model

---

## Risk Assessment

| Risk | Current State | After Fix |
|------|---------------|-----------|
| Driver updates lost | ❌ Updates go to BusLocation (isolated) | ✅ Updates go to Bus (shared) |
| Passenger sees no buses | ❌ Reads from Location (different from driver) | ✅ Reads from Bus (same as driver) |
| Geospatial API broken | ❌ Not even registered | ✅ Works with 2dsphere index |
| Data fragmentation | ❌ 3 collections (Bus, BusLocation, Location) | ✅ 1 collection (Bus) |

---

## Next Steps

1. **Apply Fix 1** (Bus model) - `copy Bus.new.js Bus.js`
2. **Apply Fix 2** (app.js) - Add busTrackingRoutes import and registration
3. **Apply Fix 3** (locationController.js) - Add Bus.write after BusLocation.write
4. **Test locally** - Verify /api/buses/nearby returns data
5. **Deploy** - Push to Render
6. **Run migration** - Copy old data to Bus model
7. **Apply remaining fixes** - Switch all reads to Bus model

---

**Estimated time to fix:** 30 minutes  
**Files to modify:** 6  
**Lines to change:** ~25
