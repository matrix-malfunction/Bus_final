# Backend Merge Fix Checklist

## Critical Issues Summary

| Issue | Status | Files |
|-------|--------|-------|
| Bus model not geospatial | 🔴 CRITICAL | models/Bus.js |
| Driver updates wrong model | 🔴 CRITICAL | controllers/locationController.js |
| Passenger reads wrong model | 🔴 CRITICAL | routes/passengerRoutes.js, controllers/passengerController.js |
| /api/location/all stale | 🟡 HIGH | controllers/locationController.js |
| Missing 2dsphere index | 🔴 CRITICAL | MongoDB |

---

## Quick Fix (30 Minutes)

### Step 1: Apply Bus Model (2 min)
```bash
cd "w:\Final year project\backend"
copy /Y src\models\Bus.new.js src\models\Bus.js
```

### Step 2: Install Dependencies (3 min)
```bash
npm install compression helmet express-rate-limit
```

### Step 3: Apply locationController.js Patches (10 min)

**Edit file:** `src/controllers/locationController.js`

#### Patch A: Add Bus write (after line 151)
Find the `BusLocation.findOneAndUpdate` block that ends at line 151.

AFTER that block, ADD:
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

#### Patch B: Fix getAllBusLocations (line 454)
Find:
```javascript
const buses = await BusLocation.find({});
```

Replace with:
```javascript
const buses = await Bus.find({ status: "active" })
  .select("busId latitude longitude lat lng speed source lastUpdate -_id")
  .lean();
```

### Step 4: Apply passengerRoutes.js Patch (5 min)

**Edit file:** `src/routes/passengerRoutes.js`

#### Change Line 4:
Add after line 3:
```javascript
const Bus = require("../models/Bus");
```

#### Change Lines 14-17:
Find:
```javascript
const buses = await Location.find()
  .select("busId latitude longitude timestamp -_id")
  .sort({ timestamp: -1 })
  .lean();
```

Replace with:
```javascript
const buses = await Bus.find({
  status: "active",
  lastUpdate: { $gte: new Date(Date.now() - 5 * 60 * 1000) },
})
  .select("busId latitude longitude speed source lastUpdate -_id")
  .sort({ lastUpdate: -1 })
  .lean();
```

### Step 5: Apply passengerController.js Patch (5 min)

**Edit file:** `src/controllers/passengerController.js`

#### Change Line 1:
Replace:
```javascript
const Location = require("../models/Location");
```
With:
```javascript
const Bus = require("../models/Bus");
```

#### Change Lines 15-27:
Replace entire query with:
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

### Step 6: Run Migration (5 min)
```bash
node scripts/migrateToGeospatial.js
```

### Step 7: Test (10 min)

```bash
# Start server
npm run dev

# Test 1: Driver updates location
curl -X POST http://localhost:3000/api/driver/location \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"busId":"TEST001","lat":40.7128,"lng":-74.0060}'

# Test 2: Check geospatial endpoint (should return bus)
curl "http://localhost:3000/api/buses/nearby?lat=40.7128&lng=-74.0060&radius=5000"

# Test 3: Check passenger endpoint (should return same bus)
curl "http://localhost:3000/api/passenger/nearby-buses" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## Verification Checklist

- [ ] Bus model has `location` field (GeoJSON)
- [ ] Driver POST updates both BusLocation AND Bus
- [ ] Passenger GET returns buses from Bus model
- [ ] `/api/buses/nearby` returns buses with geospatial query
- [ ] `/api/location/all` returns buses from Bus model
- [ ] MongoDB has 2dsphere index on Bus.location
- [ ] No errors in console

---

## MongoDB Index Check

Connect to MongoDB and verify:

```javascript
// Check indexes
db.buses.getIndexes()

// Should show:
[
  { key: { _id: 1 }, name: "_id_" },
  { key: { busId: 1 }, name: "busId_1" },
  { key: { location: "2dsphere" }, name: "location_2dsphere" }
]

// If missing, create:
db.buses.createIndex({ location: "2dsphere" })
```

---

## Post-Deploy Cleanup (1 Week Later)

After 1 week of stable operation:

1. Remove BusLocation writes (keep only Bus writes)
2. Delete BusLocation.js model file
3. Delete Location.js model file
4. Remove bus-tracker-backend/ folder
5. Update documentation

---

## Troubleshooting

### "Cannot GET /api/buses/nearby"
- Check that `busTrackingRoutes` is registered in `app.js`
- Check that Bus model has geospatial fields

### "No buses returned"
- Run migration script to copy data from BusLocation to Bus
- Check that driver updates write to Bus model (Patch A)

### "Driver location not showing"
- Verify both BusLocation AND Bus are being updated
- Check MongoDB has data in both collections

### "Geospatial query error"
- Create 2dsphere index: `db.buses.createIndex({ location: "2dsphere" })`
- Check Bus.location is GeoJSON format: `{type: "Point", coordinates: [lng, lat]}`

---

## Rollback Plan

If issues occur:

```bash
# Restore backups
cp src/models/Bus.backup.js src/models/Bus.js
cp src/app.backup.js src/app.js

# Redeploy
git checkout -- .
git push origin main
```

---

## Support Files

| File | Purpose |
|------|---------|
| `BACKEND_AUDIT_CRITICAL_ISSUES.md` | Full analysis |
| `APPLY_PATCHES.bat` | Automated script (partial) |
| `*.js.patch` files | Line-by-line patch instructions |
| `scripts/migrateToGeospatial.js` | Data migration |

---

**Start with Step 1 (Bus model) - it's the foundation for everything else!**
