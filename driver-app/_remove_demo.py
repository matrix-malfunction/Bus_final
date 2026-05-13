path = r'w:\Final year project\driver-app\DriverTrackingScreen.js'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Remove the demo route override in startTracking
old_override = '''      let { latitude, longitude } = currentLoc.coords;

      // DEMO ROUTE: override real GPS with route start so backend snapping succeeds
      const isDemoRoute = routeId?.includes("DEMO");
      if (isDemoRoute && denseCoordsRef.current && denseCoordsRef.current.length >= 2) {
        const routeStart = denseCoordsRef.current[0];
        latitude = routeStart[0];
        longitude = routeStart[1];
        console.log("[SIMULATION] Using route start:", latitude, longitude);
      }

      setCurrentLocation({ latitude, longitude });'''

new_override = '''      const { latitude, longitude } = currentLoc.coords;
      setCurrentLocation({ latitude, longitude });'''

if old_override in content:
    content = content.replace(old_override, new_override)
    print('Removed demo route override')
else:
    print('WARNING: Could not find demo route override')

# 2. Remove background task DEMO guard
old_bg = '''    // MODE GUARD: in DEMO mode background task sends are owned by simulation loop
    if (global.__trackingMode === TRACKING_MODE.DEMO) {
      console.log("[BG TASK] Skipped - DEMO mode active");
      return;
    }

    '''

if old_bg in content:
    content = content.replace(old_bg, '')
    print('Removed background task DEMO guard')
else:
    print('WARNING: Could not find background task DEMO guard')

# 3. Remove sendLocationToBackend DEMO guard
old_send = '''    // MODE GUARD: in DEMO mode real GPS sends are skipped
    if (trackingModeRef.current === TRACKING_MODE.DEMO) {
      console.log("[API] Skipped - DEMO mode active");
      return;
    }

    '''

if old_send in content:
    content = content.replace(old_send, '')
    print('Removed sendLocationToBackend DEMO guard')
else:
    print('WARNING: Could not find sendLocationToBackend DEMO guard')

# 4. Remove queue flush DEMO guard
old_queue = '''    // MODE GUARD: in DEMO mode queue flush is skipped
    if (trackingModeRef.current === TRACKING_MODE.DEMO) {
      console.log("[QUEUE] Flush skipped - DEMO mode active");
      return;
    }

    '''

if old_queue in content:
    content = content.replace(old_queue, '')
    print('Removed queue flush DEMO guard')
else:
    print('WARNING: Could not find queue flush DEMO guard')

# 5. Remove watchPositionAsync DEMO guard
old_watch = '''        (location) => {
          // MODE: in DEMO mode real GPS is ignored; in REAL mode it flows through
          if (trackingModeRef.current === TRACKING_MODE.DEMO) {
            console.log("[DEV GPS] Real GPS ignored - DEMO mode");
            return;
          }

          const { latitude, longitude } = location.coords;'''

new_watch = '''        (location) => {
          const { latitude, longitude } = location.coords;'''

if old_watch in content:
    content = content.replace(old_watch, new_watch)
    print('Removed watchPositionAsync DEMO guard')
else:
    print('WARNING: Could not find watchPositionAsync DEMO guard')

# 6. Remove guaranteed update DEMO guard
old_guarantee = '''        // MODE GUARD: in DEMO mode skip guaranteed GPS fetch
        if (trackingModeRef.current === TRACKING_MODE.DEMO) {
          console.log("[TRACKING] Guaranteed update skipped - DEMO mode");
          return;
        }
        try {'''

new_guarantee = '''        try {'''

if old_guarantee in content:
    content = content.replace(old_guarantee, new_guarantee)
    print('Removed guaranteed update DEMO guard')
else:
    print('WARNING: Could not find guaranteed update DEMO guard')

# 7. Remove simulation reset block
old_sim_reset = '''      // DEMO ONLY: Reset simulation state for realistic startup
      if (trackingModeRef.current === TRACKING_MODE.DEMO) {
        simulationRef.current.segmentIndex = 0;
        simulationRef.current.segmentProgress = 0;
        simulationRef.current.currentStopIndex = 0;
        simulationRef.current.speed = 0;
        simulationRef.current.avgSpeed = 0;
        simulationRef.current.targetSpeed = 35;
        simulationRef.current.speedCurrent = 0;
        simulationRef.current.speedTarget = 35;
        simulationRef.current.speedLastChange = 0;
        simulationRef.current.stopUntil = 0;
        simulationRef.current.lastHeldStopIndex = -1;
        simulationRef.current.etaSmoothed = null;
        simulationRef.current.initialStopHoldUntil = Date.now() + 4000;
        console.log("[SIMULATION] Reset state with 4s startup hold");
      }

      '''

if old_sim_reset in content:
    content = content.replace(old_sim_reset, '')
    print('Removed simulation reset block')
else:
    print('WARNING: Could not find simulation reset block')

# 8. Remove the entire simulation useEffect (lines 906-1248)
# Find from "// DEMO ONLY: Stop-aware simulation interval" to "// Call backend to start tracking"
old_sim_effect = '''  // DEMO ONLY: Stop-aware simulation interval
  useEffect(() => {
    if (trackingModeRef.current !== TRACKING_MODE.DEMO) return;

    const interval = setInterval(() => {'''

# Find the end of the useEffect
sim_start_idx = content.find(old_sim_effect)
if sim_start_idx != -1:
    # Find the end: "}, []);" after the interval
    # Look for the pattern that ends the useEffect
    sim_end_marker = "    devSimIntervalRef.current = interval;\n    return () => clearInterval(interval);\n  }, []);\n\n  // Call backend to start tracking"
    sim_end_idx = content.find(sim_end_marker)
    if sim_end_idx != -1:
        # Remove from sim_start to sim_end, keeping the "// Call backend" part
        content = content[:sim_start_idx] + "  // Call backend to start tracking" + content[sim_end_idx + len(sim_end_marker):]
        print('Removed simulation useEffect')
    else:
        print('WARNING: Could not find simulation useEffect end marker')
else:
    print('WARNING: Could not find simulation useEffect start')

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print('Done')
