import re

path = r'w:\Final year project\driver-app\DriverTrackingScreen.js'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Initial hold POST: add remainingDistanceMeters
old1 = '''        // POST during initial hold
        fetch(`${API_BASE_URL}/api/driver/location`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token && { "Authorization": `Bearer ${token}` }),
          },
          body: JSON.stringify({
            busId,
            lat: lat,
            lng: lng,
            speed: 0,
            source: "simulation",
            trackingActive: true,
          }),
        }).catch((err) => console.log("[SIMULATION POST] Failed:", err.message));'''
new1 = '''        // POST during initial hold
        const initialHoldRemaining = computeRemainingDistanceMeters(activeCoords, s.segmentIndex, s.segmentProgress);
        fetch(`${API_BASE_URL}/api/driver/location`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token && { "Authorization": `Bearer ${token}` }),
          },
          body: JSON.stringify({
            busId,
            lat: lat,
            lng: lng,
            speed: 0,
            remainingDistanceMeters: initialHoldRemaining,
            source: "simulation",
            trackingActive: true,
          }),
        }).catch((err) => console.log("[SIMULATION POST] Failed:", err.message));'''
content = content.replace(old1, new1, 1)

# 2. Stop hold POST: add remainingDistanceMeters
old2 = '''        // POST during stop hold
        fetch(`${API_BASE_URL}/api/driver/location`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token && { "Authorization": `Bearer ${token}` }),
          },
          body: JSON.stringify({
            busId,
            lat: lat,
            lng: lng,
            speed: 0,
            source: "simulation",
            trackingActive: true,
          }),
        }).catch((err) => console.log("[SIMULATION POST] Failed:", err.message));'''
new2 = '''        // POST during stop hold
        const stopHoldRemaining = computeRemainingDistanceMeters(activeCoords, s.segmentIndex, s.segmentProgress);
        fetch(`${API_BASE_URL}/api/driver/location`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token && { "Authorization": `Bearer ${token}` }),
          },
          body: JSON.stringify({
            busId,
            lat: lat,
            lng: lng,
            speed: 0,
            remainingDistanceMeters: stopHoldRemaining,
            source: "simulation",
            trackingActive: true,
          }),
        }).catch((err) => console.log("[SIMULATION POST] Failed:", err.message));'''
content = content.replace(old2, new2, 1)

# 3. Normal movement POST: add remainingDistanceMeters
old3 = '''      // POST to backend so progression engine computes stops / ETA for all clients
      fetch(`${API_BASE_URL}/api/driver/location`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token && { "Authorization": `Bearer ${token}` }),
        },
        body: JSON.stringify({
          busId,
          lat: lat,
          lng: lng,
          speed: derivedSpeed,
          source: "simulation",
          trackingActive: true,
        }),
      }).catch((err) => console.log("[SIMULATION POST] Failed:", err.message));'''
new3 = '''      // POST to backend so progression engine computes stops / ETA for all clients
      const remainingDistanceMeters = computeRemainingDistanceMeters(activeCoords, s.segmentIndex, s.segmentProgress);
      fetch(`${API_BASE_URL}/api/driver/location`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token && { "Authorization": `Bearer ${token}` }),
        },
        body: JSON.stringify({
          busId,
          lat: lat,
          lng: lng,
          speed: derivedSpeed,
          remainingDistanceMeters,
          source: "simulation",
          trackingActive: true,
        }),
      }).catch((err) => console.log("[SIMULATION POST] Failed:", err.message));'''
content = content.replace(old3, new3, 1)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print('done')
