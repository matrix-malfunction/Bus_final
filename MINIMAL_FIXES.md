# Minimal Fixes - Exact File + Line

Apply these in order. Each fix is self-contained.

---

## Fix 1: Bus Model (Critical)
**File:** `backend/src/models/Bus.js`  
**Action:** Replace entire file  
**Command:**
```bash
cd "w:\Final year project\backend"
copy /Y src\models\Bus.new.js src\models\Bus.js
```
**Verify:**
```bash
node -e "const Bus = require('./src/models/Bus'); console.log('location' in Bus.schema.paths ? 'OK' : 'FAIL')"
```

---

## Fix 2: Register /api/buses Routes (Critical)
**File:** `backend/src/app.js`

### Line 12 - ADD import:
```javascript
const busTrackingRoutes = require("./routes/busTrackingRoutes");
```

### After line 53 - ADD route:
```javascript
app.use("/api/buses", busTrackingRoutes);
```

**Verify:**
```bash
curl http://localhost:3000/api/buses
# Should return: { count: 0, buses: [] } (not "Cannot GET")
```

---

## Fix 3: Driver Writes to Bus Model (Critical)
**File:** `backend/src/controllers/locationController.js`

### Line 151 - ADD after BusLocation.update:

AFTER this block (ends at line 151):
```javascript
const updated = await BusLocation.findOneAndUpdate(
  { busId: busId.trim() },
  { busId: busId.trim(), lat: numLat, lng: numLng, ... },
  { upsert: true, new: true }
);
```

ADD this code (new lines 152-169):
```javascript

// ALSO update the geospatial Bus model (merged)
await Bus.findOneAndUpdate(
  { busId: busId.trim() },
  {
    $set: {
      busId: busId.trim(),
      location: {
        type: "Point",
        coordinates: [numLng, numLat], // [longitude, latitude]
      },
      latitude: numLat,
      longitude: numLng,
      lat: numLat,
      lng: numLng,
      speed: req.body.speed || 0,
      heading: req.body.heading || 0,
      source: source || "mobile",
      status: "active",
      lastUpdate: new Date(),
      timestamp: new Date(),
    },
  },
  { upsert: true, new: true }
);
console.log("✅ ALSO SAVED TO Bus MODEL (geospatial):", busId.trim());
```

---

## Fix 4: Passenger Routes Use Bus Model (High)
**File:** `backend/src/routes/passengerRoutes.js`

### Line 4 - REPLACE import:
**OLD:**
```javascript
const Location = require("../models/Location");
```

**NEW:**
```javascript
const Bus = require("../models/Bus");
const Location = require("../models/Location"); // Keep for now, remove later
```

### Lines 14-17 - REPLACE query:
**OLD:**
```javascript
const buses = await Location.find()
  .select("busId latitude longitude timestamp -_id")
  .sort({ timestamp: -1 })
  .lean();
```

**NEW:**
```javascript
const buses = await Bus.find({
  status: "active",
  lastUpdate: { $gte: new Date(Date.now() - 5 * 60 * 1000) }, // 5 min
})
  .select("busId latitude longitude speed source lastUpdate -_id")
  .sort({ lastUpdate: -1 })
  .lean();
```

---

## Fix 5: Passenger Controller Uses Bus Model (High)
**File:** `backend/src/controllers/passengerController.js`

### Line 1 - REPLACE import:
**OLD:**
```javascript
const Location = require("../models/Location");
```

**NEW:**
```javascript
const Bus = require("../models/Bus");
```

### Lines 15-27 - REPLACE query:
**OLD:**
```javascript
const buses = await Location.find({
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
  .select("busId lat lng speed source updatedAt -_id")
  .lean();
```

**NEW:**
```javascript
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

## Fix 6: Location Controller Uses Bus Model (Medium)
**File:** `backend/src/controllers/locationController.js`

### Line 454 - REPLACE getAllBusLocations query:
**OLD:**
```javascript
const buses = await BusLocation.find({});
```

**NEW:**
```javascript
const buses = await Bus.find({ status: "active" })
  .select("busId latitude longitude lat lng speed source lastUpdate -_id")
  .lean();
```

### Line 231 - REPLACE cache fallback:
**OLD:**
```javascript
const dbCandidatesRaw = await BusLocation.find({})
  .sort({ updatedAt: -1 })
  .limit(50)
  .select("busId lat lng updatedAt")
```

**NEW:**
```javascript
const dbCandidatesRaw = await Bus.find({ status: "active" })
  .sort({ lastUpdate: -1 })
  .limit(50)
  .select("busId lat lng latitude longitude lastUpdate")
