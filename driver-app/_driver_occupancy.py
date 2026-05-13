path = r'w:\Final year project\driver-app\DriverTrackingScreen.js'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add occupancy to component props
old1 = """export default function DriverTrackingScreen({
  token,
  routeId,
  routeName,
  routeColor,
  direction
}) {"""
new1 = """export default function DriverTrackingScreen({
  token,
  routeId,
  routeName,
  routeColor,
  direction,
  occupancy
}) {"""
content = content.replace(old1, new1, 1)

# 2. Add occupancy to debug log
old2 = """  console.log("[TRACKING SCREEN PARAMS]", {
    routeId,
    routeName,
    routeColor,
    direction,
  });"""
new2 = """  console.log("[TRACKING SCREEN PARAMS]", {
    routeId,
    routeName,
    routeColor,
    direction,
    occupancy,
  });"""
content = content.replace(old2, new2, 1)

# 3. Initialize simulationRef occupancy from prop
old3 = """    etaSmoothed: null,
    occupancy: "MEDIUM",
    direction: direction || "OUTBOUND",
  });"""
new3 = """    etaSmoothed: null,
    occupancy: occupancy || "MEDIUM",
    direction: direction || "OUTBOUND",
  });"""
content = content.replace(old3, new3, 1)

# 4. Remove duplicate INBOUND reversal in simulation loop (normalized at fetch time)
old4 = """      let activeStops = route.stops;
      let activeCoords = denseCoords;
      if (s.direction === "INBOUND") {
        activeStops = [...route.stops].reverse();
        activeCoords = [...denseCoords].reverse();
      }"""
new4 = """      let activeStops = route.stops;
      let activeCoords = denseCoords;"""
content = content.replace(old4, new4, 1)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print('DriverTrackingScreen occupancy wired')
