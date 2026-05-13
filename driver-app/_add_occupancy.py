path = r'w:\Final year project\driver-app\DriverTrackingScreen.js'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Initial hold POST
old1 = """          body: JSON.stringify({
            busId,
            lat: lat,
            lng: lng,
            speed: 0,
            remainingDistanceMeters: initialHoldRemaining,
            source: "simulation",
            trackingActive: true,
          }),"""
new1 = """          body: JSON.stringify({
            busId,
            lat: lat,
            lng: lng,
            speed: 0,
            remainingDistanceMeters: initialHoldRemaining,
            occupancy: s.occupancy,
            source: "simulation",
            trackingActive: true,
          }),"""
content = content.replace(old1, new1, 1)

# 2. Stop hold POST
old2 = """          body: JSON.stringify({
            busId,
            lat: lat,
            lng: lng,
            speed: 0,
            remainingDistanceMeters: stopHoldRemaining,
            source: "simulation",
            trackingActive: true,
          }),"""
new2 = """          body: JSON.stringify({
            busId,
            lat: lat,
            lng: lng,
            speed: 0,
            remainingDistanceMeters: stopHoldRemaining,
            occupancy: s.occupancy,
            source: "simulation",
            trackingActive: true,
          }),"""
content = content.replace(old2, new2, 1)

# 3. Normal movement POST
old3 = """          body: JSON.stringify({
          busId,
          lat: lat,
          lng: lng,
          speed: derivedSpeed,
          remainingDistanceMeters,
          source: "simulation",
          trackingActive: true,
        }),"""
new3 = """          body: JSON.stringify({
          busId,
          lat: lat,
          lng: lng,
          speed: derivedSpeed,
          remainingDistanceMeters,
          occupancy: s.occupancy,
          source: "simulation",
          trackingActive: true,
        }),"""
content = content.replace(old3, new3, 1)

# 4. Real GPS requestBody in sendLocationToBackend
old4 = """      const requestBody = {
        busId,
        lat: latitude,
        lng: longitude,
        accuracy: accuracy || null,
        altitude: altitude || null,
        heading: heading || null,
        speed: finalSpeed, // Computed speed (Haversine), not GPS
        source: isFromQueue ? "queue_retry" : "watch_position",
        timestamp: new Date().toISOString(),
        trackingActive: global.__trackingActive, // Dynamic tracking state
      };"""
new4 = """      const requestBody = {
        busId,
        lat: latitude,
        lng: longitude,
        accuracy: accuracy || null,
        altitude: altitude || null,
        heading: heading || null,
        speed: finalSpeed, // Computed speed (Haversine), not GPS
        occupancy: simulationRef.current?.occupancy || "MEDIUM",
        source: isFromQueue ? "queue_retry" : "watch_position",
        timestamp: new Date().toISOString(),
        trackingActive: global.__trackingActive, // Dynamic tracking state
      };"""
content = content.replace(old4, new4, 1)

# 5. Background task requestBody
old5 = """    const requestBody = {
      busId,
      lat: latitude,
      lng: longitude,
      accuracy: accuracy || null,
      altitude: altitude || null,
      heading: heading || null,
      speed: finalSpeed, // Computed speed (Haversine), not GPS
      source: "background_task",
      timestamp: new Date().toISOString(),
      trackingActive: global.__trackingActive, // Dynamic tracking state
    };"""
new5 = """    const requestBody = {
      busId,
      lat: latitude,
      lng: longitude,
      accuracy: accuracy || null,
      altitude: altitude || null,
      heading: heading || null,
      speed: finalSpeed, // Computed speed (Haversine), not GPS
      occupancy: simulationRef.current?.occupancy || "MEDIUM",
      source: "background_task",
      timestamp: new Date().toISOString(),
      trackingActive: global.__trackingActive, // Dynamic tracking state
    };"""
content = content.replace(old5, new5, 1)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print('occupancy added to posts')
