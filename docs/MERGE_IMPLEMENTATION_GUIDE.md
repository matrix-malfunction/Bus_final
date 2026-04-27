# Backend Merge Implementation Guide

## Quick Summary

**Status:** Ready to implement
**Risk Level:** Low (backward compatible)
**Estimated Time:** 2-3 hours
**Downtime:** None (gradual migration)

---

## File Movements Summary

### New Files to Create

| File | Purpose |
|------|---------|
| `backend/src/routes/busTrackingRoutes.js` | Geospatial API endpoints |
| `backend/src/models/Bus.new.js` | Merged Bus model (backup old first) |
| `backend/scripts/seedData.js` | Copied from bus-tracker-backend |
| `backend/scripts/migrateToGeospatial.js` | Data migration script |

### Files to Modify

| File | Changes |
|------|---------|
| `backend/src/app.js` | Add busTrackingRoutes registration |
| `backend/src/routes/locationRoutes.js` | Keep POST /update, modify GET /all |
| `backend/src/controllers/locationController.js` | Use new Bus model |
| `backend/package.json` | Add compression, helmet, rate-limit |

### Files to Deprecate (Keep for now)

| File | Reason |
|------|--------|
| `backend/src/models/Location.js` | Migrate data to Bus model |
| `backend/src/models/BusLocation.js` | Consolidate into Bus model |

### Files to Delete After Verification

| File | When to Delete |
|------|----------------|
| `bus-tracker-backend/` | After 1 week of stable operation |

---

## Step-by-Step Implementation

### Phase 1: Preparation (15 minutes)

1. **Backup current backend:**
```bash
cd backend
cp src/models/Bus.js src/models/Bus.backup.js
cp src/app.js src/app.backup.js
cp src/routes/locationRoutes.js src/routes/locationRoutes.backup.js
cp package.json package.backup.json
```

2. **Copy files from bus-tracker-backend:**
```bash
# From project root
cp bus-tracker-backend/scripts/seedData.js backend/scripts/
cp bus-tracker-backend/utils/streaming.js backend/src/services/
```

### Phase 2: Install New Dependencies (5 minutes)

```bash
cd backend
npm install compression helmet express-rate-limit
```

### Phase 3: Update Models (10 minutes)

1. **Replace Bus model:**
```bash
cp src/models/Bus.new.js src/models/Bus.js
```

2. **Verify the new model compiles:**
```bash
node -e "require('./src/models/Bus')" && echo "Bus model OK"
```

### Phase 4: Add New Routes (10 minutes)

1. **Copy busTrackingRoutes.js:**
```bash
cp src/routes/busTrackingRoutes.js src/routes/busTrackingRoutes.js
```

2. **Update app.js:**
   - Open `src/app.js`
   - Add import: `const busTrackingRoutes = require("./routes/busTrackingRoutes");`
   - Add registration: `app.use("/api/buses", busTrackingRoutes);`
   - Add compression middleware

Use the provided `src/app.merged.js` as reference.

### Phase 5: Test Locally (30 minutes)

1. **Start the server:**
```bash
npm run dev
```

2. **Test driver endpoint (should still work):**
```bash
curl -X POST http://localhost:3000/api/location/update \
  -H "Content-Type: application/json" \
  -d '{"busId":"TEST001","lat":40.7128,"lng":-74.0060}'
```

3. **Test new geospatial endpoint:**
```bash
curl "http://localhost:3000/api/buses/nearby?lat=40.7128&lng=-74.0060&radius=5000"
```

4. **Test old endpoint (backward compatible):**
```bash
curl http://localhost:3000/api/location/all
```

5. **Verify passenger endpoint:**
```bash
curl http://localhost:3000/api/passenger/nearby-buses \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Phase 6: Deploy to Production (15 minutes)

1. **Commit changes:**
```bash
git add .
git commit -m "Merge bus-tracker-backend geospatial features"
git push origin main
```

2. **Deploy to Render:**
   - Render will auto-deploy on push
   - Or manual deploy from dashboard

3. **Verify deployment:**
```bash
curl https://your-render-url.onrender.com/health
```

### Phase 7: Data Migration (Optional - 20 minutes)

If you need to migrate existing Location data to the new Bus model:

```bash
cd backend
node scripts/migrateToGeospatial.js
```

This will:
- Copy all Location records to Bus model
- Add geospatial coordinates
- Create 2dsphere index

### Phase 8: Update Client Apps (Gradual)

**Driver App:** No changes needed ✅

**Passenger App:** Can optionally switch to new endpoints:

```javascript
// Old (still works)
const response = await fetch('/api/passenger/nearby-buses');

