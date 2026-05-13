import re

path = r'w:\Final year project\driver-app\DriverTrackingScreen.js'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Replace DEV_ROUTE_SIMULATION constant with tracking mode enum + default
old1 = """// ─────────────────────────────────────────────
// DEV-ONLY: Fake GPS injector for route corridor testing
// ⚠️  Set DEV_ROUTE_SIMULATION = false before production build
// ─────────────────────────────────────────────
const DEV_ROUTE_SIMULATION = true;
global.__devRouteSimulation = DEV_ROUTE_SIMULATION; // Expose for background task guard"""
new1 = """// ─────────────────────────────────────────────
// TRACKING MODE: REAL uses GPS, DEMO uses simulation
// ─────────────────────────────────────────────
const TRACKING_MODE = { REAL: "REAL", DEMO: "DEMO" };
const DEFAULT_TRACKING_MODE = TRACKING_MODE.REAL;

global.__trackingMode = DEFAULT_TRACKING_MODE; // Expose for background task"""
content = content.replace(old1, new1, 1)

# 2. Add trackingModeRef after simulationRef block
old2 = """  const simulationRef = useRef({
    segmentIndex: 0,
    segmentProgress: 0,
    currentStopIndex: 0,
    speed: 0,
    targetSpeed: 35,
    speedCurrent: 0,
    speedTarget: 35,
    speedLastChange: 0,
    stopUntil: 0,
    initialStopHoldUntil: 0,
    lastHeldStopIndex: -1,
    avgSpeed: 0,
    etaSmoothed: null,
    direction: direction || "OUTBOUND",
  });"""
new2 = """  const trackingModeRef = useRef(DEFAULT_TRACKING_MODE);
  const simulationRef = useRef({
    segmentIndex: 0,
    segmentProgress: 0,
    currentStopIndex: 0,
    speed: 0,
    targetSpeed: 35,
    speedCurrent: 0,
    speedTarget: 35,
    speedLastChange: 0,
    stopUntil: 0,
    initialStopHoldUntil: 0,
    lastHeldStopIndex: -1,
    avgSpeed: 0,
    etaSmoothed: null,
    occupancy: "MEDIUM",
    direction: direction || "OUTBOUND",
  });"""
content = content.replace(old2, new2, 1)

# 3. Background task: replace simulation block with mode check
old3 = """    // DEV SIMULATION BLOCK: do not emit real GPS during demo mode
    if (global.__devRouteSimulation) {
      console.log("[BG TASK] BLOCKED - simulation mode active");
      return;
    }"""
new3 = """    // MODE GUARD: in DEMO mode background task sends are owned by simulation loop
    if (global.__trackingMode === TRACKING_MODE.DEMO) {
      console.log("[BG TASK] Skipped - DEMO mode active");
      return;
    }"""
content = content.replace(old3, new3, 1)

# 4. sendLocationToBackend: replace simulation block
old4 = """    // DEV SIMULATION BLOCK: do not emit real GPS during demo mode
    if (DEV_ROUTE_SIMULATION) {
      console.log("[API] BLOCKED - simulation mode active");
      return;
    }"""
new4 = """    // MODE GUARD: in DEMO mode real GPS sends are skipped
    if (trackingModeRef.current === TRACKING_MODE.DEMO) {
      console.log("[API] Skipped - DEMO mode active");
      return;
    }"""
content = content.replace(old4, new4, 1)

# 5. flushQueue: replace simulation block
old5 = """    // DEV SIMULATION BLOCK: do not flush real GPS during demo mode
    if (DEV_ROUTE_SIMULATION) {
      console.log("[QUEUE] Flush blocked - simulation mode active");
      return;
    }"""
new5 = """    // MODE GUARD: in DEMO mode queue flush is skipped
    if (trackingModeRef.current === TRACKING_MODE.DEMO) {
      console.log("[QUEUE] Flush skipped - DEMO mode active");
      return;
    }"""
content = content.replace(old5, new5, 1)

