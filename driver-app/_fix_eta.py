path = r'w:\Final year project\driver-app\DriverTrackingScreen.js'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Replace ETA calculation block
old = """      // Smooth ETA using avgSpeed
      let nextStopEtaMinutes = null;
      if (nextStop && s.avgSpeed > 1) {
        const etaSeconds = distToNextStop / (s.avgSpeed / 3.6);
        nextStopEtaMinutes = Math.max(1, Math.round(etaSeconds / 60));
      }

      // Route progress index = nearest dense coordinate
      const routeProgressIndex = Math.min(
        activeCoords.length - 1,
        s.segmentIndex
      );

      const derivedSpeed = Math.round(s.speed / 3.6);"""
new = """      // ETA based on final destination using simulatedSpeed only
      const remainingDistanceMeters = computeRemainingDistanceMeters(activeCoords, s.segmentIndex, s.segmentProgress);
      const remainingKm = remainingDistanceMeters / 1000;
      let nextStopEtaMinutes = null;
      if (remainingKm <= 0.05) {
        nextStopEtaMinutes = 0;
      } else if (s.speed > 1) {
        const rawEta = (remainingKm / s.speed) * 60;
        let newEta = Math.max(0, Math.round(rawEta));
        if (s.etaSmoothed === null) {
          s.etaSmoothed = newEta;
        } else {
          s.etaSmoothed = s.etaSmoothed * 0.7 + newEta * 0.3;
        }
        nextStopEtaMinutes = Math.round(s.etaSmoothed);
      }

      // Route progress index = nearest dense coordinate
      const routeProgressIndex = Math.min(
        activeCoords.length - 1,
        s.segmentIndex
      );

      const derivedSpeed = Math.round(s.speed / 3.6);"""
content = content.replace(old, new, 1)

# Remove the duplicate computeRemainingDistanceMeters before POST since we now compute it above
old_post = """      // POST to backend so progression engine computes stops / ETA for all clients
      const remainingDistanceMeters = computeRemainingDistanceMeters(activeCoords, s.segmentIndex, s.segmentProgress);
      fetch"""
new_post = """      // POST to backend so progression engine computes stops / ETA for all clients
      fetch"""
content = content.replace(old_post, new_post, 1)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print('done')