// New (recommended)
const response = await fetch('/api/buses/nearby?lat=40.7&lng=-74.0&radius=5000');
```

**Benefits of new endpoints:**
- Geospatial queries (faster for nearby searches)
- Compact JSON (smaller payload)
- Bounding box queries (for map viewport)
- Real-time streaming (`/api/buses/stream`)

---

## Verification Checklist

### Before Merge
- [ ] Backup all existing files
- [ ] Document current API usage in driver/passenger apps
- [ ] Check MongoDB connection strings match

### After Merge (Local)
- [ ] Server starts without errors
- [ ] Driver can update location (POST /api/location/update)
- [ ] Passenger can see nearby buses (GET /api/passenger/nearby-buses)
- [ ] New endpoint works (GET /api/buses/nearby)
- [ ] Health check passes (GET /health)

### After Deploy (Production)
- [ ] Health check passes
- [ ] Driver app works (no updates needed)
- [ ] Passenger app works (no updates needed)
- [ ] New endpoints available
- [ ] No errors in Render logs

### After 1 Week (Cleanup)
- [ ] No issues reported
- [ ] Can delete bus-tracker-backend folder
- [ ] Can deprecate Location model

---

## API Endpoint Reference

### Driver Endpoints (Unchanged)
| Endpoint | Method | Status |
|----------|--------|--------|
| /api/driver/location | POST | ✅ Keep |
| /api/driver/set-route | POST | ✅ Keep |
| /api/driver/emergency | POST | ✅ Keep |

### Passenger Endpoints (Unchanged)
| Endpoint | Method | Status |
|----------|--------|--------|
| /api/passenger/nearby-buses | GET | ✅ Keep |
| /api/passenger/routes | GET | ✅ Keep |
| /api/passenger/routes/:id/schedule | GET | ✅ Keep |

### Location Endpoints (Modified)
| Endpoint | Method | Status | Action |
|----------|--------|--------|--------|
| /api/location/update | POST | ✅ Keep | Used by driver |
| /api/location/all | GET | ⚠️ Works | Now uses Bus model |
| /api/location/nearest-stop | GET | ✅ Keep | Unchanged |

### New Endpoints (Added)
| Endpoint | Method | Status | Notes |
|----------|--------|--------|-------|
| /api/buses | GET | 🆕 New | List all buses |
| /api/buses/nearby | GET | 🆕 New | Geospatial search |
| /api/buses/bounds | GET | 🆕 New | Bounding box |
| /api/buses/stream | GET | 🆕 New | SSE real-time |
| /api/buses/:id | GET | 🆕 New | Single bus |

---

## Troubleshooting

### Issue: "Cannot GET /api/buses/nearby"
**Cause:** busTrackingRoutes not registered
**Fix:** Check app.js has `app.use("/api/buses", busTrackingRoutes)`

### Issue: Driver location not updating
**Cause:** Bus model schema mismatch
**Fix:** Ensure Bus model has both old and new fields

### Issue: Geospatial query slow
**Cause:** Missing 2dsphere index
**Fix:** Run migration script or create index manually:
```javascript
db.buses.createIndex({ location: "2dsphere" })
```

### Issue: Passenger app shows no buses
**Cause:** Data not migrated
**Fix:** Run `node scripts/migrateToGeospatial.js`

---

## Rollback Plan

If issues occur:

1. **Revert files:**
```bash
cp src/models/Bus.backup.js src/models/Bus.js
cp src/app.backup.js src/app.js
cp src/routes/locationRoutes.backup.js src/routes/locationRoutes.js
cp package.backup.json package.json
npm install
```

2. **Redeploy:**
```bash
git revert HEAD
git push origin main
```

---

## Summary

This merge combines:
- ✅ Backend's authentication + driver features
- ✅ Bus-tracker's geospatial queries + performance

**Result:** Single backend serving all apps with better performance.

**Next Steps:**
1. Follow Phase 1-4 to implement
2. Test locally
3. Deploy
4. Gradually migrate passenger app to new endpoints
5. Delete bus-tracker-backend folder after verification
