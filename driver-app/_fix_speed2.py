path = r'w:\Final year project\driver-app\DriverTrackingScreen.js'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Replace getRandomCruiseSpeed to return 30-65 range
old1 = """function getRandomCruiseSpeed() {
  const r = Math.random();
  if (r < 0.55) return 35 + Math.random() * 10;      // 35-45 (most common)
  if (r < 0.85) return 45 + Math.random() * 15;      // 45-60 (occasional)
  return 60 + Math.random() * 20;                    // 60-80 (rare spike)
}"""
new1 = """function getRandomCruiseSpeed() {
  return 30 + Math.random() * 35; // 30-65 km/h
}"""
content = content.replace(old1, new1, 1)

# 2. Replace simulationRef: swap cruiseTarget/nextCruiseChangeAt for speedStateRef pattern
# Actually, the user said "add speedStateRef" but the simulationRef already holds speed state.
# Let's keep it simple: replace cruiseTarget/nextCruiseChangeAt with speedCurrent/speedTarget/speedLastChange
old2 = """  const simulationRef = useRef({
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
new2 = """  const simulationRef = useRef({
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
content = content.replace(old2, new2, 1)

# 3. Replace startup reset block
old3 = """        simulationRef.current.segmentIndex = 0;
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
new3 = """        simulationRef.current.segmentIndex = 0;
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
        simulationRef.current.initialStopHoldUntil = Date.now() + 4000;"""
content = content.replace(old3, new3, 1)

# 4. Replace post-hold relaunch + periodic refresh + smooth interpolation block
old4 = """      // Post-hold instant relaunch: speed 0 → 28-35 km/h immediately
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
new4 = """      // Post-hold gradual relaunch: pick target, let interpolation handle it
      if (s.speed < 5 && s.stopUntil <= now && s.speedTarget < 10) {
        s.speedTarget = getRandomCruiseSpeed();
        s.speedLastChange = now;
      }

      // Periodic target refresh (every 8-15 seconds)
      if (now - s.speedLastChange >= 8000 + Math.random() * 7000) {
        s.speedTarget = getRandomCruiseSpeed();
        s.speedLastChange = now;
      }

      // Smooth speed interpolation with clamped delta per tick
      const delta = s.speedTarget - s.speedCurrent;
      const maxDelta = 1.5;
      let step = delta * 0.08;
      if (step > maxDelta) step = maxDelta;
      if (step < -maxDelta) step = -maxDelta;
      s.speedCurrent += step;
      if (s.speedCurrent < 0) s.speedCurrent = 0;
      if (s.speedCurrent > 80) s.speedCurrent = 80;
      s.speed = s.speedCurrent;"""
content = content.replace(old4, new4, 1)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print('step1 done')
