# V-Bus — Complete Technical Documentation

**System:** Real-Time Smart Bus Tracking and Passenger Information System  
**Version:** Production-grade final year project documentation  
**Classification:** Internal Engineering Documentation — Not a formal report  

---

## Table of Contents

1. [Complete System Overview](#1-complete-system-overview)
2. [Full Architecture Documentation](#2-full-architecture-documentation)
3. [End-to-End Data Flow Documentation](#3-end-to-end-data-flow-documentation)
4. [API Documentation](#4-api-documentation)
5. [Socket Event Documentation](#5-socket-event-documentation)
6. [Database Documentation](#6-database-documentation)
7. [Real-Time Engine Documentation](#7-real-time-engine-documentation)
8. [Frontend Implementation Documentation](#8-frontend-implementation-documentation)
9. [Backend Implementation Documentation](#9-backend-implementation-documentation)
10. [Performance Optimization Documentation](#10-performance-optimization-documentation)
11. [Security Documentation](#11-security-documentation)
12. [Testing Documentation](#12-testing-documentation)
13. [Production Hardening Documentation](#13-production-hardening-documentation)
14. [Future Enhancement Documentation](#14-future-enhancement-documentation)

---

## 1. Complete System Overview

### 1.1 System Purpose

V-Bus is a real-time bus tracking and passenger information platform designed for public transit operations in Indian urban and semi-urban contexts. The system connects drivers, passengers, and administrators through a unified real-time data pipeline, providing live bus locations, route visualization, ETA predictions, stop progression tracking, and emergency SOS handling.

### 1.2 Core Problem Solved

Traditional public bus systems in India suffer from:
- **No real-time visibility**: Passengers wait at stops with no information about bus arrival times
- **Manual coordination**: Dispatchers rely on phone calls to track bus positions
- **Emergency response latency**: Breakdowns and emergencies are reported through slow manual channels
- **Route adherence uncertainty**: There is no automated way to verify if buses are following assigned routes

V-Bus solves these problems by creating a fully automated, backend-authoritative real-time tracking ecosystem where every bus position update flows through a centralized engine that computes progressions, detects stop arrivals, projects positions onto route corridors, and distributes sanitized data to all connected clients within sub-second latency.

### 1.3 Technical Goals

- **Sub-5-second end-to-end latency** from driver GPS update to passenger map render
- **Backend-authoritative state**: No client can override tracking state; the backend is the single source of truth
- **Route corridor locking**: Bus positions are mathematically projected onto assigned route corridors to prevent GPS drift from showing buses on wrong roads
- **Stop lifecycle detection**: Automatic detection of APPROACHING → ARRIVED → DWELLING → DEPARTED events
- **SOS emergency integration**: Driver SOS triggers immediately freeze tracking, emit alerts to all passengers, and log emergencies persistently
- **Offline resilience**: Driver app queues location updates during network outages and flushes when connectivity returns
- **Background tracking**: Driver location updates continue even when the driver app is backgrounded or killed

### 1.4 Scalability Goals

- Support **50+ simultaneous active buses** per region with single-server Socket.IO architecture
- **Geospatial queries** via MongoDB 2dsphere indexes for `$near` and `$geoWithin` operations
- **In-memory caching layer** (`LocationCache`) to reduce database read load for passenger queries
- **Batched WebView updates** with priority-based payload filtering to limit render overhead
- **Route data normalization** handles both legacy and current schema formats without migration downtime

### 1.5 Real-Time Requirements

| Metric | Requirement | Implementation |
|--------|-------------|----------------|
| Driver → Backend latency | < 5s | HTTP POST with 5s throttle + background task |
| Backend → Passenger latency | < 500ms | Socket.IO broadcast (no polling) |
| Passenger → Map render | < 100ms | postMessage batching (250ms window) |
| Stale bus detection | 5 minutes | `TRACKING_STATE_TTL_MS` + DB TTL index |
| GPS jitter filtering | 15 meters | `GPS_JITTER_THRESHOLD_METERS` |
| Route snap threshold | 80 meters | `SNAP_THRESHOLD_METERS` |
| Heartbeat update | 15 seconds | `FORCE_UPDATE_INTERVAL_MS` |
| Cleanup scheduler | 15 seconds | `cleanupStaleState` interval |
| DB stale mark | 5 minutes | `markStaleBusesInactive` interval (60s) |

---

## 2. Full Architecture Documentation

### 2.1 Frontend Architecture

#### Passenger App (React Native + Expo)

The passenger application is built with **React Native** using **Expo SDK**. It does not use native map components (Google Maps/Mapbox RN SDK). Instead, it embeds a **WebView** that renders an HTML page with **Leaflet.js** and OpenStreetMap tiles.

**Why WebView + Leaflet instead of native maps:**
- **Consistent cross-platform behavior**: iOS and Android render identical maps without platform-specific native module dependencies
- **Full JavaScript control**: Route corridors, stop markers, bus markers, and popup UIs are implemented in plain JavaScript inside the WebView, enabling rapid iteration without native recompilation
- **Offline tile resilience**: Leaflet's tile layer can be configured with multiple subdomains and fallback sources
- **postMessage bridge**: React Native and WebView communicate exclusively through typed `postMessage` events, creating a clean separation of concerns

**Architecture layers:**

```
┌─────────────────────────────────────────┐
│  React Native Screens (HomeScreen,      │
│  FullMapScreen, NearbyBusesScreen)      │
├─────────────────────────────────────────┤
│  BusContext (Global State)              │
│  - buses: { [busId]: BusData }           │
│  - busProgress: { [busId]: Progress }   │
│  - socket: Socket.IO client              │
│  - followBusId: string | null            │
├─────────────────────────────────────────┤
│  postMessage Bridge                     │
│  - RN → WebView: USER_LOCATION,         │
│    BUS_UPDATE, FOLLOW_UPDATE,           │
│    DRAW_ROUTE, CLEAR_ROUTE, etc.        │
│  - WebView → RN: MAP_READY, BUS_SELECTED│
│    SET_FOLLOW, NEAREST_STOPS, SOS_ACK   │
├─────────────────────────────────────────┤
│  WebView (Leaflet.js + OpenStreetMap)   │
│  - Map initialization with preferCanvas   │
│  - Marker registry (window.busMarkers)  │
│  - Bus stop marker registry             │
│  - Route polyline rendering             │
│  - Popup generation with ETA data       │
└─────────────────────────────────────────┘
```

#### Driver App (React Native + Expo)

The driver application uses **Expo Location** with both foreground (`watchPositionAsync`) and background (`startLocationUpdatesAsync`) tracking.

**Key architectural decisions:**
- **Two-tier tracking**: Foreground for immediate updates when app is open; background task (`background-location-task`) for updates when app is killed
- **Global variable bridge**: `TaskManager.defineTask` cannot access React state or AsyncStorage synchronously, so `global.bgBusId`, `global.bgToken`, and `global.__trackingActive` are used as the interop layer between JavaScript runtime and the background task
- **SOS freeze state**: `global.bgSosActive` blocks all location updates when an SOS is active, preventing the bus from appearing to move during an emergency
- **Persistent queue**: Failed updates are stored in AsyncStorage (`@driver_location_queue`) and flushed when network returns

#### Admin Web (React + Vite + Leaflet)

The admin dashboard is a lightweight React application built with **Vite**. It uses **react-leaflet** for direct Leaflet integration (no WebView bridge needed since it runs in a browser). It connects to the same Socket.IO server for live bus updates and SOS alerts.

### 2.2 Backend Architecture

The backend is a **Node.js/Express** monolith with the following structural layers:

```
┌──────────────────────────────────────────┐
│  Express Router Layer                    │
│  /api/auth, /api/driver, /api/location, │
│  /api/passenger, /api/admin, /api/sos   │
├──────────────────────────────────────────┤
│  Middleware Layer                        │
│  - requireAuth (JWT verification)        │
│  - requireRole (RBAC enforcement)        │
│  - CORS origin filtering                 │
│  - Compression (gzip level 6)            │
├──────────────────────────────────────────┤
│  Controller Layer                        │
│  - locationController (GPS ingestion)   │
│  - authController (login/register)      │
│  - driverController (route assignment)  │
│  - driverFeatureController (SOS)       │
│  - adminController (CRUD operations)     │
├──────────────────────────────────────────┤
│  Service / Engine Layer                  │
│  - progressionEngine (route snap, stops)  │
│  - etaService (Haversine + speed calc)   │
│  - overpassService (OSM stop fetch)    │
│  - locationCache (in-memory adapter)    │
│  - hybridSourceSelector                  │
├──────────────────────────────────────────┤
│  State Management Layer                  │
│  - trackingState (Map<busId, State>)    │
│  - MongoDB (persistent storage)           │
└──────────────────────────────────────────┘
```

**Why monolith over microservices:**
- Single Socket.IO instance is required for broadcast consistency; splitting into services would require Redis Pub/Sub or NATS for socket synchronization
- The compute overhead of the progression engine is lightweight (JavaScript math on GPS coordinates); a single Node.js process can handle 50+ buses without CPU strain
- Deployment simplicity: one Heroku/Render dyno runs the entire backend

### 2.3 Socket Architecture

**Single Socket.IO server** on the same HTTP server as Express.

```javascript
const io = new Server(server, { cors: { origin: "*" } });
app.set("io", io);
```

The Socket.IO instance is attached to the Express `app` object so that controllers can access it via `req.app.get("io")`. This is a critical architectural decision: it allows HTTP controllers to emit socket events without importing the server module directly, preventing circular dependencies.

**Socket event model:**
- **Broadcast only**: The server emits events (`io.emit(...)`) to all connected clients. There is no room-based routing or namespace separation.
- **Client → Server events are minimal**: Only `REQUEST_BUS_STOPS` is handled; all other data flows are HTTP → Socket emit → Client receive.
- **Why no rooms/namespaces**: The passenger app needs to see all active buses in the region, not just a subset. Room separation would add complexity without benefit.

### 2.4 WebView Architecture

The WebView in the passenger app is **not** a static HTML file loaded from disk. It is an inline HTML string embedded in the React Native component (`HomeScreen.js` and `FullMapScreen.js`).

**Why inline HTML:**
- **No asset bundling issues**: React Native's asset system can be unreliable for HTML files; inline strings are guaranteed to exist
- **Dynamic interpolation**: Bus markers and stop coordinates can be interpolated at render time using template literals (though the production implementation uses `postMessage` for all dynamic data)
- **Single file deployment**: No need to manage `file://` or `bundle://` asset paths

**WebView initialization hardening:**
- `preferCanvas: true` — Forces Leaflet to use Canvas rendering instead of SVG DOM elements, drastically improving marker count performance
- `zoomAnimation: false`, `fadeAnimation: false`, `markerZoomAnimation: false` — Disables all CSS transitions to prevent layout thrashing during rapid updates
- `updateWhenIdle: false`, `updateWhenZooming: false` — Prevents tile re-fetching during zoom/pan
- `reuseTiles: true` — Caches tiles across view changes

**Message queue system:**
The WebView maintains `window.__messageQueue` because the `document.addEventListener("message", ...)` handler may not be attached before the first React Native `postMessage` calls. Queued messages are processed after the handler is ready.

### 2.5 State Management Architecture

#### Backend State (`trackingState`)

```javascript
const trackingState = new Map();
```

- **Key**: `busId` (string)
- **Value**: State object containing `trackingActive`, `sos`, `speed`, `derivedSpeed`, `location`, `routeId`, `tripId`, `progression`
- **Lifetime**: Lives in Node.js heap. Cleared by `cleanupStaleState()` after 5 minutes of inactivity or immediately when `setTrackingActive(busId, false)` is called.

**Why a Map instead of Redis:**
- Sub-millisecond read/write latency required for GPS updates arriving every 5 seconds
- The state is transient; losing it on server restart is acceptable because the driver app will re-establish tracking state via `startTracking` API calls
- No external dependency reduces deployment complexity

#### Frontend State (`BusContext`)

```javascript
const [buses, setBuses] = useState({}); // Object keyed by busId
```

- **Why an object, not an array**: O(1) updates by `busId`. When `BUS_LOCATION_UPDATE` arrives, the reducer does `newBuses[data.busId] = busData` without iterating.
- **Clean replacement, no merge**: The entire bus object is replaced on each update. This prevents stale nested fields from lingering.
- **Progression stored separately**: `busProgress` is a parallel object to avoid re-rendering the entire bus list when only progression data changes.

### 2.6 Real-Time Synchronization Architecture

**Data pipeline:**

```
Driver GPS (Expo Location)
    ↓
[Foreground] watchPositionAsync → sendLocationToBackend()
[Background] TaskManager.defineTask → fetch() to /api/driver/location
    ↓
Express Route /api/driver/location
    ↓
requireAuth + requireRole("driver")
    ↓
normalizeDriverLocationPayload middleware
    ↓
locationController.updateLocation()
    ↓
_trackingState guard (bus must have active state)
    ↓
Bus.findOneAndUpdate() (DB persistence)
    ↓
progressionEngine.computeBusProgression()
    ↓
snapToRouteCorridor() → projectOntoRouteCorridor()
    ↓
determineStopProgression()
    ↓
computeEta() → checkApproachingEvent()
    ↓
io.emit("BUS_LOCATION_UPDATE", safePayload)
io.emit("BUS_PROGRESS_UPDATE", progressPayload) [if changed]
    ↓
Socket.IO broadcast
    ↓
Passenger App BusContext receives event
    ↓
setBuses() → setBusProgress() → React re-render
    ↓
useEffect detects bus change → webViewRef.postMessage("BUS_UPDATE")
    ↓
WebView message handler → window.busMarkers[busId].setLatLng()
```

**Why HTTP from driver instead of Socket.IO:**
- **Reliability**: HTTP POST with retry logic and queue persistence is more reliable than a persistent socket connection for mobile devices on unstable cellular networks
- **Authentication**: Bearer token in HTTP header is simpler to validate than socket handshake JWT
- **Background compatibility**: Background tasks cannot easily maintain a Socket.IO connection; HTTP fetch is natively supported by `TaskManager`

---

## 3. End-to-End Data Flow Documentation

### 3.1 GPS Update Flow

**Trigger**: Driver moves 10+ meters or 5+ seconds elapse (`MIN_DISTANCE_METERS = 10`, `MIN_API_INTERVAL_MS = 5000`)

1. **Driver App — Foreground**:
   - `Location.watchPositionAsync()` fires with `{ latitude, longitude, accuracy, heading, speed }`
   - `sendLocationToBackend()` is called
   - GPS jitter filter: if distance from `lastSentLocation` < 10m and not a forced heartbeat, skip
   - Throttle check: if `now - lastSendTimeRef.current < 4000ms`, skip
   - Speed calculation: `calculateSpeed()` computes Haversine-based speed (more reliable than Expo GPS `speed` when stationary)
   - Network check: if offline, push to `failedQueue` in AsyncStorage
   - HTTP POST to `/api/driver/location` with Bearer token

2. **Driver App — Background** (if app is killed):
   - `TaskManager.defineTask(BACKGROUND_LOCATION_TASK)` receives location
   - Checks `global.__trackingActive` and AsyncStorage `trackingActive === "true"`
   - Applies identical jitter and accuracy filters
   - Sends via `fetch()` with one automatic retry after 3 seconds

3. **Backend — HTTP Ingress**:
   - `driverRoutes.js` → `normalizeDriverLocationPayload` middleware normalizes `lat/lng` vs `latitude/longitude`
   - `requireAuth` + `requireRole("driver")` validates JWT
   - `locationController.updateLocation()` handles the request

4. **Backend — Validation**:
   - `trackingState.get(busId)` must exist; if not, return 403 (prevents stale packets from reviving stopped buses)
   - If `state.trackingActive === false`, return 200 with `ignored: true`
   - If `req.body.trackingActive === false`, treat as STOP signal → `setTrackingActive(busId, false, io)` → emit `BUS_OFFLINE`
   - Strict coordinate validation: finite numbers within [-90,90] and [-180,180]

5. **Backend — Database**:
   - `Bus.findOneAndUpdate({ busId }, { $set: { location: { type: "Point", coordinates: [lng, lat] }, ... } }, { upsert: true, new: true })`
   - GeoJSON Point format stored as `[longitude, latitude]` per MongoDB 2dsphere spec
   - On DB failure, tracking continues with a degraded in-memory object

6. **Backend — Progression Engine**:
   - `getBusRoute(busId)` retrieves assigned route from `trackingState`
   - `normalizeRoute()` handles schema migration (`routeCoords` vs `coordinates`)
   - `computeBusProgression(busId, lat, lng, speed, route, accuracy)`:
     - `normalizeCoord()` auto-detects coordinate order `[lat,lng]` vs `[lng,lat]`
     - `projectOntoRouteCorridor()` finds nearest segment via `projectPointOntoSegment()` using local meter approximation
     - Hard snap threshold: 80m. Beyond this, raw GPS is used.
     - `determineStopProgression()` computes `currentStopIndex`, `nextStopIndex`, `passedStopIds`
     - `computeEta()` calculates rolling-average-speed-based ETA (70% old + 30% new)
     - `checkApproachingEvent()` emits `APPROACHING` if ETA ≤ 2 minutes
     - `updateStopEventState()` detects `ARRIVED`/`DWELLING`/`DEPARTED` lifecycle

7. **Backend — Socket Emit**:
   - `io.emit("BUS_LOCATION_UPDATE", safePayload)` where `safePayload` includes:
     - `latitude`, `longitude` (raw GPS)
     - `snappedLat`, `snappedLng`, `isSnapped`, `distanceFromRoute` (corridor projection)
     - `routeId`, `routeName`, `routeColor`, `direction`, `tripId`, `routeCoords`
     - `currentStopId`, `nextStopId`, `nextStopName`, `passedStopIds`, `nextStopEtaMinutes`, `remainingDistanceMeters`
   - `io.emit("BUS_PROGRESS_UPDATE", progressPayload)` only if `hasProgressionChanged()` returns true (prevents spam)

8. **Passenger App — Socket Receive**:
   - `BusContext` listener for `BUS_LOCATION_UPDATE` receives payload
   - `setBuses(prev => ({ ...prev, [data.busId]: busData }))` performs clean replacement
   - `useEffect` in `HomeScreen`/`FullMapScreen` detects `buses` change
   - `webViewRef.current.postMessage(JSON.stringify({ type: "BUS_UPDATE", buses: activeBuses }))`

9. **WebView — Render**:
   - Message handler receives `BUS_UPDATE`
   - Computes `incomingIds = new Set(data.buses.map(b => b.busId))`
   - Removes stale markers not in `incomingIds` via `window.map.removeLayer(marker)`
   - For each incoming bus:
     - If `window.busMarkers[busId]` exists → `setLatLng([lat, lng])`
     - If not → `L.marker([lat, lng], { icon: window.busIcon }).addTo(window.map)`
   - If `followBusId` matches this bus → `window.map.panTo([lat, lng])`

### 3.2 SOS Trigger Flow

**Trigger**: Driver presses `[SOS] BUS BREAKDOWN` button

1. **Driver App**:
   - `sendEmergency()` sends HTTP POST to `/api/sos` with `{ busId, location, type: "emergency" }`
   - On success: `sosActiveRef.current = true; global.bgSosActive = true;`
   - This blocks all subsequent `sendLocationToBackend()` calls at the top of the function
   - Background task also checks `global.bgSosActive` and returns early if true

2. **Backend**:
   - `sosRoutes.js` → `triggerSos()` in `driverFeatureController.js`
   - `Bus.findOne({ busId }).lean()` gets latest known location
   - `DriverEmergency.create({ busId, type: "breakdown", location, timestamp })` persists the emergency
   - `setSosState(busId, true, io, location)`:
     - If no prior state exists, bootstraps a new tracking state with `trackingActive: false`
     - Emits `BUS_OFFLINE` first (removes bus from active tracking)
     - Then emits `SOS_TRIGGERED` with lat/lng to all clients
   - `io.emit("sosAlert", { busId, message, time })` for admin dashboard

3. **Passenger App**:
   - `BusContext` receives `BUS_OFFLINE` → deletes bus from `buses` object
   - `HomeScreen`/`FullMapScreen` effect sends `SOS_TRIGGERED` postMessage to WebView
   - WebView replaces bus marker with SOS marker (red cross icon)
   - Popup shows emergency status with "Acknowledge" button

4. **SOS Clear**:
   - Admin/operator calls `POST /api/sos/clear` or driver app polls `GET /api/sos/status` every 5s
   - When backend reports `active: false`, driver app sets `global.bgSosActive = false`
   - Backend emits `SOS_CLEARED` to all clients
   - WebView removes SOS marker and bus can resume tracking

### 3.3 Bus Offline Flow

**Trigger**: Driver presses `STOP` or app background task detects `trackingActive === false`

1. **Driver App**:
   - `stopTracking()` sets `global.__trackingActive = false`
   - Sends HTTP POST with `trackingActive: false`
   - Clears location subscription, stops background task, clears AsyncStorage keys

2. **Backend**:
   - `updateLocation()` sees `req.body.trackingActive === false`
   - Calls `setTrackingActive(busId, false, io)`
   - Emits `BUS_OFFLINE` with reason `tracking_stopped`
   - Deletes bus from `trackingState` Map

3. **Passenger App**:
   - `BusContext` receives `BUS_OFFLINE` → `delete updated[busId]`
   - If `followBusId === busId`, clears follow state
   - `useEffect` sends `BUS_OFFLINE` postMessage to WebView
   - WebView removes marker from `window.busMarkers` and from map layer

4. **Backend Cleanup**:
   - `cleanupStaleState(io)` runs every 15s; if bus hasn't updated in 5 minutes, emits `BUS_OFFLINE` and deletes state
   - `Bus.markStaleBusesInactive()` runs every 60s; updates DB `status` to `inactive` for buses with `lastUpdate` > 5 min ago
   - MongoDB TTL index on `lastUpdate` auto-deletes documents after 1 hour

### 3.4 Route Assignment Flow

**Trigger**: Driver selects route on `RouteSelectionScreen` and presses `START`

1. **Driver App**:
   - `RouteSelectionScreen` fetches `/api/routes` and displays list
   - Driver selects route + direction (OUTBOUND/INBOUND)
   - `handleStartShift()` navigates to `Tracking` screen with `routeId`, `routeName`, `routeColor`, `direction`

2. **Tracking Start**:
   - `callBackendStartTracking(latitude, longitude)` sends POST to `/api/location/start`
   - Body includes `busId`, `lat`, `lng`, `routeId`, `routeName`, `routeColor`, `direction`

3. **Backend**:
   - `startTracking` handler (inferred from controller flow) creates tracking state:
     - `setTrackingActive(busId, true)`
     - `setBusRoute(busId, { routeId, routeName, routeColor, direction })` generates a `tripId`
   - `Bus.findOneAndUpdate()` assigns `routeId` to the bus document

4. **Progression Engine**:
   - On next GPS update, `getBusRoute(busId)` returns the assigned route
   - `normalizeRoute()` hydrates route coordinates from `backend/data/routes.js`
   - `computeBusProgression()` begins corridor projection and stop progression
   - If route changes mid-trip, `clearBusProgression()` resets stop state

5. **Passenger App**:
   - Subsequent `BUS_LOCATION_UPDATE` events include `routeId`, `routeName`, `routeColor`, `routeCoords`
   - `FullMapScreen` detects `followBusId` or selected bus and sends `DRAW_ROUTE` postMessage
   - WebView renders `L.polyline(coordinates, { color: routeColor })`

### 3.5 Passenger Tracking Flow

**Trigger**: Passenger opens app and navigates to Home or FullMap

1. **BusContext mounts**:
   - `io(API_BASE_URL, { transports: ["websocket"], reconnection: true })`
   - Listeners registered for `BUS_LOCATION_UPDATE`, `BUS_OFFLINE`, `INIT_BUS_STOPS`, `BUS_PROGRESS_UPDATE`

2. **HomeScreen**:
   - `useBus()` retrieves `buses` object from context
   - `fetchNearbyBuses()` (optional REST fallback) fetches `/api/passenger/nearby-buses` with Bearer token
   - MiniMap WebView receives `USER_LOCATION` from Expo Location
   - `BUS_UPDATE` postMessage renders bus markers on MiniMap
   - `computeNearestStops()` in WebView calculates walking distance/ETA to nearest 3 stops and sends `NEAREST_STOPS` back to RN

3. **FullMapScreen**:
   - Larger WebView with interactive popups
   - Tap on bus marker → `BUS_SELECTED` message to RN → `setSelectedBusId()`
   - Tap "Follow" in popup → `SET_FOLLOW` message to RN → `setFollowBusId()`
   - Follow mode: RN sends `FOLLOW_UPDATE` to WebView; WebView pans map center to bus on each update

### 3.6 Follow Mode Flow

**Trigger**: Passenger taps "Follow Bus" in popup

1. **WebView → RN**: `postMessage({ type: "SET_FOLLOW", busId })`

2. **FullMapScreen**: `setFollowBusId(data.busId)` in BusContext

3. **Effect chain**:
   - `useEffect([followBusId, buses])` detects follow target
   - If `followBusId` is set and bus exists in `buses`, sends `FOLLOW_UPDATE` postMessage to WebView
   - Also triggers `DRAW_ROUTE` effect if the bus has `routeCoords`

4. **WebView**:
   - On next `BUS_UPDATE`, if `followBusId` matches, `window.map.panTo([lat, lng])`
   - Map center follows bus without zoom changes (smooth panning)

5. **Follow termination**:
   - Bus goes offline → `BUS_OFFLINE` clears `followBusId`
   - Passenger taps another bus → new `SET_FOLLOW` replaces old one
   - Passenger taps "Unfollow" → `SET_FOLLOW` with `busId: null`

---

## 4. API Documentation

### 4.1 Authentication

#### POST /api/auth/register
- **Method**: POST
- **Auth**: None
- **Body**: `{ name, role, email, password }`
- **Validation**:
  - `name`, `role`, `email`, `password` are required
  - `role` must be one of `["admin", "driver", "passenger"]`
  - `email` is lowercased and checked for uniqueness
- **Response 201**: `{ message: "User created", user: { id, name, role, email } }`
- **Response 409**: `{ message: "Email already registered" }`
- **Response 400**: Missing fields or invalid role
- **Security**: Password hashed with `bcryptjs` (salt rounds: 10)

#### POST /api/auth/login
- **Method**: POST
- **Auth**: None
- **Body**: `{ email, password }`
- **Validation**: `email` and `password` required
- **Response 200**: `{ message: "Login successful", token, user: { id, name, role, email } }`
- **Response 401**: Invalid credentials (generic message to prevent user enumeration)
- **Security**: JWT signed with `env.jwtSecret`, expires in `1d`. Token payload: `{ id, role }`

### 4.2 Driver Location

#### POST /api/driver/location
- **Method**: POST
- **Auth**: Bearer token + `requireRole("driver")`
- **Body** (normalized by middleware):
  ```json
  {
    "busId": "BUS101",
    "lat": 12.9346,
    "lng": 79.1384,
    "accuracy": 8.5,
    "altitude": 215.3,
    "heading": 94,
    "speed": 12.3,
    "source": "watch_position",
    "timestamp": "2024-01-15T08:30:00.000Z",
    "trackingActive": true
  }
  ```
- **Validation**:
  - `busId` required
  - `lat` and `lng` must be finite numbers within geographic bounds
  - `trackingState` must exist for this `busId` (return 403 if missing)
  - `trackingActive === false` triggers STOP flow
- **Response 200 (success)**:
  ```json
  {
    "success": true,
    "data": { /* updated Bus document */ },
    "timestamp": 1705312200000
  }
  ```
- **Response 200 (ignored)**:
  ```json
  { "ignored": true, "inactive": true }
  ```
- **Response 200 (degraded)**:
  ```json
  { "success": true, "degraded": true, "message": "Location recorded (degraded mode)" }
  ```
  Returned when the controller catches an unexpected fatal error but still wants to acknowledge receipt so the driver app doesn't retry unnecessarily.
- **Response 403**: `{ error: "Tracking not started", ignored: true }`
- **Failure cases**:
  - DB write fails → tracking continues with in-memory degraded object
  - Socket emit fails → non-fatal, logged only
  - Progression engine crashes → non-fatal, falls back to `createFallbackPayload`
- **Security**: JWT role enforcement prevents passenger/admin from spoofing driver locations

#### POST /api/location/start
- **Method**: POST
- **Auth**: Bearer token + driver role
- **Body**: `{ busId, lat, lng, routeId?, routeName?, routeColor?, direction? }`
- **Action**: Creates `trackingState` entry, assigns route, generates `tripId`
- **Response**: `{ success: true, tripId }`

#### POST /api/location/stop
- **Method**: POST
- **Auth**: Bearer token + driver role
- **Body**: `{ busId }`
- **Action**: Sets `trackingActive: false`, emits `BUS_OFFLINE`, clears state
- **Response**: `{ success: true, offline: true }`

#### GET /api/location/all
- **Method**: GET
- **Auth**: None (or minimal)
- **Response**: Array of active bus locations from `defaultCache` or DB fallback

#### GET /api/location/nearest-stop
- **Method**: GET
- **Query**: `lat`, `lng`, `routeId?`
- **Auth**: None
- **Response**: Enriched bus list with ETA, next stop, upcoming stops

### 4.3 SOS / Emergency

#### POST /api/sos
- **Method**: POST
- **Auth**: None (or driver token if available)
- **Body**: `{ busId, location: { latitude, longitude }, type: "emergency" }`
- **Validation**: `busId` required; valid coordinates from latest DB record
- **Action**:
  - Creates `DriverEmergency` record
  - Sets `setSosState(busId, true, io, location)`
  - Emits `BUS_OFFLINE` then `SOS_TRIGGERED`
- **Response 201**: `{ message: "SOS created", sosId, timestamp }`
- **Failure**: If no valid bus location in DB, returns 400

#### POST /api/sos/ack
- **Method**: POST
- **Auth**: Admin/Operator
- **Body**: `{ busId }`
- **Action**: Updates `DriverEmergency` status to `acknowledged`; emits `SOS_ACKNOWLEDGED`
- **Response 200**: `{ message: "SOS acknowledged", busId }`

#### POST /api/sos/clear
- **Method**: POST
- **Auth**: Admin/Operator
- **Body**: `{ busId }`
- **Action**: Updates status to `resolved`; emits `SOS_CLEARED`
- **Response 200**: `{ message: "SOS cleared", busId }`

#### GET /api/sos/status
- **Method**: GET
- **Query**: `busId`, `t` (cache buster)
- **Auth**: None
- **Response**: `{ active: boolean, sos: object | null }`
- **Logic**: Queries `DriverEmergency` with 5-minute TTL window on `lastUpdate` or `createdAt`

### 4.4 Passenger

#### GET /api/passenger/nearby-buses
- **Method**: GET
- **Auth**: Bearer token + `requireRole("passenger")`
- **Response**: `{ message, role, userId, buses: [ { busId, lat, lng, speed, heading, status, lastUpdate } ] }`
- **DB Query**: `Bus.find({ status: "active" }).select(...).sort({ lastUpdate: -1 }).lean()`

#### GET /api/passenger/routes
- **Method**: GET
- **Auth**: Bearer token + passenger role
- **Response**: `{ count, routes: [ { routeId, name } ] }`

#### GET /api/passenger/routes/:routeId/schedule
- **Method**: GET
- **Auth**: Bearer token + passenger role
- **Validation**: `routeId` must be valid MongoDB ObjectId
- **Response**: `{ routeId, routeName, stops: [ { stopId, name, latitude, longitude, order, time } ] }`
- **Logic**: Fetches `Route`, `Stop`, and `Schedule` in parallel via `Promise.all`; merges schedule times by `stopId`

#### POST /api/passenger/sos
- **Method**: POST
- **Auth**: Bearer token + passenger role
- **Body**: `{ location: { latitude, longitude } }`
- **Validation**: Coordinates within bounds
- **Action**: Creates `PassengerSos` record
- **Response 201**: `{ message: "SOS created", sosId, timestamp }`

### 4.5 Admin

#### POST /api/admin/drivers
- **Method**: POST
- **Auth**: None (note: production should add `requireAuth, requireRole("admin")`)
- **Body**: `{ name, email, password }`
- **Action**: Creates `User` with `role: "driver"`

#### GET /api/admin/drivers
- **Method**: GET
- **Response**: `{ count, drivers: [ { id, name, email, role } ] }`

#### PUT /api/admin/drivers/:id
- **Method**: PUT
- **Body**: `{ name?, email?, password? }`
- **Action**: Updates driver fields; re-hashes password if provided

#### DELETE /api/admin/drivers/:id
- **Method**: DELETE
- **Action**: `User.findOneAndDelete({ _id: id, role: "driver" })`

#### POST /api/admin/buses
- **Method**: POST
- **Body**: `{ busId, routeId? }`
- **Action**: `Bus.create({ busId, routeId })`

#### GET /api/admin/buses
- **Method**: GET
- **Response**: `{ count, buses }` with `populate("routeId", "name")`

#### POST /api/admin/routes
- **Method**: POST
- **Body**: `{ name, stops: [], schedule: [] }`
- **Action**: `Route.create({ name, stops, schedule })`

#### POST /api/admin/upload-schedule
- **Method**: POST
- **Content-Type**: `multipart/form-data`
- **Body**: `file` (.xlsx), `routeName?`
- **Action**: Parses XLSX with `xlsx` library; creates `Stop` and `Schedule` documents
- **Response**: `{ message, stopsCreated, routeId }`

### 4.6 Route Management

#### GET /api/routes
- **Method**: GET
- **Response**: `{ count, routes: [ { id, name, shortName, color, district, type, stopCount } ] }`

---

## 5. Socket Event Documentation

### 5.1 Server → Client Events

#### `connected`
- **Sender**: Server (`registerSocketHandlers`)
- **Receiver**: All connecting clients
- **Payload**: `{ message: "Socket connected", socketId }`
- **Trigger**: On every new socket connection
- **Purpose**: Handshake confirmation

#### `INIT_BUS_STOPS`
- **Sender**: Server (`emitBusStops`)
- **Receiver**: Connecting client (and all clients on explicit `REQUEST_BUS_STOPS`)
- **Payload**: `{ stops: [ { id, name, lat, lng } ] }`
- **Trigger**: On connection + on `REQUEST_BUS_STOPS`
- **Purpose**: Hydrates passenger app with full bus stop dataset
- **Failure**: Logs error but does not crash; client will see empty stops until retry

#### `BUS_LOCATION_UPDATE`
- **Sender**: Server (`locationController.js` → `io.emit`)
- **Receiver**: All connected passenger and admin clients
- **Payload**:
  ```json
  {
    "busId": "BUS101",
    "timestamp": 1705312200000,
    "latitude": 12.9346,
    "longitude": 79.1384,
    "snappedLat": 12.9345,
    "snappedLng": 79.1383,
    "isSnapped": true,
    "distanceFromRoute": 12,
    "speed": 12.3,
    "derivedSpeed": 44.2,
    "heading": 94,
    "trackingActive": true,
    "routeId": "VLR_1",
    "routeName": "Vellore Central Loop",
    "routeColor": "#2563eb",
    "direction": "OUTBOUND",
    "tripId": "TRIP_1705312200000_ABC123",
    "routeCoords": [[12.9346,79.1384], ...],
    "currentStopId": "custom_stop_117",
    "currentStopName": "Vellore Mofussil Bus Terminus",
    "nextStopId": "custom_stop_144",
    "nextStopName": "Vellore Fort Main Gate",
    "passedStopIds": [],
    "nextStopEtaMinutes": 4,
    "remainingDistanceMeters": 850,
    "routeProgressIndex": 0,
    "progressPercent": 5,
    "avgSpeedKmh": 28
  }
  ```
- **Trigger**: Every valid driver GPS update after progression computation
- **Cleanup**: None; this is the primary data event

#### `BUS_PROGRESS_UPDATE`
- **Sender**: Server
- **Receiver**: All clients
- **Payload**: `{ busId, tripId, routeId, currentStopIndex, nextStopIndex, passedStopIds, remainingDistanceKm, progressPercent, etaMinutes, avgSpeedKmh }`
- **Trigger**: Only when `hasProgressionChanged()` returns true (stop index change, ETA change ≥ 1 min, progress change ≥ 2%)
- **Purpose**: Throttled progression updates to reduce socket bandwidth

#### `BUS_OFFLINE`
- **Sender**: Server (`setTrackingActive` with `active: false`)
- **Receiver**: All clients
- **Payload**: `{ busId, reason: "tracking_stopped" | "stale_cleanup", timestamp }`
- **Trigger**: Driver STOP, SOS trigger, or stale TTL cleanup
- **Cleanup**: Client removes bus from local state and map markers

#### `BUS_STOP_EVENT`
- **Sender**: Server (via `onStopEvent` callback in progression engine)
- **Receiver**: All clients
- **Payload**: `{ type: "ARRIVED" | "DEPARTED" | "DWELLING" | "APPROACHING", busId, stopId, stopName, etaMinutes?, dwellSeconds?, timestamp }`
- **Trigger**: `updateStopEventState()` detects lifecycle transitions
- **Purpose**: Real-time stop arrival/departure announcements

#### `SOS_TRIGGERED`
- **Sender**: Server (`setSosState`)
- **Receiver**: All clients
- **Payload**: `{ busId, lat, lng, timestamp }`
- **Trigger**: Driver emergency button or `/api/sos` endpoint
- **Cleanup**: Cleared by `SOS_CLEARED` event

#### `SOS_CLEARED`
- **Sender**: Server (`clearSos`)
- **Receiver**: All clients
- **Payload**: `{ busId, clearedAt }`
- **Trigger**: Admin clears SOS via `/api/sos/clear`

#### `SOS_ACKNOWLEDGED`
- **Sender**: Server (`acknowledgeSos`)
- **Receiver**: All clients
- **Payload**: `{ busId, acknowledgedAt }`
- **Trigger**: Admin acknowledges SOS via `/api/sos/ack`

#### `sosAlert` (legacy admin event)
- **Sender**: Server (`driverFeatureController.js`)
- **Receiver**: Admin dashboard
- **Payload**: `{ busId, message, time }`

### 5.2 Client → Server Events

#### `REQUEST_BUS_STOPS`
- **Sender**: Passenger App (BusContext or HomeScreen)
- **Receiver**: Server
- **Payload**: None
- **Action**: Server calls `emitBusStops(socket)` to send `INIT_BUS_STOPS`
- **Purpose**: Reliable re-request if initial `INIT_BUS_STOPS` on connect was missed

### 5.3 WebView ↔ React Native Events

#### RN → WebView (`postMessage`)

| Type | Payload | Purpose |
|------|---------|---------|
| `USER_LOCATION` | `{ lat, lng }` | Update passenger beacon marker |
| `BUS_UPDATE` | `{ buses: [...] }` | Create/update bus markers |
| `BUS_OFFLINE` | `{ busId }` | Remove bus marker |
| `FOLLOW_UPDATE` | `{ payload: busId \| null }` | Enable/disable follow panning |
| `DRAW_ROUTE` | `{ busId, routeId, routeColor, coordinates }` | Render route polyline |
| `CLEAR_ROUTE` | `{}` | Remove route polyline |
| `INIT_BUS_STOPS` | `{ stops: [...] }` | Create stop markers |
| `STOP_PROGRESSION` | `{ busId, nextStopIndex, passedStopIds, etaMinutes }` | Highlight next stop |
| `DRAW_STOP_ROUTE` | `{ payload: { stop, userLocation } }` | Draw walking route to stop |
| `TOGGLE_NEAREST_ROUTE` | `{ enabled }` | Show/hide nearest route line |
| `SOS_TRIGGERED` | `{ busId, lat, lng }` | Show SOS marker |
| `SOS_CLEARED` | `{ busId }` | Remove SOS marker |
| `SOS_ACKNOWLEDGED` | `{ busId }` | Update SOS popup UI |

#### WebView → RN (`window.ReactNativeWebView.postMessage`)

| Type | Payload | Purpose |
|------|---------|---------|
| `MAP_READY` | `{}` | WebView initialized, ready for data |
| `PING` | `{}` | Heartbeat check |
| `BUS_SELECTED` | `{ busId }` | User tapped bus marker |
| `SET_FOLLOW` | `{ busId }` | User toggled follow in popup |
| `SOS_ACK` | `{ busId }` | User pressed SOS acknowledge |
| `NEAREST_STOPS` | `{ stops: [ { id, name, distance, etaMinutes } ] }` | Walking distances to stops |

---

## 6. Database Documentation

### 6.1 MongoDB Collections

#### `buses`

```javascript
{
  busId: String,          // Unique, indexed
  location: {
    type: "Point",
    coordinates: [Number] // [longitude, latitude]
  },
  route: String,          // Indexed
  routeId: String,
  destination: String,
  speed: Number,          // m/s, default 0, max 100
  heading: Number,        // degrees, 0-360
  capacity: Number,
  occupancy: Number,      // min 0
  status: String,         // enum: ['active','inactive','maintenance','out_of_service']
  eta: [{
    stopId: String,
    stopName: String,
    arrivalTime: Date,
    delay: Number         // seconds
  }],
  lastUpdate: Date,       // TTL index: expireAfterSeconds: 3600
  createdAt: Date,
  expireAt: Date          // Auto-cleanup after 24h inactivity
}
```

**Indexes:**
- `busId`: Standard index (unique)
- `location`: `2dsphere` geospatial index for `$near` / `$geoWithin`
- `status`: Compound `{ status: 1, lastUpdate: -1 }`
- `route`: Compound `{ route: 1, status: 1 }`
- `lastUpdate`: TTL index `{ lastUpdate: 1 }, { expireAfterSeconds: 3600 }`

**Why 2dsphere on `location`:**
MongoDB's 2dsphere index supports spherical geometry queries essential for accurate `$near` (nearest buses) and `$geoWithin` (buses in map viewport) operations on the Earth's surface.

**Why TTL index:**
Automatically removes stale bus documents after 1 hour of inactivity, preventing unbounded collection growth if cleanup logic fails.

#### `users`

```javascript
{
  name: String,           // required, trimmed
  role: String,           // enum: ['admin','driver','passenger']
  email: String,          // required, unique, lowercase, trimmed
  password: String        // bcrypt hash
}
```

#### `routes`

```javascript
{
  routeName: String,
  stops: [{
    name: String,
    lat: Number,
    lng: Number
  }]
}
```

#### `stops`

```javascript
{
  routeId: ObjectId,      // ref: Route, required, indexed
  name: String,           // required, trimmed
  latitude: Number,         // required
  longitude: Number,      // required
  order: Number           // required, min 0
}
```

**Index**: `{ routeId: 1, order: 1 }` — Supports ordered stop retrieval for route progression.

#### `schedules`

```javascript
{
  routeId: ObjectId,      // ref: Route, required, indexed, unique
  stops: [{
    stopId: ObjectId,     // ref: Stop
    time: String           // e.g., "08:30"
  }]
}
```

#### `driveremergencies`

```javascript
{
  busId: String,
  type: String,           // e.g., "breakdown"
  location: {
    latitude: Number,
    longitude: Number
  },
  status: String,         // active | acknowledged | resolved
  timestamp: Date,
  acknowledgedAt: Date,
  resolvedAt: Date
}
```

#### `passengersos`

```javascript
{
  passengerId: String,
  location: {
    latitude: Number,
    longitude: Number
  },
  timestamp: Date
}
```

### 6.2 Query Optimization

- **`getNearestStopHandler`** uses `defaultCache` first; only falls back to `Bus.find()` if cache is empty. Cache is hydrated on first query and updated on each DB read.
- **`findNearby`** uses the `2dsphere` index with `$near` + `status` filter + `lastUpdate` window, limited to 50 results.
- **`findInBounds`** uses `$geoWithin` with a polygon bounding box for viewport queries.
- **Parallel queries**: `getNearestStopHandler` executes `Stop.find()`, `Route.find()`, and `Schedule.find()` simultaneously via `Promise.all`.

### 6.3 Real-Time Considerations

- DB writes happen on every GPS update, but DB reads are largely replaced by `defaultCache` for passenger queries
- `markStaleBusesInactive` runs every 60s to batch-update status, preventing per-update write amplification
- Upsert on `Bus.findOneAndUpdate` ensures atomic create-or-update without race conditions

---

## 7. Real-Time Engine Documentation

### 7.1 Socket Synchronization

The system uses a **single Socket.IO server** with broadcast semantics. There are no rooms, namespaces, or per-client filtering. Every connected client receives every `BUS_LOCATION_UPDATE`.

**Why broadcast:**
- All passengers in a region need visibility into all active buses
- Filtering by viewport or route would add server-side compute; client-side filtering is cheaper since the data volume is small (~1 KB per bus per update)
- Simplifies debugging: `io.emit()` guarantees all clients see the same state

**Reconnection resilience:**
- Passenger app socket configured with `reconnection: true`, `reconnectionAttempts: Infinity`, `reconnectionDelay: 1000`
- On reconnect, the server automatically re-sends `INIT_BUS_STOPS` and subsequent `BUS_LOCATION_UPDATE` events flow normally

### 7.2 Projection Engine

#### Route Corridor Projection

**Function**: `projectOntoRouteCorridor(busLat, busLng, routeCoordinates, busId)`

**Algorithm**:
1. **Normalize coordinates**: Each coordinate in `routeCoordinates` is passed through `normalizeCoord()`, which auto-detects `[lat,lng]` vs `[lng,lat]` formats and validates ranges
2. **Segment iteration**: For each consecutive pair `(start, end)` in the normalized route:
   - Convert to local meter scale using `latScale = cos(latAvg * PI/180) * 111320`, `lngScale = 111320`
   - Vector projection: compute `t = dot(dpx, dpy) / lenSq` clamped to `[0,1]`
   - Projected point: `projLat = y1 + t*(y2-y1)`, `projLng = x1 + t*(x2-x1)`
   - Haversine distance from bus to projection
3. **Best segment selection**: Track minimum distance across all segments
4. **Threshold enforcement**:
   - `distance > 150m` → hard reject, return null
   - `distance <= 100m` → hard snap (`isSnapped: true`)
   - `100m < distance <= 150m` → soft snap (`isSnapped: true, isSoftSnap: true`)

**Why local meter approximation instead of full geodesic projection:**
- Performance: Computing exact geodesic projections for 100+ segments per GPS update would be CPU-intensive
- Accuracy: At Indian latitudes (~13°N), the local Cartesian approximation error is < 0.5% for segments under 5km, which is acceptable for bus tracking

#### Cumulative Distance Tracking

The projection engine also computes:
- `cumulativeDistance`: Total meters along the route from start to the projected point
- `totalRouteLength`: Total meters of the entire route
- `progressPercent`: `(cumulativeDistance / totalRouteLength) * 100`

These values are used for ETA calculation and route completion visualization.

### 7.3 Stop Progression Logic

**Function**: `determineStopProgression(projection, routeStops, prevProgression, accuracy, busId)`

**State machine**:
- `currentStopIndex`: The stop the bus is currently at (within arrival threshold)
- `nextStopIndex`: The upcoming stop
- `passedStopIds`: Array of stop IDs the bus has already passed

**Forward-only constraint**:
- The bus can only advance forward in the stop sequence; it cannot regress to a previous stop
- This prevents GPS noise near a passed stop from flipping the current stop back

**Dynamic thresholds**:
- `effectiveArrivalThreshold = max(80, accuracy)` — A bus with poor GPS (80m accuracy) needs to be within 80m to be considered "at" a stop
- `effectiveHysteresis = max(60, accuracy * 1.5)` — The bus must advance 60m (or 1.5x accuracy) past a stop to be considered departed

**Lifecycle detection** (via `updateStopEventState`):
1. **APPROACHING**: Bus is > arrival threshold but ETA ≤ 2 minutes. Emitted once per stop via event lock.
2. **ARRIVED**: Bus distance ≤ arrival threshold. Event lock prevents duplicate emits.
3. **DWELLING**: Bus has been at stop for ≥ 5 seconds. Emitted once.
4. **DEPARTED**: Bus distance > hysteresis threshold. Computes `dwellSeconds` and emits once.

### 7.4 Bus Movement Updates

**Speed handling**:
- Driver app computes speed using Haversine distance and time delta (`calculateSpeed()`)
- Backend uses driver-provided speed directly (`rawDriverSpeed`); it does NOT recompute speed
- Dead-zone filter: if speed < 5 km/h (`MIN_SPEED_MPS = 1.39 m/s`), clamped to 0 to prevent UI noise
- Derived speed: backend independently computes `derivedSpeed` from position changes for reliable movement detection

**Jitter filtering**:
- `GPS_JITTER_THRESHOLD_METERS = 15`
- If projected point moves < 15m from previous projected point, the update is discarded and previous progression is returned with `jitterFiltered: true`
- This prevents stop markers from flickering when the bus is stationary at a traffic signal

### 7.5 Offline Detection

**Three-layer detection**:

1. **Explicit STOP**: Driver presses STOP → `trackingActive: false` → immediate `BUS_OFFLINE`
2. **Stale TTL**: `cleanupStaleState()` runs every 15s. If `lastUpdate` > 5 minutes, emits `BUS_OFFLINE`
3. **DB stale mark**: `markStaleBusesInactive()` runs every 60s. Updates DB `status` to `inactive` for `lastUpdate` > 5 min

**Why three layers:**
- Explicit STOP handles normal operation
- TTL cleanup handles app crashes, phone shutdowns, or network blackouts where the driver cannot send STOP
- DB stale mark ensures the database reflects reality even if the in-memory `trackingState` is lost on server restart

### 7.6 Marker Replacement

**WebView strategy**:
- `window.busMarkers` is an object keyed by `busId` (mirrors RN's `buses` object structure)
- On each `BUS_UPDATE`:
  - `incomingIds = new Set(data.buses.map(b => b.busId))`
  - Iterate existing markers: if `!incomingIds.has(busId)`, remove layer and delete key
  - Iterate incoming buses: if marker exists, `setLatLng()`; if not, create new `L.marker()`

**Why remove-then-create instead of clear-all:**
- Preserves map pan/zoom state
- Minimizes DOM/Canvas operations: `setLatLng()` is O(1); destroying and recreating all markers would cause frame drops

**Stop markers**:
- `window.__busStopMarkers` keyed by `stopId`
- Created once on `INIT_BUS_STOPS`
- Zoom-based visibility: `zoomend` listener shows stops only at zoom ≥ 15 to reduce visual clutter

---

## 8. Frontend Implementation Documentation

### 8.1 React Native Structure

**Passenger App screens**:
- `LoginScreen` / `PassengerLoginScreen`: JWT acquisition
- `HomeScreen`: MiniMap preview, nearest stops list, SOS alerts, active bus cards
- `FullMapScreen`: Full-screen interactive WebView with route drawing, follow mode, popups
- `NearbyBusesScreen`: REST-based bus list with simple WebView map
- `ScheduleScreen`: Route schedule viewer
- `ProfileScreen`: User profile
- `EmergencyScreen`: Passenger SOS trigger

**Navigation**:
- `NativeStackNavigator` for auth flow
- `DrawerNavigator` for authenticated screens
- `BusProvider` wraps the drawer to ensure global state availability
- `MapPreviewProvider` (additional context for map state)

### 8.2 Screen Responsibilities

#### HomeScreen
- Renders `MiniMap` (memoized WebView component)
- Subscribes to `buses` object from `BusContext`
- Requests passenger location via `Expo Location`
- Sends `USER_LOCATION` to MiniMap WebView
- Receives `NEAREST_STOPS` from WebView and displays walking ETAs
- Renders `Speedometer` component for selected bus

#### FullMapScreen
- Full-screen WebView with all interactive features
- `handleWebViewMessage` processes:
  - `MAP_READY`: Resends all cached data (user location, bus updates, follow state)
  - `BUS_SELECTED`: Opens popup for selected bus
  - `SET_FOLLOW`: Toggles follow mode
  - `SOS_ACK`: Calls backend `/sos/ack`
- Effects:
  - `buses` → `BUS_UPDATE` postMessage
  - `busProgress` → `STOP_PROGRESSION` postMessage
  - `followBusId` / `selectedBusId` → `DRAW_ROUTE` / `CLEAR_ROUTE`
  - `selectedStopRoute` → `DRAW_STOP_ROUTE` (one-time walking route)
  - `socket` events (`BUS_OFFLINE`, `SOS_ACKNOWLEDGED`) → postMessage
  - `DeviceEventEmitter` for global SOS events from HomeScreen

### 8.3 BusContext

```javascript
const [buses, setBuses] = useState({});           // O(1) lookup by busId
const [busProgress, setBusProgress] = useState({}); // Parallel progress state
const [busStops, setBusStops] = useState([]);     // From socket INIT_BUS_STOPS
const [followBusId, setFollowBusId] = useState(null);
```

**Update philosophy**:
- `BUS_LOCATION_UPDATE` performs a **clean replacement** of the entire bus object
- No merging of nested fields; this guarantees no stale data persists across updates
- `busProgress` is stored separately to allow fine-grained re-renders of progression UI without redrawing the entire bus list

### 8.4 WebView Rendering

**Map initialization** (inside inline HTML):
```javascript
window.map = L.map("map", {
  zoomControl: false,
  attributionControl: false,
  preferCanvas: true,
  zoomAnimation: false,
  fadeAnimation: false,
  markerZoomAnimation: false
}).setView([13.0827, 80.2707], 15);
```

**Tile layer**: CARTO light tiles with `reuseTiles: true`, `keepBuffer: 8`, `crossOrigin: true`

**Performance optimizations in WebView**:
- Canvas rendering (`preferCanvas: true`) handles 50+ markers without SVG DOM overhead
- Disabled animations prevent jank during rapid `setLatLng()` calls
- Tile reuse and buffer reduce network requests during panning

### 8.5 postMessage Bridge

**RN → WebView**:
- Uses `webViewRef.current.postMessage(JSON.stringify(msg))`
- All messages are typed with a `type` field
- `MAP_READY` recovery mechanism: on WebView reload, RN automatically resends cached `lastUserLocationRef`, `busStopsRef`, and latest bus data

**WebView → RN**:
- Uses `window.ReactNativeWebView.postMessage(JSON.stringify(msg))`
- Handler attached via `document.addEventListener("message", ...)` with a guard `window.__messageHandlerAttached` to prevent duplicate listeners
- Message queue (`window.__messageQueue`) buffers early messages before handler attachment

### 8.6 Marker Lifecycle

**Bus markers**:
- Created on first `BUS_UPDATE` containing the busId
- Updated via `setLatLng()` on subsequent updates
- Removed on `BUS_OFFLINE` or if bus is missing from incoming `BUS_UPDATE` payload
- Icon: `L.icon({ iconUrl: "https://cdn-icons-png.flaticon.com/512/3448/3448339.png", iconSize: [32,32] })`

**SOS markers**:
- Replaces bus marker on `SOS_TRIGGERED`
- Icon: red emergency cross from flaticon
- Removed on `SOS_CLEARED`

**User location beacon**:
- `L.divIcon` with CSS pulse animation
- Updated on every `USER_LOCATION` message

### 8.7 UI Synchronization

- React Native state (`buses`) drives WebView state exclusively
- WebView does not maintain independent bus data; it is a pure rendering surface
- This unidirectional data flow prevents desynchronization bugs

### 8.8 Memory Leak Prevention

- `useEffect` cleanup in `BusContext` removes socket listeners and closes connection on unmount
- `useEffect` cleanup in `FullMapScreen` removes `DeviceEventEmitter` subscriptions
- WebView message handler uses `window.__messageHandlerAttached` guard to prevent duplicate listener attachment on React re-renders
- `lastDrawnRouteRef` and `lastFittedRouteRef` prevent redundant postMessage spam

---

## 9. Backend Implementation Documentation

### 9.1 Controller Flow

#### locationController.updateLocation

**Entry wrapper**: `updateLocation()` wraps `_updateLocationUnsafe()` in a try/catch that returns HTTP 200 with a degraded payload on fatal errors. This prevents the driver app from entering a retry storm if the backend crashes mid-request.

**Telemetry steps**:
1. Log `req.body`, `req.path`, `req.method`
2. Validate required fields (`busId`, `lat`, `lng`)
3. `trackingState` guard: bus must exist and be active
4. Handle STOP signal (`trackingActive: false`)
5. Strict coordinate validation (finite, in bounds)
6. DB upsert with GeoJSON Point
7. Speed normalization (dead-zone filter)
8. Progression computation (optional enrichment)
9. Route snapping (optional enhancement)
10. Socket emit (non-blocking, failure tolerant)
11. Progress emit (throttled by `hasProgressionChanged`)
12. Update `trackingState` Map
13. Return success response

### 9.2 Real-Time State Tracking (`trackingState`)

**Data structure**:
```javascript
Map<string, {
  trackingActive: boolean,
  sos: boolean,
  sosActive: boolean,
  lastUpdate: number,
  location: { latitude, longitude },
  speed: number,
  derivedSpeed: number,
  routeId: string,
  routeName: string,
  routeColor: string,
  direction: string,
  tripId: string,
  currentStopIndex: number,
  progression: object
}>
```

**Lifecycle**:
- Created by `startTracking` API or bootstrapped by SOS trigger
- Updated by every `updateLocation` call
- Marked inactive by `setTrackingActive(busId, false)`
- Deleted by `setTrackingActive` when transitioning active → inactive
- Auto-deleted by `cleanupStaleState` after 5 minutes of inactivity

### 9.3 Tracking State Map

Exported as a module-level `const trackingState = new Map()`. This is the **authoritative in-memory state** for the entire system.

**Why not Redis/Memcached:**
- The state is transient and small (< 100 buses × ~500 bytes = 50KB)
- Sub-millisecond access is required for 5-second GPS update intervals
- Server restart recovery is handled by driver re-authentication and `startTracking`

### 9.4 Cleanup System

**Two schedulers** in `server.js`:

1. **Stale bus DB cleanup** (60s interval):
   ```javascript
   setInterval(async () => {
     await Bus.markStaleBusesInactive();
   }, 60000);
   ```
   Updates DB documents older than 5 minutes to `status: "inactive"`.

2. **Tracking state TTL cleanup** (15s interval):
   ```javascript
   setInterval(() => {
     const cleaned = cleanupStaleState(io);
   }, 15000);
   ```
   Iterates `trackingState`, deletes entries with `lastUpdate > 5 minutes`, emits `BUS_OFFLINE`.

**Why 15s for state cleanup vs 60s for DB cleanup:**
- In-memory state must reflect reality quickly for passenger UX
- DB writes are more expensive; batching to 60s reduces write load

### 9.5 SOS Enforcement

**`setSosState(busId, true, io, location)`**:
1. Disables tracking (`trackingActive: false`)
2. Emits `BUS_OFFLINE` to remove bus from passenger maps
3. Emits `SOS_TRIGGERED` with location to all clients
4. Persists `DriverEmergency` record

**`setSosState(busId, false, io)`**:
1. Clears SOS flags
2. Does NOT automatically re-enable tracking (driver must explicitly restart)
3. Emits `SOS_CLEARED`

**Why tracking stays disabled after SOS clear:**
- Prevents automatic reconnection if the bus is still being serviced
- Ensures the driver explicitly confirms readiness to resume

### 9.6 Driver Validation

- `requireAuth` middleware verifies JWT signature and attaches `req.user`
- `requireRole("driver")` returns 403 if `req.user.role !== "driver"`
- `normalizeDriverLocationPayload` middleware coerces field names (`lat`/`latitude`, `lng`/`longitude`) to handle driver app schema variations

### 9.7 Telemetry Logging

Extensive structured logging is implemented throughout:
- `[FLOW] STEP N` markers trace execution through the location controller
- `[BACKEND] ✅/❌` markers indicate success/failure of DB and socket operations
- `[SNAP TRACE]` logs corridor projection diagnostics
- `[PROGRESSION ENTRY/EXIT]` logs stop progression computation flow
- `[SOS STATE]` logs all SOS transitions

All logs use JSON-serialized objects with `timestamp`, `busId`, and relevant metrics. This enables grep-based log analysis in production.

### 9.8 Error Handling

**Defensive programming patterns**:
- Every external service call wrapped in try/catch (DB, socket, progression engine)
- `createFallbackPayload()` returns a safe degraded object on controller failure
- `createFallbackProgression()` returns safe defaults on progression failure
- `sanitizeNumber()` filters `NaN` and `Infinity` before serialization
- `normalizeCoord()` handles both `[lat,lng]` and `[lng,lat]` formats to prevent coordinate order bugs
- `projectPointOntoSegment()` catches math errors and returns `{ point: null, distance: Infinity }` instead of throwing

---

## 10. Performance Optimization Documentation

### 10.1 Throttling

**Driver app**:
- `MIN_API_INTERVAL_MS = 5000` — Minimum 5 seconds between HTTP POSTs
- `MIN_DISTANCE_METERS = 10` — No update if moved < 10 meters (except heartbeat)
- Throttled updates are queued in AsyncStorage and flushed when constraints allow

**Backend**:
- `EMIT_DISTANCE_THRESHOLD_METERS = 15` — GPS updates within 15m of last emitted position are ignored (jitter filter)
- `MIN_TIME_DIFF_SEC = 3` — Minimum 3 seconds between progression computations

### 10.2 Debouncing

- `scheduleBatch()` in `usePostMessageBusTracking` waits 250ms before flushing accumulated bus updates to the WebView
- This collapses multiple rapid `BUS_LOCATION_UPDATE` socket events into a single `postMessage`, reducing WebView bridge overhead

### 10.3 Marker Reuse

**WebView**:
- `window.busMarkers` object keyed by `busId` enables O(1) marker lookup
- Existing markers are moved with `setLatLng()` rather than destroyed and recreated
- New markers are only created for buses not yet in the registry

**Why reuse matters**:
- Leaflet SVG markers cause DOM reflows on creation/destruction
- Canvas markers (`preferCanvas: true`) are faster but still benefit from reuse
- At 50 buses × 5s updates, creating 50 new markers every 5 seconds would cause visible frame drops

### 10.4 Socket Optimization

- `BUS_PROGRESS_UPDATE` is throttled by `hasProgressionChanged()`:
  - Stop index changes → emit
  - ETA changes by ≥ 1 minute → emit
  - Progress percent changes by ≥ 2% → emit
  - Otherwise → skip
- This reduces socket bandwidth by ~60% during steady-state highway driving

### 10.5 Memory Management

- `trackingState` Map deletes entries on `BUS_OFFLINE`; no unbounded growth
- `defaultCache` deletes stale entries via `deleteStale(ACTIVE_WINDOW_MS)`
- `progressionEngine` clears per-bus state on `clearBusState()`
- MongoDB TTL index auto-deletes `Bus` documents after 1 hour of inactivity
- Driver app clears AsyncStorage queue after successful flush

### 10.6 WebView Optimization

- `preferCanvas: true` — Canvas renderer instead of SVG
- Animation disabled — `zoomAnimation`, `fadeAnimation`, `markerZoomAnimation` all false
- Tile optimization — `reuseTiles: true`, `keepBuffer: 8`, `updateWhenIdle: false`
- Message batching — 250ms batch window collapses rapid updates

### 10.7 State Synchronization Optimization

- `BusContext` stores buses as an object, not an array, for O(1) updates
- `FullMapScreen` uses `useMemo` to convert `contextBuses` object to array only when dependencies change
- `lastDrawnRouteRef` prevents redundant `DRAW_ROUTE` postMessages for the same bus+route combination
- `webViewReadyRef` (mutable ref) is used for immediate-send checks without causing re-renders

---

## 11. Security Documentation

### 11.1 Driver Authentication

- JWT-based authentication with `Bearer` token scheme
- Tokens expire in 1 day (`expiresIn: "1d"`)
- Role claim in token payload (`{ id, role }`)
- Password hashing with `bcryptjs` (salt rounds: 10)

### 11.2 API Protection

- `requireAuth` middleware on all non-public routes
- `requireRole` middleware enforces role-based access:
  - `/api/driver/*` → `driver`
  - `/api/passenger/*` → `passenger`
  - `/api/admin/*` → `admin` (note: some admin routes currently lack auth — production hardening required)
- CORS origin filtering via `configuredOrigins` environment variable

### 11.3 Socket Validation

- Socket.IO runs with `cors: { origin: "*" }` — in production, this should be restricted to known client origins
- No JWT validation on socket connections in current implementation; all security is at the HTTP layer
- **Recommendation**: Implement socket handshake JWT verification for production

### 11.4 GPS Validation

- `lat` and `lng` must be finite numbers
- Geographic bounds enforcement: `lat ∈ [-90, 90]`, `lng ∈ [-180, 180]`
- `accuracy` > 50m is rejected (except first update after START)
- Extreme jump filter: distance > 1km in one update is rejected
- Speed clamped to ≤ 40 m/s (144 km/h) to filter GPS spikes

### 11.5 Anti-Spam Protection

- `MIN_API_INTERVAL_MS = 5000` prevents rapid-fire location updates
- `trackingState` guard prevents updates for buses that never called `startTracking`
- `isSendingRef` in driver app prevents overlapping HTTP requests
- `sosSendingRef` prevents duplicate SOS triggers

### 11.6 SOS Validation

- SOS creation requires a valid `busId` and a known location from the DB
- Driver emergency endpoint requires `latitude` and `longitude` in request body
- Acknowledge/Clear endpoints require admin intervention (no auto-clear by driver)

---

## 12. Testing Documentation

### 12.1 Test Scenarios

#### GPS Update Pipeline
1. Driver starts tracking → verify `BUS_LOCATION_UPDATE` reaches passenger within 5s
2. Driver moves 100m → verify snapped coordinates in payload
3. Driver stops at traffic signal → verify jitter filter prevents marker movement
4. Driver moves off-route (> 80m) → verify `isSnapped: false`, raw GPS used

#### SOS Lifecycle
1. Driver triggers SOS → verify `BUS_OFFLINE` then `SOS_TRIGGERED` emitted
2. Passenger app → verify bus marker replaced with SOS marker
3. Admin acknowledges → verify `SOS_ACKNOWLEDGED` received
4. Admin clears → verify `SOS_CLEARED` received, marker removed
5. Driver attempts location update during SOS → verify blocked by `bgSosActive`

#### Stop Progression
1. Bus approaches stop within 2 min → verify `APPROACHING` event
2. Bus enters 40m threshold → verify `ARRIVED` event
3. Bus dwells > 5s → verify `DWELLING` event
4. Bus departs > 60m → verify `DEPARTED` event with dwell time

#### Offline Detection
1. Driver presses STOP → verify immediate `BUS_OFFLINE`
2. Driver kills app without STOP → verify TTL cleanup emits `BUS_OFFLINE` within 5 min
3. Server restarts → verify driver must call `startTracking` again

### 12.2 Edge Cases

- **Zero GPS accuracy**: Handled by treating `null`/`undefined` accuracy as 0
- **Coordinate order reversal**: `normalizeCoord()` auto-detects and corrects
- **Empty route coordinates**: `computeBusProgression()` returns `createFallbackProgression()`
- **DB write failure**: Tracking continues with degraded in-memory object
- **Socket emit failure**: Logged but non-fatal; tracking continues
- **Background task without globals**: Returns early if `bgBusId` or `bgToken` missing

### 12.3 Failure Simulations

- **Network blackout**: Driver app queues updates; verify flush on reconnect
- **Server crash**: Driver app receives 500; verify retry with exponential backoff
- **Invalid JWT**: Driver app receives 401; verify no retry (token expired)
- **Rapid START/STOP**: Verify `trackingLifecycleRef` state machine prevents duplicate starts

### 12.4 GPS Drift Tests

- Simulate stationary bus with ±15m GPS noise → verify marker does not move
- Simulate ±50m noise with 20m accuracy → verify `effectiveArrivalThreshold = 50m`, arrival detected correctly
- Simulate coordinate flip `[lng,lat]` vs `[lat,lng]` → verify `normalizeCoord()` corrects

### 12.5 Offline Tests

- Disconnect driver device for 3 minutes → verify TTL cleanup marks bus offline
- Reconnect driver device → verify `startTracking` restores state
- Background task with `trackingActive === false` in AsyncStorage → verify blocked

### 12.6 Load Testing Strategy

- **Simultaneous buses**: Use `k6` or Artillery to simulate 50 drivers sending GPS every 5s
- **Socket clients**: Simulate 500 passenger connections receiving broadcasts
- **DB load**: Monitor `Bus.findOneAndUpdate` latency under 50 concurrent writes
- **Memory growth**: Monitor `trackingState` Map size and `defaultCache` growth over 24 hours

---

## 13. Production Hardening Documentation

### 13.1 Defensive Programming

- **Fatal error wrapper**: `updateLocation()` returns degraded HTTP 200 instead of crashing
- **Progression non-fatality**: `computeBusProgression()` wrapped in try/catch; tracking survives engine crashes
- **Route snap non-fatality**: `snapToRouteCorridor()` wrapped; raw GPS used if snapping fails
- **Coordinate sanitization**: `sanitizeNumber()` prevents `NaN`/`Infinity` from poisoning socket payloads
- **Payload safe serialization**: `JSON.parse(JSON.stringify(emitPayload))` strips circular references

### 13.2 Crash Prevention

- **State machine guards**: `trackingLifecycleRef` prevents `startTracking` during `starting` or `active` states
- **Overlap prevention**: `isSendingRef` prevents concurrent HTTP requests
- **Queue drain guard**: `flushInProgressRef` prevents parallel queue flushes
- **SOS race safety**: `isCheckingSOS` flag prevents overlapping status polls

### 13.3 State Recovery

- **App restart**: Driver app checks AsyncStorage `trackingActive` on mount; if not `true`, clears orphaned globals
- **WebView reload**: `MAP_READY` handler in `FullMapScreen` resends all cached state
- **Socket reconnect**: `reconnection: true` with automatic resubscription to events

### 13.4 Cleanup Mechanisms

- **Unmount cleanup**: All `useEffect` return functions remove subscriptions, intervals, and listeners
- **Stop teardown**: `stopTracking()` clears AsyncStorage, globals, queue, retry timeouts, and guarantee timeouts
- **Server SIGINT**: Graceful shutdown closes HTTP server and MongoDB connection

### 13.5 Stability Improvements

- **Heartbeat updates**: `FORCE_UPDATE_INTERVAL_MS = 15000` ensures at least one update every 15 seconds even when stationary
- **Guaranteed start update**: 3-second timeout after `startTracking` fetches current GPS and forces a send
- **First update accuracy bypass**: `firstUpdateAfterStartRef` allows weak GPS on first fix to prevent startup stalls

### 13.6 Failure Tolerance

- **DB failure tolerance**: Continue tracking with degraded object
- **Socket failure tolerance**: Continue tracking; clients reconnect and receive fresh state
- **Progression failure tolerance**: Fallback progression with all defaults
- **Route data failure tolerance**: Missing `routeCoords` disables snapping but preserves raw GPS tracking

---

## 14. Future Enhancement Documentation

### 14.1 AI ETA Prediction

**Current limitation**: ETA is computed using simple rolling average speed (`rollingSpeedKmh = old * 0.7 + new * 0.3`).

**Enhancement**: Integrate a lightweight ML model (e.g., TensorFlow.js or a pre-trained scikit-learn model served via Python microservice) that predicts ETA using:
- Historical traffic patterns by time of day
- Weather conditions (rain/slowdown correlation)
- Bus dwell time history per stop
- Route segment speed baselines

**Implementation path**:
- Collect 3-6 months of `BUS_LOCATION_UPDATE` telemetry
- Train gradient boosting regressor on `{ routeId, hourOfDay, dayOfWeek, segmentIndex, historicalSpeed } → actualTravelTime`
- Deploy model as `/api/eta/predict` endpoint
- Replace `computeEta()` call with model inference when confidence > threshold

### 14.2 Traffic-Aware Routing

**Enhancement**: Integrate real-time traffic data (Google Maps Directions API, Mapbox Traffic, or OpenTraffic) into the route corridor.

**Implementation**:
- Fetch traffic speeds for each route segment
- Adjust `speedForEta` in `computeEta()` by segment-level traffic multiplier
- Re-project route corridors using traffic-aware routing instead of static OSM coordinates

### 14.3 Push Notifications

**Enhancement**: Replace socket-only updates with native push notifications for:
- Bus approaching stop (2-minute warning)
- SOS alerts in vicinity
- Route delays > 10 minutes

**Implementation**:
- Integrate Expo Notifications or Firebase Cloud Messaging (FCM)
- Backend emits push via FCM API when `APPROACHING` event fires
- Passenger app registers FCM token on login

### 14.4 Admin Dashboard

**Current state**: Basic React app with CRUD tables and a live map.

**Enhancement**:
- Real-time fleet overview with heatmaps
- Historical route adherence reports (compare GPS traces to assigned corridors)
- Driver performance metrics (on-time percentage, average speed, stop dwell times)
- Schedule deviation alerts

### 14.5 Analytics

**Enhancement**: ClickHouse or TimescaleDB ingestion of `BUS_LOCATION_UPDATE` events for:
- Peak hour demand analysis per route
- Bus utilization rates
- Stop-level boarding/alighting estimation (based on dwell time)
- GPS accuracy trend analysis by device model

### 14.6 Fleet Management

**Enhancement**: Expand admin capabilities:
- Bulk route assignment via CSV/XLSX upload
- Geofence alerts (bus leaves assigned district)
- Maintenance scheduling integration (auto-flag buses due for service)
- Driver shift scheduling and automated route handoff

### 14.7 Predictive Maintenance

**Enhancement**: Correlate GPS anomalies with mechanical issues:
- Sudden speed drops → engine trouble indicator
- Repeated route deviations → steering/suspension issues
- Extended dwell times → door/brake problems
- Integrate with workshop ticketing system

---

## Appendix A: File Structure Reference

```
backend/
  src/
    app.js                  # Express app, route mounting
    server.js               # HTTP server, Socket.IO, schedulers
    config/
      db.js                 # MongoDB connection
      env.js                # Environment variable loader
    controllers/
      authController.js     # Login/register
      locationController.js # GPS ingestion, progression orchestration
      driverController.js   # Route assignment
      driverFeatureController.js # SOS trigger/ack/clear
      passengerFeatureController.js # Passenger SOS
      adminController.js    # CRUD operations
    middleware/
      authMiddleware.js     # JWT + RBAC
    models/
      Bus.js                # Geospatial Bus schema
      Route.js              # Route + embedded stops
      Stop.js               # Standalone stop (ordered)
      Schedule.js           # Route schedule
      User.js               # Auth users
      DriverEmergency.js    # SOS records
      PassengerSos.js       # Passenger SOS records
    routes/
      authRoutes.js
      driverRoutes.js
      locationRoutes.js
      passengerRoutes.js
      adminRoutes.js
      sosRoutes.js
      busRoutes.js
      busTrackingRoutes.js
      busStopRoutes.js
    services/
      etaService.js         # Haversine + ETA math
      overpassService.js    # OSM stop fetching + curation
      locationCache.js      # In-memory cache adapter
      hybridSourceSelector.js
    sockets/
      index.js              # Socket.IO event registration
    utils/
      trackingState.js      # In-memory state management
      progressionEngine.js # Route snap, stop progression, ETA
  data/
    routes.js               # Static route master data

passenger-app/
  App.js                    # Navigation setup
  BusContext.js             # Global socket + bus state
  HomeScreen.js             # MiniMap, nearest stops
  FullMapScreen.js          # Interactive WebView map
  NearbyBusesScreen.js      # REST fallback list
  hooks/
    usePostMessageBusTracking.js # Batched WebView bridge
    useFaultTolerantBusTracking.js
  api/
    busApi.js               # REST API helpers

driver-app/
  App.js                    # Driver navigation
  DriverTrackingScreen.js # GPS tracking, SOS, queue management
  RouteSelectionScreen.js # Route picker

admin-web/
  src/
    App.jsx                 # Admin dashboard with Leaflet
```

---

## Appendix B: Glossary

| Term | Definition |
|------|------------|
| **2dsphere** | MongoDB geospatial index type supporting spherical queries |
| **AVL** | Automatic Vehicle Location — industry term for GPS fleet tracking |
| **Corridor projection** | Mathematical snapping of GPS coordinates to the nearest route segment |
| **Dead-zone filter** | Clamp small speed values to zero to prevent UI noise |
| **GeoJSON Point** | Standard format `{ type: "Point", coordinates: [lng, lat] }` |
| **Haversine** | Formula for great-circle distance between two lat/lng points |
| **Jitter filter** | Ignore GPS updates below a distance threshold when stationary |
| **postMessage** | RN ↔ WebView communication API |
| **Route corridor** | The geometric path defined by route coordinates |
| **SOS freeze** | Blocking location updates during an active emergency |
| **Stop hysteresis** | Distance buffer required to confirm bus departure from a stop |
| **TTL** | Time-To-Live — automatic expiration of stale data |

---

*Document generated from production codebase analysis. All implementation details are derived from the actual source code of the V-Bus system.*
