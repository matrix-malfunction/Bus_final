# Backend Data Consistency Fix - COMPLETE

## Summary

Fixed data inconsistency by unifying all APIs to use the single **Bus model** (with geospatial capabilities) instead of three separate models.

**Result:** All driver writes and passenger reads now use the same MongoDB collection (`buses`) with consistent geospatial data.

---

## Problem Identified

| Model | Collection | Used By | Status Before |
|-------|------------|---------|---------------|
| `Bus` (geospatial) | `buses` | `/api/buses/*` | ✅ Working |
| `BusLocation` | `buslocations` | `locationController` (driver updates) | ❌ Outdated |
| `Location` | `locations` | `passengerController` (passenger reads) | ❌ Outdated |

**Issue:** Driver wrote to `BusLocation`, passenger read from `Location`, and `/api/buses` read from `Bus`. Data was fragmented across 3 collections.

---

## Files Modified

### 1. `backend/src/controllers/locationController.js`

**Changes:**
- ✅ Added dual-write to Bus model after BusLocation write (lines 153-172)
- ✅ Replaced BusLocation.find with Bus.find in cache fallback (line 252)
- ✅ Replaced BusLocation.find with Bus.find in getAllBusLocations (line 475)
- ✅ Replaced BusLocation.find with Bus.find in getNearestSingleBus (line 531)