# 6. Route fetch effect: replace DEV_ROUTE_SIMULATION check + add INBOUND normalization
old6 = """  // Fetch full route details (stops + routeCoords) for simulation
  useEffect(() => {
    if (!DEV_ROUTE_SIMULATION || !routeId) return;

    fetch(`${API_BASE_URL}/api/routes/${routeId}`)
      .then((res) => res.json())"""
new6 = """  // Fetch full route details (stops + routeCoords) for progression / snapping
  useEffect(() => {
    if (!routeId) return;

    fetch(`${API_BASE_URL}/api/routes/${routeId}`)
      .then((res) => res.json())"""
content = content.replace(old6, new6, 1)

# 7. After route fetch .then block: add INBOUND normalization
old7 = """      .then((data) => {
        if (data?.route) {
          routeDataRef.current = data.route;
          denseCoordsRef.current = buildDenseRoute(data.route.routeCoords || data.route.coordinates || [], 25);
          console.log("[ROUTE FETCH]", data.route.name, "coords:", denseCoordsRef.current.length);
        }
      })"""
new7 = """      .then((data) => {
        if (data?.route) {
          const rawRoute = data.route;
          // Normalize INBOUND once: reverse coords and stops
          const isInbound = direction === "INBOUND";
          const normalizedCoords = isInbound
            ? [...(rawRoute.routeCoords || rawRoute.coordinates || [])].reverse()
            : (rawRoute.routeCoords || rawRoute.coordinates || []);
          const normalizedStops = isInbound
            ? [...(rawRoute.stops || [])].reverse()
            : (rawRoute.stops || []);
          routeDataRef.current = {
            ...rawRoute,
            routeCoords: normalizedCoords,
            stops: normalizedStops,
          };
          denseCoordsRef.current = buildDenseRoute(normalizedCoords, 25);
          console.log("[ROUTE FETCH]", rawRoute.name, "coords:", denseCoordsRef.current.length, "direction:", direction);
        }
      })"""
content = content.replace(old7, new7, 1)

# 8. Simulation interval effect: replace check
old8 = """  // DEV ONLY: Stop-aware simulation interval
  useEffect(() => {
    if (!DEV_ROUTE_SIMULATION) return;"""
new8 = """  // DEMO ONLY: Stop-aware simulation interval
  useEffect(() => {
    if (trackingModeRef.current !== TRACKING_MODE.DEMO) return;"""
content = content.replace(old8, new8, 1)

# 9. watchPositionAsync callback: replace DEV check
old9 = """          // DEV: Real GPS blocked — simulation interval owns all sends
          if (DEV_ROUTE_SIMULATION) {
            console.log("[DEV GPS] Real GPS ignored");
            return;
          }"""
new9 = """          // MODE: in DEMO mode real GPS is ignored; in REAL mode it flows through
          if (trackingModeRef.current === TRACKING_MODE.DEMO) {
            console.log("[DEV GPS] Real GPS ignored - DEMO mode");
            return;
          }"""
content = content.replace(old9, new9, 1)

# 10. Startup simulation reset: replace check
old10 = """      // DEV ONLY: Reset simulation state for realistic startup
      if (DEV_ROUTE_SIMULATION) {"""
new10 = """      // DEMO ONLY: Reset simulation state for realistic startup
      if (trackingModeRef.current === TRACKING_MODE.DEMO) {"""
content = content.replace(old10, new10, 1)

# 11. Guarantee timeout: replace check
old11 = """        // DEV SIMULATION BLOCK: do not fetch real GPS during demo mode
        if (DEV_ROUTE_SIMULATION) {
          console.log("[TRACKING] Guaranteed update blocked - simulation mode");
          return;
        }"""
new11 = """        // MODE GUARD: in DEMO mode skip guaranteed GPS fetch
        if (trackingModeRef.current === TRACKING_MODE.DEMO) {
          console.log("[TRACKING] Guaranteed update skipped - DEMO mode");
          return;
        }"""
content = content.replace(old11, new11, 1)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print('DriverTrackingScreen migration done')
