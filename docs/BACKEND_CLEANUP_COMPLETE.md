# Backend Cleanup - COMPLETE

## Summary

Removed all legacy model usage and files. The backend now uses only the unified **Bus model** as the single source of truth.

---

## Files Deleted

| File | Status |
|------|--------|
| `backend/src/models/BusLocation.js` | ✅ **DELETED** |

---

## Files Modified

### 1. `backend/src/controllers/locationController.js`

**Changes:**
- ✅ Removed `BusLocation` import (line 1)
- ✅ Removed `BusLocation.findOneAndUpdate()` dual-write (lines 141-151)
- ✅ Driver location API now ONLY writes to Bus model
- ✅ Updated console log message to reflect Bus model only

**Before:**
```javascript
const BusLocation = require("../models/BusLocation");  // ❌ REMOVED
const Bus = require("../models/Bus");

// Dual-write (backward compat)
const updated = await BusLocation.findOneAndUpdate({...});  // ❌ REMOVED
await Bus.findOneAndUpdate({...});  // Primary write
```

**After:**
```javascript
const Bus = require("../models/Bus");  // ✅ ONLY MODEL

// Single source of truth
const updated = await Bus.findOneAndUpdate(
  { busId: busId.trim() },
  {
    $set: {
      busId: busId.trim(),
      location: { type: "Point", coordinates: [numLng, numLat] },
      lat: numLat,
      lng: numLng,
      speed: req.body.speed || 0,
      heading: req.body.heading || 0,
      status: "active",
      lastUpdate: new Date(),
    },
  },
  { upsert: true, new: true }
);
```

---

## Verification: No Legacy Models Remain

### Search Results

```bash
$ grep -r "BusLocation" backend/src --include="*.js" (excluding .patch files)
# No results found ✅

$ grep -r "require.*Location" backend/src --include="*.js" (excluding .patch files)
# No results found ✅
```

### Active Model Imports (Verified)

| Model | Import Location | Status |
|-------|----------------|--------|
| `Bus` | All controllers | ✅ **Active** |
| `Route` | Multiple controllers | ✅ Active |
| `Stop` | Multiple controllers | ✅ Active |
| `User` | auth, admin controllers | ✅ Active |
| `Passenger` | passenger controllers | ✅ Active |
| `DriverEmergency` | driver controllers | ✅ Active |
| `BusLocation` | **None** | ✅ **Removed** |
| `Location` | **None** | ✅ **Removed** |

---

## Final Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│  POST /api/driver/location                                   │
│  Controller: locationController.js                           │
│                                                              │
│  Bus.findOneAndUpdate(...) ───────────► buses (SINGLE)      │
│     - location: { type: "Point", coordinates: [lng, lat] }  │
│     - lat, lng, speed, heading, status: "active"          │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
              ┌────────────────┐
              │  MongoDB       │
              │  buses collection (ONLY)
              └───────┬────────┘
                      │
        ┌─────────────┼─────────────┐
        │             │             │
        ▼             ▼             ▼
  ┌──────────┐  ┌──────────┐  ┌──────────┐
  │Passenger │  │/api/buses│  │Emergency │
  │API       │  │/nearby   │  │API       │
  └──────────┘  └──────────┘  └──────────┘
        │             │             │
        └─────────────┴─────────────┘
                      │
                All use: Bus.find({...})
```

---

## MongoDB Collections (Current State)

| Collection | Status | Notes |
|------------|--------|-------|
| `buses` | ✅ **ACTIVE** | Single source of truth with geospatial index |
| `buslocations` | ⚠️ **ORPHANED** | Old data remains, no new writes |
| `locations` | ⚠️ **ORPHANED** | Old data remains, no new writes |

**Cleanup (Optional):**
```javascript
// Archive old collections after verification
use your-database

db.buslocations.renameCollection("buslocations_archive_2024")
db.locations.renameCollection("locations_archive_2024")

// Or drop if confident
db.buslocations.drop()
db.locations.drop()
```

---

## API Endpoints (All Using Bus Model)

| Endpoint | Method | Model | Notes |
|----------|--------|-------|-------|
| `/api/driver/location` | POST | Bus | Single write (no dual-write) |
| `/api/passenger/nearby-buses` | GET | Bus | Geospatial query |
| `/api/buses/nearby` | GET | Bus | Geospatial query |
| `/api/buses/bounds` | GET | Bus | Bounding box query |
| `/api/location/all` | GET | Bus | Backward compatible |
| `/api/driver/emergency` | POST | Bus | Reads from Bus |

---

## Test Verification

```bash
# 1. Start server
cd backend
npm start

# 2. Driver updates location (writes ONLY to Bus)
curl -X POST http://localhost:3000/api/driver/location \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer DRIVER_TOKEN" \
  -d '{
    "busId": "CLEANUP_TEST",
    "lat": 40.7128,
    "lng": -74.0060,
    "speed": 30,
    "heading": 45
  }'

# Expected: 200 OK with bus data from Bus model

# 3. Verify NO writes to buslocations
db.buslocations.find({ busId: "CLEANUP_TEST" })
# Expected: No documents found

# 4. Verify write to buses
db.buses.find({ busId: "CLEANUP_TEST" })
# Expected: One document with geospatial location

# 5. Passenger reads from Bus
curl "http://localhost:3000/api/passenger/nearby-buses?lat=40.7128&lng=-74.0060&radiusKm=5" \
  -H "Authorization: Bearer PASSENGER_TOKEN"

# Expected: CLEANUP_TEST bus in response

# 6. Geospatial API reads from Bus
curl "http://localhost:3000/api/buses/nearby?lat=40.7128&lng=-74.0060&radius=5000"

# Expected: CLEANUP_TEST bus in response
```

---

## Summary

| Check | Status |
|-------|--------|
| BusLocation model file deleted | ✅ |
| BusLocation imports removed | ✅ |
| BusLocation usage removed | ✅ |
| Driver ONLY writes to Bus | ✅ |
| All controllers use Bus | ✅ |
| No legacy model references | ✅ |
| Single source of truth | ✅ **Bus model** |

**Cleanup Status: COMPLETE** ✅

The backend now has a clean, unified architecture with only the Bus model for all bus location operations.
