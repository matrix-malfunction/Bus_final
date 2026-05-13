path = r'w:\Final year project\passenger-app\BusContext.js'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

old = """          nextStopEtaMinutes: data.nextStopEtaMinutes ?? prev.nextStopEtaMinutes ?? null,
          remainingDistanceMeters: data.remainingDistanceMeters ?? prev.remainingDistanceMeters ?? null,
          routeProgressIndex: data.routeProgressIndex ?? prev.routeProgressIndex ?? null,
        };"""
new = """          nextStopEtaMinutes: data.nextStopEtaMinutes ?? prev.nextStopEtaMinutes ?? null,
          remainingDistanceMeters: data.remainingDistanceMeters ?? prev.remainingDistanceMeters ?? null,
          routeProgressIndex: data.routeProgressIndex ?? prev.routeProgressIndex ?? null,
          occupancy: data.occupancy ?? prev.occupancy ?? "UNKNOWN",
        };"""
content = content.replace(old, new, 1)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print('BusContext occupancy added')
