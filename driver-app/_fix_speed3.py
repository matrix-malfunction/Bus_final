path = r'w:\Final year project\driver-app\DriverTrackingScreen.js'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update arrival logic to zero both speedCurrent and speedTarget
old1 = """      // Arrival logic: within 35m of next stop — edge-triggered, hold once per stop
      if (distToNextStop < 35 && nextStop) {
        if (s.currentStopIndex !== s.lastHeldStopIndex) {
          s.stopUntil = now + 5000;
          s.speed = 0;
          s.avgSpeed = 0;
          s.lastHeldStopIndex = s.currentStopIndex;
          s.currentStopIndex++;

          console.log("[SIMULATION ARRIVAL]", {
            stopName: nextStop.name,
            currentStopIndex: s.currentStopIndex,
            direction: s.direction,
          });
        }"""
new1 = """      // Arrival logic: within 35m of next stop — edge-triggered, hold once per stop
      if (distToNextStop < 35 && nextStop) {
        if (s.currentStopIndex !== s.lastHeldStopIndex) {
          s.stopUntil = now + 5000;
          s.speed = 0;
          s.speedCurrent = 0;
          s.speedTarget = 0;
          s.avgSpeed = 0;
          s.lastHeldStopIndex = s.currentStopIndex;
          s.currentStopIndex++;

          console.log("[SIMULATION ARRIVAL]", {
            stopName: nextStop.name,
            currentStopIndex: s.currentStopIndex,
            direction: s.direction,
          });
        }"""
content = content.replace(old1, new1, 1)

# 2. Update first end-of-route reversal block
old2 = """          s.targetSpeed = 35;
          s.cruiseTarget = 30 + Math.random() * 5;
          s.nextCruiseChangeAt = 0;
          s.avgSpeed = 0;"""
new2 = """          s.targetSpeed = 35;
          s.speedCurrent = 0;
          s.speedTarget = 35;
          s.speedLastChange = 0;
          s.avgSpeed = 0;
          s.etaSmoothed = null;"""
content = content.replace(old2, new2, 1)

# 3. Update second end-of-route reversal block (after skip)
old3 = """              s.targetSpeed = 35;
              s.cruiseTarget = 30 + Math.random() * 5;
              s.nextCruiseChangeAt = 0;
              s.avgSpeed = 0;"""
new3 = """              s.targetSpeed = 35;
              s.speedCurrent = 0;
              s.speedTarget = 35;
              s.speedLastChange = 0;
              s.avgSpeed = 0;
              s.etaSmoothed = null;"""
content = content.replace(old3, new3, 1)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print('step2 done')
