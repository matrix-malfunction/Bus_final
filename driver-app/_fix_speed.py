path = r'w:\Final year project\driver-app\DriverTrackingScreen.js'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Replace getSegmentSpeed with getRandomCruiseSpeed
old1 = """function getSegmentSpeed(routeProgress) {
  if (routeProgress < 0.05) {
    // Startup: 0 → 10 km/h
    return lerp(0, 10, routeProgress / 0.05);
  } else if (routeProgress > 0.92) {
    // End of route: slow down 30 → 8 km/h
    return lerp(30, 8, (routeProgress - 0.92) / 0.08);
  }
  // Cruise: 30-80 km/h with natural wave + slight random jitter
  const wave = Math.sin(routeProgress * Math.PI * 6) * 15;
  const jitter = (Math.random() - 0.5) * 6;
  return Math.max(30, Math.min(80, 55 + wave + jitter));
}"""
new1 = """function getRandomCruiseSpeed() {
  const r = Math.random();
  if (r < 0.55) return 35 + Math.random() * 10;      // 35-45 (most common)
  if (r < 0.85) return 45 + Math.random() * 15;      // 45-60 (occasional)
  return 60 + Math.random() * 20;                    // 60-80 (rare spike)
}"""
content = content.replace(old1, new1, 1)

# 2. Add cruiseTarget and nextCruiseChangeAt to simulationRef
old2 = """  const simulationRef = useRef({
    segmentIndex: 0,
    segmentProgress: 0,
    currentStopIndex: 0,
    speed: 0,
    targetSpeed: 35,
    stopUntil: 0,
    initialStopHoldUntil: 0,
    lastHeldStopIndex: -1,
    avgSpeed: 0,
    direction: direction || "OUTBOUND",
  });"""
new2 = """  const simulationRef = useRef({
    segmentIndex: 0,
    segmentProgress: 0,
    currentStopIndex: 0,
    speed: 0,
    targetSpeed: 35,
    cruiseTarget: 35,
    nextCruiseChangeAt: 0,
    stopUntil: 0,
    initialStopHoldUntil: 0,
    lastHeldStopIndex: -1,
    avgSpeed: 0,
    direction: direction || "OUTBOUND",
  });"""
content = content.replace(old2, new2, 1)

# 3. Update reset block in startTracking
old3 = """        simulationRef.current.segmentIndex = 0;
        simulationRef.current.segmentProgress = 0;
        simulationRef.current.currentStopIndex = 0;
        simulationRef.current.speed = 0;
        simulationRef.current.avgSpeed = 0;
        simulationRef.current.targetSpeed = 35;
        simulationRef.current.stopUntil = 0;
        simulationRef.current.lastHeldStopIndex = -1;
        simulationRef.current.initialStopHoldUntil = Date.now() + 4000;"""
new3 = """        simulationRef.current.segmentIndex = 0;
        simulationRef.current.segmentProgress = 0;
        simulationRef.current.currentStopIndex = 0;
        simulationRef.current.speed = 0;
        simulationRef.current.avgSpeed = 0;
        simulationRef.current.targetSpeed = 35;
        simulationRef.current.cruiseTarget = 30 + Math.random() * 5;
        simulationRef.current.nextCruiseChangeAt = 0;
        simulationRef.current.stopUntil = 0;
        simulationRef.current.lastHeldStopIndex = -1;
        simulationRef.current.initialStopHoldUntil = Date.now() + 4000;"""
content = content.replace(old3, new3, 1)

# 4. Replace adaptive acceleration block with cruise interpolation
old4 = """      // Adaptive acceleration
      const delta = s.targetSpeed - s.speed;
      let accelFactor;
      if (s.speed < 5) {
        accelFactor = 0.01;
      } else if (s.speed < 20) {
        accelFactor = 0.02;
      } else {
        accelFactor = 0.035;
      }
      s.speed += delta * accelFactor;
      if (s.speed < 0.05) s.speed = 0;"""
new4 = """      // Post-hold instant relaunch: speed 0 → 28-35 km/h immediately
      if (s.speed < 5 && s.stopUntil <= now) {
        s.speed = 28 + Math.random() * 7;
        s.cruiseTarget = getRandomCruiseSpeed();
        s.nextCruiseChangeAt = now + 4000 + Math.random() * 6000;
      }

      // Periodic cruise target refresh (every 4-10 seconds)
      if (now >= s.nextCruiseChangeAt) {
        s.cruiseTarget = getRandomCruiseSpeed();
        s.nextCruiseChangeAt = now + 4000 + Math.random() * 6000;
      }

      // Smooth cruise interpolation
      const delta = s.cruiseTarget - s.speed;
      const accelRate = delta > 0 ? 0.18 : 0.08;
      s.speed += delta * accelRate;

      // Clamp
      if (s.speed < 0) s.speed = 0;
      if (s.speed > 80) s.speed = 80;"""
content = content.replace(old4, new4, 1)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print('done')
