path = r'w:\Final year project\passenger-app\FullMapScreen.js'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update popup occupancy display from percentage to string label
old1 = """                  '<div style="margin-top:4px;">' +
                    '<strong>Occupancy:</strong> ' + Math.round(((bus.occupancy || 0) / (bus.capacity || 50)) * 100) + '%' +
                  '</div>' +"""
new1 = """                  '<div style="margin-top:4px;">' +
                    '<strong>Occupancy:</strong> ' + (bus.occupancy || "UNKNOWN") +
                  '</div>' +"""
content = content.replace(old1, new1, 1)

# 2. Add occupancy to FullMap POSTMESSAGE log (first occurrence)
old2 = """    console.log("[FULLMAP POSTMESSAGE]", activeBuses.map(b => ({
      busId: b.busId,
      currentStopName: b.currentStopName,
      nextStopName: b.nextStopName,
      nextStopEtaMinutes: b.nextStopEtaMinutes,
      direction: b.direction,
      derivedSpeed: b.derivedSpeed,
      speed: b.speed,
    })));"""
new2 = """    console.log("[FULLMAP POSTMESSAGE]", activeBuses.map(b => ({
      busId: b.busId,
      currentStopName: b.currentStopName,
      nextStopName: b.nextStopName,
      nextStopEtaMinutes: b.nextStopEtaMinutes,
      direction: b.direction,
      derivedSpeed: b.derivedSpeed,
      speed: b.speed,
      occupancy: b.occupancy,
    })));"""
content = content.replace(old2, new2, 1)

# 3. Add occupancy to second POSTMESSAGE log (MAP_READY recovery)
old3 = """          console.log("[FULLMAP POSTMESSAGE]", latestBuses.map(b => ({
            busId: b.busId,
            currentStopName: b.currentStopName,
            nextStopName: b.nextStopName,
            nextStopEtaMinutes: b.nextStopEtaMinutes,
            direction: b.direction,
            derivedSpeed: b.derivedSpeed,
            speed: b.speed,
          })));"""
new3 = """          console.log("[FULLMAP POSTMESSAGE]", latestBuses.map(b => ({
            busId: b.busId,
            currentStopName: b.currentStopName,
            nextStopName: b.nextStopName,
            nextStopEtaMinutes: b.nextStopEtaMinutes,
            direction: b.direction,
            derivedSpeed: b.derivedSpeed,
            speed: b.speed,
            occupancy: b.occupancy,
          })));"""
content = content.replace(old3, new3, 1)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print('FullMapScreen occupancy updated')