```

### Line 510 - REPLACE nearest stop query:
**OLD:**
```javascript
const buses = await BusLocation.find({})
  .select("busId lat lng updatedAt timestamp")
  .lean();
```

**NEW:**
```javascript
const buses = await Bus.find({ status: "active" })
  .select("busId lat lng latitude longitude lastUpdate timestamp")
  .lean();
```

---

## Fix 7: Driver Feature Controller Uses Bus Model (Medium)
**File:** `backend/src/controllers/driverFeatureController.js`

### Line 2 - REPLACE import:
**OLD:**
```javascript
const BusLocation = require("../models/BusLocation");
```

**NEW:**
```javascript
const Bus = require("../models/Bus");
```

### Lines 46-48 - REPLACE query:
**OLD:**
```javascript
const latestBusLocation = await BusLocation.findOne({ busId }).lean();
const latitude = Number(latestBusLocation?.lat);
const longitude = Number(latestBusLocation?.lng);
```

**NEW:**
```javascript
const latestBus = await Bus.findOne({ busId }).lean();
const latitude = Number(latestBus?.latitude || latestBus?.lat);
const longitude = Number(latestBus?.longitude || latestBus?.lng);
```

---

## Fix 8: Driver Controller Uses Bus Model (Low)
**File:** `backend/src/controllers/driverController.js`

### Line 3 - REMOVE Location import (optional, keep if used elsewhere)

### Line 24 - REPLACE with Bus:
**OLD:**
```javascript
const mirroredLocation = await Location.findOneAndUpdate(
  { busId },
  { $set: { routeId } },
  { new: true }
);
```

**NEW:**
```javascript
const mirroredBus = await Bus.findOneAndUpdate(
  { busId },
  { $set: { routeId } },
  { new: true }
);
```

### Line 34 - UPDATE response:
**OLD:**
```javascript
mirroredToLocation: Boolean(mirroredLocation),
```

**NEW:**
```javascript
mirroredToBus: Boolean(mirroredBus),
```

---

## Fix 9: Create MongoDB Index (Run Once)
**File:** MongoDB Shell or Compass

**Command:**
```javascript
db.buses.createIndex({ location: "2dsphere" });
```

**Verify:**
```javascript
db.buses.getIndexes();
// Should show: { key: { location: "2dsphere" }, name: "location_2dsphere" }
```

---

## Fix 10: Run Data Migration (Run Once)
**File:** Terminal

**Command:**
```bash
cd "w:\Final year project\backend"
node scripts/migrateToGeospatial.js
```

This copies existing BusLocation data to Bus model with geospatial coordinates.

---

## Verification After All Fixes

Run these tests:

```bash
# 1. Health check
curl http://localhost:3000/health

# 2. /api/buses endpoint exists
curl http://localhost:3000/api/buses

# 3. Driver updates location (save busId for test)
curl -X POST http://localhost:3000/api/driver/location \
  -H "Authorization: Bearer TOKEN" \
  -d '{"busId":"TEST001","lat":40.7128,"lng":-74.0060}'

# 4. Verify geospatial endpoint returns the bus (NOT empty)
curl "http://localhost:3000/api/buses/nearby?lat=40.7128&lng=-74.0060&radius=5000"
# Expected: { meta: {...}, buses: [{i: "TEST001", la: 40.7128, ln: -74.0060}] }

# 5. Verify passenger endpoint sees the bus
curl http://localhost:3000/api/passenger/nearby-buses \
  -H "Authorization: Bearer TOKEN"
```

---

## Summary

| Fix | File | Lines | Critical? |
|-----|------|-------|-----------|
| 1 | models/Bus.js | All | 🔴 YES |
| 2 | app.js | 12, 53 | 🔴 YES |
| 3 | controllers/locationController.js | 151 | 🔴 YES |
| 4 | routes/passengerRoutes.js | 4, 14-17 | 🔴 YES |
| 5 | controllers/passengerController.js | 1, 15-27 | 🔴 YES |
| 6 | controllers/locationController.js | 231, 454, 510 | 🟡 Medium |
| 7 | controllers/driverFeatureController.js | 2, 46-48 | 🟡 Medium |
| 8 | controllers/driverController.js | 3, 24, 34 | 🟢 Low |
| 9 | MongoDB | Index | 🔴 YES |
| 10 | Migration script | All | 🟡 Medium |

**Start with Fixes 1-5 (Critical).** The rest can follow.
