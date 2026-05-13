path = r'w:\Final year project\driver-app\DriverTrackingScreen.js'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

old = '''    try {
      // Get current location immediately for backend start API
      const currentLoc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High
      });
      const { latitude, longitude } = currentLoc.coords;
      setCurrentLocation({ latitude, longitude });

      // Call backend to start tracking (emits BUS_LOCATION_UPDATE immediately)
      await callBackendStartTracking(latitude, longitude);'''

new = '''    try {
      // Get current location immediately for backend start API
      const currentLoc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High
      });
      let { latitude, longitude } = currentLoc.coords;

      // DEMO ROUTE: override real GPS with route start so backend snapping succeeds
      const isDemoRoute = routeId?.includes("DEMO");
      if (isDemoRoute && denseCoordsRef.current && denseCoordsRef.current.length >= 2) {
        const routeStart = denseCoordsRef.current[0];
        latitude = routeStart[0];
        longitude = routeStart[1];
        console.log("[SIMULATION] Using route start:", latitude, longitude);
      }

      setCurrentLocation({ latitude, longitude });

      // Call backend to start tracking (emits BUS_LOCATION_UPDATE immediately)
      await callBackendStartTracking(latitude, longitude);'''

if old in content:
    content = content.replace(old, new)
    print('Replaced startTracking block')
else:
    print('WARNING: Could not find startTracking block')

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print('Done')