**Dual-Write Code Added:**
```javascript
// ALSO update geospatial Bus model (single source of truth)
await Bus.findOneAndUpdate(
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

### 2. `backend/src/controllers/passengerController.js`

**Changes:**
- ✅ Replaced `Location` import with `Bus` (line 1)
- ✅ Replaced `Location.find` with `Bus.find` (line 15)
- ✅ Added `status: "active"` filter for consistency
- ✅ Updated field selection to use Bus model fields

**New Query:**
```javascript
const buses = await Bus.find({
  location: { $near: { ... } },
  status: "active",
}).select("busId lat lng speed heading status lastUpdate -_id")
```

---

### 3. `backend/src/routes/passengerRoutes.js`

**Changes:**
- ✅ Replaced `Location` import with `Bus` (line 4)
- ✅ Replaced `Location.find()` with `Bus.find({ status: "active" })` (line 14)
- ✅ Updated field selection to include geospatial fields

---

### 4. `backend/src/controllers/driverFeatureController.js`

**Changes:**
- ✅ Replaced `BusLocation` import with `Bus` (line 2)
- ✅ Updated `triggerSos` function to read from Bus model (lines 46-48)
- ✅ Added fallback logic for both `location.coordinates` and legacy `lat/lng` fields

**New Query:**
```javascript
const latestBus = await Bus.findOne({ busId }).lean();
const latitude = Number(latestBus?.location?.coordinates?.[1] || latestBus?.lat);
const longitude = Number(latestBus?.location?.coordinates?.[0] || latestBus?.lng);
```

---

### 5. `backend/src/controllers/driverController.js`

**Changes:**
- ✅ Removed `Location` import (line 3 deleted)
- ✅ Removed mirrored write to Location model
- ✅ Now only uses Bus model for all operations

---

## Unified Data Flow (After Fix)

```
┌─────────────────────────────────────────────────────────────┐
│                        DRIVER APP                            │
│                                                              │
│  POST /api/driver/location                                   │
│  { busId: "BUS001", lat: 40.7, lng: -74.0 }                  │
└──────────────────────┬────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              locationController.js                          │
│                                                              │
│  1. BusLocation.findOneAndUpdate() ──► buslocations (OLD)   │
│  2. Bus.findOneAndUpdate() ─────────► buses (NEW) ✓         │
│     - location: { type: "Point", coordinates: [lng, lat] }  │
│     - lat, lng, speed, heading, status: "active"            │
└──────────────────────┬────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                    MongoDB: buses collection                 │
│  { busId: "BUS001", location: {...}, lat: 40.7, ... }       │
└──────────────────────┬────────────────────────────────────────┘
                       │
         ┌─────────────┼─────────────┐
         │             │             │
         ▼             ▼             ▼
   ┌─────────┐   ┌─────────┐   ┌─────────┐
   │Passenger│   │Passenger│   │/api/    │
   │/nearby  │   │/all     │   │buses/*  │
   │-buses   │   │         │   │         │
   └────┬────┘   └────┬────┘   └────┬────┘
        │             │             │
        └─────────────┴─────────────┘
                      │
                      ▼
               Bus.find({...})
               (single source of truth)
```

---

## Verification Steps

### 1. Start Server
```bash
cd backend
npm start
```

**Expected:** Server starts without errors

### 2. Driver Updates Location
```bash
curl -X POST http://localhost:3000/api/driver/location \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "busId": "TEST001",
    "lat": 40.7128,
    "lng": -74.0060,
    "speed": 15,
    "heading": 90
  }'
```

**Expected:** `200 OK` with success message

### 3. Verify Data in MongoDB
```javascript
// In MongoDB shell
use your-database

// Check 'buses' collection (should have data)
db.buses.find({ busId: "TEST001" })
// Expected: { busId: "TEST001", location: { type: "Point", coordinates: [-74.006, 40.7128] }, ... }

// Check 'buslocations' collection (backward compat)
db.buslocations.find({ busId: "TEST001" })
// Expected: { busId: "TEST001", lat: 40.7128, lng: -74.006, ... }
```

### 4. Passenger Reads from Bus Model
```bash
curl "http://localhost:3000/api/passenger/nearby-buses?lat=40.7128&lng=-74.0060&radiusKm=5" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Expected:** `200 OK` with buses array (including TEST001)

### 5. Geospatial API Reads from Bus Model
```bash
curl "http://localhost:3000/api/buses/nearby?lat=40.7128&lng=-74.0060&radius=5000"
```

**Expected:** `200 OK` with buses array (including TEST001 in compact format)

### 6. Verify Consistency
All three endpoints should return the same bus data:
- `/api/passenger/nearby-buses`
- `/api/buses/nearby`
- `/api/location/all`

---

## MongoDB Index Setup (One-time)

Ensure the 2dsphere index exists on the `buses` collection:

```javascript
// In MongoDB shell
use your-database
db.buses.createIndex({ location: "2dsphere" })
db.buses.createIndex({ busId: 1 }, { unique: true })
db.buses.createIndex({ status: 1, lastUpdate: -1 })
```

Verify indexes:
```javascript
db.buses.getIndexes()
```

---

## API Endpoints (All Using Bus Model)

| Endpoint | Method | Model Used | Purpose |
|----------|--------|------------|---------|
| `/api/driver/location` | POST | Bus (dual-write) | Driver updates location |
| `/api/passenger/nearby-buses` | GET | Bus | Passenger sees nearby buses |
| `/api/buses/nearby` | GET | Bus | Geospatial nearby search |
| `/api/buses/bounds` | GET | Bus | Bounding box search |
| `/api/buses/stream` | GET | Bus | Real-time streaming |
| `/api/location/all` | GET | Bus | All buses (backward compat) |

---

## Backward Compatibility

### BusLocation Collection
- Still receiving writes from `locationController.js`
- Maintained for fallback/rollback capability
- Can be deprecated after full migration verification

### Location Collection
- No longer used by any controller
- Can be safely archived/dropped after verification
- All reads now use `Bus` model

---

## Cleanup (After Verification)

Once the system is stable:

1. Remove dual-write to BusLocation (optional):
   ```javascript
   // In locationController.js, delete lines 141-151 (BusLocation.update)
   ```

2. Archive old collections:
   ```javascript
   // In MongoDB
   db.buslocations.renameCollection("buslocations_archive")
   db.locations.renameCollection("locations_archive")
   ```

3. Remove old model files (optional):
   ```bash
   rm backend/src/models/BusLocation.js
   rm backend/src/models/Location.js
   ```

---

## Status

| Component | Status |
|-----------|--------|
| Driver writes to Bus | ✅ Fixed (dual-write) |
| Passenger reads from Bus | ✅ Fixed |
| Emergency reads from Bus | ✅ Fixed |
| Geospatial API uses Bus | ✅ Already working |
| Unified data flow | ✅ Complete |
| Single source of truth | ✅ Achieved |

**Status: DATA CONSISTENCY FIXED** ✅

All APIs now use the unified `Bus` model with geospatial capabilities.
